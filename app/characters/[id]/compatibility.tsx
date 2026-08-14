import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { MetricTile } from '../../../src/components/MetricTile';
import { Field } from '../../../src/components/Field';
import { Screen } from '../../../src/components/Screen';
import { useCharacterCompatibility } from '../../../src/characters/useCharacterCompatibility';
import type { CharacterCompatibilityResolutionAction } from '../../../src/characters/characterCompatibility';
import {
  createCompatibilityRemediationPlan,
  listCompatibilityReplacementCandidates,
  previewCompatibilityRemediation,
  removeCompatibilityRemediationDecision,
  upsertCompatibilityRemediationDecision
} from '../../../src/characters/compatibilityRemediation';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useCatalogStore } from '../../../src/store/catalogStore';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useAppTheme } from '../../../src/theme';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';

const getId = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] ?? '' : value ?? '';

const actionRoute = (characterId: string, action: CharacterCompatibilityResolutionAction): string => {
  if (action.route === 'content-management') return '/content-management';
  if (action.route === 'compendium') return '/compendium';
  return `/characters/${characterId}/compendium`;
};

export default function CharacterCompatibilityScreen() {
  const { colors } = useAppTheme();
  const { id: idParam } = useLocalSearchParams();
  const id = getId(idParam);
  const character = useCharacterStore((state) => state.characters.find((entry) => entry.id === id));
  const plan = useCharacterStore((state) => state.compatibilityRemediationPlans[id]);
  const savePlan = useCharacterStore((state) => state.saveCompatibilityRemediationPlan);
  const discardPlan = useCharacterStore((state) => state.discardCompatibilityRemediationPlan);
  const commitPlan = useCharacterStore((state) => state.commitCompatibilityRemediationPlan);
  const remediationRecovery = useCharacterStore((state) => state.compatibilityRemediationRecovery);
  const reconcileRemediationRecovery = useCharacterStore((state) => state.reconcileCompatibilityRemediationRecovery);
  const acknowledgeRemediationPlan = useCharacterStore((state) => state.acknowledgeCompatibilityRemediationPlan);
  const snapshot = useCatalogStore((state) => state.snapshot);
  const filterState = useCatalogStore((state) => state.filterState);
  const bridge = useCharacterChoiceBridge();
  const [replacementQuery, setReplacementQuery] = useState('');
  const compatibility = useCharacterCompatibility(character);

  useEffect(() => {
    if (snapshot?.snapshotId) reconcileRemediationRecovery(snapshot.snapshotId);
  }, [reconcileRemediationRecovery, snapshot?.snapshotId]);

  const recoveryStatus = remediationRecovery.conflictedCharacterIds.includes(id)
    ? 'conflicted'
    : remediationRecovery.staleCatalogCharacterIds.includes(id)
      ? 'staleCatalog'
      : remediationRecovery.pendingAcknowledgementCharacterIds.includes(id)
        ? 'recoverable'
        : 'ready';
  const planEditable = recoveryStatus === 'ready';

  const preview = useMemo(() => {
    if (!character || !plan || !compatibility.report || !snapshot || !filterState || bridge.status !== 'ready') return undefined;
    return previewCompatibilityRemediation({
      character,
      report: compatibility.report,
      plan,
      snapshot,
      filterState,
      choices: bridge.choices
    });
  }, [bridge.choices, bridge.status, character, compatibility.report, filterState, plan, snapshot]);

  if (!character) {
    return <Screen title="Personagem não encontrado" onBack={() => router.replace('/')}><Button label="Voltar" onPress={() => router.replace('/')} /></Screen>;
  }
  if (compatibility.status === 'loading') {
    return <Screen eyebrow="Compatibilidade" title="Verificando regras" subtitle="Comparando a ficha com o catálogo e o compêndio atuais." onBack={() => router.replace('/')}><Card variant="filled" title="Preparando manifesto" subtitle="Nenhuma escolha será modificada durante o diagnóstico." /></Screen>;
  }
  if (compatibility.status === 'failed' || !compatibility.report) {
    return <Screen eyebrow="Compatibilidade" title="Diagnóstico indisponível" subtitle={compatibility.error} onBack={() => router.replace('/')}><Button label="Voltar aos personagens" onPress={() => router.replace('/')} /></Screen>;
  }

  const report = compatibility.report;
  const statusTitle = report.status === 'compatible' ? 'Ficha compatível' : report.status === 'review' ? 'Revisão recomendada' : 'Conteúdo incompatível detectado';
  const statusSubtitle = report.status === 'compatible'
    ? 'Todas as referências encontradas estão disponíveis nos filtros atuais.'
    : 'A ficha foi preservada. Revise as ocorrências abaixo antes de decidir como continuar.';

  const beginPlan = () => savePlan(createCompatibilityRemediationPlan({ character, report }));
  const decide = (issueId: string, referenceKey: string | undefined, kind: 'remove' | 'replace' | 'adoptSnapshot', replacementChoiceId?: string) => {
    if (!planEditable) return;
    const current = plan ?? createCompatibilityRemediationPlan({ character, report });
    savePlan(upsertCompatibilityRemediationDecision(current, { issueId, referenceKey, kind, replacementChoiceId }));
  };
  const commit = () => {
    if (!preview?.ok || !planEditable) return;
    Alert.alert(
      'Aplicar plano de remediação?',
      `${preview.changes.length} decisão(ões) serão aplicadas em uma única transação auditável.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Aplicar plano',
          onPress: () => {
            const result = commitPlan(character.id, preview);
            if (!result?.ok) {
              Alert.alert('Plano não aplicado', 'A ficha mudou ou o preview deixou de ser válido. Gere um novo plano.');
              return;
            }
            Alert.alert('Remediação concluída', 'Todas as decisões foram confirmadas em um único commit.');
          }
        }
      ]
    );
  };

  return (
    <Screen
      eyebrow="Manifesto de regras"
      title={getCharacterDisplayName(character)}
      subtitle={`Snapshot da ficha: ${report.manifest.characterCatalogSnapshotId ?? 'não registrado'} · atual: ${report.manifest.currentCatalogSnapshotId}`}
      onBack={() => router.replace('/')}
    >
      <Card variant={report.status === 'compatible' ? 'hero' : 'filled'} title={statusTitle} subtitle={statusSubtitle}>
        <View style={styles.metrics}>
          <MetricTile label="Referências" value={report.manifest.counts.total} />
          <MetricTile label="Bloqueios" value={report.blockingIssueCount} />
          <MetricTile label="Avisos" value={report.warningCount} />
        </View>
        <Button
          testID="compatibility-open-character"
          label={report.requiresReview ? 'Abrir ficha mesmo assim' : 'Abrir ficha'}
          icon="person-outline"
          onPress={() => router.replace(`/characters/${character.id}?compatibilityReviewed=1` as never)}
        />
        {report.requiresReview && !plan ? (
          <Button testID="compatibility-create-remediation-plan" label="Criar plano de remediação" icon="construct-outline" variant="tonal" onPress={beginPlan} />
        ) : null}
      </Card>


      {plan && recoveryStatus !== 'ready' ? (
        <Card variant="filled" title="Plano recuperado" subtitle={recoveryStatus === 'recoverable'
          ? 'Este plano foi restaurado após reinício. Confirme a retomada antes de editar ou aplicar decisões.'
          : recoveryStatus === 'conflicted'
            ? 'A ficha mudou depois da criação do plano. Descarte-o e gere um novo plano.'
            : 'O catálogo mudou depois da criação do plano. Descarte-o e gere um novo plano.'}>
          {recoveryStatus === 'recoverable' ? (
            <Button testID="compatibility-acknowledge-remediation" label="Retomar com segurança" icon="refresh-circle-outline" onPress={() => acknowledgeRemediationPlan(character.id)} />
          ) : null}
          <Button label="Abrir gestão global" variant="outlined" onPress={() => router.push('/character-compatibility')} />
        </Card>
      ) : null}

      {plan ? (
        <Card variant="filled" title={plan.origin === 'preventiveCatalogChange' ? "Plano preventivo de remediação" : "Plano de remediação"} subtitle={plan.origin === 'preventiveCatalogChange' ? `Iniciado após ${plan.preventiveContext?.label ?? 'alteração preventiva do catálogo'}. Nenhuma decisão foi tomada automaticamente.` : "Nada será alterado até a confirmação final."}>
          <View style={styles.metrics}>
            <MetricTile label="Decisões" value={plan.decisions.length} />
            <MetricTile label="Substituições" value={preview?.impact.replacements ?? 0} />
            <MetricTile label="Remoções" value={preview?.impact.removals ?? 0} />
          </View>
          {preview ? (
            <>
              <Text style={[styles.text, { color: colors.onSurface }]}>Bloqueios projetados: {preview.impact.blockingIssuesBefore} → {preview.impact.blockingIssuesAfter}</Text>
              <Text style={[styles.text, { color: colors.onSurfaceVariant }]}>Caminhos alterados: {preview.impact.changedPaths.join(', ') || 'nenhum'}</Text>
              {preview.blockingIssues.map((issue) => <Text key={`${issue.code}-${issue.message}`} style={[styles.issue, { color: colors.error }]}>{issue.message}</Text>)}
              {preview.changes.map((change) => <Text key={change.decisionId} style={[styles.text, { color: colors.onSurface }]}>{change.label}</Text>)}
            </>
          ) : null}
          <Button testID="compatibility-commit-remediation" label="Confirmar em uma única transação" icon="checkmark-circle-outline" disabled={!preview?.ok || !planEditable} onPress={commit} />
          <Button
            testID="compatibility-discard-remediation"
            label="Descartar plano"
            icon="close-circle-outline"
            variant="outlined"
            onPress={() => Alert.alert('Descartar plano?', 'A ficha permanecerá inalterada.', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Descartar', style: 'destructive', onPress: () => discardPlan(character.id) }
            ])}
          />
        </Card>
      ) : null}

      {plan ? (
        <Card variant="outlined" title="Buscar substituições" subtitle="A busca filtra candidatos do mesmo tipo mecânico em todas as ocorrências.">
          <Field label="Nome da substituição" value={replacementQuery} onChangeText={setReplacementQuery} placeholder="Ex.: Fire Bolt, Alert, Evoker" />
        </Card>
      ) : null}

      <Card variant="outlined" title="Manifesto de conteúdo" subtitle="Inventário somente leitura das regras usadas pela ficha.">
        <Text style={[styles.text, { color: colors.onSurface }]}>Livros: {report.manifest.sourceBookIds.join(', ') || 'nenhum identificado'}</Text>
        <Text style={[styles.text, { color: colors.onSurface }]}>Snapshots: {report.manifest.catalogSnapshotIds.join(', ') || 'nenhum registrado'}</Text>
        <Text style={[styles.text, { color: colors.onSurfaceVariant }]}>{report.manifest.counts.catalog} referência(s) oficiais · {report.manifest.counts.compendium} local(is) · {report.manifest.counts.missing} ausente(s)</Text>
      </Card>

      {report.issues.map((issue) => {
        const reference = issue.referenceKey ? report.manifest.references.find((entry) => entry.key === issue.referenceKey) : undefined;
        const selected = plan?.decisions.find((entry) => entry.issueId === issue.id);
        const normalizedQuery = replacementQuery.trim().toLowerCase();
        const candidates = reference ? listCompatibilityReplacementCandidates(reference, bridge.choices)
          .filter((candidate) => !normalizedQuery || candidate.searchableText.includes(normalizedQuery) || candidate.name.toLowerCase().includes(normalizedQuery))
          .slice(0, 8) : [];
        return (
          <Card key={issue.id} variant={issue.severity === 'error' ? 'filled' : 'outlined'} title={issue.title} subtitle={issue.message}>
            <Text style={[styles.code, { color: colors.onSurfaceVariant }]}>{issue.code}</Text>
            {selected ? <Text style={[styles.selected, { color: colors.primary }]}>Decisão: {selected.kind}{selected.replacementChoiceId ? ` · ${selected.replacementChoiceId}` : ''}</Text> : null}
            {plan && issue.code === 'CHARACTER_SNAPSHOT_MISMATCH' ? (
              <Button label="Adotar snapshot atual no commit" variant="tonal" disabled={!planEditable} onPress={() => decide(issue.id, undefined, 'adoptSnapshot')} />
            ) : null}
            {plan && reference && issue.severity === 'error' ? (
              <View style={styles.actions}>
                <Button label={`Remover ${reference.label}`} variant="outlined" disabled={!planEditable} onPress={() => decide(issue.id, reference.key, 'remove')} />
                {candidates.map((candidate) => (
                  <Button key={candidate.choiceId} label={`Substituir por ${candidate.name}`} variant="outlined" disabled={!planEditable} onPress={() => decide(issue.id, reference.key, 'replace', candidate.choiceId)} />
                ))}
                {selected ? <Button label="Limpar decisão" variant="text" disabled={!planEditable} onPress={() => savePlan(removeCompatibilityRemediationDecision(plan, issue.id))} /> : null}
              </View>
            ) : null}
            <View style={styles.actions}>
              {issue.actions.map((action) => (
                <Button key={`${issue.id}-${action.kind}`} label={action.label} variant="outlined" onPress={() => router.push(actionRoute(character.id, action) as never)} />
              ))}
            </View>
          </Card>
        );
      })}

      <Card variant="outlined" title={`Referências registradas (${report.manifest.references.length})`}>
        {report.manifest.references.map((reference) => (
          <View key={reference.key} style={styles.referenceRow}>
            <View style={styles.flex}>
              <Text style={[styles.referenceTitle, { color: colors.onSurface }]}>{reference.label}</Text>
              <Text style={[styles.text, { color: colors.onSurfaceVariant }]}>{reference.origin} · {reference.kind ?? reference.role} · {reference.sourceBookId ?? reference.sourceId ?? 'fonte desconhecida'}</Text>
            </View>
            <Text style={[styles.status, { color: reference.status === 'available' ? colors.primary : colors.onSurfaceVariant }]}>{reference.status}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { gap: 8 },
  text: { fontSize: 13, lineHeight: 19 },
  issue: { fontSize: 12, lineHeight: 18, fontWeight: '700' },
  selected: { fontSize: 12, lineHeight: 18, fontWeight: '900' },
  code: { fontSize: 11, lineHeight: 16, fontWeight: '800' },
  referenceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  flex: { flex: 1 },
  referenceTitle: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  status: { fontSize: 11, lineHeight: 16, fontWeight: '900', textTransform: 'uppercase' }
});
