import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Share, StyleSheet, Text } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import { useCatalogOperationalFederationStore } from '../src/store/catalogOperationalFederationStore';
import { useCatalogTrustStore } from '../src/store/catalogTrustStore';

const statusLabel = { approved: 'Consenso aprovado', warning: 'Consenso com avisos', rejected: 'Consenso rejeitado' } as const;

export default function CatalogOperationalFederationScreen() {
  const registry = useCatalogTrustStore((state) => state.registry);
  const imported = useCatalogOperationalFederationStore((state) => state.importedFederations);
  const importFederation = useCatalogOperationalFederationStore((state) => state.importFederation);
  const compareFederations = useCatalogOperationalFederationStore((state) => state.compareFederations);
  const removeFederation = useCatalogOperationalFederationStore((state) => state.removeFederation);
  const [json, setJson] = useState('');
  const [leftId, setLeftId] = useState<string | undefined>();
  const [rightId, setRightId] = useState<string | undefined>();

  const pick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      setJson(await new File(result.assets[0].uri).text());
    } catch { Alert.alert('Arquivo não lido', 'Não foi possível ler o pacote federado.'); }
  };

  const comparison = leftId && rightId ? compareFederations(leftId, rightId) : undefined;

  return (
    <Screen title="Federação de auditoria" subtitle="Testemunhas independentes e consenso verificável sobre o head do diário operacional." onBack={() => router.back()}>
      <Card variant="hero" title="Consenso somente leitura" subtitle="A federação compara múltiplos dispositivos e testemunhos assinados sem conceder capacidade de execução ou rollback.">
        <Text style={styles.muted}>Cada pacote precisa de pelo menos duas testemunhas independentes e a política precisa exigir dois ou mais dispositivos.</Text>
        <Button testID="operational-federation-open-audit" label="Abrir auditoria operacional" variant="outlined" onPress={() => router.push('/catalog-operational-audit')} />
      </Card>

      <Card title="Importar federação" subtitle="O pacote inclui política assinada, auditorias dos dispositivos e testemunhos independentes.">
        <Button testID="operational-federation-pick-file" label="Selecionar arquivo" variant="outlined" onPress={() => { void pick(); }} />
        <Field testID="operational-federation-json" label="Pacote federado JSON" value={json} onChangeText={setJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="operational-federation-import" label="Validar e importar" disabled={!json.trim()} onPress={() => {
          const result = importFederation(json, registry, 'Federação importada');
          Alert.alert(result.ok ? 'Federação validada' : 'Federação rejeitada', result.ok ? 'O consenso foi armazenado somente para auditoria.' : result.issue);
          if (result.ok) setJson('');
        }} />
      </Card>

      {comparison ? (
        <Card title="Comparação entre consensos" subtitle={comparison.message}>
          <Text style={comparison.status === 'forked' || comparison.status === 'unrelated' ? styles.error : styles.muted}>Estado: {comparison.status}</Text>
        </Card>
      ) : null}

      {imported.slice().reverse().map((record) => (
        <Card key={record.recordId} title={record.sourceLabel ?? record.federation.federationId} subtitle={`${statusLabel[record.consensus.status]} · somente leitura`}>
          <Text style={styles.muted}>Dispositivos: {record.consensus.deviceCount} · testemunhas: {record.consensus.uniqueWitnessCount}</Text>
          <Text style={styles.muted}>Prefixo comum: {record.consensus.commonPrefixEntries} · head: {record.consensus.canonicalHeadHash?.slice(0, 22) ?? 'indisponível'}…</Text>
          {record.consensus.findings.slice(0, 4).map((entry) => <Text key={`${entry.code}-${entry.packageId ?? ''}`} style={entry.severity === 'error' ? styles.error : styles.warning}>{entry.code}: {entry.message}</Text>)}
          <Button label="Usar como consenso esquerdo" variant="outlined" onPress={() => setLeftId(record.recordId)} />
          <Button label="Usar como consenso direito" variant="outlined" onPress={() => setRightId(record.recordId)} />
          <Button label="Compartilhar consenso" variant="text" onPress={() => { void Share.share({ title: `${record.consensus.consensusId}.json`, message: JSON.stringify(record.consensus, null, 2) }); }} />
          <Button label="Remover federação" variant="text" onPress={() => removeFederation(record.recordId)} />
        </Card>
      ))}

      <Card title="Ferramentas independentes" subtitle="A política e os testemunhos devem ser assinados fora do aplicativo.">
        <Text style={styles.code}>node scripts/sign-catalog-operational-witness-policy.js --input politica.json --private-key autoridade.jwk.json --output politica-assinada.json</Text>
        <Text style={styles.code}>node scripts/sign-catalog-operational-witness-statement.js --input pacote.json --policy politica-assinada.json --private-key testemunha.jwk.json --witness-id ID --publisher-id ID --key-id ID --device-hash HASH --output testemunho.json</Text>
        <Text style={styles.code}>node scripts/verify-catalog-operational-federation.js --input federacao.json --registry confianca.json</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  json: { minHeight: 120, textAlignVertical: 'top' },
  muted: { opacity: 0.72, marginTop: 4 },
  warning: { color: '#9A6700', marginTop: 4 },
  error: { color: '#B42318', marginTop: 4 },
  code: { fontFamily: 'monospace', opacity: 0.85, marginTop: 6 }
});
