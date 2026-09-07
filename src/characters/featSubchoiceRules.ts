import type {
  Character,
  CharacterFeatChoice,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { findCompendiumItemByReference } from '../compendium/classProgression';
import {
  findEldritchInvocationById,
  getEffectiveEldritchInvocationCounts,
  getEldritchInvocationMinimumLevel,
  getEldritchInvocationPrerequisiteIssues,
  getSelectableEldritchInvocations,
  isEldritchInvocationItem,
  isEldritchInvocationRepeatable
} from './eldritchInvocationRules';
import {
  applyEldritchInvocationChoiceGrantSet,
  invocationNeedsInternalChoice,
  validateEldritchInvocationChoices
} from './eldritchInvocationChoiceRules';
import {
  findFeatOptionDefinition,
  getMartialAdeptManeuverOptions,
  getMetamagicFeatOptions,
  type FeatOptionDefinition
} from './featOptionCatalog';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const issue = (code: string, message: string): RuleValidationIssue => ({ severity: 'error', code, message });

export const isFightingStyleFeatItem = (item: StoredCompendiumItem | undefined): item is StoredCompendiumItem =>
  Boolean(item && item.type === 'feat' && normalize(asString(asRecord(item.normalizedJson).category) ?? '') === 'fightingstyle');

const activeFightingStyleItemIds = (
  character: Character | undefined,
  excludingFeatEntityId?: string
): Set<string> => {
  const result = new Set<string>();
  if (!character) return result;
  for (const link of character.compendiumLinks ?? []) {
    if (link.status !== 'active' || link.appliedAs !== 'feat') continue;
    if (excludingFeatEntityId && link.notes?.includes(`feat-subchoice:${excludingFeatEntityId}:fighting-style`)) continue;
    result.add(link.itemId);
  }
  for (const choice of character.featChoices ?? []) {
    if (excludingFeatEntityId && choice.featEntityId === excludingFeatEntityId) continue;
    if (choice.fightingStyleItemId) result.add(choice.fightingStyleItemId);
  }
  return result;
};

export const getFightingStyleFeatChoiceCandidates = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[] = [],
  character?: Character,
  excludingFeatEntityId?: string
): StoredCompendiumItem[] => {
  const enabled = enabledSourceIds.length ? new Set(enabledSourceIds) : undefined;
  const known = activeFightingStyleItemIds(character, excludingFeatEntityId);
  return items
    .filter(isFightingStyleFeatItem)
    .filter((item) => item.status !== 'disabled' && (!enabled || enabled.has(item.sourceId)))
    .filter((item) => !known.has(item.id))
    .sort((left, right) => left.name.localeCompare(right.name));
};

export const validateFightingStyleFeatChoice = (
  choice: CharacterFeatChoice,
  allItems: StoredCompendiumItem[],
  character?: Character
): RuleValidationIssue[] => {
  if (!choice.fightingStyleItemId) return [issue('FEAT_FIGHTING_STYLE_CHOICE_REQUIRED', 'Escolha um Fighting Style.')];
  const style = allItems.find((item) => item.id === choice.fightingStyleItemId);
  if (!isFightingStyleFeatItem(style) || style?.status === 'disabled') {
    return [issue('FEAT_FIGHTING_STYLE_CHOICE_INVALID', 'O Fighting Style escolhido não está disponível no compêndio.')];
  }
  if (activeFightingStyleItemIds(character, choice.featEntityId).has(style.id)) {
    return [issue('FEAT_FIGHTING_STYLE_ALREADY_KNOWN', `${style.name} já é conhecido pelo personagem e não pode ser escolhido novamente.`)];
  }
  return [];
};

const characterWarlockLevel = (character?: Character): number =>
  character?.classes
    .filter((entry) => normalize(entry.name) === 'warlock')
    .reduce((sum, entry) => sum + Math.max(0, Math.floor(entry.level)), 0) ?? 0;

const characterMainOriginFeatItemIds = (character?: Character): string[] => {
  if (!character?.originFeatId) return [];
  return (character.compendiumLinks ?? [])
    .filter((link) => link.appliedAs === 'feat' && link.status === 'active' && link.appliedEntityId === character.originFeatId)
    .map((link) => link.itemId);
};

