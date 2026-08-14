import type {
  AbilityScore,
  AbilityScores,
  Character,
  CharacterProficiencies,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  findCompendiumItemByReference,
  getProgressionFeatureReferences
} from '../compendium/classProgression';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const abilityNameMap: Record<string, AbilityScore> = {
  strength: 'STR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA'
};

export type MulticlassAbilityRequirement =
  | { mode: 'all'; abilities: AbilityScore[]; minimum: number }
  | { mode: 'any'; abilities: AbilityScore[]; minimum: number };

const MULTICLASS_REQUIREMENTS: Record<string, MulticlassAbilityRequirement> = {
  barbarian: { mode: 'all', abilities: ['STR'], minimum: 13 },
  bard: { mode: 'all', abilities: ['CHA'], minimum: 13 },
  cleric: { mode: 'all', abilities: ['WIS'], minimum: 13 },
  druid: { mode: 'all', abilities: ['WIS'], minimum: 13 },
  fighter: { mode: 'any', abilities: ['STR', 'DEX'], minimum: 13 },
  monk: { mode: 'all', abilities: ['DEX', 'WIS'], minimum: 13 },
  paladin: { mode: 'all', abilities: ['STR', 'CHA'], minimum: 13 },
  ranger: { mode: 'all', abilities: ['DEX', 'WIS'], minimum: 13 },
  rogue: { mode: 'all', abilities: ['DEX'], minimum: 13 },
  sorcerer: { mode: 'all', abilities: ['CHA'], minimum: 13 },
  warlock: { mode: 'all', abilities: ['CHA'], minimum: 13 },
  wizard: { mode: 'all', abilities: ['INT'], minimum: 13 }
};

export const getMulticlassRequirement = (
  classItem: StoredCompendiumItem
): MulticlassAbilityRequirement | undefined =>
  MULTICLASS_REQUIREMENTS[normalize(classItem.name)];

const requirementLabel = (requirement: MulticlassAbilityRequirement): string => {
  const joiner = requirement.mode === 'all' ? ' e ' : ' ou ';
  return `${requirement.abilities.join(joiner)} ${requirement.minimum}+`;
};

export const validateMulticlassPrerequisites = (
  classItems: StoredCompendiumItem[],
  abilities: AbilityScores
): RuleValidationIssue[] => {
  if (classItems.length <= 1) return [];
  const issues: RuleValidationIssue[] = [];

  for (const classItem of classItems) {
    const requirement = getMulticlassRequirement(classItem);
    if (!requirement) continue;
    const passed = requirement.mode === 'all'
      ? requirement.abilities.every((ability) => abilities[ability] >= requirement.minimum)
      : requirement.abilities.some((ability) => abilities[ability] >= requirement.minimum);
    if (!passed) {
      issues.push({
        severity: 'error',
        code: 'MULTICLASS_ABILITY_PREREQUISITE',
        message: `${classItem.name} exige ${requirementLabel(requirement)} para multiclasse.`
      });
    }
  }
  return issues;
};

export const isFeatRepeatable = (item: StoredCompendiumItem): boolean =>
  item.type === 'feat' && asRecord(item.normalizedJson).repeatable === true;

const hasFeatureNamed = (character: Character | undefined, name: string): boolean =>
  Boolean(character?.features.some((feature) => normalize(feature.name) === normalize(name)));

const selectedClassUnlocksFeature = (
  classEntries: Array<{ item: StoredCompendiumItem; level: number }>,
  allItems: StoredCompendiumItem[],
  featureName: string
): boolean =>
  classEntries.some(({ item, level }) =>
    getProgressionFeatureReferences(item, level).some((reference) => {
      const feature = findCompendiumItemByReference(allItems, reference);
      return Boolean(feature && normalize(feature.name) === normalize(featureName));
    })
  );

