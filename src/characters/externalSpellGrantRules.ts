import type {
  AbilityScore,
  Character,
  CharacterFeatChoice,
  ExternalSpellGrantSource,
  ResourcePool,
  RuleValidationIssue,
  Spell,
  SpellFreeCastGrant
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { findCompendiumItemByReference } from '../compendium/classProgression';
import {
  characterLinkMatchesCompendiumItem,
  findCompendiumItemForCharacterLink
} from '../compendium/characterLinkIdentity';
import { itemReferenceMatches } from './creationData';
import {
  getSpeciesChoiceOptionFeatureItem,
  getSpeciesChoiceRequirements,
  getSpeciesFeatureItems,
  getSpeciesStructuredSpellGrants,
  speciesChoiceForRequirement
} from './speciesChoiceRules';
import { getFeatChoiceSchema } from './featChoiceRules';
import { getCharacterRuleFeatures } from './customRuleEffects';
import { getSpeciesSpellReplacementRequirements } from './speciesSpellReplacementRules';
import { getAbilityModifier, getProficiencyBonus } from '../rules-engine/characters/derivedStats';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())) : [];
const normalize = (value: string): string => value
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const unique = <T,>(values: T[]): T[] => Array.from(new Set(values));
const ABILITIES = new Set<AbilityScore>(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);

const ability = (value: unknown): AbilityScore | undefined => {
  const normalized = asString(value)?.toUpperCase();
  return normalized && ABILITIES.has(normalized as AbilityScore) ? normalized as AbilityScore : undefined;
};

const findSpell = (items: StoredCompendiumItem[], reference: string): StoredCompendiumItem | undefined =>
  items.find((item) => item.type === 'spell' && item.status !== 'disabled' && itemReferenceMatches(item, reference));

const spellLevel = (item: StoredCompendiumItem): number =>
  Math.max(0, Math.floor(asNumber(asRecord(item.normalizedJson).level) ?? 0));

const explicitlyApproved = (item: StoredCompendiumItem): StoredCompendiumItem => item.status === 'validated'
  ? item
  : {
      ...item,
      status: 'validated',
      reviewDecision: 'approved',
      reviewedBy: 'Reconciliação de magia concedida por espécie/feat/feature ativa',
      reviewedAt: new Date().toISOString()
    };

interface DesiredFreeCast extends SpellFreeCastGrant {
  max: number;
  recharge: ResourcePool['recharge'];
}

interface DesiredExternalGrant {
  spellItem: StoredCompendiumItem;
  sources: ExternalSpellGrantSource[];
  freeCasts: DesiredFreeCast[];
}

const sourceKey = (source: ExternalSpellGrantSource): string =>
  `${source.kind}|${source.sourceItemId}|${source.sourceEntityId ?? ''}`;
const freeCastKey = (grant: SpellFreeCastGrant): string => grant.id;
const uniqueSources = (sources: ExternalSpellGrantSource[]): ExternalSpellGrantSource[] =>
  Array.from(new Map(sources.map((source) => [sourceKey(source), source] as const)).values());
const uniqueFreeCasts = <T extends SpellFreeCastGrant>(grants: T[]): T[] =>
  Array.from(new Map(grants.map((grant) => [freeCastKey(grant), grant] as const)).values());

const putDesired = (
  desired: Map<string, DesiredExternalGrant>,
  spellItem: StoredCompendiumItem | undefined,
  source: ExternalSpellGrantSource,
  freeCasts: DesiredFreeCast[] = []
) => {
  if (!spellItem) return;
  const current = desired.get(spellItem.id);
  desired.set(spellItem.id, {
    spellItem,
    sources: uniqueSources([...(current?.sources ?? []), source]),
    freeCasts: uniqueFreeCasts([...(current?.freeCasts ?? []), ...freeCasts])
  });
};

const rechargeFrom = (value: unknown): ResourcePool['recharge'] => {
  const normalized = normalize(asString(value) ?? 'longRest');
  return normalized.includes('short') ? 'shortRest' : normalized.includes('manual') ? 'manual' : 'longRest';
};

