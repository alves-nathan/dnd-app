import type {
  AbilityScore,
  Character,
  CharacterEldritchInvocationChoice,
  ChainMasterDamageType,
  LifedrinkerDamageType,
  PactChainFamiliarVariant,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createId } from '../utils/id';
import { getInvocationSpellGrant, invocationSpellResourceId } from './invocationSpellGrants';
import { isInvestmentOfTheChainMasterInvocation, reconcilePactChainCompanion } from './pactChainCompanionRules';
import { getCompendiumChoiceDescription, isOriginFeatItem } from './creationData';
import { spellItemClasses } from './spellcastingRules';
import { reconcileWarlockSpecializedInvocations } from './warlockSpecializedInvocations';
import {
  findEldritchInvocationById,
  isEldritchInvocationItem
} from './eldritchInvocationRules';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();
const error = (code: string, message: string): RuleValidationIssue => ({ severity: 'error', code, message });
const unique = (values: string[]): string[] => Array.from(new Set(values));

const invocationIdentity = (item?: StoredCompendiumItem): string => {
  if (!item) return '';
  const payload = asRecord(item.normalizedJson);
  return normalize(asString(payload.engineKey) ?? item.name);
};

const isInvocation = (item: StoredCompendiumItem | undefined, engineKey: string, name: string): boolean => {
  if (!item || !isEldritchInvocationItem(item)) return false;
  const identity = invocationIdentity(item);
  return identity === normalize(engineKey) || normalize(item.name) === normalize(name);
};

export const invocationChoiceKey = (invocationItemId: string, instanceIndex = 0): string =>
  `${invocationItemId}::${instanceIndex}`;

export const emptyEldritchInvocationChoice = (
  invocationItemId: string,
  instanceIndex = 0
): CharacterEldritchInvocationChoice => ({
  id: createId('invocationChoice'),
  invocationItemId,
  instanceIndex,
  cantripItemIds: [],
  ritualSpellItemIds: []
});

export const isPactOfTheTomeInvocation = (item?: StoredCompendiumItem): boolean =>
  isInvocation(item, 'warlock.pact-of-the-tome', 'Pact of the Tome');
export const isAgonizingBlastInvocation = (item?: StoredCompendiumItem): boolean =>
  isInvocation(item, 'warlock.agonizing-blast', 'Agonizing Blast');
export const isEldritchSpearInvocation = (item?: StoredCompendiumItem): boolean =>
  isInvocation(item, 'warlock.eldritch-spear', 'Eldritch Spear');
export const isRepellingBlastInvocation = (item?: StoredCompendiumItem): boolean =>
  isInvocation(item, 'warlock.repelling-blast', 'Repelling Blast');
export const isLessonsOfTheFirstOnesInvocation = (item?: StoredCompendiumItem): boolean =>
  isInvocation(item, 'warlock.lessons-of-the-first-ones', 'Lessons of the First Ones');
export const isPactOfTheChainInvocation = (item?: StoredCompendiumItem): boolean =>
  isInvocation(item, 'warlock.pact-of-the-chain', 'Pact of the Chain');
export const isEldritchSmiteInvocation = (item?: StoredCompendiumItem): boolean =>
  isInvocation(item, 'warlock.eldritch-smite', 'Eldritch Smite');
export const isLifedrinkerInvocation = (item?: StoredCompendiumItem): boolean =>
  isInvocation(item, 'warlock.lifedrinker', 'Lifedrinker');

export const invocationNeedsInternalChoice = (item?: StoredCompendiumItem): boolean =>
  isPactOfTheTomeInvocation(item)
  || isAgonizingBlastInvocation(item)
  || isEldritchSpearInvocation(item)
  || isRepellingBlastInvocation(item)
  || isLessonsOfTheFirstOnesInvocation(item)
  || isPactOfTheChainInvocation(item)
  || isInvestmentOfTheChainMasterInvocation(item)
  || isLifedrinkerInvocation(item);

export const isRitualSpellItem = (item: StoredCompendiumItem): boolean => {
  if (item.type !== 'spell') return false;
  const payload = asRecord(item.normalizedJson);
  const castingTime = normalize(asString(payload.castingTime) ?? '');
  return asBoolean(payload.ritual) === true || castingTime.includes('ritual');
};

