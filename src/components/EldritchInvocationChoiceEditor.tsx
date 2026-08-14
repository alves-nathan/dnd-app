import { StyleSheet, Text, View } from 'react-native';
import type { ChainMasterDamageType, CharacterEldritchInvocationChoice, LifedrinkerDamageType } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { useAppTheme } from '../theme';
import { Card } from './Card';
import { Chip } from './Chip';
import { PaginatedOptionCardList } from './PaginatedOptionCardList';
import { getCompendiumChoiceDescription } from '../characters/creationData';
import { spellItemClasses } from '../characters/spellcastingRules';
import {
  emptyEldritchInvocationChoice,
  getInvocationTargetCantripCandidates,
  getLessonsOriginFeatCandidates,
  getPactChainFamiliarCandidates,
  getPactTomeCantripCandidates,
  getPactTomeRitualCandidates,
  invocationChoiceKey,
  invocationNeedsInternalChoice,
  isAgonizingBlastInvocation,
  isEldritchSpearInvocation,
  isLessonsOfTheFirstOnesInvocation,
  isLifedrinkerInvocation,
  isPactOfTheChainInvocation,
  isPactOfTheTomeInvocation,
  isRepellingBlastInvocation
} from '../characters/eldritchInvocationChoiceRules';
import { findEldritchInvocationById } from '../characters/eldritchInvocationRules';
import { isInvestmentOfTheChainMasterInvocation } from '../characters/pactChainCompanionRules';

interface Props {
  items: StoredCompendiumItem[];
  enabledSourceIds: string[];
  selectedCounts: Record<string, number>;
  choices: CharacterEldritchInvocationChoice[];
  onChange: (choices: CharacterEldritchInvocationChoice[]) => void;
  knownWarlockCantripItemIds?: string[];
  selectedOriginFeatItemIds?: string[];
  onBeforeSelectItem?: (item: StoredCompendiumItem) => Promise<boolean> | boolean;
  onTargetCantripSelected?: (spellItem: StoredCompendiumItem) => void;
}

const labelForClasses = (item: StoredCompendiumItem): string => spellItemClasses(item).join(', ') || 'Qualquer lista';