const noComponentsFrom = (value: Record<string, unknown>): boolean | undefined =>
  asBoolean(value.noComponents) ?? (asBoolean(value.requiresComponents) === false ? true : undefined);

const parseTextFreeCast = (
  text: string | undefined,
  character: Character
): { max: number; recharge: ResourcePool['recharge'] } | undefined => {
  if (!text) return undefined;
  const normalized = normalize(text);
  const max = normalized.includes('pb') || normalized.includes('proficiency')
    ? getProficiencyBonus(character)
    : normalized.includes('once') || normalized.includes('1')
      ? 1
      : 1;
  return { max, recharge: normalized.includes('short') ? 'shortRest' : 'longRest' };
};

const freeCastGrant = (params: {
  id: string;
  source: ExternalSpellGrantSource;
  resourceId: string;
  max: number;
  recharge: ResourcePool['recharge'];
  spellLevel?: number;
  noComponents?: boolean;
  ignoreMaterialComponent?: boolean;
  notes?: string;
}): DesiredFreeCast => ({
  id: params.id,
  sourceKind: params.source.kind,
  sourceItemId: params.source.sourceItemId,
  sourceEntityId: params.source.sourceEntityId,
  sourceName: params.source.sourceName,
  resourceId: params.resourceId,
  castAtSpellLevel: params.spellLevel,
  spellcastingAbility: params.source.spellcastingAbility,
  noComponents: params.noComponents,
  ignoreMaterialComponent: params.ignoreMaterialComponent,
  notes: params.notes,
  max: params.max,
  recharge: params.recharge
});

const selectedSpeciesOption = (
  featureItem: StoredCompendiumItem,
  optionId: string | undefined
): Record<string, unknown> => {
  if (!optionId) return {};
  const payload = asRecord(featureItem.normalizedJson);
  for (const key of ['ancestryOptions', 'lineageOptions', 'legacyOptions', 'options']) {
    const option = asRecord(asRecord(payload[key])[optionId]);
    if (Object.keys(option).length) return option;
  }
  return {};
};

const evaluateSpeciesUsesFormula = (formula: string | undefined, character: Character): number | undefined => {
  if (!formula) return undefined;
  const normalized = formula.replace(/\s+/g, '');
  const maxMatch = normalized.match(/^max\((\d+),(STR|DEX|CON|INT|WIS|CHA)\.modifier\)$/i);
  if (maxMatch) {
    const floor = Number(maxMatch[1]);
    const abilityScore = maxMatch[2]!.toUpperCase() as AbilityScore;
    return Math.max(floor, getAbilityModifier(character.abilities, abilityScore));
  }
  const modifierMatch = normalized.match(/^(STR|DEX|CON|INT|WIS|CHA)\.modifier$/i);
  if (modifierMatch) {
    const abilityScore = modifierMatch[1]!.toUpperCase() as AbilityScore;
    return Math.max(0, getAbilityModifier(character.abilities, abilityScore));
  }
  return undefined;
};

const collectStructuredSpeciesFeatureGrants = (
  character: Character,
  items: StoredCompendiumItem[],
  desired: Map<string, DesiredExternalGrant>,
  featureItem: StoredCompendiumItem,
  speciesItem: StoredCompendiumItem,
  speciesEntityId: string | undefined,
  fallbackAbility?: AbilityScore
) => {
  for (const grant of getSpeciesStructuredSpellGrants(featureItem, character.level)) {
    const spellItem = findSpell(items, grant.spellReference);
    if (!spellItem) continue;
    const source: ExternalSpellGrantSource = {
      kind: 'species',
      sourceItemId: featureItem.id,
      sourceEntityId: speciesEntityId,
      sourceName: `${speciesItem.name} · ${featureItem.name}`,
      spellcastingAbility: grant.spellcastingAbility ?? fallbackAbility,
      canUseSpellSlots: grant.canUseSpellSlots,
      atWill: grant.atWill,
      noComponents: grant.noComponents,
      ignoreMaterialComponent: grant.ignoreMaterialComponent,
      ruleNotes: grant.notes
    };
    const freeCasts: DesiredFreeCast[] = [];
    const formulaUses = evaluateSpeciesUsesFormula(grant.usesFormula, character);
    const uses = grant.uses ?? formulaUses;
    if (!grant.atWill && spellLevel(spellItem) > 0 && uses !== undefined && uses > 0) {
      const sharedKey = grant.sharedResourceKey?.replace(/[^a-zA-Z0-9_-]/g, '_');
      const resourceId = sharedKey
        ? `species_free_cast_${featureItem.id}_${sharedKey}`
        : `species_free_cast_${featureItem.id}_${spellItem.id}`;
      freeCasts.push(freeCastGrant({
        id: `species:${featureItem.id}:${spellItem.id}`,
        source,
        resourceId,
        max: uses,
        recharge: rechargeFrom(grant.recharge),
        spellLevel: grant.castAtSpellLevel ?? spellLevel(spellItem),
        noComponents: grant.noComponents,
        ignoreMaterialComponent: grant.ignoreMaterialComponent,
        notes: [
          `${featureItem.name} concede uma conjuração sem spell slot.`,
          ...(grant.notes ?? [])
        ].join(' ')
      }));
    }
    putDesired(desired, spellItem, source, freeCasts);
  }
};