const enabledItems = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[],
  type: StoredCompendiumItem['type']
): StoredCompendiumItem[] => {
  const enabled = new Set(enabledSourceIds);
  return items.filter((item) => item.type === type && item.status !== 'disabled' && enabled.has(item.sourceId));
};

export const getPactTomeCantripCandidates = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): StoredCompendiumItem[] => enabledItems(items, enabledSourceIds, 'spell')
  .filter((item) => (asNumber(asRecord(item.normalizedJson).level) ?? 0) === 0)
  .sort((left, right) => left.name.localeCompare(right.name));

export const getPactTomeRitualCandidates = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): StoredCompendiumItem[] => enabledItems(items, enabledSourceIds, 'spell')
  .filter((item) => (asNumber(asRecord(item.normalizedJson).level) ?? 0) === 1)
  .filter(isRitualSpellItem)
  .sort((left, right) => left.name.localeCompare(right.name));

const spellHasDamage = (item: StoredCompendiumItem): boolean => {
  const payload = asRecord(item.normalizedJson);
  return Boolean(asString(payload.damageFormula) ?? asString(payload.damage) ?? asString(payload.formula));
};

const spellRangeFeet = (item: StoredCompendiumItem): number | undefined => {
  const range = asString(asRecord(item.normalizedJson).range) ?? '';
  const match = range.match(/(\d+)\s*(?:ft|feet|foot|pes|pés)/i);
  return match?.[1] ? Number(match[1]) : undefined;
};

const isWarlockCantrip = (item: StoredCompendiumItem): boolean =>
  item.type === 'spell'
  && (asNumber(asRecord(item.normalizedJson).level) ?? 0) === 0
  && spellItemClasses(item).some((className) => normalize(className) === 'warlock');

export const getInvocationTargetCantripCandidates = (
  invocation: StoredCompendiumItem | undefined,
  items: StoredCompendiumItem[],
  enabledSourceIds: string[],
  knownCantripItemIds?: string[]
): StoredCompendiumItem[] => {
  const known = knownCantripItemIds ? new Set(knownCantripItemIds) : undefined;
  return enabledItems(items, enabledSourceIds, 'spell')
    .filter(isWarlockCantrip)
    .filter(spellHasDamage)
    .filter((item) => !known || known.has(item.id))
    .filter((item) => !isEldritchSpearInvocation(invocation) || (spellRangeFeet(item) ?? 0) >= 10)
    .filter((item) => !isRepellingBlastInvocation(invocation) || asBoolean(asRecord(item.normalizedJson).requiresAttackRoll) === true)
    .sort((left, right) => left.name.localeCompare(right.name));
};

export const getLessonsOriginFeatCandidates = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): StoredCompendiumItem[] => enabledItems(items, enabledSourceIds, 'feat')
  .filter(isOriginFeatItem)
  .sort((left, right) => left.name.localeCompare(right.name));

const STANDARD_FAMILIAR_NAMES = new Set([
  'bat', 'cat', 'crab', 'frog', 'hawk', 'lizard', 'octopus', 'owl', 'poisonous snake',
  'venomous snake', 'fish', 'rat', 'raven', 'sea horse', 'spider', 'weasel'
]);
const SPECIAL_FAMILIAR_NAMES = new Set([
  'imp', 'pseudodragon', 'quasit', 'skeleton', 'sphinx of wonder', 'sprite'
]);

export interface PactChainFamiliarCandidate {
  item: StoredCompendiumItem;
  variant: PactChainFamiliarVariant;
  description: string;
}

export const getPactChainFamiliarCandidates = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): PactChainFamiliarCandidate[] => enabledItems(items, enabledSourceIds, 'creatureStatBlock')
  .flatMap((item): PactChainFamiliarCandidate[] => {
    const name = normalize(item.name);
    const variant = SPECIAL_FAMILIAR_NAMES.has(name)
      ? 'special'
      : STANDARD_FAMILIAR_NAMES.has(name)
        ? 'standard'
        : undefined;
    return variant ? [{ item, variant, description: getCompendiumChoiceDescription(item) }] : [];
  })
  .sort((left, right) => {
    if (left.variant !== right.variant) return left.variant === 'special' ? -1 : 1;
    return left.item.name.localeCompare(right.item.name);
  });

const choiceFor = (
  choices: CharacterEldritchInvocationChoice[],
  invocationItemId: string,
  instanceIndex: number
): CharacterEldritchInvocationChoice | undefined => choices.find(
  (choice) => choice.invocationItemId === invocationItemId && choice.instanceIndex === instanceIndex
);

