import { useMemo, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import { buildCharacterCompatibilityReport } from '../src/characters/characterCompatibility';
import { useCharacterChoiceBridge } from '../src/catalog/useCharacterChoiceBridge';
import { useCatalogStore } from '../src/store/catalogStore';
import { useCatalogTrustStore } from '../src/store/catalogTrustStore';
import { useCatalogTransparencyStore } from '../src/store/catalogTransparencyStore';
import { useCatalogDistributionStore } from '../src/store/catalogDistributionStore';
import { useCatalogPublicationStore } from '../src/store/catalogPublicationStore';
import { useCharacterStore } from '../src/store/characterStore';

export default function CatalogDistributionScreen() {
  const registry = useCatalogTrustStore((state) => state.registry);
  const logs = useCatalogTransparencyStore((state) => state.logs);
  const remoteManifests = useCatalogTransparencyStore((state) => state.remoteManifests);
  const snapshot = useCatalogStore((state) => state.snapshot);
  const filterState = useCatalogStore((state) => state.filterState);
  const characters = useCharacterStore((state) => state.characters);
  const bridge = useCharacterChoiceBridge();
  const selectedChannel = useCatalogPublicationStore((state) => state.selectedChannel);
  const publications = useCatalogPublicationStore((state) => state.publications);
  const eligibilityEvidence = useCatalogPublicationStore((state) => state.eligibilityEvidence);
  const policy = useCatalogDistributionStore((state) => state.policy);
  const manifests = useCatalogDistributionStore((state) => state.manifests);
  const observations = useCatalogDistributionStore((state) => state.observations);
  const sessions = useCatalogDistributionStore((state) => state.sessions);
  const cachedBundles = useCatalogDistributionStore((state) => state.cachedBundles);
  const evidence = useCatalogDistributionStore((state) => state.evidence);
  const events = useCatalogDistributionStore((state) => state.events);
  const setPolicy = useCatalogDistributionStore((state) => state.setPolicy);
  const importManifest = useCatalogDistributionStore((state) => state.importManifest);
  const probeMirrors = useCatalogDistributionStore((state) => state.probeMirrors);
  const startOrResumeDownload = useCatalogDistributionStore((state) => state.startOrResumeDownload);
  const requestPause = useCatalogDistributionStore((state) => state.requestPause);
  const cancelDownload = useCatalogDistributionStore((state) => state.cancelDownload);
  const prepareCachedUpdate = useCatalogDistributionStore((state) => state.prepareCachedUpdate);
  const removeCachedBundle = useCatalogDistributionStore((state) => state.removeCachedBundle);
  const [manifestJson, setManifestJson] = useState('');
  const [busy, setBusy] = useState(false);

  const currentReports = useMemo(() => {
    if (!snapshot || !filterState || bridge.status !== 'ready') return [];
    return characters.map((character) => buildCharacterCompatibilityReport({ character, snapshot, filterState, choices: bridge.choices }));
  }, [bridge.choices, bridge.status, characters, filterState, snapshot]);

  const importSignedManifest = () => {
    try {
      const parsed = JSON.parse(manifestJson) as { publisherId?: string };
      const publisherId = parsed.publisherId ?? '';
      const result = importManifest(manifestJson, { registry, remoteManifest: remoteManifests[publisherId], localLog: logs[publisherId] });
      Alert.alert(result.ok ? 'Distribuição validada' : 'Manifesto rejeitado', result.ok ? 'Os mirrors assinados estão disponíveis para verificação. Nenhum download foi iniciado.' : result.issue);
      if (result.ok) setManifestJson('');
    } catch { Alert.alert('JSON inválido', 'O manifesto de distribuição não contém JSON válido.'); }
  };

  const probe = async (publisherId: string) => {
    setBusy(true);
    const result = await probeMirrors(publisherId);
    setBusy(false);
    Alert.alert(result.ok ? 'Mirrors verificados' : 'Nenhum mirror utilizável', result.ok ? `${result.observations.filter((entry) => entry.status === 'available').length} mirror(s) consistente(s).` : result.issue);
  };

  const download = async (publisherId: string, automatic = false) => {
    setBusy(true);
    const result = await startOrResumeDownload(publisherId, { kind: 'unknown', observedAt: new Date().toISOString() }, { automatic, manualOverride: !automatic });
    setBusy(false);
    Alert.alert(result.ok ? 'Bundle disponível offline' : 'Download interrompido', result.ok ? 'O bundle foi verificado antes de entrar no cache. Ele ainda não foi aplicado.' : result.issue);
  };

  const prepare = async (cacheId: string) => {
    setBusy(true);
    const result = await prepareCachedUpdate(cacheId, currentReports);
    setBusy(false);
    Alert.alert(result.ok ? 'Atualização preparada' : 'Cache rejeitado', result.ok ? 'O bundle offline foi encaminhado ao preview transacional.' : result.issues.join('\n'));
    if (result.ok) router.push('/catalog-update');
  };

  return (
    <Screen title="Distribuição offline" subtitle="Baixe de mirrors assinados, retome blocos interrompidos e prepare atualizações somente depois da verificação completa." onBack={() => router.back()}>
      <Card variant="hero" title={`Canal ${selectedChannel}`} subtitle={`${Object.keys(publications).length} publicação(ões) assinada(s) · ${eligibilityEvidence.length} evidência(s) de elegibilidade. Downloads exigem canal, versão e coorte compatíveis.`}>
        <Button testID="open-catalog-publication" label="Revisar canais, rollout e notas" secondary onPress={() => router.push('/catalog-publication')} />
      </Card>
      <Card variant="hero" title="Política de rede" subtitle="Downloads assistidos nunca começam quando a rede não atende à política configurada.">
        <Text style={styles.strong}>Modo atual: {policy.mode === 'manual' ? 'manual' : 'assistido'}</Text>
        <Button testID="catalog-distribution-policy-mode" label={policy.mode === 'manual' ? 'Ativar modo assistido' : 'Usar somente modo manual'} secondary onPress={() => setPolicy({ ...policy, mode: policy.mode === 'manual' ? 'assisted' : 'manual' })} />
        <Button testID="catalog-distribution-policy-cellular" label={policy.allowCellular ? 'Dados móveis permitidos' : 'Dados móveis bloqueados'} variant="outlined" onPress={() => setPolicy({ ...policy, allowCellular: !policy.allowCellular })} />
        <Button testID="catalog-distribution-policy-roaming" label={policy.allowRoaming ? 'Roaming permitido' : 'Roaming bloqueado'} variant="outlined" onPress={() => setPolicy({ ...policy, allowRoaming: !policy.allowRoaming })} />
        <Button testID="catalog-distribution-policy-unknown" label={policy.allowUnknownNetwork ? 'Rede não classificada permitida no modo assistido' : 'Rede não classificada exige ação manual'} variant="outlined" onPress={() => setPolicy({ ...policy, allowUnknownNetwork: !policy.allowUnknownNetwork })} />
        <Text style={styles.muted}>Limite assistido: {(policy.maxAssistedBundleBytes / 1024 / 1024).toFixed(1)} MB · cache sempre verificado: {policy.verifyCachedBundleOnRead ? 'sim' : 'não'}</Text>
      </Card>

      <Card title="Importar manifesto de distribuição" subtitle="O documento assinado fixa os mirrors, checksums, blocos e a versão esperada. Importar não baixa nem aplica conteúdo.">
        <Field testID="catalog-distribution-manifest-json" label="Manifesto assinado JSON" value={manifestJson} onChangeText={setManifestJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="catalog-distribution-manifest-import" label="Validar origem e mirrors" onPress={importSignedManifest} disabled={!manifestJson.trim()} />
      </Card>

      {Object.values(manifests).map((manifest) => {
        const publisherObservations = observations[manifest.publisherId] ?? [];
        const session = sessions[`${manifest.publisherId}:${manifest.sequence}`];
        return (
          <Card key={`${manifest.publisherId}:${manifest.sequence}`} title={`${manifest.catalogVersion} · ${manifest.publisherId}`} subtitle={`${manifest.mirrors.length} mirrors assinados · ${manifest.chunks.length} blocos · ${(manifest.bundleByteLength / 1024 / 1024).toFixed(2)} MB`}>
            <Text testID={`catalog-distribution-sequence-${manifest.publisherId}`} style={styles.strong}>Sequência {manifest.sequence} · snapshot {manifest.snapshotId}</Text>
            <Text selectable style={styles.hash}>{manifest.bundleChecksum}</Text>
            <Button testID={`catalog-distribution-probe-${manifest.publisherId}`} label="Verificar mirrors" secondary onPress={() => { void probe(manifest.publisherId); }} disabled={busy} />
            {manifest.mirrors.map((mirror) => {
              const observed = publisherObservations.find((entry) => entry.mirrorId === mirror.mirrorId);
              return <View key={mirror.mirrorId} style={styles.row}><Text style={styles.strong}>{mirror.label}</Text><Text style={observed?.status === 'available' ? styles.success : observed?.status === 'conflicting' ? styles.error : styles.warning}>{observed?.status ?? 'não verificado'}{observed?.latencyMs !== undefined ? ` · ${observed.latencyMs} ms` : ''}</Text>{observed?.issue ? <Text style={styles.muted}>{observed.issue}</Text> : null}</View>;
            })}
            <Button testID={`catalog-distribution-download-${manifest.publisherId}`} label={session && ['paused', 'failed'].includes(session.status) ? 'Retomar download' : 'Baixar agora com confirmação manual'} onPress={() => { void download(manifest.publisherId, false); }} disabled={busy} />
            {policy.mode === 'assisted' ? <Button testID={`catalog-distribution-assisted-${manifest.publisherId}`} label="Executar conforme política assistida" variant="outlined" onPress={() => { void download(manifest.publisherId, true); }} disabled={busy} /> : null}
            {session ? <>
              <Text testID={`catalog-distribution-progress-${manifest.publisherId}`}>Status: {session.status} · {session.completedChunkIndexes.length}/{manifest.chunks.length} blocos · {(session.downloadedBytes / 1024 / 1024).toFixed(2)} MB</Text>
              <Text style={styles.muted}>Retomadas: {session.resumeCount} · mirrors usados: {session.usedMirrorIds.join(', ') || 'nenhum'}</Text>
              {session.status === 'downloading' ? <Button testID={`catalog-distribution-pause-${manifest.publisherId}`} label="Pausar após o bloco atual" variant="text" onPress={() => requestPause(session.id)} /> : null}
              {!['verified', 'cancelled'].includes(session.status) ? <Button testID={`catalog-distribution-cancel-${manifest.publisherId}`} label="Cancelar sessão" variant="text" onPress={() => { void cancelDownload(session.id); }} /> : null}
              {session.lastError ? <Text style={styles.error}>{session.lastError}</Text> : null}
            </> : null}
          </Card>
        );
      })}

      <Card title="Cache offline verificado" subtitle={`${Object.keys(cachedBundles).length} bundle(s) disponível(is) sem rede`}>
        {Object.values(cachedBundles).map((descriptor) => (
          <View key={descriptor.cacheId} style={styles.cacheRow} testID={`catalog-cache-${descriptor.cacheId}`}>
            <Text style={styles.strong}>{descriptor.catalogVersion} · sequência {descriptor.sequence}</Text>
            <Text style={styles.muted}>{descriptor.publisherId} · {(descriptor.bundleByteLength / 1024 / 1024).toFixed(2)} MB</Text>
            <Text selectable style={styles.hash}>{descriptor.bundleChecksum}</Text>
            <Button testID={`catalog-cache-prepare-${descriptor.cacheId}`} label="Abrir preview transacional" onPress={() => { void prepare(descriptor.cacheId); }} disabled={busy || bridge.status !== 'ready'} />
            <Button testID={`catalog-cache-remove-${descriptor.cacheId}`} label="Remover do dispositivo" variant="text" onPress={() => { void removeCachedBundle(descriptor.cacheId); }} />
          </View>
        ))}
        {!Object.keys(cachedBundles).length ? <Text style={styles.muted}>Nenhum bundle verificado está disponível offline.</Text> : null}
      </Card>

      <Card title="Evidências de download" subtitle={`${evidence.length} recibo(s) verificado(s)`}>
        <Button testID="catalog-download-evidence-share" label="Compartilhar evidências" secondary onPress={() => { void Share.share({ title: 'Evidências de download do catálogo', message: JSON.stringify(evidence, null, 2) }); }} disabled={!evidence.length} />
        {[...evidence].reverse().slice(0, 10).map((entry) => <View key={entry.evidenceId} style={styles.row}><Text style={styles.strong}>{entry.catalogVersion} · {entry.publisherId}</Text><Text style={styles.muted}>{entry.chunkCount} blocos · {entry.resumeCount} retomada(s) · {entry.usedMirrorIds.join(', ')}</Text></View>)}
      </Card>

      <Card title="Eventos de distribuição" subtitle={`${events.length} evento(s) local(is)`}>
        {[...events].reverse().slice(0, 20).map((entry) => <View key={entry.id} style={styles.row}><Text style={styles.strong}>{entry.type}</Text><Text style={styles.muted}>{entry.at}</Text></View>)}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  strong: { fontWeight: '700' },
  muted: { opacity: 0.7 },
  json: { minHeight: 120, textAlignVertical: 'top' },
  hash: { fontFamily: 'monospace', fontSize: 11, marginTop: 4 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#77777744', paddingTop: 8, marginTop: 8 },
  cacheRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#77777744', paddingTop: 10, marginTop: 10 },
  success: { color: '#146C43' },
  warning: { color: '#A76400' },
  error: { color: '#B3261E' }
});