const collectSpeciesGrants = (
  character: Character,
  items: StoredCompendiumItem[],
  desired: Map<string, DesiredExternalGrant>
) => {
  const speciesLink = (character.compendiumLinks ?? []).find((link) =>
    link.appliedAs === 'species' && link.status === 'active'
  );
  if (!speciesLink) return;
  const speciesItem = items.find((item) => item.type === 'species' && item.id === speciesLink.itemId);
  if (!speciesItem) return;
  const requirements = getSpeciesChoiceRequirements(speciesItem, items, character.level);
  const choices = character.buildChoices?.speciesChoices ?? [];
  const replacementRequirements = getSpeciesSpellReplacementRequirements(speciesItem, items, character.level, choices);

  for (const featureItem of getSpeciesFeatureItems(speciesItem, items)) {
    const payload = asRecord(featureItem.normalizedJson);
    const levelGained = Math.max(1, Math.floor(asNumber(payload.levelGained) ?? 1));
    if (levelGained > character.level) continue;
    const requirement = requirements.find((candidate) => candidate.featureItemId === featureItem.id);
    const choice = requirement ? speciesChoiceForRequirement(choices, requirement) : undefined;
    if (requirement && (!choice?.optionId || !requirement.options.some((option) => option.id === choice.optionId))) continue;

    const configuredAbility = ability(payload.spellcastingAbility);
    const chosenAbility = choice?.spellcastingAbility
      ?? (asString(payload.spellcastingAbility) === 'sameAsFiendishLegacy'
        ? choices.find((candidate) => candidate.spellcastingAbility)?.spellcastingAbility
        : configuredAbility);
    const source: ExternalSpellGrantSource = {
      kind: 'species',
      sourceItemId: featureItem.id,
      sourceEntityId: speciesLink.appliedEntityId,
      sourceName: `${speciesItem.name} · ${featureItem.name}`,
      spellcastingAbility: chosenAbility
    };

    collectStructuredSpeciesFeatureGrants(
      character, items, desired, featureItem, speciesItem, speciesLink.appliedEntityId, chosenAbility
    );

    for (const reference of asStringArray(payload.spellRefs)) {
      putDesired(desired, findSpell(items, reference), source);
    }

    const replacementRequirement = replacementRequirements.find((entry) => entry.featureItemId === featureItem.id);
    if (requirement?.kind === 'spell' && choice?.optionId) {
      putDesired(desired, findSpell(items, replacementRequirement?.currentSpellItemId ?? choice.optionId), source);
    }

    const option = selectedSpeciesOption(featureItem, choice?.optionId);
    const refs: string[] = [...asStringArray(option.spellRefs)];
    for (const [key, value] of Object.entries(option)) {
      const match = key.match(/^level(\d+)SpellRefs$/i);
      if (!match || character.level < Number(match[1])) continue;
      refs.push(...asStringArray(value));
    }
    if (replacementRequirement && asString(option.cantripReplacementOnLongRest)) {
      const withoutInitial = refs.filter((reference) => findSpell(items, reference)?.id !== replacementRequirement.initialSpellItemId);
      refs.length = 0;
      refs.push(...withoutInitial, replacementRequirement.currentSpellItemId);
    }

    for (const reference of unique(refs)) {
      const spellItem = findSpell(items, reference);
      if (!spellItem) continue;
      const freeCasts: DesiredFreeCast[] = [];
      const perSpellText = asString(asRecord(option.freeCasts)[reference]);
      const parsedPerSpell = parseTextFreeCast(perSpellText, character);
      const featureEach = parseTextFreeCast(asString(payload.freeCastEachSpell), character);
      const free = parsedPerSpell ?? (spellLevel(spellItem) > 0 ? featureEach : undefined);
      if (free) {
        const id = `species:${featureItem.id}:${spellItem.id}`;
        freeCasts.push(freeCastGrant({
          id,
          source,
          resourceId: `species_free_cast_${featureItem.id}_${spellItem.id}`,
          max: free.max,
          recharge: free.recharge,
          spellLevel: spellLevel(spellItem),
          notes: `${featureItem.name} concede uma conjuração sem spell slot.`
        }));
      }
      putDesired(desired, spellItem, {
        ...source,
        canUseSpellSlots: asBoolean(payload.alsoCastWithSlots) ?? false
      }, freeCasts);
    }

    const selectedOptionFeature = requirement
      ? getSpeciesChoiceOptionFeatureItem(requirement, choice?.optionId, items)
      : undefined;
    if (selectedOptionFeature) {
      collectStructuredSpeciesFeatureGrants(
        character, items, desired, selectedOptionFeature, speciesItem, speciesLink.appliedEntityId, chosenAbility
      );
      const optionFeaturePayload = asRecord(selectedOptionFeature.normalizedJson);
      const optionFeatureAbility = ability(optionFeaturePayload.spellcastingAbility) ?? chosenAbility;
      for (const reference of asStringArray(optionFeaturePayload.spellRefs)) {
        putDesired(desired, findSpell(items, reference), {
          kind: 'species',
          sourceItemId: selectedOptionFeature.id,
          sourceEntityId: speciesLink.appliedEntityId,
          sourceName: `${speciesItem.name} · ${selectedOptionFeature.name}`,
          spellcastingAbility: optionFeatureAbility
        });
      }
    }
  }
};

