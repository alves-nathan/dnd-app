import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { IssueList } from '../../../src/components/IssueList';
import { MetricTile } from '../../../src/components/MetricTile';
import { Screen } from '../../../src/components/Screen';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import type { CharacterPendingChoiceResolution } from '../../../src/catalog/characterDependencyResolver';
import { progressionOperation, validateProgressionDraft } from '../../../src/characters/progressionTransaction';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useAppTheme } from '../../../src/theme';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

const pendingChoiceRoute = (characterId: string, kind: string, pendingId: string): string => {
  const suffix = `?pendingId=${encodeURIComponent(pendingId)}`;
  if (kind === 'feat' || kind === 'featOptions') return `/characters/${characterId}/feats${suffix}`;
  if (kind === 'spellSelection' || kind === 'spellReplacement') return `/characters/${characterId}/spells${suffix}`;
  if (kind === 'proficiency') return `/characters/${characterId}/proficiencies${suffix}`;
  if (kind === 'equipment') return `/characters/${characterId}/equipment${suffix}`;
  if (kind === 'subclass' || kind === 'subclassOptions') return `/characters/${characterId}/classes${suffix}`;
  if (kind === 'speciesOption') return `/characters/${characterId}/identity${suffix}`;
  if (kind === 'pactWeapon') return `/characters/${characterId}/pact-weapon${suffix}`;
  if (kind === 'eldritchInvocation' || kind === 'eldritchInvocationOptions') return `/characters/${characterId}/invocations${suffix}`;
  if (kind === 'warlockSpecial') return `/characters/${characterId}/warlock-special${suffix}`;
  return `/characters/${characterId}/compendium${suffix}`;
};

const transactionLabel: Record<string, string> = {
  learned: 'Aprendeu',
  copied: 'Copiou',
  prepared: 'Preparou',
  unprepared: 'Despreparou',
  replaced: 'Substituiu',
  removed: 'Removeu'
};

const collectionLabel: Record<string, string> = {
  classes: 'classes',
  subclasses: 'subclasses',
  feats: 'feats',
  features: 'features',
  spells: 'magias',
  spellbookEntries: 'entradas no spellbook',
  weapons: 'armas',
  armors: 'armaduras',
  armorAccessories: 'acessórios de armadura',
  equipment: 'equipamentos',
  magicItems: 'itens mágicos',
  weaponMasteries: 'maestrias',
  resources: 'recursos',
  spellSlots: 'pools de slots',
  companions: 'companheiros',
  compendiumLinks: 'vínculos de conteúdo'
};

