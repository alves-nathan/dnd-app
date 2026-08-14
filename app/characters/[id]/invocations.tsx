import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { EldritchInvocationChoiceEditor } from '../../../src/components/EldritchInvocationChoiceEditor';
import { IssueList } from '../../../src/components/IssueList';
import { PaginatedOptionCardList } from '../../../src/components/PaginatedOptionCardList';
import { PendingChoiceContextCard } from '../../../src/components/PendingChoiceContextCard';
import { Screen } from '../../../src/components/Screen';
import { getCompendiumChoiceDescription } from '../../../src/characters/creationData';
import {
  findEldritchInvocationById,
  getEldritchInvocationLimit,
  getEldritchInvocationMinimumLevel,
  getEldritchInvocationPrerequisiteIssues,
  getLevelAvailableEldritchInvocations,
  getSelectedWarlockLevel,
  isEldritchInvocationRepeatable,
  validateEldritchInvocationSelection
} from '../../../src/characters/eldritchInvocationRules';
import { getEldritchInvocationCardAction, isEldritchInvocationCardDisabled } from '../../../src/characters/eldritchInvocationInteraction';
import { applyEldritchInvocationSelection } from '../../../src/characters/eldritchInvocationSelection';
import {
  applyEldritchInvocationChoices,
  validateEldritchInvocationChoices
} from '../../../src/characters/eldritchInvocationChoiceRules';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useAppTheme } from '../../../src/theme';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';
import type { CharacterEldritchInvocationChoice } from '../../../src/types';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default function EldritchInvocationsScreen() {
  const { colors } = useAppTheme();
  const params = useLocalSearchParams();
  const id = getId(params.id);
  const pendingId = getId(params.pendingId);
  const progressionSession = useCharacterProgressionSession(id);
  const character = progressionSession.character;
  const updateCharacter = progressionSession.updateCharacter;
  const bridge = useCharacterChoiceBridge();
  const { items, enabledSourceIds, choiceForItemId } = bridge;
  const [selectedCounts, setSelectedCounts] = useState<Record<string, number>>({});
  const [invocationChoices, setInvocationChoices] = useState<CharacterEldritchInvocationChoice[]>([]);
  const pendingChoice = character?.pendingChoices?.find((choice) => choice.id === pendingId);
  const pendingResolution = character && pendingChoice ? bridge.resolvePendingChoice(character, pendingChoice) : undefined;
  const pendingCandidateIds = useMemo(() => new Set(pendingResolution?.candidateChoices.map((choice) => choice.choiceId) ?? []), [pendingResolution]);
  const itemForReference = (reference: string | undefined) => {
    if (!reference) return undefined;
    const direct = items.find((candidate) => candidate.id === reference);
    if (direct) return direct;
    const choice = choiceForItemId(reference);
    return choice ? items.find((candidate) => candidate.id === choice.choiceId) : undefined;
  };


  useEffect(() => {
    setSelectedCounts(character?.buildChoices?.eldritchInvocationCounts ?? {});
    setInvocationChoices(character?.buildChoices?.eldritchInvocationChoices ?? []);
  }, [character?.id]);

  const classEntries = useMemo(() => {
    if (!character) return [];
    return character.classes.flatMap((classEntity) => {
      const link = (character.compendiumLinks ?? []).find(
        (entry) => entry.status === 'active' && entry.appliedAs === 'class' && entry.appliedEntityId === classEntity.id
      );
      const item = itemForReference(link?.choiceId ?? link?.itemId);
      return item ? [{ item, level: classEntity.level }] : [];
    });
  }, [character, items]);

  if (!character || !id) {
    return <Screen title="Personagem não encontrado" onBack={() => router.back()} />;
  }

  const warlockLevel = getSelectedWarlockLevel(classEntries);
  const limit = getEldritchInvocationLimit(warlockLevel, classEntries, items);
  const selectedTotal = Object.values(selectedCounts).reduce((sum, count) => sum + Math.max(0, Math.floor(count)), 0);
  const allSelectable = getLevelAvailableEldritchInvocations(items, enabledSourceIds, warlockLevel);
  const selectable = allSelectable
    .filter((item) => !pendingResolution || pendingCandidateIds.has(item.id));
  const selectedItems = Object.keys(selectedCounts)
    .map((itemId) => findEldritchInvocationById(items, itemId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const visibleItems = [
    ...selectedItems,
    ...selectable.filter((item) => !selectedItems.some((selected) => selected.id === item.id))
  ];
  const warlockClassEntityIds = new Set(
    character.classes.filter((entry) => entry.name.trim().toLowerCase() === 'warlock').map((entry) => entry.id)
  );
  const knownWarlockCantripItemIds = (character.compendiumLinks ?? [])
    .filter((link) => link.appliedAs === 'spell' && link.status === 'active')
    .filter((link) => {
      const spellEntity = character.spells.find((spell) => spell.id === link.appliedEntityId);
      const spellItem = itemForReference(link.choiceId ?? link.itemId);
      if (spellItem?.type !== 'spell') return false;
      return Boolean(
        spellEntity
        && spellItem
        && Number(spellItem.normalizedJson.level ?? 0) === 0
        && spellEntity.spellcastingClassId
        && warlockClassEntityIds.has(spellEntity.spellcastingClassId)
      );
    })
    .map((link) => itemForReference(link.choiceId ?? link.itemId)?.id)
    .filter((itemId): itemId is string => Boolean(itemId));
  const mainOriginFeatLink = (character.compendiumLinks ?? []).find(
    (link) => link.appliedAs === 'feat' && link.status === 'active' && link.appliedEntityId === character.originFeatId
  );
  const mainOriginFeatItemId = itemForReference(mainOriginFeatLink?.choiceId ?? mainOriginFeatLink?.itemId)?.id;
  const selectionIssues = validateEldritchInvocationSelection(classEntries, items, enabledSourceIds, selectedCounts);
  const choiceIssues = validateEldritchInvocationChoices(
    selectedCounts,
    invocationChoices,
    items,
    enabledSourceIds,
    {
      knownWarlockCantripItemIds,
      requireKnownWarlockCantrip: true,
      selectedOriginFeatItemIds: mainOriginFeatItemId ? [mainOriginFeatItemId] : []
    }
  );
  const issues = [...selectionIssues, ...choiceIssues];

  const add = (itemId: string) => {
    const item = findEldritchInvocationById(items, itemId);
    if (!item || selectedTotal >= limit) return;
    if (getEldritchInvocationPrerequisiteIssues(item, warlockLevel, selectedCounts, allSelectable).length) return;
    const current = selectedCounts[itemId] ?? 0;
    if (current > 0 && !isEldritchInvocationRepeatable(item)) return;
    setSelectedCounts((counts) => ({ ...counts, [itemId]: (counts[itemId] ?? 0) + 1 }));
  };

  const remove = (itemId: string) => {
    const currentCount = selectedCounts[itemId] ?? 0;
    setSelectedCounts((counts) => {
      const current = counts[itemId] ?? 0;
      if (current <= 1) return Object.fromEntries(Object.entries(counts).filter(([idValue]) => idValue !== itemId));
      return { ...counts, [itemId]: current - 1 };
    });
    setInvocationChoices((choices) => choices.filter(
      (choice) => choice.invocationItemId !== itemId || choice.instanceIndex < Math.max(0, currentCount - 1)
    ));
  };

  const toggle = (itemId: string) => {
    if (getEldritchInvocationCardAction(selectedCounts[itemId] ?? 0) === 'remove') {
      remove(itemId);
      return;
    }
    add(itemId);
  };

  const save = () => {
    if (issues.length) {
      Alert.alert('Revise as invocations', issues.map((entry) => entry.message).join('\n'));
      return;
    }
    const result = applyEldritchInvocationSelection(character, selectedCounts, items);
    const choicesResult = applyEldritchInvocationChoices(result.character, invocationChoices, items);
    const next = pendingId
      ? { ...choicesResult.character, pendingChoices: (choicesResult.character.pendingChoices ?? []).filter((choice) => choice.id !== pendingId) }
      : choicesResult.character;
    updateCharacter(character.id, () => next);
    Alert.alert(
      'Invocations atualizadas',
      `${result.appliedCount} invocation(s) aplicada(s), ${choicesResult.appliedSpellCount} magia(s) e ${choicesResult.appliedFeatCount} feat(s) concedido(s). Os cálculos e recursos vinculados foram reconciliados.`,
      [{ text: 'Concluir', onPress: () => router.replace(progressionSession.hasActiveTransaction ? `/characters/${character.id}/progression` : `/characters/${character.id}`) }]
    );
  };

  return (
    <Screen
      eyebrow={getCharacterDisplayName(character)}
      title="Eldritch Invocations"
      subtitle="Altere as invocations fora da criação. Opções inelegíveis continuam visíveis, mas bloqueadas até que seus requisitos sejam atendidos."
      onBack={() => progressionSession.hasActiveTransaction ? router.replace(`/characters/${character.id}/progression`) : router.back()}
      footer={(
        <View style={styles.footer}>
          <Button label="Voltar" variant="text" icon="arrow-back" onPress={() => progressionSession.hasActiveTransaction ? router.replace(`/characters/${character.id}/progression`) : router.back()} />
          <Button label="Salvar invocations" icon="checkmark" disabled={issues.length > 0} onPress={save} />
        </View>
      )}
    >
      <PendingChoiceContextCard pendingChoice={pendingChoice} resolution={pendingResolution} />
      <Card
        variant="hero"
        title={`Warlock nível ${warlockLevel} · ${selectedTotal}/${limit}`}
        subtitle="Todas as opções das fontes ativas são exibidas. Invocations com nível ou dependências ainda não atendidos aparecem bloqueadas com seus pré-requisitos."
      />

      {warlockLevel <= 0 ? (
        <Card variant="filled" title="Sem níveis de Warlock" subtitle="Adicione ao menos um nível de Warlock para escolher Eldritch Invocations." />
      ) : (
        <PaginatedOptionCardList
          items={visibleItems}
          keyExtractor={(item) => item.id}
          titleForItem={(item) => `${item.name}${(selectedCounts[item.id] ?? 0) > 0 ? ` ×${selectedCounts[item.id]}` : ''}`}
          descriptionForItem={getCompendiumChoiceDescription}
          metaForItem={(item) => {
            const count = selectedCounts[item.id] ?? 0;
            const requirement = String(item.normalizedJson.prerequisite ?? '').trim();
            const base = `Nível mínimo ${getEldritchInvocationMinimumLevel(item)}`;
            if (count > 0) return `${base} · selecionada${count > 1 ? ` ×${count}` : ''} · toque para remover uma${requirement ? ` · ${requirement}` : ''}`;
            return `${base}${requirement ? ` · ${requirement}` : ''}`;
          }}
          isSelected={(item) => (selectedCounts[item.id] ?? 0) > 0}
          isDisabled={(item) => isEldritchInvocationCardDisabled({
            selectedCount: selectedCounts[item.id] ?? 0,
            selectedTotal,
            limit,
            hasPrerequisiteIssues: getEldritchInvocationPrerequisiteIssues(item, warlockLevel, selectedCounts, allSelectable).length > 0
          })}
          onPressItem={(item) => toggle(item.id)}
          selectedAccessibilityHint="Toque para remover uma seleção."
          pageSize={8}
          resetKey={`${warlockLevel}:${selectedTotal}`}
          emptyText="Nenhuma Eldritch Invocation foi encontrada nas fontes ativas."
        />
      )}

      {selectedItems.length ? (
        <Card variant="filled" title="Selecionadas">
          {selectedItems.map((item) => (
            <View key={`selected-${item.id}`} style={styles.selectionRow}>
              <View style={styles.selectionText}>
                <Text style={{ color: colors.onSurface, fontWeight: '800' }}>{item.name}</Text>
                <Text style={{ color: colors.onSurfaceVariant }}>{getCompendiumChoiceDescription(item)}</Text>
              </View>
              {isEldritchInvocationRepeatable(item) && selectedTotal < limit ? (
                <Button label="Adicionar outra" variant="text" compact onPress={() => add(item.id)} />
              ) : null}
              <Button label="Remover uma" variant="text" compact onPress={() => remove(item.id)} />
            </View>
          ))}
        </Card>
      ) : null}

      <Card variant="outlined" title="Pact Familiar" subtitle={character.companions?.[0] ? `${character.companions[0].name} · CA ${character.companions[0].armorClass} · PV ${character.companions[0].hitPoints.current}/${character.companions[0].hitPoints.max}` : 'Pact of the Chain ainda não possui uma entidade de familiar configurada.'}>
        <Button label={character.companions?.[0] ? 'Ver e gerenciar familiar' : 'Configurar familiar pelas invocations'} variant="outlined" onPress={() => character.companions?.[0] ? router.push(`/characters/${character.id}/familiar`) : undefined} disabled={!character.companions?.[0]} />
      </Card>


      <Card
        variant="outlined"
        title="Poderes especializados"
        subtitle="Gerencie Gaze of Two Minds, Gift of the Protectors, Devil's Sight, Witch Sight e One with Shadows."
      >
        <Button label="Abrir poderes de Warlock" variant="outlined" onPress={() => router.push(`/characters/${character.id}/warlock-special`)} />
      </Card>

      <EldritchInvocationChoiceEditor
        items={items}
        enabledSourceIds={enabledSourceIds}
        selectedCounts={selectedCounts}
        choices={invocationChoices}
        onChange={setInvocationChoices}
        knownWarlockCantripItemIds={knownWarlockCantripItemIds}
        selectedOriginFeatItemIds={mainOriginFeatItemId ? [mainOriginFeatItemId] : []}
      />

      {issues.length ? <IssueList issues={issues} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { width: '100%', maxWidth: 760, alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  selectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectionText: { flex: 1, gap: 3 }
});