const characterKnownWarlockCantripItemIds = (character: Character | undefined, allItems: StoredCompendiumItem[]): string[] => {
  if (!character) return [];
  const warlockClassEntityIds = new Set(
    character.classes.filter((entry) => normalize(entry.name) === 'warlock').map((entry) => entry.id)
  );
  if (!warlockClassEntityIds.size) return [];
  return (character.compendiumLinks ?? [])
    .filter((link) => link.appliedAs === 'spell' && link.status === 'active')
    .filter((link) => {
      const spell = character.spells.find((entry) => entry.id === link.appliedEntityId);
      const spellItem = allItems.find((entry) => entry.id === link.itemId && entry.type === 'spell');
      return Boolean(
        spell
        && spellItem
        && Number(asRecord(spellItem.normalizedJson).level ?? 0) === 0
        && spell.spellcastingClassId
        && warlockClassEntityIds.has(spell.spellcastingClassId)
      );
    })
    .map((link) => link.itemId);
};

/** Eldritch Adept treats any prerequisite as Warlock-only. Level gates are prerequisites too. */
export const eldritchAdeptInvocationHasPrerequisite = (item: StoredCompendiumItem): boolean => {
  const payload = asRecord(item.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  return Boolean(asString(payload.prerequisite))
    || Boolean(asString(mechanics.requiresFeatureId))
    || getEldritchInvocationMinimumLevel(item) > 1;
};

const invocationCountsExcludingFeat = (
  character: Character | undefined,
  featEntityId: string
): Record<string, number> => {
  if (!character) return {};
  const counts = getEffectiveEldritchInvocationCounts(character);
  const current = (character.featChoices ?? []).find((entry) => entry.featEntityId === featEntityId)?.eldritchInvocationItemId;
  if (current && counts[current]) {
    counts[current] -= 1;
    if (counts[current] <= 0) delete counts[current];
  }
  return counts;
};

export const validateEldritchAdeptInvocationChoice = (
  choice: CharacterFeatChoice,
  allItems: StoredCompendiumItem[],
  character?: Character
): RuleValidationIssue[] => {
  const invocationItemId = choice.eldritchInvocationItemId;
  if (!invocationItemId) return [issue('FEAT_ELDRITCH_INVOCATION_REQUIRED', 'Escolha uma Eldritch Invocation.')];
  const invocation = findEldritchInvocationById(allItems, invocationItemId);
  if (!invocation || !isEldritchInvocationItem(invocation) || invocation.status === 'disabled') {
    return [issue('FEAT_ELDRITCH_INVOCATION_INVALID', 'A Eldritch Invocation escolhida não está disponível no compêndio.')];
  }

  const issues: RuleValidationIssue[] = validateEldritchAdeptPrerequisitesOnly(
    invocation,
    allItems,
    character,
    choice.featEntityId
  );

  if (invocationNeedsInternalChoice(invocation)) {
    const internal = choice.eldritchInvocationChoice;
    if (!internal) {
      issues.push(issue('FEAT_ELDRITCH_INVOCATION_INTERNAL_CHOICE_REQUIRED', `${invocation.name} possui uma escolha interna obrigatória.`));
    } else {
      const sourceIds = Array.from(new Set(allItems.map((item) => item.sourceId)));
      issues.push(...validateEldritchInvocationChoices(
        { [invocation.id]: 1 },
        [{ ...internal, invocationItemId: invocation.id, instanceIndex: 0 }],
        allItems,
        sourceIds,
        {
          knownWarlockCantripItemIds: characterKnownWarlockCantripItemIds(character, allItems),
          requireKnownWarlockCantrip: characterWarlockLevel(character) > 0,
          selectedOriginFeatItemIds: characterMainOriginFeatItemIds(character)
        }
      ));
    }
  }

  return issues;
};

const validateEldritchAdeptPrerequisitesOnly = (
  invocation: StoredCompendiumItem,
  allItems: StoredCompendiumItem[],
  character?: Character,
  featEntityId = ''
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  const selectedCounts = invocationCountsExcludingFeat(character, featEntityId);
  if ((selectedCounts[invocation.id] ?? 0) > 0 && !isEldritchInvocationRepeatable(invocation)) {
    issues.push(issue('FEAT_ELDRITCH_INVOCATION_ALREADY_KNOWN', `${invocation.name} já é conhecida e não pode ser escolhida novamente.`));
  }
  if (!eldritchAdeptInvocationHasPrerequisite(invocation)) return issues;

  const warlockLevel = characterWarlockLevel(character);
  if (warlockLevel <= 0) {
    issues.push(issue('FEAT_ELDRITCH_INVOCATION_WARLOCK_REQUIRED', `${invocation.name} possui pré-requisito e, por Eldritch Adept, só pode ser escolhida por um Warlock que o cumpra.`));
    return issues;
  }
  const allInvocations = getSelectableEldritchInvocations(allItems, Array.from(new Set(allItems.map((item) => item.sourceId))));
  issues.push(...getEldritchInvocationPrerequisiteIssues(invocation, warlockLevel, selectedCounts, allInvocations));
  return issues;
};

export const getEldritchAdeptInvocationCandidates = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[],
  character?: Character,
  featEntityId = ''
): StoredCompendiumItem[] =>
  getSelectableEldritchInvocations(items, enabledSourceIds)
    .filter((invocation) => validateEldritchAdeptPrerequisitesOnly(invocation, items, character, featEntityId).length === 0)
    .sort((left, right) => left.name.localeCompare(right.name));

