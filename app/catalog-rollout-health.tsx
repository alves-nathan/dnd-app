import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Screen } from '../src/components/Screen';
import { useCatalogPublicationStore } from '../src/store/catalogPublicationStore';
import { useCatalogRolloutHealthStore } from '../src/store/catalogRolloutHealthStore';
import { useCatalogTrustStore } from '../src/store/catalogTrustStore';

const statusLabel: Record<string, string> = {
  insufficient: 'Amostra insuficiente',
  healthy: 'Saudável',
  watch: 'Em observação',
  unhealthy: 'Não saudável'
};
const recommendationLabel: Record<string, string> = {
  hold: 'Manter rollout atual',
  expand: 'Recomendar expansão gradual',
  promote: 'Recomendar promoção de canal',
  pause: 'Recomendar pausa',
  rollback: 'Recomendar rollback operacional'
};

export default function CatalogRolloutHealthScreen() {
  const registry = useCatalogTrustStore((state) => state.registry);
  const publications = useCatalogPublicationStore((state) => state.publications);
  const sharingOptIn = useCatalogRolloutHealthStore((state) => state.sharingOptIn);
  const policies = useCatalogRolloutHealthStore((state) => state.policies);
  const directives = useCatalogRolloutHealthStore((state) => state.directives);
  const signals = useCatalogRolloutHealthStore((state) => state.signals);
  const evidence = useCatalogRolloutHealthStore((state) => state.evidence);
  const events = useCatalogRolloutHealthStore((state) => state.events);
  const setSharingOptIn = useCatalogRolloutHealthStore((state) => state.setSharingOptIn);
  const importPolicy = useCatalogRolloutHealthStore((state) => state.importPolicy);
  const importDirective = useCatalogRolloutHealthStore((state) => state.importDirective);
  const generateEvidence = useCatalogRolloutHealthStore((state) => state.generateEvidence);
  const effectiveRolloutFor = useCatalogRolloutHealthStore((state) => state.effectiveRolloutFor);
  const clearSignals = useCatalogRolloutHealthStore((state) => state.clearSignals);
  const [policyJson, setPolicyJson] = useState('');
  const [directiveJson, setDirectiveJson] = useState('');

  const publicationList = useMemo(() => Object.values(publications).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)), [publications]);

  const submitPolicy = () => {
    try {
      const parsed = JSON.parse(policyJson) as { publicationId?: string };
      const publication = parsed.publicationId ? publications[parsed.publicationId] : undefined;
      if (!publication) return Alert.alert('Publicação ausente', 'Importe primeiro a publicação assinada correspondente.');
      const result = importPolicy(policyJson, { registry, publication });
      Alert.alert(result.ok ? 'Política validada' : 'Política rejeitada', result.ok ? 'Os limites assinados foram armazenados. Nenhuma ação operacional foi executada.' : result.issue);
      if (result.ok) setPolicyJson('');
    } catch {
      Alert.alert('JSON inválido', 'O documento não contém uma política de saúde válida.');
    }
  };

  const submitDirective = () => {
    try {
      const parsed = JSON.parse(directiveJson) as { publicationId?: string; targetPublicationId?: string };
      const publication = parsed.publicationId ? publications[parsed.publicationId] : undefined;
      if (!publication) return Alert.alert('Publicação ausente', 'A publicação de origem precisa estar validada localmente.');
      const result = importDirective(directiveJson, {
        registry,
        publication,
        targetPublication: parsed.targetPublicationId ? publications[parsed.targetPublicationId] : undefined
      });
      Alert.alert(result.ok ? 'Diretriz validada' : 'Diretriz rejeitada', result.ok ? 'A elegibilidade futura passou a considerar a diretriz. Nenhum catálogo foi baixado, aplicado ou revertido.' : result.issue);
      if (result.ok) setDirectiveJson('');
    } catch {
      Alert.alert('JSON inválido', 'O documento não contém uma diretriz válida.');
    }
  };

  const createEvidence = (publicationId: string) => {
    const publication = publications[publicationId];
    if (!publication) return;
    try {
      const generated = generateEvidence(publication);
      Alert.alert(statusLabel[generated.status], `${recommendationLabel[generated.recommendation]}\n\n${generated.findings.join('\n')}`);
    } catch (error) {
      Alert.alert('Evidência não gerada', error instanceof Error ? error.message : 'Não foi possível gerar a evidência.');
    }
  };

  return (
    <Screen title="Saúde e promoção do rollout" subtitle="Métricas locais, limites assinados e diretrizes auditáveis. Recomendações nunca executam ações automaticamente." onBack={() => router.back()}>
      <Card variant="hero" title={sharingOptIn ? 'Compartilhamento opt-in ativado' : 'Métricas permanecem somente neste dispositivo'} subtitle="Sinais operacionais não contêm nome, e-mail, personagem ou identificador completo da instalação. Somente evidências agregadas podem ser compartilhadas.">
        <Button testID="rollout-health-opt-in" label={sharingOptIn ? 'Desativar compartilhamento' : 'Ativar compartilhamento de evidências'} secondary onPress={() => setSharingOptIn(!sharingOptIn)} />
      </Card>

      <Card title="Importar limites de saúde assinados" subtitle="A política define amostra mínima, sucesso, falhas, rollback, integridade e duração p95.">
        <Field testID="rollout-health-policy-json" label="Política assinada JSON" value={policyJson} onChangeText={setPolicyJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="rollout-health-policy-import" label="Validar política" onPress={submitPolicy} disabled={!policyJson.trim()} />
      </Card>

      <Card title="Importar diretriz operacional assinada" subtitle="Expansão, redução, promoção, pausa e rollback exigem evidência íntegra. Nenhuma diretriz aplica um catálogo.">
        <Field testID="rollout-health-directive-json" label="Diretriz assinada JSON" value={directiveJson} onChangeText={setDirectiveJson} multiline style={styles.json} autoCapitalize="none" />
        <Button testID="rollout-health-directive-import" label="Validar diretriz" onPress={submitDirective} disabled={!directiveJson.trim()} />
      </Card>

      {publicationList.map((publication) => {
        const publicationPolicies = policies[publication.publicationId] ?? [];
        const publicationDirectives = directives[publication.publicationId] ?? [];
        const publicationSignals = signals.filter((entry) => entry.publicationId === publication.publicationId);
        const publicationEvidence = [...evidence].reverse().find((entry) => entry.publicationId === publication.publicationId);
        const effective = effectiveRolloutFor(publication);
        return (
          <Card key={publication.publicationId} title={`${publication.catalogVersion} · ${publication.channel}`} subtitle={`Rollout declarado ${publication.rolloutPercent}% · efetivo ${effective.rolloutPercent}%`}>
            <Text testID={`rollout-health-status-${publication.publicationId}`} style={publicationEvidence?.status === 'unhealthy' ? styles.error : publicationEvidence?.status === 'healthy' ? styles.success : styles.warning}>
              {publicationEvidence ? `${statusLabel[publicationEvidence.status]} · ${recommendationLabel[publicationEvidence.recommendation]}` : 'Sem evidência agregada'}
            </Text>
            <Text style={styles.muted}>Políticas: {publicationPolicies.length} · diretrizes: {publicationDirectives.length} · sinais locais: {publicationSignals.length}</Text>
            {effective.directiveId ? <Text style={styles.muted}>Diretriz efetiva: {effective.directiveId} · {effective.action}</Text> : null}
            {publicationEvidence ? (
              <>
                <Text style={styles.strong}>Sucesso {(publicationEvidence.metrics.successRate * 100).toFixed(1)}% · falha {(publicationEvidence.metrics.failureRate * 100).toFixed(1)}% · rollback {(publicationEvidence.metrics.rollbackRate * 100).toFixed(1)}%</Text>
                <Text style={styles.muted}>Adoção {(publicationEvidence.metrics.adoptionRate * 100).toFixed(1)}% · integridade {(publicationEvidence.metrics.integrityFailureRate * 100).toFixed(1)}% · p95 {publicationEvidence.metrics.p95DurationMs} ms</Text>
                {publicationEvidence.cohorts.map((cohort) => <View key={cohort.band} style={styles.row}><Text style={styles.strong}>Coorte {cohort.band}% · {cohort.samples} sinais</Text><Text style={styles.muted}>Sucesso {(cohort.successRate * 100).toFixed(1)}% · falha {(cohort.failureRate * 100).toFixed(1)}%</Text></View>)}
              </>
            ) : null}
            <Button testID={`rollout-health-generate-${publication.publicationId}`} label="Gerar evidência agregada" variant="outlined" onPress={() => createEvidence(publication.publicationId)} disabled={!sharingOptIn || !publicationPolicies.length} />
            <Button testID={`rollout-health-clear-${publication.publicationId}`} label="Limpar sinais locais" variant="text" onPress={() => Alert.alert('Limpar sinais?', 'Recibos, políticas, diretrizes e evidências já geradas serão preservados.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Limpar', style: 'destructive', onPress: () => clearSignals(publication.publicationId) }])} disabled={!publicationSignals.length} />
          </Card>
        );
      })}

      {!publicationList.length ? <Card title="Nenhuma publicação"><Text style={styles.muted}>Importe uma publicação assinada antes de avaliar a saúde do rollout.</Text></Card> : null}

      <Card title="Evidências opt-in" subtitle={`${evidence.length} evidência(s) agregada(s)`}>
        <Button testID="rollout-health-evidence-share" label="Compartilhar evidências" secondary onPress={() => { void Share.share({ title: 'Saúde do rollout do catálogo', message: JSON.stringify(evidence, null, 2) }); }} disabled={!evidence.length || !sharingOptIn} />
        {[...evidence].reverse().slice(0, 10).map((entry) => <View key={entry.evidenceId} style={styles.row}><Text style={styles.strong}>{entry.catalogVersion} · {statusLabel[entry.status]}</Text><Text style={styles.muted}>{entry.generatedAt} · {recommendationLabel[entry.recommendation]}</Text></View>)}
      </Card>

      <Card title="Auditoria local" subtitle={`${events.length} evento(s)`}>
        {[...events].reverse().slice(0, 20).map((entry) => <View key={entry.id} style={styles.row}><Text style={styles.strong}>{entry.type}</Text><Text style={styles.muted}>{entry.at}</Text></View>)}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  json: { minHeight: 120, textAlignVertical: 'top' },
  strong: { fontWeight: '700', marginTop: 4 },
  muted: { opacity: 0.72, marginTop: 4 },
  success: { color: '#146C43', fontWeight: '700' },
  warning: { color: '#A76400', fontWeight: '700' },
  error: { color: '#B3261E', fontWeight: '700' },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#77777744', paddingTop: 8, marginTop: 8 }
});
