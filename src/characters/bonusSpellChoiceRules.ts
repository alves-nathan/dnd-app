import type { StoredCompendiumItem } from '../compendium/types';
import type { CharacterBonusSpellChoice, RuleValidationIssue } from '../types';
import { itemReferenceMatches } from './creationData';
import type { CharacterSpellChoiceRequirement } from './characterSpellAccess';
import { getClassSpellListReferences } from './spellListRules';
import type { ClassSpellcastingProfile } from './spellcastingRules';
import { spellItemClasses, spellItemLevel } from './spellcastingRules';

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const unique = <T,>(values: readonly T[]): T[] => Array.from(new Set(values));

const findClassByName = (
  items: StoredCompendiumItem[],
  className: string
): StoredCompendiumItem | undefined => items.find((item) =>
  item.type === 'class' && item.status !== 'disabled' && normalize(item.name) === normalize(className)
);

const directSpellReferencesForClass = (
  items: StoredCompendiumItem[],
  className: string
): string[] => items
  .filter((item) => item.type === 'spell' && item.status !== 'disabled')
  .filter((item) => spellItemClasses(item).some((candidate) => normalize(candidate) === normalize(className)))
  .map((item) => item.id);

const sourceReferencesForRequirement = (
  requirement: CharacterSpellChoiceRequirement,
  items: StoredCompendiumItem[]
): string[] => unique([
  ...requirement.explicitSpellReferences,
  ...requirement.sourceClassNames.flatMap((className) => {
    const classItem = findClassByName(items, className);
    // A class-list carrier is the authoritative source when present, but V2
    // imports may legitimately encode membership only on spell.payload.classes.
    // Bonus choices must accept both representations just like the normal spell
    // eligibility path does, otherwise reconciliation can prune a valid choice.
    return [
      ...(classItem ? getClassSpellListReferences(classItem, items, 1) : []),
      ...directSpellReferencesForClass(items, className)
    ];
  })
]);

export const getBonusSpellChoiceCandidates = (
  requirement: CharacterSpellChoiceRequirement,
  ownerProfile: ClassSpellcastingProfile | undefined,
  selectableSpells: StoredCompendiumItem[],
  allItems: StoredCompendiumItem[]
): StoredCompendiumItem[] => {
  const references = sourceReferencesForRequirement(requirement, allItems);
  const referenceMatches = (spell: StoredCompendiumItem): boolean =>
    references.some((reference) => itemReferenceMatches(spell, reference));

  return selectableSpells.filter((spell) => {
    if (spell.type !== 'spell' || !referenceMatches(spell)) return false;
    const level = spellItemLevel(spell);
    if (requirement.spellLevel !== undefined) return level === requirement.spellLevel;
    if (!ownerProfile) return level === 0;
    return level === 0 || level <= ownerProfile.maxSpellLevel;
  });
};

export const bonusSpellChoiceForRequirement = (
  choices: readonly CharacterBonusSpellChoice[],
  requirement: CharacterSpellChoiceRequirement
): CharacterBonusSpellChoice | undefined => choices.find((choice) => choice.requirementId === requirement.id);

export const setBonusSpellChoiceSpellIds = (
  choices: readonly CharacterBonusSpellChoice[],
  requirement: CharacterSpellChoiceRequirement,
  spellItemIds: readonly string[]
): CharacterBonusSpellChoice[] => {
  const without = choices.filter((choice) => choice.requirementId !== requirement.id);
  const normalizedIds = unique(spellItemIds).slice(0, requirement.count);
  if (!normalizedIds.length) return without;
  return [...without, {
    requirementId: requirement.id,
    classItemId: requirement.classItemId,
    featureItemId: requirement.source.itemId,
    spellItemIds: normalizedIds
  }];
};

export const toggleBonusSpellChoiceSpell = (
  choices: readonly CharacterBonusSpellChoice[],
  requirement: CharacterSpellChoiceRequirement,
  spellItemId: string
): CharacterBonusSpellChoice[] => {
  const current = bonusSpellChoiceForRequirement(choices, requirement)?.spellItemIds ?? [];
  const next = current.includes(spellItemId)
    ? current.filter((id) => id !== spellItemId)
    : current.length < requirement.count
      ? [...current, spellItemId]
      : current;
  return setBonusSpellChoiceSpellIds(choices, requirement, next);
};