const parseAbilityPrerequisite = (
  prerequisite: string,
  abilities: AbilityScores
): RuleValidationIssue | undefined => {
  const match = prerequisite.match(
    /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?:\s*,\s*(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma))?(?:\s*,?\s*or\s*(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma))?\s*(\d+)\+/i
  );
  if (!match) return undefined;
  const names = [match[1], match[2], match[3]].filter(Boolean) as string[];
  const required = Number(match[4]);
  const scores = names.map((name) => abilityNameMap[normalize(name)]).filter(Boolean);
  const usesOr = /\bor\b/i.test(match[0]);
  const passed = usesOr
    ? scores.some((ability) => abilities[ability] >= required)
    : scores.every((ability) => abilities[ability] >= required);
  return passed
    ? undefined
    : {
        severity: 'error',
        code: 'FEAT_ABILITY_PREREQUISITE',
        message: `Pré-requisito não atendido: ${match[0]}.`
      };
};

export interface ValidateFeatPrerequisiteInput {
  featItem: StoredCompendiumItem;
  totalLevel: number;
  abilities: AbilityScores;
  proficiencies: CharacterProficiencies;
  classEntries: Array<{ item: StoredCompendiumItem; level: number }>;
  allItems: StoredCompendiumItem[];
  character?: Character;
  currentCopies?: number;
}

export const validateFeatPrerequisites = ({
  featItem,
  totalLevel,
  abilities,
  proficiencies,
  classEntries,
  allItems,
  character,
  currentCopies = 0
}: ValidateFeatPrerequisiteInput): RuleValidationIssue[] => {
  const payload = asRecord(featItem.normalizedJson);
  const prerequisite = asString(payload.prerequisite) ?? '';
  const issues: RuleValidationIssue[] = [];
  const levelMatch = prerequisite.match(/Level\s+(\d+)\+/i);
  if (levelMatch && totalLevel < Number(levelMatch[1])) {
    issues.push({
      severity: 'error',
      code: 'FEAT_LEVEL_PREREQUISITE',
      message: `${featItem.name} exige nível ${levelMatch[1]} ou superior.`
    });
  }

  const abilityIssue = parseAbilityPrerequisite(prerequisite, abilities);
  if (abilityIssue) issues.push(abilityIssue);

  const hasSpellcasting = classEntries.some(({ item }) =>
    Object.keys(asRecord(asRecord(item.normalizedJson).spellcasting)).length > 0
  ) || hasFeatureNamed(character, 'Spellcasting') || hasFeatureNamed(character, 'Pact Magic');

  if (/Spellcasting or Pact Magic Feature/i.test(prerequisite) && !hasSpellcasting) {
    issues.push({ severity: 'error', code: 'FEAT_SPELLCASTING_PREREQUISITE', message: `${featItem.name} exige Spellcasting ou Pact Magic.` });
  } else if (/Spellcasting Feature/i.test(prerequisite) && !hasSpellcasting) {
    issues.push({ severity: 'error', code: 'FEAT_SPELLCASTING_PREREQUISITE', message: `${featItem.name} exige Spellcasting.` });
  }

  const hasFightingStyle = hasFeatureNamed(character, 'Fighting Style') ||
    selectedClassUnlocksFeature(classEntries, allItems, 'Fighting Style');
  if (/Fighting Style Feature/i.test(prerequisite) && !hasFightingStyle) {
    issues.push({ severity: 'error', code: 'FEAT_FIGHTING_STYLE_PREREQUISITE', message: `${featItem.name} exige a feature Fighting Style.` });
  }

  const trainingChecks: Array<[RegExp, string, string]> = [
    [/Light Armor Training/i, 'light', 'Light Armor Training'],
    [/Medium Armor Training/i, 'medium', 'Medium Armor Training'],
    [/Heavy Armor Training/i, 'heavy', 'Heavy Armor Training'],
    [/Shield Training/i, 'shields', 'Shield Training']
  ];
  for (const [pattern, token, label] of trainingChecks) {
    if (pattern.test(prerequisite) && !proficiencies.armor.map(normalize).includes(normalize(token))) {
      issues.push({ severity: 'error', code: 'FEAT_ARMOR_TRAINING_PREREQUISITE', message: `${featItem.name} exige ${label}.` });
    }
  }

  if (currentCopies > 0 && !isFeatRepeatable(featItem)) {
    issues.push({ severity: 'error', code: 'FEAT_NOT_REPEATABLE', message: `${featItem.name} não pode ser escolhido mais de uma vez.` });
  }

  return issues;
};

