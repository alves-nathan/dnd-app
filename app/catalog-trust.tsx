import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import {
  catalogPublicKeyFingerprint,
  type CatalogEcPublicJwk,
  type CatalogKeyRevocationStatement,
  type CatalogKeyRotationStatement
} from '../src/catalog/catalogTrust';
import { useCatalogTrustStore } from '../src/store/catalogTrustStore';

interface CommunityPublisherInput {
  publisherId: string;
  displayName: string;
  keyId: string;
  publicJwk: CatalogEcPublicJwk;
}

export default function CatalogTrustScreen() {
  const registry = useCatalogTrustStore((state) => state.registry);
  const addCommunityPublisher = useCatalogTrustStore((state) => state.addCommunityPublisher);
  const applyRotation = useCatalogTrustStore((state) => state.applyRotation);
  const applyRevocation = useCatalogTrustStore((state) => state.applyRevocation);
  const [publisherJson, setPublisherJson] = useState('');
  const [fingerprintAck, setFingerprintAck] = useState('');
  const [statementJson, setStatementJson] = useState('');

  const parsedPublisher = useMemo(() => {
    try {
      const value = JSON.parse(publisherJson) as CommunityPublisherInput;
      if (!value.publicJwk) return undefined;
      return { value, fingerprint: catalogPublicKeyFingerprint(value.publicJwk) };
    } catch {
      return undefined;
    }
  }, [publisherJson]);

  const importPublisher = () => {
    if (!parsedPublisher) return Alert.alert('Publicador inválido', 'Informe um documento JSON com publisherId, displayName, keyId e publicJwk.');
    const result = addCommunityPublisher({ ...parsedPublisher.value, acknowledgedFingerprint: fingerprintAck });
    Alert.alert(result.ok ? 'Publicador confiável adicionado' : 'Publicador rejeitado', result.ok ? 'A chave comunitária foi armazenada após o reconhecimento do fingerprint.' : result.issue);
    if (result.ok) { setPublisherJson(''); setFingerprintAck(''); }
  };

  const applyStatement = (kind: 'rotation' | 'revocation') => {
    try {
      const parsed = JSON.parse(statementJson) as CatalogKeyRotationStatement | CatalogKeyRevocationStatement;
      const result = kind === 'rotation'
        ? applyRotation(parsed as CatalogKeyRotationStatement)
        : applyRevocation(parsed as CatalogKeyRevocationStatement);
      Alert.alert(result.ok ? 'Cadeia de confiança atualizada' : 'Declaração rejeitada', result.ok ? 'A alteração foi validada criptograficamente e registrada no histórico.' : result.issue);
      if (result.ok) setStatementJson('');
    } catch {
      Alert.alert('Documento inválido', 'A declaração não contém JSON válido.');
    }
  };

  return (
    <Screen title="Publicadores confiáveis" subtitle="Gerencie chaves públicas, rotações e revogações usadas para validar atualizações do catálogo.">
      <Card title="Registro de confiança" subtitle={`Revisão ${registry.revision} · ${registry.publishers.length} publicador(es)`}>
        {registry.publishers.map((publisher) => (
          <View key={publisher.publisherId} style={styles.row} testID={`catalog-trust-publisher-${publisher.publisherId}`}>
            <Text style={styles.strong}>{publisher.displayName}</Text>
            <Text style={styles.muted}>{publisher.kind === 'official' ? 'Oficial fixado no aplicativo' : 'Comunitário aprovado pelo usuário'} · {publisher.status}</Text>
            {publisher.keys.map((key) => (
              <View key={key.keyId} style={styles.keyRow}>
                <Text>{key.keyId} · {key.status}</Text>
                <Text selectable style={styles.fingerprint}>{key.fingerprint}</Text>
              </View>
            ))}
            {publisher.lastAcceptedBundle ? <Text testID={`catalog-trust-anchor-${publisher.publisherId}`} style={styles.muted}>Último bundle: seq. {publisher.lastAcceptedBundle.sequence} · {publisher.lastAcceptedBundle.catalogVersion}</Text> : <Text style={styles.muted}>Nenhum bundle desse publicador foi aceito ainda.</Text>}
          </View>
        ))}
      </Card>

      <Card title="Adicionar publicador comunitário" subtitle="Confirme o fingerprint recebido por um canal independente antes de confiar na chave.">
        <Field testID="catalog-trust-publisher-json" label="Documento do publicador" value={publisherJson} onChangeText={setPublisherJson} multiline style={styles.json} autoCapitalize="none" />
        {parsedPublisher ? <Text testID="catalog-trust-computed-fingerprint" selectable style={styles.fingerprint}>Fingerprint calculado: {parsedPublisher.fingerprint}</Text> : null}
        <Field testID="catalog-trust-fingerprint-ack" label="Fingerprint reconhecido" value={fingerprintAck} onChangeText={setFingerprintAck} autoCapitalize="none" />
        <Button testID="catalog-trust-add-community" label="Confiar neste publicador" onPress={importPublisher} disabled={!parsedPublisher || fingerprintAck.trim().length !== 64} />
      </Card>

      <Card title="Rotação ou revogação assinada" subtitle="A declaração precisa ser assinada por uma chave atualmente ativa do mesmo publicador.">
        <Field testID="catalog-trust-statement-json" label="Declaração JSON" value={statementJson} onChangeText={setStatementJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="catalog-trust-rotate" label="Aplicar rotação de chave" secondary onPress={() => applyStatement('rotation')} disabled={!statementJson.trim()} />
        <Button testID="catalog-trust-revoke" label="Aplicar revogação" variant="outlined" onPress={() => applyStatement('revocation')} disabled={!statementJson.trim()} />
      </Card>

      <Card title="Histórico da cadeia" subtitle={`${registry.events.length} evento(s) preservado(s)`}>
        {[...registry.events].reverse().slice(0, 30).map((entry) => (
          <View key={entry.id} style={styles.eventRow}>
            <Text style={styles.strong}>{entry.type}</Text>
            <Text style={styles.muted}>{entry.publisherId}{entry.keyId ? ` · ${entry.keyId}` : ''}</Text>
            <Text style={styles.muted}>{entry.at}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#77777755', paddingTop: 10, marginTop: 10 },
  keyRow: { marginTop: 6 },
  eventRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#77777744', paddingTop: 8, marginTop: 8 },
  strong: { fontWeight: '700' },
  muted: { opacity: 0.7 },
  fingerprint: { fontFamily: 'monospace', fontSize: 12, marginTop: 4 },
  json: { minHeight: 120, textAlignVertical: 'top' }
});
