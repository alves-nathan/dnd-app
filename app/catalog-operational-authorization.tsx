import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import { catalogOperationalAuthorizationChecksum } from '../src/catalog/catalogOperationalAuthorization';
import { useCatalogOperationalAuthorizationStore } from '../src/store/catalogOperationalAuthorizationStore';
import { useCatalogTrustStore } from '../src/store/catalogTrustStore';

const actionLabel = { expand: 'Expandir rollout', promote: 'Promover canal', pause: 'Pausar publicação', rollback: 'Executar rollback' } as const;

export default function CatalogOperationalAuthorizationScreen() {
  const registry = useCatalogTrustStore((state) => state.registry);
  const authorizations = useCatalogOperationalAuthorizationStore((state) => state.authorizations);
  const confirmations = useCatalogOperationalAuthorizationStore((state) => state.confirmations);
  const sessions = useCatalogOperationalAuthorizationStore((state) => state.sessions);
  const receipts = useCatalogOperationalAuthorizationStore((state) => state.receipts);
  const events = useCatalogOperationalAuthorizationStore((state) => state.events);
  const importAuthorization = useCatalogOperationalAuthorizationStore((state) => state.importAuthorization);
  const importExecutorConfirmation = useCatalogOperationalAuthorizationStore((state) => state.importExecutorConfirmation);
  const prepareExecution = useCatalogOperationalAuthorizationStore((state) => state.prepareExecution);
  const confirmAndExecute = useCatalogOperationalAuthorizationStore((state) => state.confirmAndExecute);
  const discardPrepared = useCatalogOperationalAuthorizationStore((state) => state.discardPrepared);
  const [authorizationJson, setAuthorizationJson] = useState('');
  const [confirmationJson, setConfirmationJson] = useState('');

  const submitAuthorization = () => {
    const result = importAuthorization(authorizationJson, registry);
    Alert.alert(result.ok ? 'Autorização validada' : 'Autorização rejeitada', result.ok ? 'A decisão, o quórum, o executor, a validade e a assinatura foram verificados.' : result.issue);
    if (result.ok) setAuthorizationJson('');
  };

  const submitConfirmation = () => {
    const result = importExecutorConfirmation(confirmationJson, registry);
    Alert.alert(result.ok ? 'Executor confirmado' : 'Confirmação rejeitada', result.ok ? 'A chave do executor confirmou o escopo exato e a autorização continua sem uso.' : result.issue);
    if (result.ok) setConfirmationJson('');
  };

  const prepare = (authorizationId: string) => {
    const result = prepareExecution(authorizationId);
    Alert.alert(result.ok ? 'Execução preparada' : 'Não foi possível preparar', result.ok ? 'Revise a ação e faça a confirmação humana final.' : result.issue);
  };

  const execute = (sessionId: string, authorizationId: string) => {
    const authorization = authorizations.find((entry) => entry.authorizationId === authorizationId);
    if (!authorization) return;
    Alert.alert(
      'Confirmação humana final',
      `${actionLabel[authorization.action]} para a publicação ${authorization.publicationId}. Esta autorização será consumida mesmo se a execução falhar.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar e executar',
          style: 'destructive',
          onPress: () => {
            void confirmAndExecute(sessionId, true).then((result) => Alert.alert(result.ok ? 'Execução concluída' : 'Execução falhou', result.ok ? result.receipt?.result?.summary ?? 'O recibo foi registrado.' : result.issue));
          }
        }
      ]
    );
  };

  return (
    <Screen title="Autorização operacional" subtitle="Quórum aprovado não executa nada sozinho. A autorização assinada, a confirmação do executor e a confirmação humana são obrigatórias." onBack={() => router.back()}>
      <Card variant="hero" title="Três barreiras independentes" subtitle="1. Quórum aprovado. 2. Autorização e confirmação assinadas por chaves separadas. 3. Confirmação humana final e uso único." />
      <Button testID="operational-journal-open" label="Abrir diário e reconciliação" icon="document-lock-outline" variant="outlined" onPress={() => router.push('/catalog-operational-journal')} />

      <Card title="Autorização operacional assinada" subtitle="Deve vincular publicação, relatório, decisão aprovada, ação, executor, prazo e nonce de uso único.">
        <Field testID="operational-authorization-json" label="Autorização JSON" value={authorizationJson} onChangeText={setAuthorizationJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="operational-authorization-import" label="Validar autorização" onPress={submitAuthorization} disabled={!authorizationJson.trim()} />
      </Card>

      <Card title="Confirmação assinada do executor" subtitle="A chave do executor não pode ter participado do quórum e precisa confirmar exatamente a autorização importada.">
        <Field testID="operational-executor-confirmation-json" label="Confirmação JSON" value={confirmationJson} onChangeText={setConfirmationJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="operational-executor-confirmation-import" label="Validar confirmação do executor" onPress={submitConfirmation} disabled={!confirmationJson.trim()} />
      </Card>

      {authorizations.slice().reverse().map((authorization) => {
        const confirmation = confirmations[catalogOperationalAuthorizationChecksum(authorization)];
        const session = sessions.slice().reverse().find((entry) => entry.authorizationId === authorization.authorizationId && ['prepared', 'executing'].includes(entry.status));
        const receipt = receipts.slice().reverse().find((entry) => entry.authorizationId === authorization.authorizationId);
        return (
          <Card key={authorization.authorizationId} title={actionLabel[authorization.action]} subtitle={`${authorization.authorizationId} · executor ${authorization.executor.executorId}`}>
            <Text style={styles.muted}>Expira em {authorization.expiresAt} · uso máximo 1 · execução automática: não</Text>
            <Text style={styles.muted}>Confirmação do executor: {confirmation ? 'disponível' : 'ausente'} · recibo: {receipt ? receipt.status : 'não executado'}</Text>
            {!receipt && !session ? <Button testID={`operational-prepare-${authorization.authorizationId}`} label="Preparar execução" onPress={() => prepare(authorization.authorizationId)} disabled={!confirmation} /> : null}
            {session?.status === 'prepared' ? (
              <View style={styles.actions}>
                <Button testID={`operational-confirm-${session.sessionId}`} label="Revisar e confirmar" onPress={() => execute(session.sessionId, authorization.authorizationId)} />
                <Button label="Descartar preparação" variant="outlined" onPress={() => discardPrepared(session.sessionId)} />
              </View>
            ) : null}
            {receipt ? <Button label="Compartilhar recibo" variant="text" onPress={() => { void Share.share({ title: 'Recibo operacional do catálogo', message: JSON.stringify(receipt, null, 2) }); }} /> : null}
          </Card>
        );
      })}

      <Card title="Recibos de execução" subtitle={`${receipts.length} autorização(ões) consumida(s)`}>
        {receipts.slice().reverse().slice(0, 20).map((receipt) => (
          <View key={receipt.receiptId} style={styles.row}>
            <Text style={styles.strong}>{actionLabel[receipt.action]} · {receipt.status === 'succeeded' ? 'concluída' : 'falhou'}</Text>
            <Text style={styles.muted}>{receipt.completedAt} · executor {receipt.executor.executorId}</Text>
          </View>
        ))}
      </Card>

      <Card title="Auditoria local" subtitle={`${events.length} evento(s)`}>
        {events.slice().reverse().slice(0, 20).map((entry) => <View key={entry.id} style={styles.row}><Text style={styles.strong}>{entry.type}</Text><Text style={styles.muted}>{entry.at}</Text></View>)}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  json: { minHeight: 120, textAlignVertical: 'top' },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#77777744', paddingTop: 8, marginTop: 8, gap: 4 },
  actions: { gap: 8, marginTop: 8 },
  strong: { fontWeight: '700', marginTop: 4 },
  muted: { opacity: 0.72, marginTop: 4 }
});