const validateStaticFeatOptionSelection = (
  selectedIds: string[],
  expectedCount: number,
  kind: FeatOptionDefinition['kind'],
  label: string,
  codePrefix: string
): RuleValidationIssue[] => {
  const uniqueIds = Array.from(new Set(selectedIds));
  const issues: RuleValidationIssue[] = [];
  if (uniqueIds.length !== expectedCount) {
    issues.push(issue(`${codePrefix}_CHOICE_COUNT`, `${label} exige ${expectedCount} escolha(s) diferente(s); ${uniqueIds.length} selecionada(s).`));
  }
  if (uniqueIds.length !== selectedIds.length) {
    issues.push(issue(`${codePrefix}_DUPLICATE`, `${label} exige opções diferentes.`));
  }
  for (const id of uniqueIds) {
    const option = findFeatOptionDefinition(id);
    if (!option || option.kind !== kind) {
      issues.push(issue(`${codePrefix}_INVALID`, `Uma das opções escolhidas para ${label} não pertence ao catálogo suportado.`));
    }
  }
  return issues;
};

export const validateMetamagicFeatChoice = (
  choice: CharacterFeatChoice,
  expectedCount: number
): RuleValidationIssue[] => validateStaticFeatOptionSelection(
  choice.metamagicOptionIds ?? [],
  expectedCount,
  'metamagic',
  'Metamagic Adept',
  'FEAT_METAMAGIC'
);

export const validateManeuverFeatChoice = (
  choice: CharacterFeatChoice,
  expectedCount: number
): RuleValidationIssue[] => validateStaticFeatOptionSelection(
  choice.maneuverOptionIds ?? [],
  expectedCount,
  'maneuver',
  'Martial Adept',
  'FEAT_MANEUVER'
);

export { getMetamagicFeatOptions, getMartialAdeptManeuverOptions };

const optionNames = (ids: string[]): string[] => ids
  .map((id) => findFeatOptionDefinition(id)?.name)
  .filter((name): name is string => Boolean(name));

const upsertFeatResource = (
  character: Character,
  featItem: StoredCompendiumItem,
  choice: CharacterFeatChoice,
  resource: { id: string; name: string; max: number; recharge: 'shortRest' | 'longRest'; notes: string }
): Character => {
  const existing = character.resources.find((entry) => entry.id === resource.id);
  return {
    ...character,
    resources: [
      ...character.resources.filter((entry) => entry.id !== resource.id),
      {
        ...resource,
        current: existing ? Math.min(resource.max, existing.current) : resource.max,
        source: featItem.rawJson.source,
        sourceFeatEntityId: choice.featEntityId
      }
    ]
  };
};

