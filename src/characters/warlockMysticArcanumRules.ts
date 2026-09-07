import type {
  Character,
  CharacterClassFeatureChoice,
  CharacterMysticArcanumChoice,
  CharacterSubclassChoice,
  RuleValidationIssue,
  Spell
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { findCompendiumItemByReference, getProgressionFeatureReferences } from '../compendium/classProgression';
import {
  characterLinkMatchesCompendiumItem,
  findCompendiumItemForCharacterLink
} from '../compendium/characterLinkIdentity';
import { itemReferenceMatches } from './creationData';
import { resolveCharacterSpellAccess } from './characterSpellAccess';
import {
  annotateLatestSpellWithClass,
  getActiveSubclassItemForClass,
  getClassSpellcastingProfile,
  spellItemLevel
} from './spellcastingRules';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();
const unique = <T,>(values: readonly T[]): T[] => Array.from(new Set(values));

const approvedItem = (item: StoredCompendiumItem): StoredCompendiumItem =>
  item.status === 'validated'
    ? item
    : {
        ...item,
        status: 'validated',
        reviewDecision: 'approved',
        reviewedBy: 'Mystic Arcanum ativo',
        reviewedAt: new Date().toISOString()
      };

export interface MysticArcanumRequirement {
  id: string;
  classItemId: string;
  className: string;
  featureItemId: string;
  featureName: string;
  classLevelRequired: number;
  spellLevel: number;
  recharge: 'longRest';
}

export interface MysticArcanumRequirementInput {
  classItem: StoredCompendiumItem;
  classLevel: number;
  items: StoredCompendiumItem[];
}

/**
 * Returns one independent Mystic Arcanum choice for every threshold reached.
 * Pact Magic itself remains capped at 5th-level spells; these requirements are
 * deliberately separate from the normal spell-selection profile.
 */
export const getMysticArcanumRequirements = ({
  classItem,
  classLevel,
  items
}: MysticArcanumRequirementInput): MysticArcanumRequirement[] => {
  const profile = getClassSpellcastingProfile(classItem, classLevel);
  if (profile?.progression !== 'pactMagic' || normalize(classItem.name) !== 'warlock') return [];

  const features = getProgressionFeatureReferences(classItem, classLevel)
    .map((reference) => findCompendiumItemByReference(items, reference))
    .filter((item): item is StoredCompendiumItem => Boolean(item && item.type === 'feature' && item.status !== 'disabled'));

  return features.flatMap((feature): MysticArcanumRequirement[] => {
    const payload = asRecord(feature.normalizedJson);
    const arcanumByLevel = asRecord(payload.arcanumByLevel);
    if (!Object.keys(arcanumByLevel).length) return [];
    return Object.entries(arcanumByLevel)
      .flatMap(([requiredLevelText, spellLevelValue]): MysticArcanumRequirement[] => {
        const requiredLevel = Number(requiredLevelText);
        const spellLevel = asNumber(spellLevelValue);
        if (!Number.isFinite(requiredLevel) || !spellLevel || classLevel < requiredLevel) return [];
        return [{
          id: `${feature.id}:level:${spellLevel}`,
          classItemId: classItem.id,
          className: classItem.name,
          featureItemId: feature.id,
          featureName: feature.name,
          classLevelRequired: requiredLevel,
          spellLevel,
          recharge: 'longRest'
        }];
      })
      .sort((left, right) => left.spellLevel - right.spellLevel);
  });
};

export interface MysticArcanumCandidateInput {
  requirement: MysticArcanumRequirement;
  classItem: StoredCompendiumItem;
  classLevel: number;
  items: StoredCompendiumItem[];
  subclassItem?: StoredCompendiumItem;
  subclassChoices?: CharacterSubclassChoice[];
  classFeatureChoices?: CharacterClassFeatureChoice[];
}

export const getMysticArcanumCandidates = ({
  requirement,
  classItem,
  classLevel,
  items,
  subclassItem,
  subclassChoices,
  classFeatureChoices
}: MysticArcanumCandidateInput): StoredCompendiumItem[] => {
  const access = resolveCharacterSpellAccess({
    classItem,
    classLevel,
    items,
    subclassItem,
    subclassChoices,
    classFeatureChoices
  });
  const references = unique([
    ...access.classListSpellReferences,
    ...access.expandedListSpellReferences
  ]);

  return items
    .filter((item) => item.type === 'spell' && item.status !== 'disabled')
    .filter((item) => spellItemLevel(item) === requirement.spellLevel)
    .filter((item) => references.some((reference) => itemReferenceMatches(item, reference)))
    .sort((left, right) => left.name.localeCompare(right.name));
};

export const mysticArcanumChoiceForRequirement = (
  choices: readonly CharacterMysticArcanumChoice[] | undefined,
  requirement: MysticArcanumRequirement
): CharacterMysticArcanumChoice | undefined => (choices ?? []).find((choice) => choice.requirementId === requirement.id);

export interface MysticArcanumReplacementEligibilityInput {
  classItem: StoredCompendiumItem;
  beforeClassLevel: number;
  afterClassLevel: number;
  choices: readonly CharacterMysticArcanumChoice[] | undefined;
}

/**
 * The 2024 Warlock may replace one existing Arcanum when a Warlock level is gained.
 * This helper intentionally requires an Arcanum that existed before the level gain;
 * unlocking the first Arcanum at level 11 does not manufacture a redundant replacement.
 */
export const canOfferMysticArcanumReplacement = ({
  classItem,
  beforeClassLevel,
  afterClassLevel,
  choices
}: MysticArcanumReplacementEligibilityInput): boolean => {
  const beforeProfile = getClassSpellcastingProfile(classItem, beforeClassLevel);
  if (beforeProfile?.progression !== 'pactMagic' || normalize(classItem.name) !== 'warlock') return false;
  if (beforeClassLevel < 11 || afterClassLevel <= beforeClassLevel) return false;
  return (choices ?? []).some((choice) => choice.classItemId === classItem.id);
};

export const setMysticArcanumChoice = (
  choices: readonly CharacterMysticArcanumChoice[] | undefined,
  requirement: MysticArcanumRequirement,
  spellItemId: string
): CharacterMysticArcanumChoice[] => [
  ...(choices ?? []).filter((choice) => choice.requirementId !== requirement.id),
  {
    requirementId: requirement.id,
    classItemId: requirement.classItemId,
    featureItemId: requirement.featureItemId,
    spellItemId,
    spellLevel: requirement.spellLevel
  }
];

export interface MysticArcanumChoiceContext {
  requirement: MysticArcanumRequirement;
  classItem: StoredCompendiumItem;
  classLevel: number;
  subclassItem?: StoredCompendiumItem;
  subclassChoices?: CharacterSubclassChoice[];
  classFeatureChoices?: CharacterClassFeatureChoice[];
}

export const pruneMysticArcanumChoices = (
  choices: readonly CharacterMysticArcanumChoice[] | undefined,
  contexts: readonly MysticArcanumChoiceContext[],
  items: StoredCompendiumItem[]
): CharacterMysticArcanumChoice[] => (choices ?? []).flatMap((choice): CharacterMysticArcanumChoice[] => {
  const context = contexts.find((entry) => entry.requirement.id === choice.requirementId);
  if (!context) return [];
  const candidates = getMysticArcanumCandidates({ ...context, items });
  if (!candidates.some((candidate) => candidate.id === choice.spellItemId)) return [];
  return [{
    ...choice,
    classItemId: context.requirement.classItemId,
    featureItemId: context.requirement.featureItemId,
    spellLevel: context.requirement.spellLevel
  }];
});

export const validateMysticArcanumChoices = (
  contexts: readonly MysticArcanumChoiceContext[],
  choices: readonly CharacterMysticArcanumChoice[] | undefined,
  items: StoredCompendiumItem[],
  requireExact = true
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  for (const context of contexts) {
    const choice = mysticArcanumChoiceForRequirement(choices, context.requirement);
    if (!choice) {
      if (requireExact) issues.push({
        severity: 'error',
        code: 'MYSTIC_ARCANUM_CHOICE_REQUIRED',
        message: `${context.requirement.featureName} exige escolher uma magia de ${context.requirement.spellLevel}º círculo.`
      });
      continue;
    }
    const candidates = getMysticArcanumCandidates({ ...context, items });
    if (!candidates.some((candidate) => candidate.id === choice.spellItemId)) {
      issues.push({
        severity: 'error',
        code: 'MYSTIC_ARCANUM_CHOICE_NOT_ELIGIBLE',
        message: `A magia escolhida para o Arcanum de ${context.requirement.spellLevel}º círculo não pertence à lista de Warlock ativa.`
      });
    }
  }
  return issues;
};

const resourceIdFor = (classEntityId: string, spellLevel: number): string =>
  `warlock-arcanum:${classEntityId}:${spellLevel}`;

const presentSpellLink = (character: Character, entityId: string) =>
  (character.compendiumLinks ?? []).find((link) =>
    link.appliedAs === 'spell' && link.appliedEntityId === entityId && link.status !== 'removed'
  );

const removeSpellEntities = (character: Character, entityIds: ReadonlySet<string>): Character => ({
  ...character,
  spells: character.spells.filter((spell) => !entityIds.has(spell.id)),
  compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
    link.appliedAs === 'spell' && entityIds.has(link.appliedEntityId) && link.status !== 'removed'
      ? { ...link, status: 'removed' as const }
      : link
  )
});

