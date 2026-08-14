import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import { buildCharacterCompatibilityReport } from '../src/characters/characterCompatibility';
import { canCommitCatalogUpdate } from '../src/catalog/catalogUpdateTransaction';
import { useCharacterChoiceBridge } from '../src/catalog/useCharacterChoiceBridge';
import { useCatalogStore } from '../src/store/catalogStore';
import { useCharacterStore } from '../src/store/characterStore';
import { useCatalogUpdateSessionStore } from '../src/store/catalogUpdateSessionStore';

export default function CatalogUpdateScreen() {
  const router = useRouter();
  const snapshot = useCatalogStore((state) => state.snapshot);
  const filterState = useCatalogStore((state) => state.filterState);
  const runtimeRef = useCatalogStore((state) => state.runtimeRef);
  const characters = useCharacterStore((state) => state.characters);
  const bridge = useCharacterChoiceBridge();
  const session = useCatalogUpdateSessionStore((state) => state.activeSession);
  const history = useCatalogUpdateSessionStore((state) => state.history);
  const prepareCandidate = useCatalogUpdateSessionStore((state) => state.prepareCandidate);
  const setMigrationCharacterIds = useCatalogUpdateSessionStore((state) => state.setMigrationCharacterIds);
  const acknowledgeImpact = useCatalogUpdateSessionStore((state) => state.acknowledgeImpact);
  const acknowledgeEvidence = useCatalogUpdateSessionStore((state) => state.acknowledgeEvidence);
  const acknowledgeBlockingReferences = useCatalogUpdateSessionStore((state) => state.acknowledgeBlockingReferences);
  const commit = useCatalogUpdateSessionStore((state) => state.commit);
  const resumeCommit = useCatalogUpdateSessionStore((state) => state.resumeCommit);
  const rollback = useCatalogUpdateSessionStore((state) => state.rollback);
  const discard = useCatalogUpdateSessionStore((state) => state.discard);
  const finalizeCommitted = useCatalogUpdateSessionStore((state) => state.finalizeCommitted);
  const clearFinished = useCatalogUpdateSessionStore((state) => state.clearFinished);
  const [rawText, setRawText] = useState('');
  const [checksum, setChecksum] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [busy, setBusy] = useState(false);

  const currentReports = useMemo(() => {
    if (!snapshot || !filterState || bridge.status !== 'ready') return [];
    return characters.map((character) => buildCharacterCompatibilityReport({ character, snapshot, filterState, choices: bridge.choices }));
  }, [bridge.choices, bridge.status, characters, filterState, snapshot]);

  const chooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/json', 'text/plain'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    try {
      setRawText(await new File(result.assets[0].uri).text());
      setSourceName(result.assets[0].name);
    } catch (error) {
      Alert.alert('Arquivo não lido', error instanceof Error ? error.message : 'Não foi possível ler o bundle.');
    }
  };

  const prepare = async () => {
    if (!rawText.trim()) return;
    setBusy(true);
    const result = await prepareCandidate({ rawText, sourceName: sourceName || undefined, expectedChecksum: checksum.trim() || undefined, currentReports });
    setBusy(false);
    if (!result.ok) return Alert.alert('Candidato rejeitado', result.issues.join('\n'));
    setRawText('');
    Alert.alert('Candidato preparado', 'O catálogo ativo ainda não foi substituído. Revise o diff e os impactos antes do commit.');
  };

  const runCommit = async (resume = false) => {
    setBusy(true);
    const result = await (resume ? resumeCommit() : commit());
    setBusy(false);
    Alert.alert(result.ok ? 'Atualização concluída' : 'Atualização não concluída', result.ok ? 'O novo catálogo foi ativado em uma única sessão e a versão anterior permanece disponível para rollback.' : result.issues.join('\n'));
  };

  const runRollback = async () => {
    setBusy(true);
    const result = await rollback();
    setBusy(false);
    Alert.alert(result.ok ? 'Rollback concluído' : 'Rollback não concluído', result.ok ? 'O catálogo, os filtros e os snapshots das fichas foram restaurados.' : result.issues.join('\n'));
  };

  const validation = session ? canCommitCatalogUpdate(session) : undefined;

  return (
    <Screen title="Atualização do catálogo" subtitle="Valide assinatura, origem, impactos e confirme ou reverta a troca transacionalmente.">
      <Card title="Versão ativa" subtitle={snapshot ? `${snapshot.catalogVersion} · ${snapshot.snapshotId}` : 'Catálogo ainda não carregado'}>
        <Text style={styles.muted}>Origem: {runtimeRef.kind === 'bundled' ? 'bundle incluído no aplicativo' : runtimeRef.packageId}</Text>
        <Text style={styles.muted}>{snapshot?.entries.length.toLocaleString('pt-BR') ?? 0} entidades · {characters.length} personagem(ns)</Text>
      </Card>

      {!session ? (
        <Card title="Preparar bundle candidato" subtitle="Somente envelopes assinados por publicadores confiáveis seguem para o preview.">
          <Button testID="catalog-update-pick" label="Selecionar envelope assinado" secondary onPress={() => { void chooseFile(); }} />
          <Field testID="catalog-update-source" label="Nome da origem" value={sourceName} onChangeText={setSourceName} />
          <Field testID="catalog-update-checksum" label="SHA-256 do envelope (opcional)" value={checksum} onChangeText={setChecksum} autoCapitalize="none" />
          <Field testID="catalog-update-json" label="Envelope assinado JSON" value={rawText} onChangeText={setRawText} multiline style={styles.json} autoCapitalize="none" />
          <Button testID="catalog-update-prepare" label="Validar assinatura e preparar" onPress={() => { void prepare(); }} disabled={busy || !rawText.trim() || !snapshot || bridge.status !== 'ready'} />
          <Button testID="catalog-update-open-trust" label="Gerenciar publicadores confiáveis" variant="text" onPress={() => router.push('/catalog-trust')} />
        </Card>
      ) : (
        <>
          <Card title={`Sessão ${session.status}`} subtitle={`${session.diff.fromVersion} → ${session.diff.toVersion}`}>
            <Text testID="catalog-update-candidate-version" style={styles.strong}>Snapshot alvo: {session.diff.toSnapshotId}</Text>
            <Text style={session.diff.versionDirection === 'downgrade' ? styles.warning : styles.muted}>Direção: {session.diff.versionDirection}</Text>
            <Text style={styles.muted}>Checksum: {session.candidate.checksum}</Text>
            <Text style={styles.muted}>Fase do commit: {session.commitPhase} · rollback: {session.rollbackPhase}</Text>
            {session.lastError ? <Text style={styles.error}>{session.lastError}</Text> : null}
          </Card>

          <Card title="Origem e assinatura" subtitle={session.trustVerification ? 'Cadeia criptográfica validada antes do preview.' : 'Fixture interna de testes; não disponível na interface de produção.'}>
            {session.trustVerification ? (
              <>
                <Text testID="catalog-update-trust-status" style={styles.success}>Assinatura válida · {session.trustVerification.chainStatus}</Text>
                <Text style={styles.strong}>{session.trustVerification.publisherName}</Text>
                <Text style={styles.muted}>{session.trustVerification.publisherKind} · {session.trustVerification.trustLevel}</Text>
                <Text style={styles.muted}>Chave: {session.trustVerification.keyId}</Text>
                <Text selectable style={styles.fingerprint}>{session.trustVerification.keyFingerprint}</Text>
                <Text style={styles.muted}>Sequência: {session.trustVerification.sequence} · emitido em {session.trustVerification.issuedAt}</Text>
                <Text selectable style={styles.fingerprint}>Catálogo: {session.trustVerification.catalogChecksum}</Text>
              </>
            ) : <Text style={styles.warning}>Sem prova criptográfica persistida.</Text>}
          </Card>

          <Card title="Comparação entre versões" subtitle="IDs modificados incluem mudanças mecânicas, de registro ou de dependências.">
            <Text testID="catalog-update-added">Adicionadas: {session.diff.addedEntityIds.length}</Text>
            <Text testID="catalog-update-removed">Removidas: {session.diff.removedEntityIds.length}</Text>
            <Text testID="catalog-update-changed">Alteradas: {session.diff.changedEntityIds.length}</Text>
            <Text>Dependências: {session.diff.dependencyEdgesBefore.toLocaleString('pt-BR')} → {session.diff.dependencyEdgesAfter.toLocaleString('pt-BR')} ({session.diff.dependencyEdgeDelta >= 0 ? '+' : ''}{session.diff.dependencyEdgeDelta})</Text>
            <Text>Livros: +{session.diff.addedBookIds.length} / -{session.diff.removedBookIds.length} · categorias: +{session.diff.addedCategoryIds.length} / -{session.diff.removedCategoryIds.length}</Text>
          </Card>

          <Card title="Impacto preventivo" subtitle={`${session.impact.counts.charactersExamined} ficha(s) examinada(s)`}>
            <Text testID="catalog-update-affected-characters">Afetadas por mudanças de regras: {session.impact.counts.charactersAffected}</Text>
            <Text>Exigem migração explícita de snapshot: {session.impact.counts.snapshotMigrations}</Text>
            <Text style={session.impact.counts.blockingCharacters ? styles.error : styles.success}>Com referências removidas ou desativadas: {session.impact.counts.blockingCharacters}</Text>
            <Text style={session.impact.counts.evidenceRecordsAffected ? styles.warning : styles.success}>Evidências históricas vinculadas à versão anterior: {session.impact.counts.evidenceRecordsAffected}</Text>
            {session.impact.characters.filter((entry) => entry.changedEntityIds.length || entry.removedEntityIds.length || entry.disabledEntityIds.length).map((entry) => (
              <View key={entry.characterId} style={styles.impactRow}>
                <Text style={styles.strong}>{entry.characterName}</Text>
                <Text style={styles.muted}>{entry.changedEntityIds.length} alterada(s), {entry.removedEntityIds.length} removida(s), {entry.disabledEntityIds.length} desativada(s)</Text>
              </View>
            ))}
          </Card>

          {session.status === 'prepared' ? (
            <Card title="Reconhecimentos e migração" subtitle="Nenhuma ficha é migrada até a confirmação final.">
              <Button testID="catalog-update-migrate-all" label={`Incluir ${session.impact.snapshotMigrationCharacterIds.length} ficha(s) na migração de snapshot`} secondary onPress={() => setMigrationCharacterIds(session.impact.snapshotMigrationCharacterIds)} />
              <Button testID="catalog-update-ack-impact" label={session.impactAcknowledged ? 'Impacto nas fichas reconhecido' : 'Reconhecer impacto nas fichas'} secondary onPress={() => acknowledgeImpact(!session.impactAcknowledged)} />
              <Button testID="catalog-update-ack-blocking" label={session.blockingAcknowledged ? 'Referências bloqueantes reconhecidas' : 'Reconhecer referências removidas/desativadas'} secondary onPress={() => acknowledgeBlockingReferences(!session.blockingAcknowledged)} />
              <Button testID="catalog-update-ack-evidence" label={session.evidenceAcknowledged ? 'Impacto histórico reconhecido' : 'Reconhecer impacto nas evidências'} secondary onPress={() => acknowledgeEvidence(!session.evidenceAcknowledged)} />
              {validation?.issues.map((issue) => <Text key={issue} style={styles.warning}>• {issue}</Text>)}
              <Button testID="catalog-update-commit" label="Confirmar atualização atômica" onPress={() => { void runCommit(false); }} disabled={busy || !validation?.ok} />
              <Button testID="catalog-update-discard" label="Descartar candidato" variant="text" onPress={() => { void discard(); }} disabled={busy} />
            </Card>
          ) : null}

          {['interrupted', 'committing'].includes(session.status) && !session.receipt ? (
            <Card title="Recuperação necessária" subtitle="A sessão persistida pode ser retomada sem repetir fases concluídas.">
              <Button testID="catalog-update-resume" label="Retomar atualização" onPress={() => { void runCommit(true); }} disabled={busy} />
            </Card>
          ) : null}

          {['rollingBack', 'interrupted'].includes(session.status) && session.receipt ? (
            <Card title="Rollback interrompido" subtitle="O checkpoint anterior continua íntegro e pode ser restaurado novamente.">
              <Button testID="catalog-update-resume-rollback" label="Retomar rollback" onPress={() => { void runRollback(); }} disabled={busy} />
            </Card>
          ) : null}

          {session.status === 'committed' ? (
            <Card title="Atualização confirmada" subtitle="A versão anterior e o checkpoint completo continuam disponíveis.">
              <Text testID="catalog-update-receipt">Recibo: {session.receipt?.receiptId}</Text>
              {session.receipt?.transparency ? <>
                <Text testID="catalog-update-transparency-proof" style={styles.success}>Inclusão no registro append-only confirmada</Text>
                <Text style={styles.muted}>Log: {session.receipt.transparency.logId} · entrada {session.receipt.transparency.entryIndex + 1}/{session.receipt.transparency.treeSize}</Text>
                <Text selectable style={styles.fingerprint}>{session.receipt.transparency.rootHash}</Text>
              </> : null}
              <Button testID="catalog-update-rollback" label="Restaurar versão anterior" variant="outlined" onPress={() => { void runRollback(); }} disabled={busy} />
              <Button testID="catalog-update-finalize" label="Encerrar e liberar checkpoint anterior" variant="text" onPress={() => Alert.alert('Encerrar atualização?', 'O catálogo atual será mantido, mas o checkpoint da versão anterior será liberado e o rollback deixará de estar disponível.', [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Encerrar', style: 'destructive', onPress: () => { void finalizeCommitted(); } }
              ])} disabled={busy} />
            </Card>
          ) : null}

          {session.status === 'rolledBack' || session.status === 'failed' ? (
            <Button testID="catalog-update-clear" label="Encerrar sessão" onPress={() => { void clearFinished(); }} />
          ) : null}
        </>
      )}

      <Card title="Histórico de atualizações" subtitle={`${history.length} recibo(s) preservado(s)`}>
        {history.length ? [...history].reverse().map((receipt) => (
          <View key={receipt.receiptId} style={styles.impactRow}>
            <Text style={styles.strong}>{receipt.fromVersion} → {receipt.toVersion}</Text>
            <Text style={styles.muted}>{receipt.committedAt} · {receipt.migratedCharacterIds.length} ficha(s) migrada(s)</Text>
            {receipt.provenance ? <Text style={styles.muted}>{receipt.provenance.publisherName} · {receipt.provenance.keyId} · seq. {receipt.provenance.sequence}</Text> : null}
            {receipt.transparency ? <Text style={styles.muted}>Log {receipt.transparency.logId} · raiz {receipt.transparency.rootHash.slice(0, 12)}…</Text> : null}
          </View>
        )) : <Text style={styles.muted}>Nenhuma atualização foi confirmada neste dispositivo.</Text>}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  json: { minHeight: 140, textAlignVertical: 'top' },
  muted: { opacity: 0.72 },
  strong: { fontWeight: '700' },
  warning: { color: '#A76400', marginTop: 4 },
  error: { color: '#B3261E', marginTop: 4 },
  success: { color: '#146C43', marginTop: 4 },
  fingerprint: { fontFamily: 'monospace', fontSize: 12, marginTop: 4 },
  impactRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#77777755', paddingTop: 8, marginTop: 8 }
});
