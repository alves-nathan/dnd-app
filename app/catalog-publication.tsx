import { useMemo, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import {
  evaluateCatalogPublicationEligibility,
  resolveCatalogPublicationStatus,
  type CatalogReleaseChannel
} from '../src/catalog/catalogPublication';
import { CURRENT_APP_VERSION } from '../src/config/appMetadata';
import { useCatalogDistributionStore } from '../src/store/catalogDistributionStore';
import { useCatalogPublicationStore } from '../src/store/catalogPublicationStore';
import { useCatalogTrustStore } from '../src/store/catalogTrustStore';

const channelLabel: Record<CatalogReleaseChannel, string> = { stable: 'Stable', beta: 'Beta', preview: 'Preview' };
const reasonLabel: Record<string, string> = {
  eligible: 'Elegível para download manual',
  channelMismatch: 'Outro canal selecionado',
  appTooOld: 'Aplicativo abaixo da versão mínima',
  appTooNew: 'Aplicativo acima da versão máxima',
  outsideRollout: 'Fora da coorte atual do rollout',
  paused: 'Publicação pausada',
  withdrawn: 'Publicação retirada',
  expired: 'Publicação expirada',
  distributionMismatch: 'Manifesto de distribuição divergente'
};

export default function CatalogPublicationScreen() {
  const registry = useCatalogTrustStore((state) => state.registry);
  const distributions = useCatalogDistributionStore((state) => state.manifests);
  const selectedChannel = useCatalogPublicationStore((state) => state.selectedChannel);
  const cohortId = useCatalogPublicationStore((state) => state.cohortId);
  const publications = useCatalogPublicationStore((state) => state.publications);
  const controls = useCatalogPublicationStore((state) => state.controls);
  const evidence = useCatalogPublicationStore((state) => state.eligibilityEvidence);
  const events = useCatalogPublicationStore((state) => state.events);
  const setSelectedChannel = useCatalogPublicationStore((state) => state.setSelectedChannel);
  const importPublication = useCatalogPublicationStore((state) => state.importPublication);
  const importControl = useCatalogPublicationStore((state) => state.importControl);
  const evaluatePublication = useCatalogPublicationStore((state) => state.evaluatePublication);
  const removePublication = useCatalogPublicationStore((state) => state.removePublication);
  const [publicationJson, setPublicationJson] = useState('');
  const [controlJson, setControlJson] = useState('');

  const evaluations = useMemo(() => Object.values(publications).map((publication) => {
    const manifest = Object.values(distributions).find((entry) => entry.publisherId === publication.publisherId && entry.sequence === publication.sequence);
    return {
      publication,
      manifest,
      status: resolveCatalogPublicationStatus(controls[publication.publicationId] ?? []),
      evidence: evaluateCatalogPublicationEligibility({
        publication,
        controls: controls[publication.publicationId] ?? [],
        selectedChannel,
        appVersion: CURRENT_APP_VERSION,
        cohortId,
        distributionManifest: manifest
      })
    };
  }), [cohortId, controls, distributions, publications, selectedChannel]);

  const chooseChannel = (channel: CatalogReleaseChannel) => {
    const preview = setSelectedChannel(channel, false);
    if (preview.ok) return;
    Alert.alert(
      `Mudar para ${channelLabel[channel]}?`,
      `${preview.assessment.explanation}\n\nA mudança não baixa, remove nem aplica catálogos.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar canal', onPress: () => setSelectedChannel(channel, true) }
      ]
    );
  };

  const submitPublication = () => {
    try {
      const parsed = JSON.parse(publicationJson) as { publisherId?: string; sequence?: number };
      const distributionManifest = Object.values(distributions).find((entry) => entry.publisherId === parsed.publisherId && entry.sequence === parsed.sequence);
      const result = importPublication(publicationJson, { registry, distributionManifest });
      Alert.alert(result.ok ? 'Publicação validada' : 'Publicação rejeitada', result.ok ? 'Canal, compatibilidade, rollout e notas foram verificados. Nenhum download foi iniciado.' : result.issue);
      if (result.ok) setPublicationJson('');
    } catch { Alert.alert('JSON inválido', 'O documento não contém uma publicação válida.'); }
  };

  const submitControl = () => {
    const result = importControl(controlJson, registry);
    Alert.alert(result.ok ? 'Controle aplicado' : 'Controle rejeitado', result.ok ? 'O estado assinado da publicação foi atualizado. Nenhum catálogo ativo foi alterado.' : result.issue);
    if (result.ok) setControlJson('');
  };

  return (
    <Screen title="Canais de publicação" subtitle="Escolha explicitamente um canal e valide rollout, compatibilidade e notas assinadas antes de qualquer download." onBack={() => router.back()}>
      <Card variant="hero" title={`Canal atual: ${channelLabel[selectedChannel]}`} subtitle={`Aplicativo ${CURRENT_APP_VERSION} · coorte local ${cohortId.slice(-8)}. O identificador completo não é compartilhado; somente seu hash aparece nas evidências.`}>
        {(['stable', 'beta', 'preview'] as CatalogReleaseChannel[]).map((channel) => (
          <Button key={channel} testID={`catalog-channel-${channel}`} label={`${channelLabel[channel]}${selectedChannel === channel ? ' · selecionado' : ''}`} secondary={selectedChannel !== channel} onPress={() => chooseChannel(channel)} />
        ))}
      </Card>

      <Card title="Importar publicação assinada" subtitle="A publicação vincula um manifesto de distribuição a canal, versões compatíveis, rollout e notas de versão verificadas.">
        <Field testID="catalog-publication-json" label="Publicação assinada JSON" value={publicationJson} onChangeText={setPublicationJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="catalog-publication-import" label="Validar publicação" onPress={submitPublication} disabled={!publicationJson.trim()} />
      </Card>

      <Card title="Pausa ou retirada assinada" subtitle="Controles monotônicos permitem pausar, retomar ou retirar uma publicação sem alterar silenciosamente o catálogo já ativo.">
        <Field testID="catalog-publication-control-json" label="Controle assinado JSON" value={controlJson} onChangeText={setControlJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="catalog-publication-control-import" label="Validar controle" onPress={submitControl} disabled={!controlJson.trim()} />
      </Card>

      {evaluations.map(({ publication, manifest, status, evidence: currentEvidence }) => (
        <Card key={publication.publicationId} title={`${publication.catalogVersion} · ${channelLabel[publication.channel]}`} subtitle={`${publication.releaseNotes.title} · rollout ${publication.rolloutPercent}%`}>
          <Text testID={`catalog-publication-status-${publication.publicationId}`} style={currentEvidence.eligible ? styles.success : styles.warning}>{reasonLabel[currentEvidence.reason]} · estado {status}</Text>
          <Text style={styles.strong}>{publication.releaseNotes.summary}</Text>
          {publication.releaseNotes.items.map((item) => <Text key={item} style={styles.item}>• {item}</Text>)}
          <Text style={styles.muted}>Aplicativo: {publication.minAppVersion}{publication.maxAppVersion ? ` a ${publication.maxAppVersion}` : ' ou superior'} · coorte {(currentEvidence.cohortScore / 100).toFixed(2)}%</Text>
          <Text style={styles.muted}>Distribuição: {manifest ? 'manifesto correspondente disponível' : 'aguardando manifesto correspondente'}</Text>
          <Button testID={`catalog-publication-evaluate-${publication.publicationId}`} label="Gerar evidência de elegibilidade" variant="outlined" onPress={() => {
            const generated = evaluatePublication(publication.publicationId, manifest);
            Alert.alert(generated.eligible ? 'Dispositivo elegível' : 'Publicação indisponível', reasonLabel[generated.reason]);
          }} />
          <Button testID={`catalog-publication-remove-${publication.publicationId}`} label="Remover publicação local" variant="text" onPress={() => removePublication(publication.publicationId)} />
        </Card>
      ))}

      {!evaluations.length ? <Card title="Nenhuma publicação importada"><Text style={styles.muted}>Importe uma publicação assinada para habilitar um manifesto de distribuição.</Text></Card> : null}

      <Card title="Saúde e promoção" subtitle="Métricas agregadas, limites assinados e recomendações sem execução automática.">
        <Button testID="open-rollout-health" label="Abrir saúde do rollout" variant="outlined" onPress={() => router.push('/catalog-rollout-health')} />
      </Card>

      <Card title="Evidências de elegibilidade" subtitle={`${evidence.length} avaliação(ões) persistida(s)`}>
        <Button testID="catalog-publication-evidence-share" label="Compartilhar evidências" secondary onPress={() => { void Share.share({ title: 'Elegibilidade das publicações do catálogo', message: JSON.stringify(evidence, null, 2) }); }} disabled={!evidence.length} />
        {[...evidence].reverse().slice(0, 10).map((entry) => <View key={`${entry.evidenceId}:${entry.evaluatedAt}`} style={styles.row}><Text style={styles.strong}>{entry.channel} · {entry.eligible ? 'elegível' : reasonLabel[entry.reason]}</Text><Text style={styles.muted}>{entry.evaluatedAt} · coorte {(entry.cohortScore / 100).toFixed(2)}%</Text></View>)}
      </Card>

      <Card title="Eventos de publicação" subtitle={`${events.length} evento(s) local(is)`}>
        {[...events].reverse().slice(0, 20).map((entry) => <View key={entry.id} style={styles.row}><Text style={styles.strong}>{entry.type}</Text><Text style={styles.muted}>{entry.at}</Text></View>)}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  json: { minHeight: 120, textAlignVertical: 'top' },
  strong: { fontWeight: '700', marginTop: 6 },
  muted: { opacity: 0.7, marginTop: 4 },
  item: { marginTop: 3 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#77777744', paddingTop: 8, marginTop: 8 },
  success: { color: '#146C43', fontWeight: '700' },
  warning: { color: '#A76400', fontWeight: '700' }
});
