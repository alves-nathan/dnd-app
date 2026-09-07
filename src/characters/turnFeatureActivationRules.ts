import type {
  Character,
  CharacterAction,
  ResourceCost,
  TurnActionModifierKind,
  TurnFeatureActivation
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { findCompendiumItemForCharacterLink } from '../compendium/characterLinkIdentity';
import { findFeatOptionDefinition } from './featOptionCatalog';
import { getCharacterMetamagicSources } from './metamagicRules';
import { getSelectedSpeciesFeatureChoice } from './speciesChoiceRules';

export interface TurnFeatureActivationOption {
  id: string;
  name: string;
  summary: string;
  activation: Omit<TurnFeatureActivation, 'id' | 'targetActionId'>;
  targetMode: 'turn' | 'action';
  eligibleActionIds: string[];
}

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const activationCost = (
  resourceId: string,
  amount: number,
  label: string,
  oncePerTurnKey?: string
): ResourceCost[] => [{ resourceId, amount, label, oncePerTurnKey }];

const featureItemForEntity = (
  character: Character,
  items: StoredCompendiumItem[],
  featureId: string
): StoredCompendiumItem | undefined => {
  const link = (character.compendiumLinks ?? []).find((entry) =>
    entry.status === 'active' && entry.appliedAs === 'feature' && entry.appliedEntityId === featureId
  );
  return link ? findCompendiumItemForCharacterLink(items, link) : undefined;
};

const isActionSurgeFeature = (
  character: Character,
  items: StoredCompendiumItem[],
  featureId: string,
  featureName: string
): boolean => {
  const item = featureItemForEntity(character, items, featureId);
  const engineKey = asString(asRecord(item?.normalizedJson).engineKey);
  return engineKey === 'fighter.action-surge' || normalize(featureName) === 'action surge';
};

const isGiantAncestryFeature = (
  character: Character,
  items: StoredCompendiumItem[],
  featureId: string,
  featureName: string
): boolean => {
  const item = featureItemForEntity(character, items, featureId);
  const engineKey = asString(asRecord(item?.normalizedJson).engineKey);
  return engineKey === 'species.goliath.giant_ancestry' || normalize(featureName) === 'giant ancestry';
};

const modifierForMetamagicOption = (optionId: string): TurnActionModifierKind | undefined => {
  if (optionId.endsWith('quickened-spell')) return 'quickenedSpell';
  if (optionId.endsWith('distant-spell')) return 'distantSpell';
  if (optionId.endsWith('subtle-spell')) return 'subtleSpell';
  return undefined;
};

const distantRangeEligible = (range: string | undefined): boolean => {
  if (!range?.trim()) return false;
  if (/^touch$/i.test(range.trim())) return true;
  const match = range.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|pes|pés)/i);
  return Boolean(match?.[1] && Number(match[1]) >= 5);
};

const eligibleForModifier = (action: CharacterAction, modifier: TurnActionModifierKind): boolean => {
  if (modifier === 'giantAncestryFiresBurn') {
    if (action.type === 'attack') return Boolean(action.damage);
    return Boolean(action.damage && (action.attacksCount ?? 0) > 0);
  }
  if (action.type !== 'spell') return false;
  if (modifier === 'quickenedSpell') return action.actionCost === 'action';
  if (modifier === 'distantSpell') return distantRangeEligible(action.range);
  if (modifier === 'subtleSpell') return Boolean(action.components && (action.components.verbal || action.components.somatic || action.components.material));
  return false;
};

/**
 * Builds explicit turn-level mechanics that the player can opt into while
 * creating a rotation. Only mechanics with deterministic runtime semantics are
 * exposed; unsupported Metamagic/Maneuver options remain descriptive/manual.
 */
