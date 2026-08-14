import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { MetricTile } from '../src/components/MetricTile';
import { Screen } from '../src/components/Screen';
import { buildCompatibilityRemediationBatchOverview } from '../src/characters/compatibilityRemediationBatch';
import { useCharacterChoiceBridge } from '../src/catalog/useCharacterChoiceBridge';
import { useCatalogStore } from '../src/store/catalogStore';
import { useCharacterStore } from '../src/store/characterStore';
import { useAppTheme } from '../src/theme';

const recoveryLabel = (status: string): string => status === 'recoverable'
  ? 'recuperado — confirmação necessária'
  : status === 'conflicted'
    ? 'conflitante — recrie o plano'
    : status === 'staleCatalog'
      ? 'catálogo antigo — recrie o plano'
      : 'pronto para edição';

export default function CharacterCompatibilityIndexScreen() {
  const { colors } = useAppTheme();
  const characters = useCharacterStore((state) => state.characters);
  const plans = useCharacterStore((state) => state.compatibilityRemediationPlans);
  const recovery = useCharacterStore((state) => state.compatibilityRemediationRecovery);
  const quarantine = useCharacterStore((state) => state.compatibilityRemediationQuarantine);
  const reconcileRecovery = useCharacterStore((state) => state.reconcileCompatibilityRemediationRecovery);
  const acknowledgePlan = useCharacterStore((state) => state.acknowledgeCompatibilityRemediationPlan);
  const discardPlan = useCharacterStore((state) => state.discardCompatibilityRemediationPlan);
  const commitPlan = useCharacterStore((state) => state.commitCompatibilityRemediationPlan);
  const dismissQuarantine = useCharacterStore((state) => state.dismissCompatibilityRemediationQuarantine);
  const snapshot = useCatalogStore((state) => state.snapshot);
  const filterState = useCatalogStore((state) => state.filterState);
  const catalogStatus = useCatalogStore((state) => state.status);
  const bridge = useCharacterChoiceBridge();

  useEffect(() => {
    if (snapshot?.snapshotId && catalogStatus === 'ready') reconcileRecovery(snapshot.snapshotId);
  }, [catalogStatus, reconcileRecovery, snapshot?.snapshotId]);

  const overview = useMemo(() => {
    if (!snapshot || !filterState || catalogStatus !== 'ready' || bridge.status !== 'ready') return undefined;
    return buildCompatibilityRemediationBatchOverview({ characters, plans, recovery, snapshot, filterState, choices: bridge.choices });
  }, [bridge.choices, bridge.status, catalogStatus, characters, filterState, plans, recovery, snapshot]);

  const commit = (characterId: string) => {
    const item = overview?.characters.find((entry) => entry.characterId === characterId);
    if (!item?.preview?.ok || !item.canCommit) return;
    Alert.alert('Aplicar este plano?', 'Somente este personagem será alterado. Os demais planos permanecerão independentes.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Aplicar',
        onPress: () => {
          const result = commitPlan(characterId, item.preview!);
          Alert.alert(result?.ok ? 'Plano aplicado' : 'Plano não aplicado', result?.ok
            ? 'O commit individual foi registrado no histórico do personagem.'
            : 'O plano mudou ou ficou inválido. Abra o manifesto e gere um novo preview.');
        }
      }
    ]);
  };

  return (
    <Screen
      eyebrow="Conteúdo e regras"
      title="Planos e manifestos"
      subtitle="Visão global somente leitura, com recuperação segura e commits independentes por personagem."
      onBack={() => router.replace('/settings')}
    >
      {!overview ? (
        <Card variant="filled" title="Preparando diagnóstico" subtitle="Carregando catálogo, filtros e conteúdo local." />
      ) : (
        <>
          <Card variant="hero" title="Resumo agregado" subtitle="O preview agregado nunca executa commits cruzados.">
            <View style={styles.metrics}>
              <MetricTile label="Personagens" value={overview.aggregate.characters} />
              <MetricTile label="Com problemas" value={overview.aggregate.charactersWithIssues} />
              <MetricTile label="Planos ativos" value={overview.aggregate.activePlans} />
              <MetricTile label="Prontos" value={overview.aggregate.readyPlans} />
            </View>
            <Text style={[styles.text, { color: colors.onSurfaceVariant }]}>Bloqueios projetados: {overview.aggregate.blockingIssuesBefore} → {overview.aggregate.blockingIssuesAfter}</Text>
            <Text style={[styles.text, { color: colors.onSurfaceVariant }]}>{overview.aggregate.replacements} substituição(ões) · {overview.aggregate.removals} remoção(ões) · {overview.aggregate.snapshotMigrations} migração(ões) de snapshot</Text>
          </Card>

          {overview.aggregate.recoveredPlans || overview.aggregate.conflictedPlans || overview.aggregate.staleCatalogPlans ? (
            <Card variant="filled" title="Recuperação de planos" subtitle="Planos persistidos são revalidados após cada reinício e mudança de catálogo.">
              <View style={styles.metrics}>
                <MetricTile label="A reconhecer" value={overview.aggregate.recoveredPlans} />
                <MetricTile label="Conflitos" value={overview.aggregate.conflictedPlans} />
                <MetricTile label="Catálogo antigo" value={overview.aggregate.staleCatalogPlans} />
              </View>
            </Card>
          ) : null}

          {overview.characters.map((item) => (
            <Card
              key={item.characterId}
              variant={item.report.status === 'compatible' && !item.plan ? 'outlined' : 'filled'}
              title={item.characterName}
              subtitle={`Compatibilidade: ${item.report.status} · ${item.report.blockingIssueCount} bloqueio(s) · ${item.plan ? recoveryLabel(item.recoveryStatus) : 'sem plano ativo'}`}
            >
              {item.plan ? (
                <>
                  <Text style={[styles.text, { color: colors.onSurface }]}>Plano: {item.plan.decisions.length} decisão(ões) · {item.plan.origin === 'preventiveCatalogChange' ? 'preventivo' : 'diagnóstico'} · atualizado em {new Date(item.plan.updatedAt).toLocaleString('pt-BR')}</Text>
                  <Text style={[styles.text, { color: colors.onSurfaceVariant }]}>Preview: {item.preview?.impact.blockingIssuesBefore ?? item.report.blockingIssueCount} → {item.preview?.impact.blockingIssuesAfter ?? item.report.blockingIssueCount} bloqueio(s)</Text>
                  {item.recoveryStatus === 'recoverable' ? (
                    <Button testID={`compatibility-acknowledge-${item.characterId}`} label="Retomar este plano com segurança" icon="refresh-circle-outline" variant="tonal" onPress={() => acknowledgePlan(item.characterId)} />
                  ) : null}
                  <Button testID={`compatibility-batch-commit-${item.characterId}`} label="Confirmar somente este personagem" icon="checkmark-circle-outline" disabled={!item.canCommit} onPress={() => commit(item.characterId)} />
                  <Button
                    testID={`compatibility-batch-discard-${item.characterId}`}
                    label="Descartar este plano"
                    icon="close-circle-outline"
                    variant="outlined"
                    onPress={() => Alert.alert('Descartar plano?', 'Somente este plano será removido. A ficha continuará inalterada.', [
                      { text: 'Cancelar', style: 'cancel' },
                      { text: 'Descartar', style: 'destructive', onPress: () => discardPlan(item.characterId) }
                    ])}
                  />
                </>
              ) : null}
              <Button label={item.plan ? 'Abrir plano e manifesto' : 'Abrir manifesto'} icon="document-text-outline" variant="outlined" onPress={() => router.push(`/characters/${item.characterId}/compatibility`)} />
            </Card>
          ))}

          {overview.groups.length ? (
            <Card variant="outlined" title="Ocorrências compartilhadas" subtitle="Personagens afetados pelo mesmo livro ou entidade. Nenhuma decisão é replicada automaticamente.">
              {overview.groups.slice(0, 20).map((group) => (
                <View key={`${group.kind}:${group.key}`} style={styles.groupRow}>
                  <View style={styles.flex}>
                    <Text style={[styles.groupTitle, { color: colors.onSurface }]}>{group.kind === 'book' ? 'Livro' : 'Entidade'}: {group.label}</Text>
                    <Text style={[styles.text, { color: colors.onSurfaceVariant }]}>{group.characterIds.length} personagem(ns) · {group.issueCount} ocorrência(s) · {group.activePlanCount} plano(s) ativo(s)</Text>
                  </View>
                </View>
              ))}
            </Card>
          ) : null}

          {Object.values(quarantine).length ? (
            <Card variant="filled" title="Planos em quarentena" subtitle="Registros órfãos ou inválidos foram isolados e não podem alterar fichas.">
              {Object.values(quarantine).map((entry) => (
                <View key={entry.id} style={styles.quarantineRow}>
                  <View style={styles.flex}>
                    <Text style={[styles.groupTitle, { color: colors.onSurface }]}>{entry.reason === 'orphaned' ? 'Personagem removido' : 'Estrutura inválida'}</Text>
                    <Text style={[styles.text, { color: colors.onSurfaceVariant }]}>{entry.planId ?? entry.characterId ?? entry.id}</Text>
                  </View>
                  <Button label="Excluir registro isolado" variant="text" onPress={() => dismissQuarantine(entry.id)} />
                </View>
              ))}
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  text: { fontSize: 13, lineHeight: 19 },
  groupRow: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
  quarantineRow: { gap: 4, paddingVertical: 8 },
  groupTitle: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  flex: { flex: 1 }
});
