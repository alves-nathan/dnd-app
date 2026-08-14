import type {
  AbilityScore,
  CharacterProficiencies,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  findCompendiumItemByReference,
  getProgressionFeatureReferences
} from '../compendium/classProgression';
import {
  emptyCharacterProficiencies,
  mergeProficiencies
} from './proficiencies';
import { backgroundSuggestions } from './creationData';
import {
  ALL_LANGUAGE_OPTIONS,
  ALL_TOOL_OPTIONS,
  getToolOptionsForDescriptor,
  parseToolProficiencyEntries,
  uniqueChoices
} from './choiceOptions';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && Boolean(entry.trim())
      )
    : [];

const normalizeName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const STARTING_SKILL_CHOICE_COUNTS: Record<string, number> = {
  barbarian: 2,
  bard: 3,
  cleric: 2,
  druid: 2,
  fighter: 2,
  monk: 2,
  paladin: 2,
  ranger: 3,
  rogue: 4,
  sorcerer: 2,
  warlock: 2,
  wizard: 2
};

export interface ToolProficiencyRequirement {
  fixedTools: string[];
  toolChoiceCount: number;
  toolChoiceLabel?: string;
  toolOptions: string[];
}

export interface ClassProficiencyRequirement extends ToolProficiencyRequirement {
  className: string;
  skillOptions: string[];
  skillChoiceCount: number;
  weapons: string[];
  armor: string[];
  savingThrows: AbilityScore[];
  expertiseChoiceCount: number;
  fixedLanguages: string[];
  languageChoiceCount: number;
  languageOptions: string[];
}

export interface BackgroundProficiencyRequirement extends ToolProficiencyRequirement {
  backgroundName: string;
}

const expertiseCountFromFeature = (
  feature: StoredCompendiumItem,
  classLevel: number
): number => {
  const payload = asRecord(feature.normalizedJson);
  const byLevel = asRecord(payload.expertiseSkillChoicesByLevel);
  let count = 0;

  for (const [levelText, value] of Object.entries(byLevel)) {
    const level = Number(levelText);
    const amount = asNumber(value);
    if (Number.isFinite(level) && level <= classLevel && amount) count += amount;
  }

  if (!Object.keys(byLevel).length) {
    const levelGained = asNumber(payload.levelGained) ?? 1;
    const amount = asNumber(payload.expertiseSkillChoices);
    if (amount && levelGained <= classLevel) count += amount;
  }

  return count;
};

export const getClassProficiencyRequirement = (
  classItem: StoredCompendiumItem,
  classLevel: number,
  allItems: StoredCompendiumItem[]
): ClassProficiencyRequirement => {
  const payload = asRecord(classItem.normalizedJson);
  const toolRequirement = parseToolProficiencyEntries(asStringArray(payload.toolProficiencies));
  const mechanics = asRecord(payload.mechanics);
  const structuredToolChoice = asRecord(mechanics.toolProficiencyChoice);
  const structuredToolChoiceCount = Math.max(0, Math.floor(asNumber(structuredToolChoice.count) ?? 0));
  const structuredToolDescriptor = structuredToolChoice.category ?? structuredToolChoice.options;
  const structuredToolOptions = structuredToolChoiceCount > 0
    ? getToolOptionsForDescriptor(structuredToolDescriptor)
    : [];

  const featureReferences = getProgressionFeatureReferences(classItem, classLevel);
  let expertiseChoiceCount = 0;
  let languageChoiceCount = 0;
  const fixedLanguages: string[] = [];
  for (const reference of featureReferences) {
    const feature = findCompendiumItemByReference(allItems, reference);
    if (!feature) continue;
    expertiseChoiceCount += expertiseCountFromFeature(feature, classLevel);
    const featurePayload = asRecord(feature.normalizedJson);
    fixedLanguages.push(...asStringArray(featurePayload.languagesAdd));
    languageChoiceCount += Math.max(0, Math.floor(asNumber(featurePayload.languageChoices) ?? 0));
  }

  const savingThrows = asStringArray(payload.savingThrowProficiencies)
    .map((entry) => entry.toUpperCase())
    .filter((entry): entry is AbilityScore =>
      ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].includes(entry)
    );

  return {
    className: classItem.name,
    skillOptions: asStringArray(payload.skillProficienciesChoice),
    skillChoiceCount: Math.max(0, Math.floor(asNumber(payload.skillChoiceCount) ?? STARTING_SKILL_CHOICE_COUNTS[normalizeName(classItem.name)] ?? 0)),
    fixedTools: toolRequirement.fixedTools,
    toolChoiceCount: toolRequirement.choiceCount + structuredToolChoiceCount,
    toolChoiceLabel: toolRequirement.choiceLabel ?? (structuredToolChoiceCount > 0 && typeof structuredToolDescriptor === 'string' ? structuredToolDescriptor.toLowerCase() : undefined),
    toolOptions: uniqueChoices([...toolRequirement.choiceOptions, ...structuredToolOptions]),
    weapons: asStringArray(payload.weaponProficiencies),
    armor: asStringArray(payload.armorTraining ?? payload.armorProficiencies),
    savingThrows,
    expertiseChoiceCount,
    fixedLanguages: uniqueChoices(fixedLanguages),
    languageChoiceCount,
    languageOptions: languageChoiceCount > 0 ? [...ALL_LANGUAGE_OPTIONS] : []
  };
};

