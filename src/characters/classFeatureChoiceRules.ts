import type { StoredCompendiumItem } from '../compendium/types';
import { findCompendiumItemByReference, getProgressionFeatureReferences } from '../compendium/classProgression';
import type { CharacterClassFeatureChoice, RuleValidationIssue } from '../types';
import { getSpellAccessRequirementsFromFeature } from './characterSpellAccess';
import type { ProgressionFeatChoiceRequirements } from './characterBuildRules';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const humanizeOptionId = (value: string): string => value
  .split(/[-_]+/g)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

export interface SpellAffectingClassFeatureOption {
  id: string;
  label: string;
  description?: string;
  activatesBonusSpellChoice: boolean;
  weaponProficienciesAdd: string[];
  armorTrainingAdd: string[];
}

export interface SpellAffectingClassFeatureChoiceRequirement {
  classItemId: string;
  className: string;
  featureItemId: string;
  featureName: string;
  required: boolean;
  alternateFeatCategory?: 'fightingStyle';
  options: SpellAffectingClassFeatureOption[];
}

const optionDescription = (option: Record<string, unknown>): string | undefined => {
  const explicit = asString(option.description) ?? asString(option.summary);
  if (explicit) return explicit;
  const extraCantrips = typeof option.extraCantrips === 'number' ? Math.max(0, Math.floor(option.extraCantrips)) : 0;
  const spellList = asString(option.spellList);
  if (extraCantrips > 0) {
    return `${extraCantrips} cantrip(s) bônus${spellList ? ` da lista de ${spellList}` : ''}; não consomem o limite normal da classe.`;
  }
  const armor = Array.isArray(option.armorTrainingAdd) ? option.armorTrainingAdd.filter((entry): entry is string => typeof entry === 'string') : [];
  const weapons = Array.isArray(option.weaponProficienciesAdd) ? option.weaponProficienciesAdd.filter((entry): entry is string => typeof entry === 'string') : [];
  const parts = [
    armor.length ? `treinamento em armadura: ${armor.join(', ')}` : undefined,
    weapons.length ? `proficiência com armas: ${weapons.join(', ')}` : undefined
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
};

const featureHasSpellChoiceActivation = (
  feature: StoredCompendiumItem,
  classItem: StoredCompendiumItem,
  items: StoredCompendiumItem[]
): boolean => getSpellAccessRequirementsFromFeature(feature, classItem, items).bonusChoiceRequirements
  .some((requirement) => requirement.activation.kind === 'featureOption');

export const getSpellAffectingClassFeatureChoiceRequirements = (
  classEntries: Array<{ item: StoredCompendiumItem; level: number }>,
  items: StoredCompendiumItem[]
): SpellAffectingClassFeatureChoiceRequirement[] => {
  const result: SpellAffectingClassFeatureChoiceRequirement[] = [];

  for (const { item: classItem, level } of classEntries) {
    for (const reference of getProgressionFeatureReferences(classItem, level)) {
      const feature = findCompendiumItemByReference(items, reference);
      if (!feature || feature.type !== 'feature' || feature.status === 'disabled') continue;
      if (!featureHasSpellChoiceActivation(feature, classItem, items)) continue;

      const payload = asRecord(feature.normalizedJson);
      const choices = Array.isArray(payload.choice) ? payload.choice.map(asRecord) : [];
      const alternate = Object.keys(asRecord(payload.alternateOption)).length ? asRecord(payload.alternateOption) : undefined;
      const rawOptions = choices.length ? choices : alternate ? [alternate] : [];
      const options = rawOptions.flatMap((option): SpellAffectingClassFeatureOption[] => {
        const id = asString(option.id);
        if (!id) return [];
        const requirements = getSpellAccessRequirementsFromFeature(feature, classItem, items).bonusChoiceRequirements;
        return [{
          id,
          label: asString(option.label) ?? humanizeOptionId(id),
          description: optionDescription(option),
          activatesBonusSpellChoice: requirements.some((requirement) =>
            requirement.activation.kind === 'featureOption' && requirement.activation.optionId === id
          ),
          weaponProficienciesAdd: Array.isArray(option.weaponProficienciesAdd)
            ? option.weaponProficienciesAdd.filter((entry): entry is string => typeof entry === 'string')
            : [],
          armorTrainingAdd: Array.isArray(option.armorTrainingAdd)
            ? option.armorTrainingAdd.filter((entry): entry is string => typeof entry === 'string')
            : []
        }];
      });
      if (!options.length) continue;

      const featCategory = normalize(asString(payload.featCategory) ?? '');
      result.push({
        classItemId: classItem.id,
        className: classItem.name,
        featureItemId: feature.id,
        featureName: feature.name,
        required: choices.length > 0,
        alternateFeatCategory: !choices.length && featCategory === 'fightingstyle' ? 'fightingStyle' : undefined,
        options
      });
    }
  }

  return result;
};

export const classFeatureChoiceForRequirement = (
  choices: readonly CharacterClassFeatureChoice[],
  requirement: SpellAffectingClassFeatureChoiceRequirement
): CharacterClassFeatureChoice | undefined => choices.find((choice) =>
  choice.classItemId === requirement.classItemId && choice.featureItemId === requirement.featureItemId
);

export const setClassFeatureChoiceOption = (
  choices: readonly CharacterClassFeatureChoice[],
  requirement: SpellAffectingClassFeatureChoiceRequirement,
  optionId?: string
): CharacterClassFeatureChoice[] => {
  const without = choices.filter((choice) =>
    !(choice.classItemId === requirement.classItemId && choice.featureItemId === requirement.featureItemId)
  );
  if (!optionId || !requirement.options.some((option) => option.id === optionId)) return without;
  return [...without, {
    classItemId: requirement.classItemId,
    featureItemId: requirement.featureItemId,
    optionId
  }];
};

export const pruneClassFeatureChoices = (
  choices: readonly CharacterClassFeatureChoice[],
  requirements: readonly SpellAffectingClassFeatureChoiceRequirement[]
): CharacterClassFeatureChoice[] => choices.filter((choice) => {
  const requirement = requirements.find((candidate) =>
    candidate.classItemId === choice.classItemId && candidate.featureItemId === choice.featureItemId
  );
  return Boolean(requirement?.options.some((option) => option.id === choice.optionId));
});

export const validateClassFeatureChoices = (
  requirements: readonly SpellAffectingClassFeatureChoiceRequirement[],
  choices: readonly CharacterClassFeatureChoice[]
): RuleValidationIssue[] => requirements.flatMap((requirement): RuleValidationIssue[] => {
  const selected = classFeatureChoiceForRequirement(choices, requirement);
  if (!requirement.required || selected) return [];
  return [{
    severity: 'error',
    code: 'CLASS_FEATURE_OPTION_REQUIRED',
    message: `Escolha uma opção para ${requirement.featureName} de ${requirement.className}.`
  }];
});



export const getClassFeatureChoiceProficiencyGrants = (
  requirements: readonly SpellAffectingClassFeatureChoiceRequirement[],
  choices: readonly CharacterClassFeatureChoice[]
): { weapons: string[]; armor: string[] } => {
  const weapons = new Set<string>();
  const armor = new Set<string>();
  for (const requirement of requirements) {
    const selected = classFeatureChoiceForRequirement(choices, requirement);
    if (!selected) continue;
    const option = requirement.options.find((candidate) => candidate.id === selected.optionId);
    for (const entry of option?.weaponProficienciesAdd ?? []) weapons.add(entry);
    for (const entry of option?.armorTrainingAdd ?? []) armor.add(entry);
  }
  return { weapons: Array.from(weapons), armor: Array.from(armor) };
};

export const applyClassFeatureChoiceAlternativesToFeatRequirements = (
  base: ProgressionFeatChoiceRequirements,
  requirements: readonly SpellAffectingClassFeatureChoiceRequirement[],
  choices: readonly CharacterClassFeatureChoice[]
): ProgressionFeatChoiceRequirements => {
  let fightingStyleAlternatives = 0;
  for (const requirement of requirements) {
    if (requirement.alternateFeatCategory !== 'fightingStyle') continue;
    const selected = classFeatureChoiceForRequirement(choices, requirement);
    if (selected) fightingStyleAlternatives += 1;
  }
  return {
    ...base,
    fightingStyle: Math.max(0, base.fightingStyle - fightingStyleAlternatives)
  };
};