export interface EldritchInvocationChoiceValidationContext {
  selectedOriginFeatItemIds?: string[];
  knownWarlockCantripItemIds?: string[];
  requireKnownWarlockCantrip?: boolean;
}

export const validateEldritchInvocationChoices = (
  selectedCounts: Record<string, number>,
  choices: CharacterEldritchInvocationChoice[],
  items: StoredCompendiumItem[],
  enabledSourceIds: string[],
  context: EldritchInvocationChoiceValidationContext = {}
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  const cantripCandidates = new Set(getPactTomeCantripCandidates(items, enabledSourceIds).map((item) => item.id));
  const ritualCandidates = new Set(getPactTomeRitualCandidates(items, enabledSourceIds).map((item) => item.id));
  const originFeatCandidates = new Set(getLessonsOriginFeatCandidates(items, enabledSourceIds).map((item) => item.id));
  const familiarCandidates = new Map(getPactChainFamiliarCandidates(items, enabledSourceIds).map((entry) => [entry.item.id, entry.variant]));
  const selectedChoiceKeys = new Set<string>();
  const selectedLessonFeats = new Set(context.selectedOriginFeatItemIds ?? []);
  const targetCantripsByInvocation = new Map<string, Set<string>>();

  for (const [itemId, rawCount] of Object.entries(selectedCounts)) {
    const count = Math.max(0, Math.floor(rawCount));
    if (!count) continue;
    const invocation = findEldritchInvocationById(items, itemId);
    if (!invocation || !invocationNeedsInternalChoice(invocation)) continue;

    for (let instanceIndex = 0; instanceIndex < count; instanceIndex += 1) {
      selectedChoiceKeys.add(invocationChoiceKey(itemId, instanceIndex));
      const choice = choiceFor(choices, itemId, instanceIndex);
      if (!choice) {
        issues.push(error('ELDRITCH_INVOCATION_CHOICE_REQUIRED', `${invocation.name} exige uma escolha interna antes de continuar.`));
        continue;
      }

      if (isPactOfTheTomeInvocation(invocation)) {
        const cantripIds = unique(choice.cantripItemIds ?? []);
        const ritualIds = unique(choice.ritualSpellItemIds ?? []);
        if (cantripIds.length !== 3) issues.push(error('PACT_TOME_CANTRIP_COUNT', `Pact of the Tome exige exatamente 3 cantrips; selecionados: ${cantripIds.length}.`));
        if (ritualIds.length !== 2) issues.push(error('PACT_TOME_RITUAL_COUNT', `Pact of the Tome exige exatamente 2 magias rituais de nível 1; selecionadas: ${ritualIds.length}.`));
        for (const spellItemId of cantripIds) {
          if (!cantripCandidates.has(spellItemId)) issues.push(error('PACT_TOME_CANTRIP_INVALID', `${items.find((candidate) => candidate.id === spellItemId)?.name ?? spellItemId} não é um cantrip disponível para Pact of the Tome.`));
        }
        for (const spellItemId of ritualIds) {
          if (!ritualCandidates.has(spellItemId)) issues.push(error('PACT_TOME_RITUAL_INVALID', `${items.find((candidate) => candidate.id === spellItemId)?.name ?? spellItemId} não é uma magia ritual de nível 1 disponível.`));
        }
      }

      if (isAgonizingBlastInvocation(invocation) || isEldritchSpearInvocation(invocation) || isRepellingBlastInvocation(invocation)) {
        const candidates = new Set(getInvocationTargetCantripCandidates(
          invocation,
          items,
          enabledSourceIds,
          context.requireKnownWarlockCantrip ? context.knownWarlockCantripItemIds : undefined
        ).map((item) => item.id));
        const targetId = choice.targetCantripItemId;
        if (!targetId) {
          issues.push(error('ELDRITCH_INVOCATION_CANTRIP_REQUIRED', `${invocation.name} exige escolher um cantrip de Warlock elegível.`));
        } else if (!candidates.has(targetId)) {
          issues.push(error('ELDRITCH_INVOCATION_CANTRIP_INVALID', `${items.find((candidate) => candidate.id === targetId)?.name ?? targetId} não atende aos requisitos de ${invocation.name}.`));
        } else {
          const used = targetCantripsByInvocation.get(itemId) ?? new Set<string>();
          if (used.has(targetId)) issues.push(error('ELDRITCH_INVOCATION_CANTRIP_DUPLICATE', `${invocation.name} foi repetida com o mesmo cantrip. Escolha um cantrip diferente para cada cópia.`));
          used.add(targetId);
          targetCantripsByInvocation.set(itemId, used);
        }
      }

      if (isLessonsOfTheFirstOnesInvocation(invocation)) {
        const featId = choice.originFeatItemId;
        if (!featId) issues.push(error('LESSONS_ORIGIN_FEAT_REQUIRED', 'Lessons of the First Ones exige escolher um Origin Feat.'));
        else if (!originFeatCandidates.has(featId)) issues.push(error('LESSONS_ORIGIN_FEAT_INVALID', `${items.find((candidate) => candidate.id === featId)?.name ?? featId} não é um Origin Feat elegível.`));
        else if (selectedLessonFeats.has(featId)) issues.push(error('LESSONS_ORIGIN_FEAT_DUPLICATE', 'Cada cópia de Lessons of the First Ones deve conceder um Origin Feat diferente, inclusive do Origin Feat principal.'));
        else selectedLessonFeats.add(featId);
      }

      if (isPactOfTheChainInvocation(invocation)) {
        const familiarId = choice.familiarCreatureItemId;
        const expectedVariant = familiarId ? familiarCandidates.get(familiarId) : undefined;
        if (!familiarId || !expectedVariant) issues.push(error('PACT_CHAIN_FAMILIAR_REQUIRED', 'Pact of the Chain exige escolher uma forma de familiar disponível.'));
        else if (choice.familiarVariant !== expectedVariant) issues.push(error('PACT_CHAIN_FAMILIAR_VARIANT_INVALID', 'A categoria da forma familiar selecionada não corresponde à opção disponível.'));
      }

      if (isInvestmentOfTheChainMasterInvocation(invocation)) {
        if (choice.chainMasterMovementMode !== 'fly' && choice.chainMasterMovementMode !== 'swim') {
          issues.push(error('CHAIN_MASTER_MOVEMENT_REQUIRED', 'Investment of the Chain Master exige escolher deslocamento de voo ou natação para o familiar.'));
        }
        if (!choice.chainMasterDamageType || !(['necrotic', 'radiant'] as ChainMasterDamageType[]).includes(choice.chainMasterDamageType)) {
          issues.push(error('CHAIN_MASTER_DAMAGE_TYPE_REQUIRED', 'Investment of the Chain Master exige escolher o tipo usado na simulação atual: Necrótico ou Radiante.'));
        }
      }

      if (isLifedrinkerInvocation(invocation)) {
        const damageType = choice.lifedrinkerDamageType;
        if (!damageType || !(['necrotic', 'psychic', 'radiant'] as LifedrinkerDamageType[]).includes(damageType)) {
          issues.push(error('LIFEDRINKER_DAMAGE_TYPE_REQUIRED', 'Lifedrinker exige escolher dano Necrótico, Psíquico ou Radiante.'));
        }
      }
    }
  }

  for (const choice of choices) {
    if (!selectedChoiceKeys.has(invocationChoiceKey(choice.invocationItemId, choice.instanceIndex))) {
      issues.push(error('ELDRITCH_INVOCATION_ORPHAN_CHOICE', 'Existe uma escolha interna vinculada a uma Eldritch Invocation que não está selecionada.'));
    }
  }
  return issues;
};