const featChoiceAbility = (
  mechanics: Record<string, unknown>,
  choice: CharacterFeatChoice | undefined
): AbilityScore | undefined => {
  const direct = ability(mechanics.spellcastingAbility);
  if (direct) return direct;
  const configured = normalize(asString(mechanics.spellcastingAbility) ?? '');
  if (configured.includes('abilityincreasedbyfeat') || configured.includes('ability increased by feat')) {
    const selected = Object.entries(choice?.abilityScoreIncreases ?? {}).find(([, amount]) => (amount ?? 0) > 0)?.[0];
    return ability(selected);
  }
  return choice?.spellcastingAbility;
};

const collectFeatGrants = (
  character: Character,
  items: StoredCompendiumItem[],
  desired: Map<string, DesiredExternalGrant>
) => {
  for (const link of (character.compendiumLinks ?? []).filter((candidate) => candidate.appliedAs === 'feat' && candidate.status === 'active')) {
    const featItem = findCompendiumItemForCharacterLink(items, link);
    if (!featItem || featItem.type !== 'feat') continue;
    const choice = (character.featChoices ?? []).find((entry) => entry.featEntityId === link.appliedEntityId);
    const mechanics = asRecord(asRecord(featItem.normalizedJson).mechanics);
    const schema = getFeatChoiceSchema(featItem);
    const chosenAbility = choice?.spellcastingAbility ?? featChoiceAbility(mechanics, choice) ?? schema.fixedSpellcastingAbility;
    const source: ExternalSpellGrantSource = {
      kind: 'feat',
      sourceItemId: featItem.id,
      sourceEntityId: link.appliedEntityId,
      sourceName: featItem.name,
      spellcastingAbility: chosenAbility,
      canUseSpellSlots: true
    };

    const selectedRefs = unique(choice?.spellItemIds ?? []);
    const fixedRefs = unique([
      ...schema.alwaysPreparedSpellReferences,
      ...asStringArray(mechanics.cantripGrants),
      ...(asString(mechanics.spellGranted) ? [asString(mechanics.spellGranted)!] : [])
    ]);
    const directFreeCast = asRecord(mechanics.freeCast);
    const freeCastEach = asRecord(mechanics.freeCastEachSpell);
    const freeCastEachUses = asNumber(freeCastEach.uses);
    const structuredChoices = Array.isArray(mechanics.spellChoices) ? mechanics.spellChoices.map(asRecord) : [];
    const genericChoice = asRecord(mechanics.spellChoice);

    const spellGrants = Array.isArray(mechanics.spellGrants) ? mechanics.spellGrants.map(asRecord) : [];
    for (const grant of spellGrants) {
      const minimumLevel = Math.max(1, Math.floor(asNumber(grant.minimumCharacterLevel) ?? 1));
      if (character.level < minimumLevel) continue;
      const reference = asString(grant.spellId) ?? asString(grant.spellRef);
      if (!reference) continue;
      const spellItem = findSpell(items, reference);
      if (!spellItem) continue;
      const rowFreeCast = asRecord(grant.freeCast);
      const uses = Math.max(0, Math.floor(asNumber(rowFreeCast.uses) ?? 0));
      const freeCasts = uses ? [freeCastGrant({
        id: `feat:${link.appliedEntityId}:${spellItem.id}`,
        source,
        resourceId: `feat_free_cast_${link.appliedEntityId}_${spellItem.id}`,
        max: uses,
        recharge: rechargeFrom(rowFreeCast.recharge),
        spellLevel: spellLevel(spellItem),
        noComponents: noComponentsFrom(rowFreeCast),
        notes: `${featItem.name} concede uma conjuração sem spell slot.`
      })] : [];
      putDesired(desired, spellItem, {
        ...source,
        canUseSpellSlots: asBoolean(grant.canUseSpellSlots) ?? true
      }, freeCasts);
    }

    for (const reference of unique([...selectedRefs, ...fixedRefs])) {
      const spellItem = findSpell(items, reference);
      if (!spellItem) continue;
      const freeCasts: DesiredFreeCast[] = [];
      const level = spellLevel(spellItem);

      const directUses = Math.max(0, Math.floor(asNumber(directFreeCast.uses) ?? 0));
      const directSpell = asString(directFreeCast.spell);
      const directLevel = asNumber(directFreeCast.spellLevel);
      const directApplies = directUses > 0
        && (!directSpell || itemReferenceMatches(spellItem, directSpell))
        && (directLevel === undefined || directLevel === level);
      if (directApplies) {
        freeCasts.push(freeCastGrant({
          id: `feat:${link.appliedEntityId}:${spellItem.id}:direct`,
          source,
          resourceId: `feat_free_cast_${link.appliedEntityId}`,
          max: directUses,
          recharge: rechargeFrom(directFreeCast.recharge),
          spellLevel: level,
          noComponents: noComponentsFrom(directFreeCast),
          notes: `${featItem.name} concede uma conjuração sem spell slot.`
        }));
      }

      if (freeCastEachUses && level > 0) {
        freeCasts.push(freeCastGrant({
          id: `feat:${link.appliedEntityId}:${spellItem.id}:each`,
          source,
          resourceId: `feat_free_cast_${link.appliedEntityId}_${spellItem.id}`,
          max: Math.max(1, Math.floor(freeCastEachUses)),
          recharge: rechargeFrom(freeCastEach.recharge),
          spellLevel: level,
          noComponents: noComponentsFrom(freeCastEach),
          notes: `${featItem.name} concede uma conjuração gratuita desta magia.`
        }));
      }

      const structuredRow = structuredChoices.find((row) => asNumber(row.spellLevel) === level && Object.keys(asRecord(row.freeCast)).length);
      const structuredFree = asRecord(structuredRow?.freeCast);
      const structuredUses = Math.max(0, Math.floor(asNumber(structuredFree.uses) ?? 0));
      if (structuredUses) {
        freeCasts.push(freeCastGrant({
          id: `feat:${link.appliedEntityId}:${spellItem.id}:structured`,
          source,
          resourceId: `feat_free_cast_${link.appliedEntityId}_${spellItem.id}`,
          max: structuredUses,
          recharge: rechargeFrom(structuredFree.recharge),
          spellLevel: level,
          noComponents: noComponentsFrom(structuredFree),
          notes: `${featItem.name} concede uma conjuração sem spell slot.`
        }));
      }

      const genericFree = asRecord(genericChoice.freeCast);
      const genericUses = Math.max(0, Math.floor(asNumber(genericFree.uses) ?? 0));
      if (genericUses && selectedRefs.includes(reference)) {
        freeCasts.push(freeCastGrant({
          id: `feat:${link.appliedEntityId}:${spellItem.id}:generic`,
          source,
          resourceId: `feat_free_cast_${link.appliedEntityId}_${spellItem.id}`,
          max: genericUses,
          recharge: rechargeFrom(genericFree.recharge),
          spellLevel: level,
          noComponents: noComponentsFrom(genericFree),
          notes: `${featItem.name} concede uma conjuração sem spell slot.`
        }));
      }

      const quickRitual = asRecord(mechanics.quickRitual);
      if (Object.keys(quickRitual).length && selectedRefs.includes(reference)) {
        freeCasts.push(freeCastGrant({
          id: `feat:${link.appliedEntityId}:${spellItem.id}:quick-ritual`,
          source,
          resourceId: `feat_quick_ritual_${link.appliedEntityId}`,
          max: 1,
          recharge: rechargeFrom(quickRitual.recharge),
          spellLevel: level,
          notes: `${featItem.name} permite conjurar um dos rituais preparados no tempo normal sem gastar spell slot.`
        }));
      }

      putDesired(desired, spellItem, source, freeCasts);
    }
  }
};