export const getBackgroundProficiencyRequirement = (
  backgroundItem?: StoredCompendiumItem
): BackgroundProficiencyRequirement | undefined => {
  if (!backgroundItem) return undefined;
  const payload = asRecord(backgroundItem.normalizedJson);
  const toolEntries = asStringArray(payload.toolProficiencies);
  const toolRequirement = parseToolProficiencyEntries(toolEntries);
  const structuredChoice = asRecord(payload.toolProficiencyChoice);
  const structuredChoiceCount = Math.max(0, Math.floor(asNumber(structuredChoice.count) ?? 0));
  const structuredDescriptors = asStringArray(structuredChoice.options);
  const structuredOptions = uniqueChoices(structuredDescriptors.flatMap((descriptor) => getToolOptionsForDescriptor(descriptor)));
  const hasConfiguredTool = toolEntries.length > 0 || structuredChoiceCount > 0;

  return {
    backgroundName: backgroundItem.name,
    fixedTools: toolRequirement.fixedTools,
    toolChoiceCount: hasConfiguredTool
      ? Math.max(toolRequirement.choiceCount, structuredChoiceCount)
      : 1,
    toolChoiceLabel: hasConfiguredTool
      ? (toolRequirement.choiceLabel ?? (structuredChoiceCount > 0 ? structuredDescriptors.join(' ou ').toLowerCase() : undefined))
      : 'qualquer ferramenta (complemento 2024)',
    toolOptions: hasConfiguredTool
      ? uniqueChoices([...toolRequirement.choiceOptions, ...structuredOptions])
      : [...ALL_TOOL_OPTIONS]
  };
};

export interface BuildProficiencySelectionInput {
  startingClassItem?: StoredCompendiumItem;
  startingClassLevel?: number;
  backgroundItem?: StoredCompendiumItem;
  allItems: StoredCompendiumItem[];
  classSkillChoices: string[];
  classToolChoices: string[];
  backgroundToolChoices?: string[];
  expertiseSkills: string[];
  languages?: string[];
  classLanguageChoices?: string[];
  fixedLanguages?: string[];
  speciesSkillGrants?: string[];
  speciesLanguageGrants?: string[];
  requiredLanguageChoiceCount?: number;
  allowedLanguageOptions?: readonly string[];
}

export interface ProficiencySelectionResult {
  proficiencies: CharacterProficiencies;
  requirement?: ClassProficiencyRequirement;
  backgroundRequirement?: BackgroundProficiencyRequirement;
  issues: RuleValidationIssue[];
  ok: boolean;
}