export default function CharacterProgressionScreen() {
  const { colors } = useAppTheme();
  const id = getId(useLocalSearchParams().id);
  const session = useCharacterProgressionSession(id);
  const character = session.character;
  const persistedCharacter = session.persistedCharacter;
  const draft = useCharacterStore((state) => id ? state.progressionDrafts[id] : undefined);
  const beginProgressionTransaction = useCharacterStore((state) => state.beginProgressionTransaction);
  const commitProgressionTransaction = useCharacterStore((state) => state.commitProgressionTransaction);
  const discardProgressionTransaction = useCharacterStore((state) => state.discardProgressionTransaction);
  const acknowledgeProgressionRecovery = useCharacterStore((state) => state.acknowledgeProgressionRecovery);
  const rollbackProgressionTransaction = useCharacterStore((state) => state.rollbackProgressionTransaction);
  const bridge = useCharacterChoiceBridge();
  const pending = character?.pendingChoices ?? [];
  const pendingResolutions = useMemo<Map<string, CharacterPendingChoiceResolution | undefined>>(() => new Map(
    character
      ? pending.map((choice) => [choice.id, bridge.resolvePendingChoice(character, choice)] as const)
      : []
  ), [bridge, character, pending]);
  const transactionPreview = useMemo(
    () => draft && persistedCharacter ? validateProgressionDraft(draft, persistedCharacter) : undefined,
    [draft, persistedCharacter]
  );

  if (!character || !persistedCharacter || !id) {
    return <Screen title="Personagem não encontrado" onBack={() => router.back()} />;
  }

  const dependencyResolvedCount = Array.from(pendingResolutions.values()).filter((resolution) => resolution?.mode === 'dependency' || resolution?.mode === 'owner').length;
  const spellbook = character.spellbookEntries ?? [];
  const preparedSpellbook = spellbook.filter((entry) => entry.prepared);
  const masteries = character.weaponMasteries ?? [];
  const transactions = [...(character.spellChangeTransactions ?? [])]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 20);
  const progressionHistory = [...(persistedCharacter.progressionTransactions ?? [])]
    .sort((left, right) => right.committedAt.localeCompare(left.committedAt));
  const rolledBackTransactionIds = new Set(
    progressionHistory
      .filter((entry) => entry.status === 'rolledBack')
      .map((entry) => entry.rolledBackTransactionId)
      .filter((transactionId): transactionId is string => Boolean(transactionId))
  );
  const latestCommitted = progressionHistory.find(
    (entry) => entry.status === 'committed' && !rolledBackTransactionIds.has(entry.transactionId)
  );

  const commit = () => {
    const result = commitProgressionTransaction(character.id);
    if (!result) {
      Alert.alert('Transação indisponível', 'Nenhuma transação ativa foi encontrada.');
      return;
    }
    if (!result.ok) {
      Alert.alert('Commit bloqueado', result.preview.blockingIssues.map((entry) => entry.message).join('\n'));
      return;
    }
    Alert.alert(
      'Progressão confirmada',
      `A transação foi aplicada de forma atômica. ${getCharacterDisplayName(result.character)} está no nível ${result.character.level}.`,
      [{ text: 'Ver personagem', onPress: () => router.replace(`/characters/${character.id}`) }]
    );
  };

  const discard = () => Alert.alert(
    'Descartar transação?',
    'O personagem publicado permanecerá exatamente como estava antes do início da progressão.',
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar rascunho',
        style: 'destructive',
        onPress: () => {
          discardProgressionTransaction(character.id);
          Alert.alert('Transação descartada', 'Nenhuma alteração foi aplicada ao personagem.');
        }
      }
    ]
  );

  const openPendingChoice = (choice: typeof pending[number]) => {
    if (draft && draft.recovery.status !== 'active') {
      Alert.alert('Retomada necessária', 'Revise e retome o rascunho recuperado antes de editar escolhas.');
      return;
    }
    if (!draft) {
      beginProgressionTransaction(character.id, persistedCharacter, {
        kind: 'pendingResolution',
        operations: [progressionOperation('manual', `Iniciar resolução: ${choice.title}`, { pendingChoiceId: choice.id })]
      });
    }
    router.push(pendingChoiceRoute(character.id, choice.kind, choice.id) as never);
  };

  const rollback = () => {
    if (!latestCommitted) return;
    Alert.alert(
      'Reverter última progressão?',
      `A ficha será restaurada ao estado anterior à transação ${latestCommitted.transactionId}. A reversão também será registrada na auditoria.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reverter',
          style: 'destructive',
          onPress: () => {
            const result = rollbackProgressionTransaction(character.id, latestCommitted.transactionId);
            Alert.alert(
              result ? 'Progressão revertida' : 'Não foi possível reverter',
              result ? 'O snapshot anterior foi restaurado sem reconstrução por nome.' : 'Verifique se existe uma transação ativa ou se o histórico ainda está disponível.'
            );
          }
        }
      ]
    );
  };

  return (
    <Screen
      eyebrow={getCharacterDisplayName(character)}
      title="Central de progressão"
      subtitle={draft ? (draft.recovery.status === 'active' ? 'Você está editando um rascunho transacional. A ficha publicada ainda não foi alterada.' : 'Uma transação persistida precisa ser revisada antes de continuar.') : 'Escolhas pendentes, spellbook, maestrias e auditoria reunidos em um único lugar.'}
      onBack={() => router.push(`/characters/${character.id}`)}
    >
      {draft?.recovery.status === 'recoverable' ? (
        <Card
          variant="hero"
          title="Rascunho recuperado após reinício"
          subtitle={`Checkpoint ${draft.recovery.checkpointSequence} preservado em ${new Date(draft.recovery.lastCheckpointAt).toLocaleString('pt-BR')}.`}
        >
          <Text testID="progression-recovery-status" style={[styles.muted, { color: colors.onSurfaceVariant }]}>A ficha publicada continua intacta. Revise o preview e confirme a retomada para liberar os editores.</Text>
          <Button
            testID="progression-recovery-resume"
            label="Retomar rascunho"
            icon="refresh"
            onPress={() => acknowledgeProgressionRecovery(character.id)}
          />
        </Card>
      ) : null}

      {draft?.recovery.status === 'conflicted' ? (
        <Card
          variant="filled"
          title="Conflito de recuperação"
          subtitle="A ficha publicada mudou depois do último checkpoint. O rascunho não pode ser mesclado automaticamente."
        >
          <Text testID="progression-recovery-status" style={[styles.muted, { color: colors.onSurfaceVariant }]}>{draft.recovery.reason}</Text>
          <Button label="Abrir central de recuperação" variant="outlined" onPress={() => router.push('/progression-recovery')} />
        </Card>
      ) : null}

      {draft && transactionPreview ? (
        <Card
          variant="hero"
          title={`${draft.recovery.status === 'active' ? 'Transação ativa' : draft.recovery.status === 'recoverable' ? 'Transação recuperada' : 'Transação conflitante'} · nível ${transactionPreview.summary.levelBefore} → ${transactionPreview.summary.levelAfter}`}
          subtitle={`Criada em ${new Date(draft.createdAt).toLocaleString('pt-BR')} · ${draft.operations.length} operação(ões) auditada(s)`}
        >
          <View style={styles.metrics}>
            <MetricTile label="Mudanças" value={transactionPreview.summary.changedPaths.length} />
            <MetricTile label="Pendências" value={transactionPreview.summary.pendingAfter} supporting={`${transactionPreview.blockingIssues.length} bloqueio(s)`} />
            <MetricTile label="Status" value={transactionPreview.ok ? 'Pronta' : 'Bloqueada'} />
          </View>

          {transactionPreview.summary.classChanges.map((change) => (
            <Text key={change.classId} style={[styles.title, { color: colors.onSurface }]}>• {change.name}: {change.beforeLevel} → {change.afterLevel}</Text>
          ))}
          {Object.entries(transactionPreview.summary.added).map(([key, count]) => (
            <Text key={`added-${key}`} style={[styles.muted, { color: colors.onSurfaceVariant }]}>+{count} {collectionLabel[key] ?? key}</Text>
          ))}
          {Object.entries(transactionPreview.summary.removed).map(([key, count]) => (
            <Text key={`removed-${key}`} style={[styles.muted, { color: colors.onSurfaceVariant }]}>−{count} {collectionLabel[key] ?? key}</Text>
          ))}
          {transactionPreview.summary.catalogSnapshotBefore !== transactionPreview.summary.catalogSnapshotAfter ? (
            <Text style={[styles.context, { color: colors.warning }]}>Snapshot: {transactionPreview.summary.catalogSnapshotBefore ?? 'legado'} → {transactionPreview.summary.catalogSnapshotAfter ?? 'não definido'}</Text>
          ) : null}

          {transactionPreview.issues.length ? <IssueList issues={transactionPreview.issues} /> : <Text style={[styles.context, { color: colors.primary }]}>A transação passou por todas as validações conjuntas.</Text>}

          <Card variant="outlined" title="Operações registradas" subtitle="Estas ações formarão a trilha de auditoria do commit.">
            {draft.operations.map((operation) => (
              <View key={operation.id} style={[styles.row, { borderBottomColor: colors.outlineVariant }]}>
                <View style={styles.flex}>
                  <Text style={[styles.title, { color: colors.onSurface }]}>{operation.label}</Text>
                  <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>{operation.kind} · {new Date(operation.createdAt).toLocaleString('pt-BR')}</Text>
                </View>
              </View>
            ))}
          </Card>

          <View style={styles.actions}>
            <View style={styles.flex}><Button testID="progression-transaction-discard" label="Descartar" variant="outlined" icon="trash-outline" onPress={discard} /></View>
            {draft.recovery.status === 'active' ? (
              <View style={styles.flex}><Button testID="progression-transaction-commit" label="Confirmar tudo" icon="checkmark" disabled={!transactionPreview.ok} onPress={commit} /></View>
            ) : null}
          </View>
        </Card>
      ) : null}

      <View style={styles.metrics}>
        <MetricTile label="Pendências" value={pending.length} supporting={`${dependencyResolvedCount} orientada(s) pelo catálogo`} />
        <MetricTile label="Spellbook" value={spellbook.length} supporting={`${preparedSpellbook.length} preparada(s)`} />
        <MetricTile label="Maestrias" value={masteries.length} />
      </View>

      <Card
        variant={pending.length ? 'hero' : 'filled'}
        title={pending.length ? `Escolhas pendentes (${pending.length})` : 'Progressão em dia'}
        subtitle={pending.length ? (draft ? 'Resolva os requisitos dentro do rascunho antes do commit.' : 'Resolva cada requisito sem procurar em várias telas.') : 'Não há escolhas obrigatórias pendentes.'}
      >
        {pending.map((choice) => {
          const resolution = pendingResolutions.get(choice.id);
          const available = resolution?.availableCandidateChoices.length ?? 0;
          const blocked = resolution?.blockedCandidateChoices.length ?? 0;
          return (
            <View key={choice.id} style={[styles.row, { borderBottomColor: colors.outlineVariant }]}>
              <View style={styles.flex}>
                <Text style={[styles.title, { color: colors.onSurface }]}>{choice.title}</Text>
                <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>{choice.description}</Text>
                {resolution ? (
                  <Text style={[styles.context, { color: available ? colors.primary : colors.warning }]}>
                    {available} opção(ões) aplicável(is){blocked ? ` · ${blocked} bloqueada(s)` : ''} · {resolution.mode === 'dependency' ? 'grafo de dependências' : resolution.mode === 'owner' ? 'proprietário canônico' : 'filtro por tipo'}
                  </Text>
                ) : null}
              </View>
              <Button
                label="Resolver"
                variant="text"
                compact
                onPress={() => openPendingChoice(choice)}
              />
            </View>
          );
        })}
      </Card>

      <Card title="Classes e subclasses" subtitle="Resumo da progressão atual.">
        {character.classes.map((entry) => {
          const subclasses = character.subclasses.filter((subclass) => subclass.classId === entry.id);
          return (
            <View key={entry.id} style={[styles.row, { borderBottomColor: colors.outlineVariant }]}>
              <View style={styles.flex}>
                <Text style={[styles.title, { color: colors.onSurface }]}>{entry.name} · nível {entry.level}</Text>
                <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>{subclasses.map((subclass) => subclass.name).join(', ') || 'Sem subclasse vinculada'}</Text>
              </View>
            </View>
          );
        })}
        <Button label="Gerenciar classes" variant="outlined" onPress={() => router.push(`/characters/${character.id}/classes`)} />
        {character.classes.some((entry) => entry.name.toLowerCase() === 'warlock') ? (
          <>
            <Button label="Gerenciar Eldritch Invocations" variant="outlined" onPress={() => router.push(`/characters/${character.id}/invocations`)} />
            <Button label="Poderes especializados de Warlock" variant="outlined" onPress={() => router.push(`/characters/${character.id}/warlock-special`)} />
          </>
        ) : null}
        <Button label={draft ? 'Transação em andamento' : 'Subir de nível'} disabled={Boolean(draft)} onPress={() => router.push(`/characters/${character.id}/level-up`)} />
      </Card>

      <Card title="Spellbook" subtitle={`${spellbook.length} magia(s) conhecida(s), ${preparedSpellbook.length} preparada(s).`}>
        {spellbook.slice(0, 30).map((entry) => (
          <View key={entry.id} style={[styles.row, { borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: colors.onSurface }]}>{entry.spellName} · nível {entry.spellLevel}</Text>
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>{entry.prepared ? 'Preparada' : 'Não preparada'} · {entry.acquisition}</Text>
            </View>
          </View>
        ))}
        {spellbook.length === 0 ? <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Nenhuma entrada de spellbook.</Text> : null}
        <Button label="Gerenciar magias" variant="outlined" onPress={() => router.push(`/characters/${character.id}/spells`)} />
      </Card>

      <Card title="Maestrias de arma" subtitle="Escolhas de classe, feat e entradas manuais.">
        {masteries.map((mastery) => (
          <View key={mastery.id} style={[styles.row, { borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: colors.onSurface }]}>{mastery.weaponName} · {mastery.mastery}</Text>
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>{mastery.sourceKind}{mastery.changeOnLongRest ? ' · troca em descanso longo' : ''}</Text>
            </View>
          </View>
        ))}
        {masteries.length === 0 ? <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Nenhuma maestria configurada.</Text> : null}
        <Button label="Gerenciar feats" variant="outlined" onPress={() => router.push(`/characters/${character.id}/feats`)} />
      </Card>

      <Card title="Auditoria de progressão" subtitle="Commits atômicos e reversões, com snapshots completos de antes e depois.">
        {progressionHistory.slice(0, 10).map((entry) => (
          <View key={entry.id} style={[styles.row, { borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: colors.onSurface }]}>{entry.status === 'rolledBack' ? 'Reversão' : 'Progressão'} · nível {entry.summary.levelBefore} → {entry.summary.levelAfter}</Text>
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>{new Date(entry.committedAt).toLocaleString('pt-BR')} · {entry.operations.length} operação(ões)</Text>
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Transação: {entry.transactionId}</Text>
            </View>
          </View>
        ))}
        {progressionHistory.length === 0 ? <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Nenhuma transação de progressão confirmada.</Text> : null}
        <Button label="Reverter última progressão" variant="outlined" icon="arrow-undo-outline" disabled={!latestCommitted || Boolean(draft)} onPress={rollback} />
      </Card>

      <Card title="Histórico de magias" subtitle="Últimas 20 alterações auditadas.">
        {transactions.map((transaction) => (
          <View key={transaction.id} style={[styles.row, { borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: colors.onSurface }]}>
                {transactionLabel[transaction.kind] ?? transaction.kind}: {transaction.spellName}
              </Text>
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>
                {transaction.className ?? 'Sem classe'} · nível {transaction.characterLevel} · {new Date(transaction.createdAt).toLocaleString('pt-BR')}
              </Text>
              {transaction.replacedSpellName ? <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Substituiu {transaction.replacedSpellName}</Text> : null}
            </View>
          </View>
        ))}
        {transactions.length === 0 ? <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Nenhuma alteração auditada.</Text> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flex: { flex: 1, gap: 3 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  muted: { fontSize: 12, lineHeight: 18 },
  context: { fontSize: 11, lineHeight: 16, fontWeight: '800' }
});