const applicableItem = (item: StoredCompendiumItem): StoredCompendiumItem => item.status === 'validated'
  ? item
  : { ...item, status: 'validated' };

const warlockClass = (character: Character) => character.classes.find((entry) => normalize(entry.name) === 'warlock');

const removePreviousInvocationGrants = (character: Character): Character => {
  const removedSpellIds = new Set(character.spells.filter((spell) => Boolean(spell.grantedByInvocationItemId && !spell.grantedByFeatEntityId)).map((spell) => spell.id));
  const removedFeatIds = new Set(character.feats.filter((feat) => Boolean(feat.grantedByInvocationItemId && !feat.grantedByFeatEntityId)).map((feat) => feat.id));
  return {
    ...character,
    spells: character.spells.filter((spell) => !removedSpellIds.has(spell.id)),
    feats: character.feats.filter((feat) => !removedFeatIds.has(feat.id)),
    resources: character.resources.filter((resource) => !resource.sourceInvocationItemId || Boolean(resource.sourceFeatEntityId)),
    featChoices: (character.featChoices ?? []).filter((choice) => !removedFeatIds.has(choice.featEntityId)),
    compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
      ((removedSpellIds.has(link.appliedEntityId) && link.appliedAs === 'spell') || (removedFeatIds.has(link.appliedEntityId) && link.appliedAs === 'feat')) && link.status === 'active'
        ? { ...link, status: 'removed' as const }
        : link
    )
  };
};