const applyStaticFeatOptionResources = (
  character: Character,
  featItem: StoredCompendiumItem,
  choice: CharacterFeatChoice
): Character => {
  const mechanics = asRecord(asRecord(featItem.normalizedJson).mechanics);
  let next = character;

  const metamagicChoice = asRecord(mechanics.metamagicChoice);
  if (Object.keys(metamagicChoice).length && (choice.metamagicOptionIds ?? []).length) {
    const points = asRecord(mechanics.sorceryPoints);
    const amount = Math.max(0, Math.floor(asNumber(points.amount) ?? 0));
    if (amount > 0) {
      const names = optionNames(choice.metamagicOptionIds ?? []);
      next = upsertFeatResource(next, featItem, choice, {
        id: `feat_metamagic_${choice.featEntityId}`,
        name: `${featItem.name}: Sorcery Points`,
        max: amount,
        recharge: 'longRest',
        notes: `Uso restrito a Metamagic. Opções conhecidas: ${names.join(', ') || '—'}.`
      });
    }
  }

  const maneuverChoice = asRecord(mechanics.maneuverChoice);
  if (Object.keys(maneuverChoice).length && (choice.maneuverOptionIds ?? []).length) {
    const superiority = asRecord(mechanics.superiorityDie);
    const amount = Math.max(0, Math.floor(asNumber(superiority.count) ?? 0));
    const die = asString(superiority.die) ?? 'd6';
    if (amount > 0) {
      const names = optionNames(choice.maneuverOptionIds ?? []);
      next = upsertFeatResource(next, featItem, choice, {
        id: `feat_superiority_die_${choice.featEntityId}`,
        name: `${featItem.name}: Superiority Die (${die})`,
        max: amount,
        recharge: 'shortRest',
        notes: `Recupera em Short ou Long Rest. Maneuvers: ${names.join(', ') || '—'}. Save DC quando aplicável: 8 + PB + modificador de STR ou DEX.`
      });
    }
  }

  return next;
};

const staticFeatResourceIds = (
  featItem: StoredCompendiumItem,
  choice: CharacterFeatChoice
): string[] => {
  const mechanics = asRecord(asRecord(featItem.normalizedJson).mechanics);
  const ids: string[] = [];
  if (Object.keys(asRecord(mechanics.metamagicChoice)).length && (choice.metamagicOptionIds ?? []).length) {
    const points = asRecord(mechanics.sorceryPoints);
    if ((asNumber(points.amount) ?? 0) > 0) ids.push(`feat_metamagic_${choice.featEntityId}`);
  }
  if (Object.keys(asRecord(mechanics.maneuverChoice)).length && (choice.maneuverOptionIds ?? []).length) {
    const superiority = asRecord(mechanics.superiorityDie);
    if ((asNumber(superiority.count) ?? 0) > 0) ids.push(`feat_superiority_die_${choice.featEntityId}`);
  }
  return ids;
};

/**
 * Rebuilds derived resource pools owned by feat subselections from persisted
 * CharacterFeatChoice data. Creation/edit flows apply these resources eagerly,
 * but reconciliation is the source of truth so a later build pass, migration,
 * restore or partial editor update cannot silently drop Metamagic Adept or
 * Martial Adept resources. Existing current values are preserved.
 */
export const reconcileFeatSubchoiceResources = (
  character: Character,
  allItems: StoredCompendiumItem[]
): Character => {
  const activeFeatLinks = (character.compendiumLinks ?? []).filter(
    (link) => link.appliedAs === 'feat' && link.status === 'active' && !link.notes?.includes('feat-subchoice:')
  );
  const choicesByFeatEntityId = new Map(
    (character.featChoices ?? [])
      .filter((choice) => Boolean(choice.featEntityId))
      .map((choice) => [choice.featEntityId, choice] as const)
  );

  const resolved: Array<{ featItem: StoredCompendiumItem; choice: CharacterFeatChoice }> = [];
  const desiredResourceIds = new Set<string>();
  for (const link of activeFeatLinks) {
    const choice = choicesByFeatEntityId.get(link.appliedEntityId);
    if (!choice) continue;
    const featItem = findCompendiumItemByReference(allItems, link.itemId)
      ?? findCompendiumItemByReference(allItems, choice.featItemId);
    if (!featItem || featItem.type !== 'feat') continue;
    resolved.push({ featItem, choice });
    for (const id of staticFeatResourceIds(featItem, choice)) desiredResourceIds.add(id);
  }

  let next: Character = {
    ...character,
    resources: character.resources.filter((resource) => {
      const managed = resource.id.startsWith('feat_metamagic_') || resource.id.startsWith('feat_superiority_die_');
      return !managed || desiredResourceIds.has(resource.id);
    })
  };
  for (const entry of resolved) next = applyStaticFeatOptionResources(next, entry.featItem, entry.choice);
  return next;
};