interface DesiredArcanum {
  context: MysticArcanumChoiceContext;
  choice: CharacterMysticArcanumChoice;
  classEntityId: string;
  className: string;
  classAbility?: string;
  spellItem: StoredCompendiumItem;
  resourceId: string;
}

export interface MysticArcanumReconciliationResult {
  character: Character;
  addedSpellCount: number;
  removedSpellCount: number;
  updatedSpellCount: number;
  issues: RuleValidationIssue[];
}

/** Materializes active Mystic Arcanum selections as no-slot, Long-Rest spell actions. */
export const reconcileMysticArcanum = (
  character: Character,
  items: StoredCompendiumItem[]
): MysticArcanumReconciliationResult => {
  let next = character;
  const contexts: MysticArcanumChoiceContext[] = [];
  const desired: DesiredArcanum[] = [];
  const issues: RuleValidationIssue[] = [];

  for (const classEntity of next.classes) {
    const classLink = (next.compendiumLinks ?? []).find((link) =>
      link.appliedAs === 'class' && link.appliedEntityId === classEntity.id && link.status === 'active'
    );
    const classItem = classLink ? findCompendiumItemForCharacterLink(items, classLink) : undefined;
    if (!classItem) continue;
    const profile = getClassSpellcastingProfile(classItem, classEntity.level);
    if (profile?.progression !== 'pactMagic' || normalize(classItem.name) !== 'warlock') continue;
    const subclassItem = getActiveSubclassItemForClass(next, classEntity.id, items);
    const requirements = getMysticArcanumRequirements({ classItem, classLevel: classEntity.level, items });
    for (const requirement of requirements) {
      const context: MysticArcanumChoiceContext = {
        requirement,
        classItem,
        classLevel: classEntity.level,
        subclassItem,
        subclassChoices: next.buildChoices?.subclassChoices,
        classFeatureChoices: next.buildChoices?.classFeatureChoices
      };
      contexts.push(context);
      const choice = mysticArcanumChoiceForRequirement(next.buildChoices?.mysticArcanumChoices, requirement);
      if (!choice) continue;
      const spellItem = getMysticArcanumCandidates({ ...context, items }).find((candidate) => candidate.id === choice.spellItemId);
      if (!spellItem) continue;
      desired.push({
        context,
        choice,
        classEntityId: classEntity.id,
        className: classEntity.name,
        classAbility: profile.ability,
        spellItem,
        resourceId: resourceIdFor(classEntity.id, requirement.spellLevel)
      });
    }
  }

  const validChoices = pruneMysticArcanumChoices(next.buildChoices?.mysticArcanumChoices, contexts, items);
  const validChoiceIds = new Set(validChoices.map((choice) => choice.requirementId));
  const desiredByChoiceId = new Map(desired.filter((entry) => validChoiceIds.has(entry.choice.requirementId)).map((entry) => [entry.choice.requirementId, entry]));
  let addedSpellCount = 0;
  let removedSpellCount = 0;
  let updatedSpellCount = 0;

  const staleArcanumOnlyIds = new Set<string>();
  next = {
    ...next,
    spells: next.spells.map((spell) => {
      if (!spell.mysticArcanumChoiceId) return spell;
      const desiredEntry = desiredByChoiceId.get(spell.mysticArcanumChoiceId);
      const link = presentSpellLink(next, spell.id);
      if (desiredEntry && link && characterLinkMatchesCompendiumItem(items, link, desiredEntry.spellItem)) {
        const resourceId = desiredEntry.resourceId;
        if (
          spell.mysticArcanumSpellLevel === desiredEntry.context.requirement.spellLevel &&
          spell.mysticArcanumFreeCastResourceId === resourceId
        ) return spell;
        updatedSpellCount += 1;
        return {
          ...spell,
          mysticArcanumSpellLevel: desiredEntry.context.requirement.spellLevel,
          mysticArcanumFreeCastResourceId: resourceId
        };
      }
      if (spell.mysticArcanumOnly) {
        staleArcanumOnlyIds.add(spell.id);
        return spell;
      }
      updatedSpellCount += 1;
      const {
        mysticArcanumChoiceId: _choiceId,
        mysticArcanumSpellLevel: _spellLevel,
        mysticArcanumFreeCastResourceId: _resourceId,
        mysticArcanumOnly: _only,
        ...rest
      } = spell;
      return rest as Spell;
    })
  };
  if (staleArcanumOnlyIds.size) {
    next = removeSpellEntities(next, staleArcanumOnlyIds);
    removedSpellCount += staleArcanumOnlyIds.size;
  }

  for (const desiredEntry of desiredByChoiceId.values()) {
    const spellLinks = (next.compendiumLinks ?? []).filter((link) =>
      link.appliedAs === 'spell' &&
      link.status !== 'removed' &&
      characterLinkMatchesCompendiumItem(items, link, desiredEntry.spellItem)
    );
    const sameClassSpell = spellLinks
      .map((link) => next.spells.find((spell) => spell.id === link.appliedEntityId))
      .find((spell): spell is Spell => Boolean(spell && spell.spellcastingClassId === desiredEntry.classEntityId));

    if (sameClassSpell) {
      if (
        sameClassSpell.mysticArcanumChoiceId !== desiredEntry.choice.requirementId ||
        sameClassSpell.mysticArcanumFreeCastResourceId !== desiredEntry.resourceId
      ) {
        next = {
          ...next,
          spells: next.spells.map((spell) => spell.id === sameClassSpell.id ? {
            ...spell,
            mysticArcanumChoiceId: desiredEntry.choice.requirementId,
            mysticArcanumSpellLevel: desiredEntry.context.requirement.spellLevel,
            mysticArcanumFreeCastResourceId: desiredEntry.resourceId,
            mysticArcanumOnly: spell.mysticArcanumOnly ?? false
          } : spell)
        };
        updatedSpellCount += 1;
      }
      continue;
    }

    if (spellLinks.length) {
      issues.push({
        severity: 'warning',
        code: 'MYSTIC_ARCANUM_MULTICLASS_ENTITY_CONFLICT',
        message: `${desiredEntry.spellItem.name} já está vinculada a outra classe; o Mystic Arcanum não reatribuiu essa entidade silenciosamente.`
      });
      continue;
    }

    const before = next;
    const applied = applyCompendiumItemToCharacter(next, approvedItem(desiredEntry.spellItem));
    if (!applied.ok) {
      issues.push(...applied.issues);
      continue;
    }
    next = annotateLatestSpellWithClass(
      before,
      applied.character,
      desiredEntry.classEntityId,
      desiredEntry.className,
      desiredEntry.classAbility
    );
    const beforeIds = new Set(before.spells.map((spell) => spell.id));
    const added = next.spells.find((spell) => !beforeIds.has(spell.id));
    if (!added) continue;
    next = {
      ...next,
      spells: next.spells.map((spell) => spell.id === added.id ? {
        ...spell,
        mysticArcanumChoiceId: desiredEntry.choice.requirementId,
        mysticArcanumSpellLevel: desiredEntry.context.requirement.spellLevel,
        mysticArcanumFreeCastResourceId: desiredEntry.resourceId,
        mysticArcanumOnly: true
      } : spell)
    };
    addedSpellCount += 1;
  }

  const desiredByResourceId = new Map(Array.from(desiredByChoiceId.values()).map((entry) => [entry.resourceId, entry]));
  const existingResourceIds = new Set(next.resources.map((resource) => resource.id));
  next = {
    ...next,
    resources: [
      ...next.resources.flatMap((resource) => {
        if (!resource.id.startsWith('warlock-arcanum:')) return [resource];
        const desiredEntry = desiredByResourceId.get(resource.id);
        if (!desiredEntry) return [];
        return [{
          ...resource,
          name: `${desiredEntry.spellItem.name} · Mystic Arcanum`,
          max: 1,
          current: Math.max(0, Math.min(1, resource.current)),
          recharge: 'longRest' as const,
          notes: `Mystic Arcanum de ${desiredEntry.context.requirement.spellLevel}º círculo: uma conjuração sem spell slot por Descanso Longo.`
        }];
      }),
      ...Array.from(desiredByChoiceId.values())
        .filter((entry) => !existingResourceIds.has(entry.resourceId))
        .map((entry) => ({
          id: entry.resourceId,
          name: `${entry.spellItem.name} · Mystic Arcanum`,
          max: 1,
          current: 1,
          recharge: 'longRest' as const,
          notes: `Mystic Arcanum de ${entry.context.requirement.spellLevel}º círculo: uma conjuração sem spell slot por Descanso Longo.`
        }))
    ],
    buildChoices: {
      ...(next.buildChoices ?? {
        speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, equipmentSelections: []
      }),
      mysticArcanumChoices: validChoices
    }
  };

  return { character: next, addedSpellCount, removedSpellCount, updatedSpellCount, issues };
};