export interface BuildCompletionValidationInput {
  classEntries: Array<{ item: StoredCompendiumItem; level: number }>;
  abilities: AbilityScores;
  proficiencies: CharacterProficiencies;
  featItems: StoredCompendiumItem[];
  allItems: StoredCompendiumItem[];
  character?: Character;
}

export const validateBuildPrerequisites = ({
  classEntries,
  abilities,
  proficiencies,
  featItems,
  allItems,
  character
}: BuildCompletionValidationInput): RuleValidationIssue[] => {
  const issues = validateMulticlassPrerequisites(classEntries.map((entry) => entry.item), abilities);
  const counts = new Map<string, number>();
  for (const feat of featItems) {
    const currentCopies = counts.get(feat.id) ?? 0;
    issues.push(...validateFeatPrerequisites({
      featItem: feat,
      totalLevel: classEntries.reduce((sum, entry) => sum + entry.level, 0),
      abilities,
      proficiencies,
      classEntries,
      allItems,
      character,
      currentCopies
    }));
    counts.set(feat.id, currentCopies + 1);
  }
  return issues;
};

export type ProgressionFeatChoiceCategory = 'general' | 'fightingStyle' | 'epicBoon';

export interface ProgressionFeatChoiceRequirements {
  general: number;
  fightingStyle: number;
  epicBoon: number;
}

export const getProgressionFeatChoiceRequirements = (
  classEntries: Array<{ item: StoredCompendiumItem; level: number }>,
  allItems: StoredCompendiumItem[]
): ProgressionFeatChoiceRequirements => {
  const result: ProgressionFeatChoiceRequirements = {
    general: 0,
    fightingStyle: 0,
    epicBoon: 0
  };

  for (const { item, level } of classEntries) {
    for (const reference of getProgressionFeatureReferences(item, level)) {
      const feature = findCompendiumItemByReference(allItems, reference);
      if (!feature) continue;
      const payload = asRecord(feature.normalizedJson);
      const name = normalize(feature.name);
      const explicitCategory = normalize(asString(payload.featCategory) ?? '');
      if (name === 'ability score improvement') result.general += 1;
      else if (name === 'epic boon') result.epicBoon += 1;
      else if (name === 'fighting style' || explicitCategory === 'fightingstyle') result.fightingStyle += 1;
    }
  }

  return result;
};

export const getFeatCategory = (item: StoredCompendiumItem): ProgressionFeatChoiceCategory | 'origin' | 'other' => {
  const payload = asRecord(item.normalizedJson);
  const category = normalize(
    asString(payload.category) ??
      asString(payload.featCategory) ??
      asString(payload.type) ??
      ''
  );
  if (category.includes('origin')) return 'origin';
  if (category.includes('fighting')) return 'fightingStyle';
  if (category.includes('epic')) return 'epicBoon';
  if (category.includes('general')) return 'general';
  return 'other';
};

export const getFeatMinimumLevel = (featItem: StoredCompendiumItem): number => {
  const prerequisite = asString(asRecord(featItem.normalizedJson).prerequisite) ?? '';
  const levelMatch = prerequisite.match(/Level\s+(\d+)\+/i);
  if (levelMatch?.[1]) return Math.max(1, Number(levelMatch[1]));
  return getFeatCategory(featItem) === 'epicBoon' ? 19 : 1;
};

