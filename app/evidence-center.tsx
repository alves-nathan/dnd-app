import { useMemo, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import { useCatalogStore } from '../src/store/catalogStore';
import { usePortableRestoreSessionStore } from '../src/store/portableRestoreSessionStore';
import { capturePortableRestoreCheckpoint } from '../src/backup/portableRestoreSessionExecutor';
import {
  createPortableRestoreEvidenceArchive,
  parsePortableRestoreEvidenceImport,
  planPortableRestoreEvidenceCleanup,
  portableRestoreEvidenceArchiveToJson,
  type PortableRestoreHistoricalEvidenceRecord
} from '../src/backup/portableRestoreEvidenceCenter';
import { portableRestoreEvidenceToJson, portableRestoreReceiptToJson } from '../src/backup/portableRestoreVerification';

const statusLabel: Record<string, string> = {
  current: 'Estado atual corresponde ao recibo',
  changed: 'Há alterações posteriores ao recibo',
  invalid: 'Evidência inválida',
  unavailable: 'Comparação indisponível'
};

const statusStyle = (record: PortableRestoreHistoricalEvidenceRecord) => {
  if (record.validationStatus === 'invalid' || record.comparison?.status === 'invalid') return styles.error;
  if (record.comparison?.status === 'changed') return styles.warning;
  if (record.comparison?.status === 'current') return styles.success;
  return styles.muted;
};

export default function EvidenceCenterScreen() {
  const records = usePortableRestoreSessionStore((state) => state.evidenceRecords);
  const archivedSessions = usePortableRestoreSessionStore((state) => state.archivedSessions);
  const activeSession = usePortableRestoreSessionStore((state) => state.activeSession);
  const importEvidenceRecords = usePortableRestoreSessionStore((state) => state.importEvidenceRecords);
  const revalidateEvidenceHistory = usePortableRestoreSessionStore((state) => state.revalidateEvidenceHistory);
  const removeEvidenceRecord = usePortableRestoreSessionStore((state) => state.removeEvidenceRecord);
  const cleanupEvidenceHistory = usePortableRestoreSessionStore((state) => state.cleanupEvidenceHistory);
  const reopenArchivedRollback = usePortableRestoreSessionStore((state) => state.reopenArchivedRollback);
  const catalogHistory = useCatalogStore((state) => state.history);
  const [importJson, setImportJson] = useState('');
  const [message, setMessage] = useState('');

  const sortedRecords = useMemo(() => [...records].sort((left, right) => right.addedAt.localeCompare(left.addedAt)), [records]);
  const changedCount = records.filter((record) => record.comparison?.status === 'changed').length;
  const invalidCount = records.filter((record) => record.validationStatus === 'invalid' || record.comparison?.status === 'invalid').length;
  const cleanupPlan = useMemo(() => planPortableRestoreEvidenceCleanup(records, archivedSessions), [archivedSessions, records]);

  const refresh = (force = true) => {
    try {
      const count = revalidateEvidenceHistory(capturePortableRestoreCheckpoint(), catalogHistory, force);
      setMessage(`${count} registro(s) revalidado(s) contra o estado atual.`);
    } catch (error) {
      Alert.alert('Comparação indisponível', error instanceof Error ? error.message : 'As stores ainda não estão prontas.');
    }
  };

  const pickEvidenceFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/json', 'text/plain'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    try {
      setImportJson(await new File(result.assets[0].uri).text());
    } catch (error) {
      Alert.alert('Arquivo não lido', error instanceof Error ? error.message : 'Não foi possível ler o arquivo selecionado.');
    }
  };

  const handleImport = () => {
    const parsed = parsePortableRestoreEvidenceImport(importJson, records.map((record) => record.recordId));
    if (!parsed.ok) {
      Alert.alert('Evidência rejeitada', parsed.issues.join('\n') || 'O checksum ou o contrato do arquivo não são válidos.');
      return;
    }
    const accepted = importEvidenceRecords(parsed.records);
    setMessage(`${accepted} registro(s) importado(s). ${parsed.ignoredDuplicateRecordIds.length} duplicata(s) ignorada(s).`);
    setImportJson('');
    setTimeout(() => refresh(true), 0);
  };

  const shareArchive = async () => {
    const archive = createPortableRestoreEvidenceArchive(records);
    await Share.share({ title: 'Arquivo agregado de evidências D&D Combat', message: portableRestoreEvidenceArchiveToJson(archive) });
  };

  const shareRecord = async (record: PortableRestoreHistoricalEvidenceRecord) => {
    await Share.share({
      title: `Evidência ${record.sessionId}`,
      message: record.evidence ? portableRestoreEvidenceToJson(record.evidence) : portableRestoreReceiptToJson(record.receipt)
    });
  };

  const confirmRemoveRecord = (record: PortableRestoreHistoricalEvidenceRecord) => {
    if (record.source === 'imported' || !record.localCheckpointAvailable) {
      Alert.alert('Remover evidência?', 'O registro será removido da central. Nenhuma ficha será alterada.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: () => removeEvidenceRecord(record.recordId) }
      ]);
      return;
    }
    Alert.alert('Remover evidência local?', 'O recibo pode ser removido sozinho ou junto com o checkpoint que permite rollback.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Só evidência', onPress: () => removeEvidenceRecord(record.recordId, false) },
      { text: 'Evidência e checkpoint', style: 'destructive', onPress: () => removeEvidenceRecord(record.recordId, true) }
    ]);
  };

  const cleanupOldCheckpoints = () => {
    if (!cleanupPlan.recommendedCheckpointSessionIds.length) {
      Alert.alert('Retenção em dia', 'Há no máximo cinco checkpoints completos armazenados.');
      return;
    }
    Alert.alert(
      'Limpar checkpoints antigos?',
      `${cleanupPlan.recommendedCheckpointSessionIds.length} checkpoint(s) completos serão removidos. Os recibos e evidências históricas permanecerão disponíveis.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover checkpoints', style: 'destructive', onPress: () => {
            const result = cleanupEvidenceHistory([], cleanupPlan.recommendedCheckpointSessionIds);
            setMessage(`${result.removedCheckpoints} checkpoint(s) removido(s); os recibos foram preservados.`);
          }
        }
      ]
    );
  };

  const cleanupInvalidEvidence = () => {
    if (!cleanupPlan.invalidEvidenceRecordIds.length) return Alert.alert('Nenhum registro inválido', 'Não há evidências inválidas para remover.');
    Alert.alert('Remover evidências inválidas?', `${cleanupPlan.invalidEvidenceRecordIds.length} registro(s) serão removidos.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive', onPress: () => {
          const result = cleanupEvidenceHistory(cleanupPlan.invalidEvidenceRecordIds, []);
          setMessage(`${result.removedRecords} registro(s) inválido(s) removido(s).`);
        }
      }
    ]);
  };

  return (
    <Screen title="Central de evidências" subtitle="Valide recibos históricos, compare o estado atual e controle a retenção dos checkpoints.">
      <Card title="Resumo histórico" subtitle={`${records.length} evidência(s) · ${archivedSessions.length} checkpoint(s) completo(s)`}>
        <Text style={changedCount ? styles.warning : styles.success}>{changedCount} recibo(s) com alterações posteriores</Text>
        <Text style={invalidCount ? styles.error : styles.success}>{invalidCount} registro(s) inválido(s)</Text>
        <Text style={styles.muted}>Checkpoints recomendados para retenção: {cleanupPlan.retainedCheckpointCount}. Recibos podem permanecer mesmo após a remoção do checkpoint.</Text>
        {message ? <Text style={styles.success}>{message}</Text> : null}
        <Button testID="evidence-center-revalidate" label="Comparar todos com o estado atual" secondary onPress={() => refresh(true)} />
        <Button testID="evidence-center-export" label="Exportar arquivo agregado" secondary onPress={() => { void shareArchive(); }} disabled={!records.length} />
      </Card>

      <Card title="Importar recibo ou evidência" subtitle="Arquivos adulterados são rejeitados. Evidências externas nunca habilitam rollback local.">
        <Button testID="evidence-center-pick" label="Selecionar arquivo JSON" secondary onPress={() => { void pickEvidenceFile(); }} />
        <Field testID="evidence-center-import-json" label="JSON" value={importJson} onChangeText={setImportJson} multiline style={styles.jsonBox} autoCapitalize="none" />
        <Button testID="evidence-center-import" label="Validar e importar" onPress={handleImport} disabled={!importJson.trim()} />
      </Card>

      <Card title="Retenção controlada" subtitle="A limpeza nunca altera personagens, catálogo ou planos ativos.">
        <Button testID="evidence-center-clean-checkpoints" label="Limpar checkpoints além dos cinco mais recentes" secondary onPress={cleanupOldCheckpoints} />
        <Button testID="evidence-center-clean-invalid" label="Remover evidências inválidas" secondary onPress={cleanupInvalidEvidence} />
      </Card>

      <Card title="Histórico navegável" subtitle="Registros locais e importados são comparados pelo fingerprint efetivo.">
        {sortedRecords.length ? sortedRecords.map((record) => {
          const checkpointAvailable = archivedSessions.some((session) => session.id === record.sessionId);
          const comparison = record.comparison;
          return (
            <View key={record.recordId} testID={`evidence-record-${record.recordId}`} style={styles.record}>
              <Text style={styles.title}>{record.sourceName ?? record.sessionId}</Text>
              <Text style={styles.muted}>{record.source === 'local' ? 'Local' : 'Importada'} · {record.receipt.createdAt} · {record.receipt.verificationStatus}</Text>
              <Text style={statusStyle(record)}>{record.validationStatus === 'invalid' ? 'Checksum inválido' : comparison ? statusLabel[comparison.status] : 'Aguardando primeira comparação'}</Text>
              <Text style={styles.muted}>Recibo: {record.receipt.checksum}</Text>
              {comparison ? <Text style={styles.muted}>Personagens Δ {comparison.characterCountDelta ?? 0} · planos Δ {comparison.remediationPlanCountDelta ?? 0} · drafts Δ {comparison.progressionDraftCountDelta ?? 0}</Text> : null}
              {comparison?.messages.map((entry) => <Text key={entry} style={styles.warning}>{entry}</Text>)}
              <Button label="Compartilhar este registro" secondary onPress={() => { void shareRecord(record); }} />
              {record.source === 'local' && checkpointAvailable ? <Button testID={`evidence-reopen-${record.sessionId}`} label="Reabrir checkpoint para rollback" secondary onPress={() => {
                if (activeSession) return Alert.alert('Sessão ativa', 'Finalize a sessão atual antes de reabrir um checkpoint.');
                if (reopenArchivedRollback(record.sessionId)) router.replace('/restore-session');
                else Alert.alert('Reabertura bloqueada', 'O recibo ou checkpoint não está disponível para rollback.');
              }} /> : null}
              <Button label="Remover da central" secondary onPress={() => confirmRemoveRecord(record)} />
            </View>
          );
        }) : <Text style={styles.muted}>Nenhum recibo histórico foi arquivado ou importado.</Text>}
      </Card>
      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: '#64748b', lineHeight: 19 },
  success: { color: '#047857', fontWeight: '800', lineHeight: 20 },
  warning: { color: '#92400e', fontWeight: '700', lineHeight: 20 },
  error: { color: '#b91c1c', fontWeight: '800', lineHeight: 20 },
  jsonBox: { minHeight: 220, textAlignVertical: 'top', fontSize: 12, lineHeight: 17 },
  record: { borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 12, gap: 7 },
  title: { color: '#0f172a', fontWeight: '900', fontSize: 16 }
});
