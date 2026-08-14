import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import { validateCatalogOperationalEvidence, validateCatalogOperationalJournalArchiveChain, validateCatalogOperationalJournalChain } from '../src/catalog/catalogOperationalJournal';
import { useCatalogOperationalAuthorizationStore } from '../src/store/catalogOperationalAuthorizationStore';
import { useCatalogTrustStore } from '../src/store/catalogTrustStore';

const reconciliationLabel = { passed: 'Íntegra', warning: 'Aviso pendente', failed: 'Divergente' } as const;

export default function CatalogOperationalJournalScreen() {
  const registry = useCatalogTrustStore((state) => state.registry);
  const sessions = useCatalogOperationalAuthorizationStore((state) => state.sessions);
  const receipts = useCatalogOperationalAuthorizationStore((state) => state.receipts);
  const journal = useCatalogOperationalAuthorizationStore((state) => state.journal);
  const archives = useCatalogOperationalAuthorizationStore((state) => state.journalArchives);
  const reconciliations = useCatalogOperationalAuthorizationStore((state) => state.reconciliations);
  const evidence = useCatalogOperationalAuthorizationStore((state) => state.evidence);
  const recoveryAuthorizations = useCatalogOperationalAuthorizationStore((state) => state.recoveryAuthorizations);
  const recoveryConfirmations = useCatalogOperationalAuthorizationStore((state) => state.recoveryConfirmations);
  const resumeInterruptedExecution = useCatalogOperationalAuthorizationStore((state) => state.resumeInterruptedExecution);
  const reconcileReceipt = useCatalogOperationalAuthorizationStore((state) => state.reconcileReceipt);
  const closeOperation = useCatalogOperationalAuthorizationStore((state) => state.closeOperation);
  const importRecoveryAuthorization = useCatalogOperationalAuthorizationStore((state) => state.importRecoveryAuthorization);
  const importRecoveryConfirmation = useCatalogOperationalAuthorizationStore((state) => state.importRecoveryConfirmation);
  const executeRecovery = useCatalogOperationalAuthorizationStore((state) => state.executeRecovery);
  const archiveJournal = useCatalogOperationalAuthorizationStore((state) => state.archiveJournal);
  const [recoveryAuthorizationJson, setRecoveryAuthorizationJson] = useState('');
  const [recoveryConfirmationJson, setRecoveryConfirmationJson] = useState('');

  const lastArchive = archives[archives.length - 1];
  const chainValid = validateCatalogOperationalJournalChain(journal, lastArchive?.headHash, lastArchive?.lastSequence ?? 0)
    && validateCatalogOperationalJournalArchiveChain(archives);

  const importAuthorization = () => {
    const result = importRecoveryAuthorization(recoveryAuthorizationJson, registry);
    Alert.alert(result.ok ? 'Autorização aceita' : 'Autorização rejeitada', result.ok ? 'O recibo, a divergência, a assinatura e o executor foram verificados.' : result.issue);
    if (result.ok) setRecoveryAuthorizationJson('');
  };

  const importConfirmation = () => {
    const result = importRecoveryConfirmation(recoveryConfirmationJson, registry);
    Alert.alert(result.ok ? 'Executor confirmado' : 'Confirmação rejeitada', result.ok ? 'A confirmação corresponde à autorização de recuperação e permanece sem uso.' : result.issue);
    if (result.ok) setRecoveryConfirmationJson('');
  };

  return (
    <Screen title="Diário operacional" subtitle="Reconciliação, encerramento verificado, recuperação de interrupções e evidências append-only." onBack={() => router.back()}>
      <Card variant="hero" title={chainValid ? 'Cadeia íntegra' : 'Cadeia inválida'} subtitle={`${journal.length} entrada(s) ativa(s) · ${archives.length} arquivo(s) · ${evidence.length} evidência(s)`}>
        <Text style={styles.muted}>Head atual: {(journal[journal.length - 1]?.hash ?? lastArchive?.headHash ?? '0'.repeat(64)).slice(0, 20)}…</Text>
        <Button testID="operational-journal-archive" label="Arquivar entradas antigas" variant="outlined" onPress={() => {
          const result = archiveJournal(200);
          Alert.alert(result.ok ? 'Diário arquivado' : 'Arquivamento não realizado', result.ok ? `${result.archive?.entries.length ?? 0} entrada(s) preservada(s) no arquivo.` : result.issue);
        }} />
      </Card>

      {sessions.filter((session) => session.status === 'interrupted').map((session) => (
        <Card key={session.sessionId} title="Execução interrompida" subtitle={session.authorizationId}>
          <Text style={styles.warning}>A aplicação foi encerrada antes da criação do recibo. A retomada reaplica a ação de forma idempotente.</Text>
          <Button testID={`operational-resume-${session.sessionId}`} label="Retomar com confirmação humana" onPress={() => {
            Alert.alert('Retomar execução', 'A autorização original continuará de uso único. Confirme somente após revisar o checkpoint.', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Retomar', onPress: () => { void resumeInterruptedExecution(session.sessionId, true).then((result) => Alert.alert(result.ok ? 'Execução retomada' : 'Retomada falhou', result.ok ? 'O recibo foi criado e agora precisa ser reconciliado.' : result.issue)); } }
            ]);
          }} />
        </Card>
      ))}

      <Card title="Operações executadas" subtitle="Uma operação só é encerrada depois da reconciliação do estado efetivo.">
        {receipts.slice().reverse().map((receipt) => {
          const reconciliation = reconciliations[receipt.receiptId];
          const closedEvidence = evidence.find((entry) => entry.receipt.receiptId === receipt.receiptId);
          return (
            <View key={receipt.receiptId} style={styles.row}>
              <Text style={styles.strong}>{receipt.action} · {receipt.status}</Text>
              <Text style={styles.muted}>{receipt.receiptId}</Text>
              <Text style={reconciliation?.status === 'failed' ? styles.error : styles.muted}>Reconciliação: {reconciliation ? reconciliationLabel[reconciliation.status] : 'não executada'} · encerrada: {closedEvidence ? 'sim' : 'não'}</Text>
              {reconciliation?.issues.map((issue) => <Text key={issue.code} style={issue.severity === 'error' ? styles.error : styles.warning}>{issue.code}: {issue.message}</Text>)}
              {!closedEvidence ? <Button testID={`operational-reconcile-${receipt.receiptId}`} label="Reconciliar estado" variant="outlined" onPress={() => {
                const result = reconcileReceipt(receipt.receiptId, false);
                Alert.alert(result.ok ? 'Reconciliação concluída' : 'Reconciliação falhou', result.ok ? `Status: ${result.reconciliation?.status}` : result.issue);
              }} /> : null}
              {reconciliation?.status === 'warning' && !closedEvidence ? <Button label="Reconhecer aviso e reconciliar" variant="outlined" onPress={() => reconcileReceipt(receipt.receiptId, true)} /> : null}
              {reconciliation && reconciliation.status !== 'failed' && !closedEvidence ? <Button testID={`operational-close-${receipt.receiptId}`} label="Encerrar e gerar evidência" onPress={() => {
                const result = closeOperation(receipt.receiptId, reconciliation.status === 'warning');
                Alert.alert(result.ok ? 'Operação encerrada' : 'Encerramento bloqueado', result.ok ? 'O recibo, a reconciliação e o head do diário foram preservados.' : result.issue);
              }} /> : null}
              {closedEvidence ? <Button label="Compartilhar evidência" variant="text" onPress={() => { void Share.share({ title: 'Evidência operacional', message: JSON.stringify(closedEvidence, null, 2) }); }} /> : null}
            </View>
          );
        })}
      </Card>

      <Card title="Autorização de correção ou rollback" subtitle="Divergências só podem ser corrigidas por uma nova autorização assinada, confirmação do executor e confirmação humana.">
        <Field testID="operational-recovery-authorization-json" label="Autorização de recuperação JSON" value={recoveryAuthorizationJson} onChangeText={setRecoveryAuthorizationJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="operational-recovery-authorization-import" label="Validar autorização de recuperação" onPress={importAuthorization} disabled={!recoveryAuthorizationJson.trim()} />
        <Field testID="operational-recovery-confirmation-json" label="Confirmação do executor JSON" value={recoveryConfirmationJson} onChangeText={setRecoveryConfirmationJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="operational-recovery-confirmation-import" label="Validar confirmação da recuperação" onPress={importConfirmation} disabled={!recoveryConfirmationJson.trim()} />
      </Card>

      {recoveryAuthorizations.slice().reverse().map((authorization) => {
        const checksum = JSON.stringify(authorization);
        const confirmation = Object.values(recoveryConfirmations).find((entry) => entry.nonce === authorization.nonce);
        return (
          <Card key={authorization.authorizationId} title={authorization.action === 'reapplyExpected' ? 'Reaplicar estado esperado' : 'Restaurar checkpoint'} subtitle={`${authorization.authorizationId} · executor ${authorization.executor.executorId}`}>
            <Text style={styles.muted}>Confirmação: {confirmation ? 'disponível' : 'ausente'} · autorização local: {checksum.length} bytes</Text>
            <Button testID={`operational-recovery-execute-${authorization.authorizationId}`} label="Confirmar e executar recuperação" disabled={!confirmation} onPress={() => {
              Alert.alert('Confirmação humana da recuperação', 'A autorização será consumida mesmo se a correção falhar.', [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Executar', style: 'destructive', onPress: () => { void executeRecovery(authorization.authorizationId, true).then((result) => Alert.alert(result.ok ? 'Recuperação concluída' : 'Recuperação falhou', result.ok ? `Nova reconciliação: ${result.reconciliation?.status}` : result.issue)); } }
              ]);
            }} />
          </Card>
        );
      })}

      <Card title="Auditoria externa" subtitle="Exporte o diário completo, compare dispositivos e valide relatórios assinados sem alterar o estado local.">
        <Button testID="operational-audit-open" label="Abrir auditoria operacional" variant="outlined" onPress={() => router.push('/catalog-operational-audit')} />
      </Card>

      <Card title="Evidências encerradas" subtitle={`${evidence.length} pacote(s) verificável(is)`}>
        {evidence.slice().reverse().slice(0, 20).map((entry) => (
          <View key={entry.evidenceId} style={styles.row}>
            <Text style={styles.strong}>{entry.receipt.action} · {entry.reconciliation.status}</Text>
            <Text style={styles.muted}>{entry.closedAt} · checksum {entry.checksum.slice(0, 16)}… · íntegra: {validateCatalogOperationalEvidence(entry) ? 'sim' : 'não'}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  json: { minHeight: 110, textAlignVertical: 'top' },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#77777744', paddingTop: 8, marginTop: 8, gap: 5 },
  strong: { fontWeight: '700' },
  muted: { opacity: 0.72, marginTop: 4 },
  warning: { color: '#9A6700', marginTop: 4 },
  error: { color: '#B42318', marginTop: 4 }
});
