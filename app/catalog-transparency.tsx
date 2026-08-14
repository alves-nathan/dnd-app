import { useMemo, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import type { CatalogRecoveryPolicy, CatalogRecoveryStatement, CatalogTransparencyLog, SignedCatalogRemoteManifest } from '../src/catalog/catalogTransparency';
import { useCatalogTransparencyStore } from '../src/store/catalogTransparencyStore';
import { useCatalogTrustStore } from '../src/store/catalogTrustStore';

export default function CatalogTransparencyScreen() {
  const registry = useCatalogTrustStore((state) => state.registry);
  const replaceRegistry = useCatalogTrustStore((state) => state.replaceRegistry);
  const logs = useCatalogTransparencyStore((state) => state.logs);
  const manifests = useCatalogTransparencyStore((state) => state.remoteManifests);
  const recoveryPolicies = useCatalogTransparencyStore((state) => state.recoveryPolicies);
  const importedTrust = useCatalogTransparencyStore((state) => state.importedTrust);
  const events = useCatalogTransparencyStore((state) => state.events);
  const importRemoteManifest = useCatalogTransparencyStore((state) => state.importRemoteManifest);
  const compareRemoteLog = useCatalogTransparencyStore((state) => state.compareRemoteLog);
  const exportPortableTrust = useCatalogTransparencyStore((state) => state.exportPortableTrust);
  const previewPortableTrustImport = useCatalogTransparencyStore((state) => state.previewPortableTrustImport);
  const applyPortableTrustImport = useCatalogTransparencyStore((state) => state.applyPortableTrustImport);
  const clearPortableTrustImport = useCatalogTransparencyStore((state) => state.clearPortableTrustImport);
  const setRecoveryPolicy = useCatalogTransparencyStore((state) => state.setRecoveryPolicy);
  const applyRecovery = useCatalogTransparencyStore((state) => state.applyRecovery);
  const [manifestJson, setManifestJson] = useState('');
  const [remoteLogJson, setRemoteLogJson] = useState('');
  const [portableJson, setPortableJson] = useState('');
  const [recoveryPolicyJson, setRecoveryPolicyJson] = useState('');
  const [recoveryJson, setRecoveryJson] = useState('');

  const metrics = useMemo(() => ({ publishers: Object.keys(logs).length, entries: Object.values(logs).reduce((sum, log) => sum + log.entries.length, 0), updates: Object.values(manifests).filter((entry) => entry.status === 'updateAvailable').length }), [logs, manifests]);

  const parseAction = <T,>(text: string, action: (value: T) => { ok: boolean; issue?: string }, success: string) => {
    try {
      const result = action(JSON.parse(text) as T);
      Alert.alert(result.ok ? success : 'Documento rejeitado', result.ok ? 'A operação foi validada e registrada localmente.' : result.issue);
    } catch {
      Alert.alert('JSON inválido', 'O documento informado não contém JSON válido.');
    }
  };

  return (
    <Screen title="Transparência e distribuição" subtitle="Compare o registro público com a cadeia local antes de baixar ou aplicar qualquer atualização." onBack={() => router.back()}>
      <Card variant="hero" title="Registro append-only" subtitle={`${metrics.publishers} publicador(es) · ${metrics.entries} bundle(s) observados · ${metrics.updates} atualização(ões) anunciada(s)`}>
        {Object.values(logs).map((log) => (
          <View key={log.logId} style={styles.row} testID={`catalog-transparency-log-${log.publisherId}`}>
            <Text style={styles.strong}>{log.publisherId}</Text>
            <Text>{log.entries.length} entrada(s) · revisão {log.revision}</Text>
            <Text selectable style={styles.hash}>{log.treeRoot}</Text>
          </View>
        ))}
        {!Object.keys(logs).length ? <Text style={styles.muted}>O primeiro bundle confirmado criará o registro local deste publicador.</Text> : null}
      </Card>

      <Card title="Distribuição resiliente" subtitle="Use mirrors assinados, cache offline e retomada em blocos sem aplicar automaticamente o catálogo.">
        <Button testID="catalog-transparency-open-distribution" label="Abrir distribuição offline" icon="download-outline" onPress={() => router.push('/catalog-distribution')} />
      </Card>

      <Card title="Manifesto remoto assinado" subtitle="O manifesto apenas anuncia uma versão e sua raiz pública. Ele nunca baixa ou aplica o catálogo automaticamente.">
        <Field testID="catalog-remote-manifest-json" label="Manifesto JSON" value={manifestJson} onChangeText={setManifestJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="catalog-remote-manifest-verify" label="Verificar manifesto" onPress={() => parseAction<SignedCatalogRemoteManifest>(manifestJson, (manifest) => importRemoteManifest(manifest, registry), 'Manifesto remoto verificado')} disabled={!manifestJson.trim()} />
        {Object.values(manifests).map((manifest) => <Text key={manifest.publisherId} testID={`catalog-remote-manifest-${manifest.publisherId}`} style={manifest.status === 'updateAvailable' ? styles.warning : styles.success}>{manifest.publisherId}: {manifest.status === 'updateAvailable' ? `versão ${manifest.latestCatalogVersion} disponível` : 'registro remoto atual'}</Text>)}
      </Card>

      <Card title="Comparar registro público" subtitle="Rollback, omissão e bifurcação são bloqueados, mesmo quando a assinatura individual do bundle é válida.">
        <Field testID="catalog-remote-log-json" label="Registro público JSON" value={remoteLogJson} onChangeText={setRemoteLogJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="catalog-remote-log-compare" label="Comparar com o registro local" secondary onPress={() => parseAction<CatalogTransparencyLog>(remoteLogJson, compareRemoteLog, 'Registro consistente')} disabled={!remoteLogJson.trim()} />
      </Card>

      <Card title="Exportar ou importar confiança" subtitle="Raízes oficiais não podem ser substituídas por importação direta. Mudanças críticas exigem recuperação em quórum.">
        <Button testID="catalog-trust-export" label="Compartilhar registro de confiança" secondary onPress={() => { void Share.share({ message: JSON.stringify(exportPortableTrust(registry), null, 2), title: 'Registro de confiança do catálogo' }); }} />
        <Field testID="catalog-trust-import-json" label="Exportação JSON" value={portableJson} onChangeText={setPortableJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="catalog-trust-import-preview" label="Validar importação" variant="outlined" onPress={() => {
          const result = previewPortableTrustImport(portableJson);
          Alert.alert(result.ok ? 'Exportação íntegra' : 'Exportação rejeitada', result.ok ? `${result.conflicts?.length ?? 0} conflito(s) encontrado(s). Nenhuma alteração foi aplicada.` : result.issue);
        }} disabled={!portableJson.trim()} />
        {importedTrust ? <>
          <Text testID="catalog-trust-import-ready" style={styles.warning}>Importação validada · revisão externa {importedTrust.registry.revision}</Text>
          <Button testID="catalog-trust-import-apply" label="Aplicar extensão segura" onPress={() => {
            const result = applyPortableTrustImport(registry);
            if (result.ok && result.registry) replaceRegistry(result.registry);
            Alert.alert(result.ok ? 'Confiança importada' : 'Importação bloqueada', result.ok ? 'Somente extensões consistentes foram incorporadas.' : result.issue);
          }} />
          <Button testID="catalog-trust-import-cancel" label="Cancelar importação" variant="text" onPress={clearPortableTrustImport} />
        </> : null}
      </Card>

      <Card title="Política de recuperação em quórum" subtitle="A perda de uma chave não autoriza um reset unilateral. A política exige pelo menos duas aprovações independentes.">
        <Field testID="catalog-recovery-policy-json" label="Política JSON" value={recoveryPolicyJson} onChangeText={setRecoveryPolicyJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="catalog-recovery-policy-save" label="Validar política" secondary onPress={() => parseAction<CatalogRecoveryPolicy>(recoveryPolicyJson, setRecoveryPolicy, 'Política de recuperação armazenada')} disabled={!recoveryPolicyJson.trim()} />
        <Text style={styles.muted}>{recoveryPolicies.length} política(s) configurada(s)</Text>
        <Field testID="catalog-recovery-statement-json" label="Declaração de recuperação" value={recoveryJson} onChangeText={setRecoveryJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="catalog-recovery-apply" label="Aplicar recuperação em quórum" variant="outlined" onPress={() => {
          try {
            const result = applyRecovery(registry, JSON.parse(recoveryJson) as CatalogRecoveryStatement);
            if (result.ok && result.registry) replaceRegistry(result.registry);
            Alert.alert(result.ok ? 'Confiança recuperada' : 'Recuperação rejeitada', result.ok ? 'O quórum foi verificado e a ação foi auditada.' : result.issue);
          } catch { Alert.alert('JSON inválido', 'A declaração de recuperação não contém JSON válido.'); }
        }} disabled={!recoveryJson.trim()} />
      </Card>

      <Card title="Eventos de transparência" subtitle={`${events.length} evento(s) preservado(s)`}>
        {[...events].reverse().slice(0, 30).map((entry) => <View key={entry.id} style={styles.row}><Text style={styles.strong}>{entry.type}</Text><Text style={styles.muted}>{entry.at}</Text></View>)}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#77777744', paddingTop: 8, marginTop: 8 },
  strong: { fontWeight: '700' },
  muted: { opacity: 0.7 },
  hash: { fontFamily: 'monospace', fontSize: 11, marginTop: 4 },
  json: { minHeight: 110, textAlignVertical: 'top' },
  warning: { color: '#A76400', marginTop: 6 },
  success: { color: '#146C43', marginTop: 6 }
});