const collectCustomGrants = (
  character: Character,
  items: StoredCompendiumItem[],
  desired: Map<string, DesiredExternalGrant>
) => {
  for (const binding of getCharacterRuleFeatures(character)) {
    for (const reference of binding.feature.customRules?.grantedSpellItemIds ?? []) {
      const spellItem = findSpell(items, reference);
      if (!spellItem) continue;
      const source: ExternalSpellGrantSource = {
        kind: binding.ownerKind,
        sourceItemId: binding.feature.id,
        sourceEntityId: binding.ownerId,
        sourceName: binding.ownerName,
        canUseSpellSlots: spellLevel(spellItem) > 0
      };
      putDesired(desired, spellItem, source);
    }
  }
};

const desiredExternalGrants = (character: Character, items: StoredCompendiumItem[]) => {
  const desired = new Map<string, DesiredExternalGrant>();
  collectSpeciesGrants(character, items, desired);
  collectFeatGrants(character, items, desired);
  collectCustomGrants(character, items, desired);
  return desired;
};

const sourceSignature = (source: ExternalSpellGrantSource): string => [
  sourceKey(source),
  source.sourceName ?? '',
  source.spellcastingAbility ?? '',
  source.canUseSpellSlots === undefined ? '' : String(source.canUseSpellSlots),
  source.atWill === undefined ? '' : String(source.atWill),
  source.noComponents === undefined ? '' : String(source.noComponents),
  source.ignoreMaterialComponent === undefined ? '' : String(source.ignoreMaterialComponent),
  ...(source.ruleNotes ?? [])
].join('|');
const freeCastSignature = (grant: SpellFreeCastGrant): string => [
  grant.id,
  grant.resourceId,
  grant.sourceKind,
  grant.sourceItemId,
  grant.sourceEntityId ?? '',
  grant.sourceName ?? '',
  grant.castAtSpellLevel ?? '',
  grant.spellcastingAbility ?? '',
  grant.noComponents === undefined ? '' : String(grant.noComponents),
  grant.ignoreMaterialComponent === undefined ? '' : String(grant.ignoreMaterialComponent),
  grant.notes ?? ''
].join('|');
const sameSourceSet = (left: ExternalSpellGrantSource[] | undefined, right: ExternalSpellGrantSource[]): boolean => {
  const a = new Set((left ?? []).map(sourceSignature));
  const b = new Set(right.map(sourceSignature));
  return a.size === b.size && Array.from(a).every((key) => b.has(key));
};
const sameFreeCastSet = (left: SpellFreeCastGrant[] | undefined, right: SpellFreeCastGrant[]): boolean => {
  const a = new Set((left ?? []).map(freeCastSignature));
  const b = new Set(right.map(freeCastSignature));
  return a.size === b.size && Array.from(a).every((key) => b.has(key));
};