export const pruneBonusSpellChoices = (
  choices: readonly CharacterBonusSpellChoice[],
  requirements: readonly CharacterSpellChoiceRequirement[],
  profiles: readonly ClassSpellcastingProfile[],
  selectableSpells: StoredCompendiumItem[],
  allItems: StoredCompendiumItem[]
): CharacterBonusSpellChoice[] => choices.flatMap((choice): CharacterBonusSpellChoice[] => {
  const requirement = requirements.find((candidate) => candidate.id === choice.requirementId);
  if (!requirement) return [];
  const profile = profiles.find((candidate) => candidate.classItemId === requirement.classItemId);
  const allowed = new Set(getBonusSpellChoiceCandidates(requirement, profile, selectableSpells, allItems).map((spell) => spell.id));
  const spellItemIds = unique(choice.spellItemIds).filter((id) => allowed.has(id)).slice(0, requirement.count);
  return spellItemIds.length ? [{
    requirementId: requirement.id,
    classItemId: requirement.classItemId,
    featureItemId: requirement.source.itemId,
    spellItemIds
  }] : [];
});

export interface BonusSpellChoiceValidationInput {
  requirements: readonly CharacterSpellChoiceRequirement[];
  choices: readonly CharacterBonusSpellChoice[];
  profiles: readonly ClassSpellcastingProfile[];
  selectableSpells: StoredCompendiumItem[];
  allItems: StoredCompendiumItem[];
  normalSpellAssignments?: Record<string, string>;
  requireExact?: boolean;
}

export const validateBonusSpellChoices = ({
  requirements,
  choices,
  profiles,
  selectableSpells,
  allItems,
  normalSpellAssignments = {},
  requireExact = true
}: BonusSpellChoiceValidationInput): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  const selectedGlobally = new Map<string, string>();

  for (const requirement of requirements) {
    const choice = bonusSpellChoiceForRequirement(choices, requirement);
    const selected = unique(choice?.spellItemIds ?? []);
    const profile = profiles.find((candidate) => candidate.classItemId === requirement.classItemId);
    const candidates = getBonusSpellChoiceCandidates(requirement, profile, selectableSpells, allItems);
    const candidateIds = new Set(candidates.map((spell) => spell.id));

    for (const spellItemId of selected) {
      const spell = selectableSpells.find((candidate) => candidate.id === spellItemId);
      if (!spell || !candidateIds.has(spellItemId)) {
        issues.push({
          severity: 'error',
          code: 'BONUS_SPELL_CHOICE_NOT_ELIGIBLE',
          message: `Uma magia escolhida para ${requirement.source.name} não pertence às listas ou ao nível permitido.`
        });
        continue;
      }
      if (normalSpellAssignments[spellItemId] === requirement.classItemId) {
        issues.push({
          severity: 'error',
          code: 'BONUS_SPELL_DUPLICATES_NORMAL_SELECTION',
          message: `${spell.name} já foi escolhida normalmente por ${requirement.className}; escolha outra magia bônus.`
        });
      }
      const previousRequirement = selectedGlobally.get(`${requirement.classItemId}:${spellItemId}`);
      if (previousRequirement && previousRequirement !== requirement.id) {
        issues.push({
          severity: 'error',
          code: 'BONUS_SPELL_DUPLICATE',
          message: `${spell.name} foi escolhida em mais de uma concessão bônus de ${requirement.className}.`
        });
      }
      selectedGlobally.set(`${requirement.classItemId}:${spellItemId}`, requirement.id);
    }

    const invalidCount = requireExact ? selected.length !== requirement.count : selected.length > requirement.count;
    if (invalidCount) {
      issues.push({
        severity: 'error',
        code: 'BONUS_SPELL_CHOICE_COUNT',
        message: `${requirement.source.name} exige ${requirement.count} magia(s) bônus; selecionada(s): ${selected.length}.`
      });
    }
  }

  return issues;
};