export const buildTurnFeatureActivationOptions = (
  character: Character,
  items: StoredCompendiumItem[],
  actions: CharacterAction[]
): TurnFeatureActivationOption[] => {
  const options: TurnFeatureActivationOption[] = [];

  for (const feature of character.features) {
    if (!isActionSurgeFeature(character, items, feature.id, feature.name)) continue;
    const resourceId = feature.resource?.id ?? character.resources.find((resource) => normalize(resource.name).includes('action surge'))?.id ?? 'fighter-action-surge';
    options.push({
      id: `turn-activation:action-surge:${feature.id}`,
      name: 'Action Surge',
      summary: 'Gasta 1 uso para conceder uma Ação adicional neste turno. A Ação adicional não pode ser Magic.',
      targetMode: 'turn',
      eligibleActionIds: [],
      activation: {
        kind: 'extraAction',
        name: 'Action Surge',
        sourceFeatureId: feature.id,
        sourceItemId: featureItemForEntity(character, items, feature.id)?.id,
        actionCost: 'free',
        consumes: activationCost(resourceId, 1, 'Action Surge', 'fighter-action-surge'),
        extraActionCount: 1,
        prohibitsMagicAction: true,
        notes: ['Concede uma Ação adicional. Pela regra 2024, essa Ação adicional não pode ser usada para a Magic action.']
      }
    });
  }

  for (const feature of character.features) {
    if (!isGiantAncestryFeature(character, items, feature.id, feature.name)) continue;
    const selection = getSelectedSpeciesFeatureChoice(character, items, feature.id);
    if (selection?.choice.optionId !== 'fires-burn') continue;
    const modifier: TurnActionModifierKind = 'giantAncestryFiresBurn';
    const eligibleActionIds = actions.filter((action) => eligibleForModifier(action, modifier)).map((action) => action.id);
    const resourceId = feature.resource?.id
      ?? character.resources.find((resource) => normalize(resource.name) === 'giant ancestry')?.id
      ?? 'goliath-giant-ancestry';
    options.push({
      id: `turn-activation:giant-ancestry:fires-burn:${feature.id}`,
      name: `Giant Ancestry · ${selection.option.label}`,
      summary: selection.description ?? 'Ao acertar com uma jogada de ataque e causar dano, cause 1d10 de dano de fogo adicional.',
      targetMode: 'action',
      eligibleActionIds,
      activation: {
        kind: 'actionModifier',
        name: `Giant Ancestry · ${selection.option.label}`,
        sourceFeatureId: feature.id,
        sourceItemId: selection.featureItem.id,
        actionCost: 'free',
        consumes: activationCost(resourceId, 1, 'Giant Ancestry'),
        modifier,
        damageBonus: { formula: '1d10', damageType: 'fire', sourceType: 'speciesFeature', trigger: 'onHit' },
        notes: [selection.description ?? 'Fire\'s Burn: +1d10 fire em um acerto que cause dano.']
      }
    });
  }

  const metamagicSources = getCharacterMetamagicSources(character, items);
  const metamagicOptionSourceCounts = metamagicSources.reduce<Record<string, number>>((counts, source) => {
    for (const optionId of source.selectedOptionIds) counts[optionId] = (counts[optionId] ?? 0) + 1;
    return counts;
  }, {});
  for (const source of metamagicSources) {
    for (const optionId of source.selectedOptionIds) {
      const definition = findFeatOptionDefinition(optionId);
      const modifier = modifierForMetamagicOption(optionId);
      if (!definition || definition.kind !== 'metamagic' || !modifier || !definition.sorceryPointCost) continue;
      const eligibleActionIds = actions.filter((action) => eligibleForModifier(action, modifier)).map((action) => action.id);
      const sourceLabel = source.kind === 'sorcerer' ? 'Sorcerer' : 'Metamagic Adept';
      options.push({
        id: `turn-activation:metamagic:${source.id}:${optionId}`,
        name: (metamagicOptionSourceCounts[optionId] ?? 0) > 1 ? `${definition.name} · ${sourceLabel}` : definition.name,
        summary: definition.summary,
        targetMode: 'action',
        eligibleActionIds,
        activation: {
          kind: 'actionModifier',
          name: definition.name,
          sourceFeatureId: source.kind === 'sorcerer' ? source.featureEntityId : undefined,
          sourceFeatEntityId: source.kind === 'feat' ? source.featEntityId : undefined,
          sourceItemId: source.kind === 'sorcerer' ? source.featureItemId : source.featItemId,
          actionCost: 'free',
          consumes: activationCost(source.resourceId, definition.sorceryPointCost, definition.name),
          modifier,
          notes: [definition.summary, `Fonte de Metamagic: ${sourceLabel}.`]
        }
      });
    }
  }

  return options;
};

export const instantiateTurnFeatureActivation = (
  option: TurnFeatureActivationOption,
  targetActionId?: string
): TurnFeatureActivation => ({
  id: option.targetMode === 'action' && targetActionId ? `${option.id}:${targetActionId}` : option.id,
  ...option.activation,
  targetActionId: option.targetMode === 'action' ? targetActionId : undefined
});