export const buildProficiencySelection = ({
  startingClassItem,
  startingClassLevel = 1,
  backgroundItem,
  allItems,
  classSkillChoices,
  classToolChoices,
  backgroundToolChoices = [],
  expertiseSkills,
  languages = [],
  classLanguageChoices = [],
  fixedLanguages = [],
  speciesSkillGrants = [],
  speciesLanguageGrants = [],
  requiredLanguageChoiceCount = 0,
  allowedLanguageOptions = []
}: BuildProficiencySelectionInput): ProficiencySelectionResult => {
  const issues: RuleValidationIssue[] = [];
  const suggestedBackground = backgroundSuggestions(backgroundItem).proficiencies;
  const backgroundRequirement = getBackgroundProficiencyRequirement(backgroundItem);
  const selectedBackgroundTools = backgroundRequirement?.toolChoiceCount
    ? uniqueChoices(backgroundToolChoices).filter((tool) =>
        !backgroundRequirement.toolOptions.length || backgroundRequirement.toolOptions.includes(tool)
      )
    : [];

  if (
    backgroundRequirement &&
    selectedBackgroundTools.length !== backgroundRequirement.toolChoiceCount
  ) {
    issues.push({
      severity: 'error',
      code: 'BACKGROUND_TOOL_CHOICE_COUNT',
      message: `${backgroundRequirement.backgroundName} exige exatamente ${backgroundRequirement.toolChoiceCount} escolha(s) de ${backgroundRequirement.toolChoiceLabel ?? 'ferramenta'}.`
    });
  }

  const selectedLanguages = uniqueChoices(languages);
  const validLanguages = allowedLanguageOptions.length
    ? selectedLanguages.filter((language) => allowedLanguageOptions.includes(language))
    : selectedLanguages;
  if (requiredLanguageChoiceCount > 0 && validLanguages.length !== requiredLanguageChoiceCount) {
    issues.push({
      severity: 'error',
      code: 'LANGUAGE_CHOICE_COUNT',
      message: `A origem exige exatamente ${requiredLanguageChoiceCount} escolha(s) de idioma da lista permitida.`
    });
  }

  const background: CharacterProficiencies = {
    ...suggestedBackground,
    skills: unique([...suggestedBackground.skills, ...speciesSkillGrants]),
    tools: unique([
      ...(backgroundRequirement?.fixedTools ?? suggestedBackground.tools),
      ...selectedBackgroundTools
    ])
  };

  if (!startingClassItem) {
    const proficiencies = mergeProficiencies(background, {
      ...emptyCharacterProficiencies(),
      expertiseSkills,
      languages: unique([...fixedLanguages, ...validLanguages])
    });
    return {
      proficiencies,
      backgroundRequirement,
      issues,
      ok: !issues.some((entry) => entry.severity === 'error')
    };
  }

  const requirement = getClassProficiencyRequirement(
    startingClassItem,
    startingClassLevel,
    allItems
  );

  const validClassLanguages = requirement.languageChoiceCount > 0
    ? uniqueChoices(classLanguageChoices).filter((language) =>
        !requirement.languageOptions.length || requirement.languageOptions.includes(language)
      )
    : [];
  if (requirement.languageChoiceCount > 0 && validClassLanguages.length !== requirement.languageChoiceCount) {
    issues.push({
      severity: 'error',
      code: 'CLASS_LANGUAGE_CHOICE_COUNT',
      message: `${requirement.className} exige exatamente ${requirement.languageChoiceCount} escolha(s) adicional(is) de idioma nesta progressão.`
    });
  }

  const duplicateBackgroundClassSkills = unique(classSkillChoices).filter((skill) =>
    background.skills.includes(skill)
  );
  if (duplicateBackgroundClassSkills.length) {
    issues.push({
      severity: 'error',
      code: 'CLASS_SKILL_ALREADY_GRANTED_BY_BACKGROUND',
      message: `A(s) perícia(s) ${duplicateBackgroundClassSkills.join(', ')} já são concedidas pelo background; escolha outra(s) opção(ões) da classe.`
    });
  }

  const validClassSkills = unique(classSkillChoices).filter((skill) =>
    requirement.skillOptions.includes(skill) && !background.skills.includes(skill)
  );
  if (validClassSkills.length !== requirement.skillChoiceCount) {
    issues.push({
      severity: 'error',
      code: 'CLASS_SKILL_CHOICE_COUNT',
      message: `${requirement.className} exige exatamente ${requirement.skillChoiceCount} escolha(s) de perícia da lista da classe.`
    });
  }

  const uniqueTools = uniqueChoices(classToolChoices).filter((tool) =>
    !requirement.toolOptions.length || requirement.toolOptions.includes(tool)
  );
  if (uniqueTools.length !== requirement.toolChoiceCount) {
    issues.push({
      severity: 'error',
      code: 'CLASS_TOOL_CHOICE_COUNT',
      message: `${requirement.className} exige exatamente ${requirement.toolChoiceCount} escolha(s) de ${requirement.toolChoiceLabel ?? 'ferramenta'}.`
    });
  }

  const skills = unique([...background.skills, ...validClassSkills]);
  const validExpertise = unique(expertiseSkills).filter((skill) => skills.includes(skill));
  if (validExpertise.length !== requirement.expertiseChoiceCount) {
    issues.push({
      severity: 'error',
      code: 'EXPERTISE_CHOICE_COUNT',
      message: `A progressão atual exige exatamente ${requirement.expertiseChoiceCount} perícia(s) com Expertise entre as perícias proficientes.`
    });
  }

  const proficiencies: CharacterProficiencies = {
    skills,
    expertiseSkills: validExpertise,
    tools: unique([...background.tools, ...requirement.fixedTools, ...uniqueTools]),
    weapons: unique(requirement.weapons),
    armor: unique(requirement.armor),
    languages: unique([
      ...background.languages,
      ...speciesLanguageGrants,
      ...fixedLanguages,
      ...validLanguages,
      ...requirement.fixedLanguages,
      ...validClassLanguages
    ]),
    savingThrows: unique(requirement.savingThrows)
  };

  return {
    proficiencies,
    requirement,
    backgroundRequirement,
    issues,
    ok: !issues.some((entry) => entry.severity === 'error')
  };
};