const markerForFeat = (featEntityId: string): string => `feat-subchoice:${featEntityId}:`;

const removePreviousFeatSubchoiceState = (character: Character, featEntityId: string): Character => {
  const marker = markerForFeat(featEntityId);
  const markedEntityIds = new Set(
    (character.compendiumLinks ?? [])
      .filter((link) => link.status === 'active' && link.notes?.includes(marker))
      .map((link) => link.appliedEntityId)
  );
  const removedFeatureResourceIds = new Set(
    character.features.filter((feature) => markedEntityIds.has(feature.id)).map((feature) => feature.resource?.id).filter((id): id is string => Boolean(id))
  );
  return {
    ...character,
    features: character.features.filter((feature) => !markedEntityIds.has(feature.id)),
    spells: character.spells.filter((spell) => !(spell.grantedByFeatEntityId === featEntityId && spell.grantedByInvocationItemId)),
    feats: character.feats.filter((feat) => feat.grantedByFeatEntityId !== featEntityId),
    companions: (character.companions ?? []).filter((companion) => companion.grantedByFeatEntityId !== featEntityId),
    resources: character.resources.filter((resource) => resource.sourceFeatEntityId !== featEntityId && !removedFeatureResourceIds.has(resource.id)),
    compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
      (markedEntityIds.has(link.appliedEntityId)
        || (link.status === 'active' && link.notes?.includes(marker)))
        ? { ...link, status: 'removed' as const }
        : link
    )
  };
};

const applicableItem = (item: StoredCompendiumItem): StoredCompendiumItem => item.status === 'validated'
  ? item
  : { ...item, status: 'validated' };

export const applyFeatSubchoiceEffects = (
  character: Character,
  featItem: StoredCompendiumItem,
  choice: CharacterFeatChoice,
  allItems: StoredCompendiumItem[]
): Character => {
  let next = removePreviousFeatSubchoiceState(character, choice.featEntityId);
  const marker = markerForFeat(choice.featEntityId);

  if (choice.fightingStyleItemId) {
    const style = allItems.find((item) => item.id === choice.fightingStyleItemId);
    if (isFightingStyleFeatItem(style)) {
      const beforeFeatIds = new Set(next.feats.map((feat) => feat.id));
      const result = applyCompendiumItemToCharacter(next, applicableItem(style));
      if (result.ok) {
        next = {
          ...result.character,
          feats: result.character.feats.map((feat) => !beforeFeatIds.has(feat.id)
            ? { ...feat, grantedByFeatEntityId: choice.featEntityId }
            : feat),
          compendiumLinks: (result.character.compendiumLinks ?? []).map((link) =>
            link.id === result.link?.id ? { ...link, notes: [link.notes, `${marker}fighting-style`].filter(Boolean).join(' · ') } : link
          )
        };
      }
    }
  }

  next = applyStaticFeatOptionResources(next, featItem, choice);

  const invocationItemId = choice.eldritchInvocationItemId;
  if (!invocationItemId) return next;
  const invocation = findEldritchInvocationById(allItems, invocationItemId);
  if (!invocation || !isEldritchInvocationItem(invocation)) return next;

  const result = applyCompendiumItemToCharacter(next, applicableItem(invocation));
  if (result.ok) {
    next = {
      ...result.character,
      compendiumLinks: (result.character.compendiumLinks ?? []).map((link) =>
        link.id === result.link?.id ? { ...link, notes: [link.notes, `${marker}eldritch-invocation`].filter(Boolean).join(' · ') } : link
      )
    };
  }

  const internalChoices = choice.eldritchInvocationChoice
    ? [{ ...choice.eldritchInvocationChoice, invocationItemId: invocation.id, instanceIndex: 0 }]
    : [];
  next = applyEldritchInvocationChoiceGrantSet(
    next,
    internalChoices,
    { [invocation.id]: 1 },
    allItems,
    {
      spellcastingClassName: featItem.name,
      spellcastingAbility: choice.spellcastingAbility,
      grantedByFeatEntityId: choice.featEntityId,
      linkNote: `${marker}eldritch-invocation`,
      resourceIdPrefix: `feat_invocation_${choice.featEntityId}`
    }
  ).character;
  return next;
};