const removeSpellEntities = (character: Character, entityIds: Set<string>): Character => ({
  ...character,
  spells: character.spells.filter((spell) => !entityIds.has(spell.id)),
  compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
    link.appliedAs === 'spell' && entityIds.has(link.appliedEntityId) && link.status !== 'removed'
      ? { ...link, status: 'removed' as const }
      : link
  )
});

export interface ExternalSpellGrantReconciliationResult {
  character: Character;
  addedSpellCount: number;
  removedSpellCount: number;
  updatedSpellCount: number;
  issues: RuleValidationIssue[];
}

/**
 * Reconciles spells granted outside normal class/subclass spell selection.
 * This includes species magic, feat magic, and custom feat/feature direct grants.
 * Invocation grants remain owned by the dedicated invocation reconciler.
 */
export const reconcileExternalSpellGrants = (
  character: Character,
  items: StoredCompendiumItem[]
): ExternalSpellGrantReconciliationResult => {
  let next = character;
  const desired = desiredExternalGrants(next, items);
  const issues: RuleValidationIssue[] = [];
  let addedSpellCount = 0;
  let removedSpellCount = 0;
  let updatedSpellCount = 0;

  const desiredResourceIds = new Set(Array.from(desired.values()).flatMap((entry) => entry.freeCasts.map((grant) => grant.resourceId)));
  const desiredResources = Array.from(new Map(
    Array.from(desired.values()).flatMap((entry) => entry.freeCasts).map((grant) => {
      const existing = next.resources.find((resource) => resource.id === grant.resourceId);
      const resource: ResourcePool = {
        id: grant.resourceId,
        name: `${grant.sourceName ?? 'Magia concedida'} · ${entryNameForGrant(desired, grant)}`,
        max: grant.max,
        current: existing ? Math.min(grant.max, existing.current) : grant.max,
        recharge: grant.recharge,
        source: undefined,
        notes: grant.notes,
        sourceSpellGrantId: grant.id
      };
      return [resource.id, resource] as const;
    })
  ).values());
  next = {
    ...next,
    resources: [
      ...next.resources.filter((resource) => !resource.sourceSpellGrantId || desiredResourceIds.has(resource.id)),
      ...desiredResources.filter((resource) => !next.resources.some((existing) => existing.id === resource.id))
    ].map((resource) => desiredResources.find((desiredResource) => desiredResource.id === resource.id) ?? resource)
  };

  const staleOnly = new Set<string>();
  next = {
    ...next,
    spells: next.spells.map((spell) => {
      if (!(spell.externalSpellGrantSources?.length)) return spell;
      const link = (next.compendiumLinks ?? []).find((candidate) => candidate.appliedAs === 'spell' && candidate.appliedEntityId === spell.id && candidate.status !== 'removed');
      const linkedSpellItem = link
        ? findCompendiumItemForCharacterLink(items, link)
        : undefined;
      const desiredEntry = linkedSpellItem ? desired.get(linkedSpellItem.id) : undefined;
      if (!desiredEntry) {
        if (spell.externalSpellGrantOnly && !(spell.automaticSpellAccessSources?.length)) {
          staleOnly.add(spell.id);
          return spell;
        }
        updatedSpellCount += 1;
        const {
          externalSpellGrantSources: _sources,
          externalSpellGrantOnly: _only,
          externalSpellGrantPreparedOnly: _preparedOnly,
          freeCastGrants: _free,
          ...rest
        } = spell;
        return {
          ...rest,
          automaticSpellAccessOnly: spell.externalSpellGrantOnly && spell.automaticSpellAccessSources?.length
            ? true
            : spell.automaticSpellAccessOnly,
          prepared: spell.externalSpellGrantPreparedOnly && !(spell.automaticSpellAccessSources?.length) ? false : spell.prepared
        } as Spell;
      }
      if (sameSourceSet(spell.externalSpellGrantSources, desiredEntry.sources) && sameFreeCastSet(spell.freeCastGrants, desiredEntry.freeCasts)) return spell;
      updatedSpellCount += 1;
      return { ...spell, externalSpellGrantSources: desiredEntry.sources, freeCastGrants: desiredEntry.freeCasts, externalSpellGrantPreparedOnly: spell.externalSpellGrantPreparedOnly ?? !spell.prepared, prepared: true };
    })
  };
  if (staleOnly.size) {
    next = removeSpellEntities(next, staleOnly);
    removedSpellCount += staleOnly.size;
  }

  for (const desiredEntry of desired.values()) {
    const links = (next.compendiumLinks ?? []).filter((link) =>
      link.appliedAs === 'spell' &&
      link.status !== 'removed' &&
      characterLinkMatchesCompendiumItem(items, link, desiredEntry.spellItem)
    );
    const existing = links.map((link) => next.spells.find((spell) => spell.id === link.appliedEntityId)).find(Boolean) as Spell | undefined;
    if (existing) {
      const legacyGrantOnly = Boolean(
        (existing.grantedByFeatEntityId && desiredEntry.sources.some((source) => source.kind === 'feat' && source.sourceEntityId === existing.grantedByFeatEntityId))
        || (existing.grantedByFeatureEntityId && desiredEntry.sources.some((source) => source.kind === 'feature' && source.sourceEntityId === existing.grantedByFeatureEntityId))
      );
      const primaryAbility = desiredEntry.sources.map((source) => source.spellcastingAbility).find(Boolean);
      next = {
        ...next,
        spells: next.spells.map((spell) => spell.id === existing.id ? {
          ...spell,
          spellcastingAbility: spell.spellcastingClassId ? spell.spellcastingAbility : primaryAbility ?? spell.spellcastingAbility,
          externalSpellGrantSources: desiredEntry.sources,
          externalSpellGrantOnly: spell.externalSpellGrantOnly ?? legacyGrantOnly,
          externalSpellGrantPreparedOnly: spell.externalSpellGrantPreparedOnly ?? !spell.prepared,
          freeCastGrants: desiredEntry.freeCasts,
          prepared: true
        } : spell)
      };
      continue;
    }

    const applied = applyCompendiumItemToCharacter(next, explicitlyApproved(desiredEntry.spellItem));
    if (!applied.ok) {
      issues.push(...applied.issues);
      continue;
    }
    const beforeIds = new Set(next.spells.map((spell) => spell.id));
    next = applied.character;
    const added = next.spells.find((spell) => !beforeIds.has(spell.id));
    if (!added) continue;
    const primary = desiredEntry.sources[0];
    next = {
      ...next,
      spells: next.spells.map((spell) => spell.id === added.id ? {
        ...spell,
        spellcastingAbility: primary?.spellcastingAbility ?? spell.spellcastingAbility,
        spellcastingClassName: primary?.sourceName ?? spell.spellcastingClassName,
        externalSpellGrantSources: desiredEntry.sources,
        externalSpellGrantOnly: true,
        externalSpellGrantPreparedOnly: true,
        freeCastGrants: desiredEntry.freeCasts,
        grantedByFeatEntityId: primary?.kind === 'feat' ? primary.sourceEntityId : spell.grantedByFeatEntityId,
        grantedByFeatureEntityId: primary?.kind === 'feature' ? primary.sourceEntityId : spell.grantedByFeatureEntityId,
        prepared: true
      } : spell)
    };
    addedSpellCount += 1;
  }

  return { character: next, addedSpellCount, removedSpellCount, updatedSpellCount, issues };
};

const entryNameForGrant = (
  desired: Map<string, DesiredExternalGrant>,
  grant: SpellFreeCastGrant
): string => Array.from(desired.values()).find((entry) => entry.freeCasts.some((candidate) => candidate.id === grant.id))?.spellItem.name ?? 'magia';
