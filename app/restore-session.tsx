import { useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { IssueList } from '../src/components/IssueList';
import { usePortableRestoreSessionStore } from '../src/store/portableRestoreSessionStore';
import { canCommitPortableRestoreSession } from '../src/backup/portableRestoreSession';
import {
  createPortableRestoreEvidenceBundle,
  portableRestoreEvidenceToJson,
  portableRestoreReceiptToJson
} from '../src/backup/portableRestoreVerification';
import {
  commitPortableRestoreSession,
  rollbackPortableRestoreSession,
  verifyCommittedPortableRestoreSession
} from '../src/backup/portableRestoreSessionExecutor';

const statusLabel: Record<string, string> = {
  prepared: 'Preview preparado', committing: 'Commit em andamento', interrupted: 'Sessão interrompida',
  committed: 'Restauração confirmada', rollingBack: 'Rollback em andamento', rolledBack: 'Rollback concluído',
  discarded: 'Preview descartado', failed: 'Falha registrada'
};

export default function RestoreSessionScreen() {
  const session = usePortableRestoreSessionStore((state) => state.activeSession);
  const archivedSessions = usePortableRestoreSessionStore((state) => state.archivedSessions);
  const acknowledgeConflict = usePortableRestoreSessionStore((state) => state.acknowledgeConflict);
  const acknowledgeVerification = usePortableRestoreSessionStore((state) => state.acknowledgePostRestoreVerification);
  const discardPrepared = usePortableRestoreSessionStore((state) => state.discardPreparedSession);
  const archiveCommitted = usePortableRestoreSessionStore((state) => state.archiveCommittedSession);
  const reopenArchivedRollback = usePortableRestoreSessionStore((state) => state.reopenArchivedRollback);
  const clearFinished = usePortableRestoreSessionStore((state) => state.clearFinishedSession);
  const [busy, setBusy] = useState(false);

  if (!session) {
    return (
      <Screen title="Sessão de restauração" subtitle="Nenhuma restauração portátil está ativa.">
        <Card title="Sem sessão"><Text style={styles.muted}>Prepare um backup na tela de Backup portátil antes de continuar.</Text></Card>
        {archivedSessions.length ? (
          <Card title="Recibos anteriores" subtitle="Sessões verificadas podem ser reabertas para rollback seguro.">
            {archivedSessions.slice().reverse().map((entry) => (
              <View key={entry.id} style={styles.conflict}>
                <Text style={styles.conflictTitle}>{entry.source.name ?? entry.id}</Text>
                <Text style={styles.muted}>{entry.closedAt ?? entry.committedAt} · {entry.integrityReceipt?.checksum}</Text>
                <Button testID={`restore-reopen-${entry.id}`} label="Reabrir rollback seguro" secondary onPress={() => {
                  if (reopenArchivedRollback(entry.id)) return;
                  Alert.alert('Recibo inválido', 'A sessão não pôde ser reaberta porque o recibo não está íntegro ou já existe outra sessão ativa.');
                }} />
              </View>
            ))}
          </Card>
        ) : null}
        <Button label="Abrir backup" onPress={() => router.replace('/backup')} />
      </Screen>
    );
  }

  const acknowledged = new Set(session.acknowledgedConflictIds);
  const verification = session.postRestoreVerification;
  const commitAllowed = canCommitPortableRestoreSession(session);
  const canRollback = ['committed', 'interrupted', 'failed'].includes(session.status);
  const canDiscard = session.status === 'prepared' && !session.applied.data && !session.applied.catalog;
  const canArchive = session.status === 'committed' && Boolean(verification?.canClose && session.integrityReceipt);

  const handleCommit = async () => {
    setBusy(true);
    const result = await commitPortableRestoreSession();
    setBusy(false);
    if (!result.ok && !result.session?.committedAt) {
      Alert.alert('Commit não concluído', result.issues.join('\n'));
      return;
    }
    if (result.verification?.status === 'failed') {
      Alert.alert('Restauração gravada, verificação bloqueada', 'O estado foi confirmado, mas divergências foram encontradas. Corrija ou execute o rollback antes de encerrar.');
      return;
    }
    Alert.alert('Restauração concluída', result.verification?.status === 'warning'
      ? 'A restauração foi confirmada, mas os avisos pós-restauração precisam ser reconhecidos.'
      : 'Todos os dados foram confirmados e verificados na mesma sessão.');
  };

  const handleRollback = async () => {
    setBusy(true);
    const result = await rollbackPortableRestoreSession();
    setBusy(false);
    if (!result.ok) return Alert.alert('Rollback não concluído', result.issues.join('\n'));
    Alert.alert('Rollback concluído', 'O checkpoint anterior foi restaurado integralmente.');
  };

  const handleReverify = () => {
    const result = verifyCommittedPortableRestoreSession();
    if (result.verification?.status === 'passed') Alert.alert('Verificação aprovada', 'O estado efetivo corresponde ao projetado e o recibo foi gerado.');
    else Alert.alert('Verificação concluída', result.issues.join('\n') || 'A verificação terminou com avisos.');
  };

  const shareReceipt = async () => {
    if (!session.integrityReceipt) return;
    await Share.share({ title: `Recibo de restauração ${session.id}`, message: portableRestoreReceiptToJson(session.integrityReceipt) });
  };

  const shareEvidence = async () => {
    const bundle = createPortableRestoreEvidenceBundle(session);
    if (!bundle) return Alert.alert('Evidências indisponíveis', 'Conclua a verificação e gere um recibo íntegro antes de exportar as evidências.');
    await Share.share({ title: `Evidências da restauração ${session.id}`, message: portableRestoreEvidenceToJson(bundle) });
  };

  return (
    <Screen title="Sessão transacional de restauração" subtitle="Revise, confirme, verifique e encerre a sessão inteira.">
      <Card title={statusLabel[session.status] ?? session.status} subtitle={`Fase: ${session.phase} · sessão ${session.id}`}>
        <Text style={session.recoveryRequired ? styles.error : styles.success}>{session.recoveryRequired ? 'Há recuperação pendente.' : 'O checkpoint está persistido e verificável.'}</Text>
        <Text style={styles.muted}>Backup: {session.source.name ?? 'sem nome'} · {session.source.backupSchemaVersion}</Text>
        <Text style={styles.muted}>Checksum: {session.source.checksum ?? 'backup legado sem checksum'}</Text>
        {session.lastError ? <Text style={styles.error}>{session.lastError}</Text> : null}
      </Card>

      <Card title="Preview agregado" subtitle="Nenhuma diferença abaixo é aplicada antes do commit final.">
        <View style={styles.grid}>
          <Text style={styles.metric}>Personagens: {session.preview.before.characters} → {session.preview.after.characters}</Text>
          <Text style={styles.metric}>Cenários: {session.preview.before.scenarios} → {session.preview.after.scenarios}</Text>
          <Text style={styles.metric}>Presets: {session.preview.before.presets} → {session.preview.after.presets}</Text>
          <Text style={styles.metric}>Snapshots: {session.preview.before.snapshots} → {session.preview.after.snapshots}</Text>
          <Text style={styles.metric}>Planos: {session.preview.before.remediationPlans} → {session.preview.after.remediationPlans}</Text>
          <Text style={styles.metric}>Catálogo: r{session.preview.before.catalogRevision} → r{session.preview.after.catalogRevision}</Text>
        </View>
      </Card>

      <Card title="Conflitos e reconhecimentos" subtitle={`${session.conflicts.length} conflito(s)`}>
        {session.conflicts.length ? session.conflicts.map((entry) => {
          const selected = acknowledged.has(entry.id);
          return <View key={entry.id} testID={`restore-conflict-${entry.kind}`} style={styles.conflict}>
            <Text style={styles.conflictTitle}>{entry.title} ({entry.count})</Text><Text style={styles.muted}>{entry.description}</Text>
            <Button testID={`restore-ack-${entry.kind}`} label={selected ? 'Reconhecido — tocar para desfazer' : 'Reconhecer este conflito'} secondary onPress={() => acknowledgeConflict(entry.id, !selected)} disabled={busy || !['prepared', 'interrupted'].includes(session.status)} />
          </View>;
        }) : <Text style={styles.success}>Nenhum conflito adicional exige reconhecimento.</Text>}
      </Card>

      {session.restoreIssues.length ? <Card title="Avisos do backup"><IssueList issues={session.restoreIssues} /></Card> : null}

      {session.status === 'committed' ? (
        <Card title="Verificação pós-restauração" subtitle="O encerramento só é permitido com estado efetivo íntegro.">
          {!verification ? <Text style={styles.warning}>A verificação ainda não foi executada.</Text> : (
            <>
              <Text testID="restore-verification-status" style={verification.status === 'failed' ? styles.error : verification.status === 'warning' ? styles.warning : styles.success}>
                {verification.status === 'failed' ? 'Divergência bloqueante' : verification.status === 'warning' ? 'Verificado com avisos' : 'Integridade aprovada'}
              </Text>
              <Text style={styles.muted}>Fingerprint esperado: {verification.expectedFingerprint}</Text>
              <Text style={styles.muted}>Fingerprint efetivo: {verification.effectiveFingerprint}</Text>
              <Text style={styles.muted}>{verification.counts.errors} erro(s) · {verification.counts.warnings} aviso(s) · {verification.counts.compatibilityBlockedCharacters} ficha(s) bloqueada(s)</Text>
              {verification.issues.map((entry) => <Text key={entry.id} style={entry.severity === 'error' ? styles.error : styles.warning}>{entry.code}: {entry.message}</Text>)}
            </>
          )}
          <Button testID="restore-session-reverify" label="Executar verificação novamente" secondary onPress={handleReverify} disabled={busy} />
          {verification?.requiresAcknowledgement && !verification.acknowledgedAt ? <Button testID="restore-verification-accept" label="Reconhecer avisos e gerar recibo" secondary onPress={() => acknowledgeVerification()} disabled={busy} /> : null}
          {session.integrityReceipt ? (
            <>
              <Text testID="restore-receipt-checksum" style={styles.success}>Recibo: {session.integrityReceipt.checksum}</Text>
              <Button testID="restore-receipt-share" label="Compartilhar recibo de integridade" secondary onPress={() => { void shareReceipt(); }} />
              <Button testID="restore-evidence-share" label="Compartilhar evidências completas" secondary onPress={() => { void shareEvidence(); }} />
            </>
          ) : null}
        </Card>
      ) : null}

      <Card title="Auditoria da sessão" subtitle={`${session.events.length} evento(s) persistido(s)`}>
        {session.events.slice().reverse().map((entry) => <Text key={entry.id} style={styles.muted}>{entry.at} · {entry.message}</Text>)}
      </Card>

      {['prepared', 'interrupted'].includes(session.status) ? <Button testID="restore-session-commit" label={session.status === 'interrupted' ? 'Retomar commit idempotente' : 'Confirmar restauração completa'} onPress={handleCommit} disabled={busy || !commitAllowed} /> : null}
      {canDiscard ? <Button testID="restore-session-discard" label="Descartar preview sem gravar" secondary onPress={() => { if (!discardPrepared()) Alert.alert('Descarte indisponível', 'A sessão já iniciou gravações.'); }} disabled={busy} /> : null}
      {canRollback ? <Button testID="restore-session-rollback" label="Restaurar checkpoint anterior" secondary onPress={handleRollback} disabled={busy} /> : null}
      {session.status === 'committed' ? <Button testID="restore-session-close" label="Encerrar e manter restauração" secondary onPress={() => {
        if (!archiveCommitted()) return Alert.alert('Encerramento bloqueado', 'Conclua a verificação, resolva divergências ou reconheça os avisos antes de encerrar.');
        router.replace('/backup');
      }} disabled={!canArchive || busy} /> : null}
      {['rolledBack', 'discarded'].includes(session.status) ? <Button label="Encerrar sessão" secondary onPress={() => { clearFinished(); router.replace('/backup'); }} /> : null}
      <Button label="Voltar" secondary onPress={() => router.back()} disabled={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: '#64748b', lineHeight: 19 }, success: { color: '#047857', fontWeight: '800', lineHeight: 20 },
  error: { color: '#b91c1c', fontWeight: '800', lineHeight: 20 }, warning: { color: '#92400e', fontWeight: '700', lineHeight: 20 },
  grid: { gap: 5 }, metric: { color: '#0f172a', fontWeight: '700' },
  conflict: { borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10, gap: 7 }, conflictTitle: { color: '#0f172a', fontWeight: '900' }
});