export interface ApplyEldritchInvocationChoicesResult {
  character: Character;
  appliedSpellCount: number;
  appliedFeatCount: number;
  missingSpellItemIds: string[];
  missingFeatItemIds: string[];
}

export interface ApplyEldritchInvocationChoiceGrantSetOptions {
  spellcastingClassId?: string;
  spellcastingClassName?: string;
  spellcastingAbility?: AbilityScore;
  grantedByFeatEntityId?: string;
  linkNote?: string;
  resourceIdPrefix?: string;
}

const withLinkNote = (character: Character, linkId: string | undefined, note: string | undefined): Character =>
  !linkId || !note
    ? character
    : {
        ...character,
        compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
          link.id === linkId ? { ...link, notes: [link.notes, note].filter(Boolean).join(' · ') } : link
        )
      };

const safeResourceToken = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * Applies the mechanical grants for an already-selected invocation set without
 * owning the Warlock progression state. This is shared by normal Warlock
 * invocations and feat-granted invocations such as Eldritch Adept.
 */
export const applyEldritchInvocationChoiceGrantSet = (
  character: Character,
  choices: CharacterEldritchInvocationChoice[],
  selectedCounts: Record<string, number>,
  items: StoredCompendiumItem[],
  options: ApplyEldritchInvocationChoiceGrantSetOptions = {}
): ApplyEldritchInvocationChoicesResult => {
  const activeChoices = choices.filter((choice) => {
    const invocation = findEldritchInvocationById(items, choice.invocationItemId);
    return (selectedCounts[choice.invocationItemId] ?? 0) > choice.instanceIndex && invocationNeedsInternalChoice(invocation);
  });
  const warlock = warlockClass(character);
  let next = character;
  let appliedSpellCount = 0;
  let appliedFeatCount = 0;
  const missingSpellItemIds: string[] = [];
  const missingFeatItemIds: string[] = [];

  const resourceIdFor = (invocationItemId: string): string => options.resourceIdPrefix
    ? `${options.resourceIdPrefix}_${safeResourceToken(invocationItemId)}`
    : invocationSpellResourceId(invocationItemId);

  const applyInvocationSpell = (
    spellItemId: string,
    invocationItemId: string,
    ritualOnly: boolean,
    freeCast = false,
    grantOptions: { selfOnly?: boolean; usage?: 'atWill' | 'oncePerLongRest'; notes?: string } = {}
  ) => {
    const spellItem = items.find((item) => item.id === spellItemId && item.type === 'spell');
    if (!spellItem) { missingSpellItemIds.push(spellItemId); return; }
    const resourceId = grantOptions.usage === 'oncePerLongRest' ? resourceIdFor(invocationItemId) : undefined;
    if (resourceId && !next.resources.some((resource) => resource.id === resourceId)) {
      next = {
        ...next,
        resources: [...next.resources, {
          id: resourceId,
          name: `${spellItem.name} · invocation`,
          max: 1,
          current: 1,
          recharge: 'longRest',
          source: spellItem.rawJson.source,
          sourceInvocationItemId: invocationItemId,
          sourceFeatEntityId: options.grantedByFeatEntityId,
          notes: grantOptions.notes
        }]
      };
    }
    const beforeSpellIds = new Set(next.spells.map((spell) => spell.id));
    const result = applyCompendiumItemToCharacter(next, applicableItem(spellItem));
    if (!result.ok) return;
    next = withLinkNote(result.character, result.link?.id, options.linkNote);
    const added = next.spells.find((spell) => !beforeSpellIds.has(spell.id));
    if (!added) return;
    next = {
      ...next,
      spells: next.spells.map((spell) => spell.id === added.id
        ? {
            ...spell,
            spellcastingClassId: options.spellcastingClassId ?? warlock?.id,
            spellcastingClassName: options.spellcastingClassName ?? warlock?.name ?? (options.grantedByFeatEntityId ? 'Eldritch Adept' : 'Warlock'),
            spellcastingAbility: options.spellcastingAbility ?? spell.spellcastingAbility,
            grantedByInvocationItemId: invocationItemId,
            grantedByFeatEntityId: options.grantedByFeatEntityId ?? spell.grantedByFeatEntityId,
            ritualOnly,
            freeCast,
            invocationSelfOnly: grantOptions.selfOnly,
            invocationUsage: grantOptions.usage,
            consumes: resourceId ? [{ resourceId, amount: 1, label: `${spellItem.name} · uso da invocation` }] : spell.consumes,
            description: [spell.description, grantOptions.notes].filter(Boolean).join(' '),
            prepared: true
          }
        : spell)
    };
    appliedSpellCount += 1;
  };

  for (const choice of activeChoices) {
    const invocation = findEldritchInvocationById(items, choice.invocationItemId);
    if (isPactOfTheTomeInvocation(invocation)) {
      const ritualIds = new Set(choice.ritualSpellItemIds ?? []);
      for (const spellItemId of unique([...(choice.cantripItemIds ?? []), ...(choice.ritualSpellItemIds ?? [])])) {
        applyInvocationSpell(spellItemId, choice.invocationItemId, ritualIds.has(spellItemId));
      }
    }

    if (isPactOfTheChainInvocation(invocation)) {
      const findFamiliar = items.find((item) => item.type === 'spell' && normalize(item.name) === 'find familiar');
      if (findFamiliar) applyInvocationSpell(findFamiliar.id, choice.invocationItemId, false, true);
    }

    if (isLessonsOfTheFirstOnesInvocation(invocation) && choice.originFeatItemId) {
      const featItem = items.find((item) => item.id === choice.originFeatItemId && item.type === 'feat');
      if (!featItem) { missingFeatItemIds.push(choice.originFeatItemId); continue; }
      const beforeFeatIds = new Set(next.feats.map((feat) => feat.id));
      const result = applyCompendiumItemToCharacter(next, applicableItem(featItem));
      if (!result.ok) continue;
      next = withLinkNote(result.character, result.link?.id, options.linkNote);
      const added = next.feats.find((feat) => !beforeFeatIds.has(feat.id));
      if (!added) continue;
      next = {
        ...next,
        feats: next.feats.map((feat) => feat.id === added.id ? {
          ...feat,
          grantedByInvocationItemId: choice.invocationItemId,
          grantedByFeatEntityId: options.grantedByFeatEntityId
        } : feat)
      };
      appliedFeatCount += 1;
    }
  }

  for (const [invocationItemId, count] of Object.entries(selectedCounts)) {
    if (count <= 0) continue;
    const invocation = findEldritchInvocationById(items, invocationItemId);
    const grant = getInvocationSpellGrant(invocation);
    if (!grant) continue;
    const spellItem = items.find((item) => item.type === 'spell' && normalize(item.name) === normalize(grant.spellName));
    if (!spellItem) {
      missingSpellItemIds.push(grant.spellName);
      continue;
    }
    applyInvocationSpell(spellItem.id, invocationItemId, false, true, {
      selfOnly: grant.selfOnly,
      usage: grant.usage,
      notes: grant.notes
    });
  }

  next = reconcilePactChainCompanion(next, activeChoices, selectedCounts, items, options.grantedByFeatEntityId);
  next = reconcileWarlockSpecializedInvocations(next, items);

  return { character: next, appliedSpellCount, appliedFeatCount, missingSpellItemIds, missingFeatItemIds };
};

export const applyEldritchInvocationChoices = (
  character: Character,
  choices: CharacterEldritchInvocationChoice[],
  items: StoredCompendiumItem[]
): ApplyEldritchInvocationChoicesResult => {
  let next = removePreviousInvocationGrants(character);
  const currentCounts = next.buildChoices?.eldritchInvocationCounts ?? {};
  const activeChoices = choices.filter((choice) => {
    const invocation = findEldritchInvocationById(items, choice.invocationItemId);
    return (currentCounts[choice.invocationItemId] ?? 0) > choice.instanceIndex && invocationNeedsInternalChoice(invocation);
  });

  next = {
    ...next,
    buildChoices: {
      ...(next.buildChoices ?? {
        speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: []
      }),
      eldritchInvocationChoices: activeChoices
    }
  };

  return applyEldritchInvocationChoiceGrantSet(next, activeChoices, currentCounts, items);
};