export const EldritchInvocationChoiceEditor = ({
  items,
  enabledSourceIds,
  selectedCounts,
  choices,
  onChange,
  knownWarlockCantripItemIds,
  selectedOriginFeatItemIds = [],
  onBeforeSelectItem,
  onTargetCantripSelected
}: Props) => {
  const { colors } = useAppTheme();
  const instances = Object.entries(selectedCounts).flatMap(([itemId, count]) => {
    const item = findEldritchInvocationById(items, itemId);
    if (!item || !invocationNeedsInternalChoice(item)) return [];
    return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, instanceIndex) => ({ item, instanceIndex }));
  });

  const updateChoice = (
    itemId: string,
    instanceIndex: number,
    updater: (choice: CharacterEldritchInvocationChoice) => CharacterEldritchInvocationChoice
  ) => {
    const key = invocationChoiceKey(itemId, instanceIndex);
    const existing = choices.find((choice) => invocationChoiceKey(choice.invocationItemId, choice.instanceIndex) === key)
      ?? emptyEldritchInvocationChoice(itemId, instanceIndex);
    onChange([
      ...choices.filter((choice) => invocationChoiceKey(choice.invocationItemId, choice.instanceIndex) !== key),
      updater(existing)
    ]);
  };

  const allowSelection = async (item: StoredCompendiumItem): Promise<boolean> =>
    onBeforeSelectItem ? Boolean(await onBeforeSelectItem(item)) : true;

  const toggleListItem = async (
    itemId: string,
    instanceIndex: number,
    item: StoredCompendiumItem,
    field: 'cantripItemIds' | 'ritualSpellItemIds',
    limit: number
  ) => {
    const current = choices.find((choice) => choice.invocationItemId === itemId && choice.instanceIndex === instanceIndex)
      ?? emptyEldritchInvocationChoice(itemId, instanceIndex);
    const ids = current[field] ?? [];
    if (!ids.includes(item.id) && !(await allowSelection(item))) return;
    updateChoice(itemId, instanceIndex, (choice) => {
      const currentIds = choice[field] ?? [];
      const nextIds = currentIds.includes(item.id)
        ? currentIds.filter((entry) => entry !== item.id)
        : currentIds.length < limit ? [...currentIds, item.id] : currentIds;
      return { ...choice, [field]: nextIds };
    });
  };

  const selectSingleItem = async (
    itemId: string,
    instanceIndex: number,
    item: StoredCompendiumItem,
    updater: (choice: CharacterEldritchInvocationChoice) => CharacterEldritchInvocationChoice
  ): Promise<boolean> => {
    if (!(await allowSelection(item))) return false;
    updateChoice(itemId, instanceIndex, updater);
    return true;
  };

  return (
    <>
      {instances.map(({ item, instanceIndex }) => {
        const choice = choices.find((entry) => entry.invocationItemId === item.id && entry.instanceIndex === instanceIndex)
          ?? emptyEldritchInvocationChoice(item.id, instanceIndex);
        const instanceLabel = (selectedCounts[item.id] ?? 0) > 1 ? ` · cópia ${instanceIndex + 1}` : '';

        if (isPactOfTheTomeInvocation(item)) {
          const cantripIds = choice.cantripItemIds ?? [];
          const ritualIds = choice.ritualSpellItemIds ?? [];
          const cantrips = getPactTomeCantripCandidates(items, enabledSourceIds);
          const rituals = getPactTomeRitualCandidates(items, enabledSourceIds);
          return (
            <Card key={invocationChoiceKey(item.id, instanceIndex)} variant="hero" title={`Book of Shadows${instanceLabel}`} subtitle="Escolha 3 cantrips e 2 magias rituais de nível 1 de quaisquer listas.">
              <Text style={[styles.heading, { color: colors.onSurface }]}>Cantrips ({cantripIds.length}/3)</Text>
              <PaginatedOptionCardList
                items={cantrips}
                keyExtractor={(spell) => `${item.id}-${instanceIndex}-cantrip-${spell.id}`}
                titleForItem={(spell) => spell.name}
                descriptionForItem={getCompendiumChoiceDescription}
                metaForItem={(spell) => `${labelForClasses(spell)}${spell.status === 'validated' ? '' : ' · validar ao escolher'}`}
                isSelected={(spell) => cantripIds.includes(spell.id)}
                isDisabled={(spell) => cantripIds.length >= 3 && !cantripIds.includes(spell.id)}
                onPressItem={(spell) => { void toggleListItem(item.id, instanceIndex, spell, 'cantripItemIds', 3); }}
                pageSize={10}
                resetKey={`${item.id}:${instanceIndex}:cantrips:${cantripIds.length}`}
              />
              <Text style={[styles.heading, { color: colors.onSurface }]}>Rituais de nível 1 ({ritualIds.length}/2)</Text>
              <PaginatedOptionCardList
                items={rituals}
                keyExtractor={(spell) => `${item.id}-${instanceIndex}-ritual-${spell.id}`}
                titleForItem={(spell) => spell.name}
                descriptionForItem={getCompendiumChoiceDescription}
                metaForItem={(spell) => `Ritual · ${labelForClasses(spell)}${spell.status === 'validated' ? '' : ' · validar ao escolher'}`}
                isSelected={(spell) => ritualIds.includes(spell.id)}
                isDisabled={(spell) => ritualIds.length >= 2 && !ritualIds.includes(spell.id)}
                onPressItem={(spell) => { void toggleListItem(item.id, instanceIndex, spell, 'ritualSpellItemIds', 2); }}
                pageSize={8}
                resetKey={`${item.id}:${instanceIndex}:rituals:${ritualIds.length}`}
              />
            </Card>
          );
        }

        if (isAgonizingBlastInvocation(item) || isEldritchSpearInvocation(item) || isRepellingBlastInvocation(item)) {
          const candidates = getInvocationTargetCantripCandidates(item, items, enabledSourceIds, knownWarlockCantripItemIds);
          return (
            <Card key={invocationChoiceKey(item.id, instanceIndex)} variant="filled" title={`${item.name}${instanceLabel}`} subtitle="Escolha o cantrip de Warlock ao qual esta invocation será vinculada.">
              <PaginatedOptionCardList
                items={candidates}
                keyExtractor={(spell) => `${item.id}-${instanceIndex}-${spell.id}`}
                titleForItem={(spell) => spell.name}
                descriptionForItem={getCompendiumChoiceDescription}
                metaForItem={(spell) => `${String(spell.normalizedJson.range ?? 'Alcance não informado')} · Warlock cantrip`}
                isSelected={(spell) => choice.targetCantripItemId === spell.id}
                onPressItem={(spell) => {
                  void selectSingleItem(item.id, instanceIndex, spell, (current) => ({ ...current, targetCantripItemId: spell.id }))
                    .then((selected) => { if (selected) onTargetCantripSelected?.(spell); });
                }}
                pageSize={8}
                resetKey={`${item.id}:${instanceIndex}:${choice.targetCantripItemId ?? 'none'}`}
                emptyText={knownWarlockCantripItemIds ? 'O personagem ainda não conhece um cantrip elegível.' : 'Nenhum cantrip de Warlock elegível foi encontrado.'}
              />
            </Card>
          );
        }

        if (isLessonsOfTheFirstOnesInvocation(item)) {
          const candidates = getLessonsOriginFeatCandidates(items, enabledSourceIds);
          const usedByOtherChoices = new Set([
            ...selectedOriginFeatItemIds,
            ...choices.filter((entry) => invocationChoiceKey(entry.invocationItemId, entry.instanceIndex) !== invocationChoiceKey(item.id, instanceIndex)).map((entry) => entry.originFeatItemId).filter((entry): entry is string => Boolean(entry))
          ]);
          return (
            <Card key={invocationChoiceKey(item.id, instanceIndex)} variant="filled" title={`Lessons of the First Ones${instanceLabel}`} subtitle="Escolha um Origin Feat diferente para cada cópia. Escolhas internas do feat poderão ser resolvidas na tela de Feats.">
              <PaginatedOptionCardList
                items={candidates}
                keyExtractor={(feat) => `${item.id}-${instanceIndex}-${feat.id}`}
                titleForItem={(feat) => feat.name}
                descriptionForItem={getCompendiumChoiceDescription}
                metaForItem={(feat) => feat.status === 'validated' ? 'Origin Feat' : 'Origin Feat · validar ao escolher'}
                isSelected={(feat) => choice.originFeatItemId === feat.id}
                isDisabled={(feat) => usedByOtherChoices.has(feat.id) && choice.originFeatItemId !== feat.id}
                onPressItem={(feat) => { void selectSingleItem(item.id, instanceIndex, feat, (current) => ({ ...current, originFeatItemId: feat.id })); }}
                pageSize={8}
                resetKey={`${item.id}:${instanceIndex}:${choice.originFeatItemId ?? 'none'}`}
              />
            </Card>
          );
        }

        if (isPactOfTheChainInvocation(item)) {
          const candidates = getPactChainFamiliarCandidates(items, enabledSourceIds);
          return (
            <Card key={invocationChoiceKey(item.id, instanceIndex)} variant="filled" title="Pact Familiar" subtitle="Escolha a forma atual do familiar. Formas especiais são exibidas antes das formas comuns de Find Familiar.">
              <PaginatedOptionCardList
                items={candidates}
                keyExtractor={(entry) => `${item.id}-${entry.item.id}`}
                titleForItem={(entry) => entry.item.name}
                descriptionForItem={(entry) => entry.description}
                metaForItem={(entry) => entry.variant === 'special' ? 'Forma especial de Pact of the Chain' : 'Forma comum de Find Familiar'}
                isSelected={(entry) => choice.familiarCreatureItemId === entry.item.id}
                onPressItem={(entry) => { void selectSingleItem(item.id, instanceIndex, entry.item, (current) => ({ ...current, familiarCreatureItemId: entry.item.id, familiarVariant: entry.variant })); }}
                pageSize={8}
                resetKey={`${item.id}:${choice.familiarCreatureItemId ?? 'none'}`}
                emptyText="Nenhum stat block de familiar foi encontrado nas fontes ativas."
              />
            </Card>
          );
        }

        if (isInvestmentOfTheChainMasterInvocation(item)) {
          return (
            <Card key={invocationChoiceKey(item.id, instanceIndex)} variant="filled" title="Investment of the Chain Master" subtitle="Escolha o deslocamento adicional do familiar. As demais melhorias são aplicadas automaticamente.">
              <Text style={[styles.heading, { color: colors.onSurface }]}>Deslocamento adicional</Text>
              <View style={styles.chips}>
                <Chip label="Voo 40 ft" selected={choice.chainMasterMovementMode === 'fly'} onPress={() => updateChoice(item.id, instanceIndex, (current) => ({ ...current, chainMasterMovementMode: 'fly' }))} />
                <Chip label="Natação 40 ft" selected={choice.chainMasterMovementMode === 'swim'} onPress={() => updateChoice(item.id, instanceIndex, (current) => ({ ...current, chainMasterMovementMode: 'swim' }))} />
              </View>
              <Text style={[styles.heading, { color: colors.onSurface }]}>Dano usado na simulação atual</Text>
              <View style={styles.chips}>
                {([{ value: 'necrotic', label: 'Necrótico' }, { value: 'radiant', label: 'Radiante' }] as Array<{ value: ChainMasterDamageType; label: string }>).map((entry) => (
                  <Chip key={entry.value} label={entry.label} selected={choice.chainMasterDamageType === entry.value} onPress={() => updateChoice(item.id, instanceIndex, (current) => ({ ...current, chainMasterDamageType: entry.value }))} />
                ))}
              </View>
              <Text style={{ color: colors.onSurfaceVariant }}>O tipo pode ser alterado antes de cada cálculo. O familiar também passa a atacar por sua ação bônus, usa sua CD de magia quando aplicável e recebe a reação defensiva da invocation.</Text>
            </Card>
          );
        }

        if (isLifedrinkerInvocation(item)) {
          const damageTypes: Array<{ value: LifedrinkerDamageType; label: string }> = [
            { value: 'necrotic', label: 'Necrótico' },
            { value: 'psychic', label: 'Psíquico' },
            { value: 'radiant', label: 'Radiante' }
          ];
          return (
            <Card key={invocationChoiceKey(item.id, instanceIndex)} variant="filled" title="Lifedrinker" subtitle="Escolha o tipo do dano adicional de 1d6 aplicado uma vez por turno com a Pact Weapon.">
              <View style={styles.chips}>
                {damageTypes.map((entry) => (
                  <Chip
                    key={entry.value}
                    label={entry.label}
                    selected={choice.lifedrinkerDamageType === entry.value}
                    onPress={() => updateChoice(item.id, instanceIndex, (current) => ({ ...current, lifedrinkerDamageType: entry.value }))}
                  />
                ))}
              </View>
              <Text style={{ color: colors.onSurfaceVariant }}>Após acertar com a Pact Weapon, a cura pode ser ativada na tela de Combate; ela consome um Hit Die e registra a rolagem.</Text>
            </Card>
          );
        }

        return null;
      })}
    </>
  );
};

const styles = StyleSheet.create({
  heading: { fontSize: 15, lineHeight: 21, fontWeight: '900' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
});
