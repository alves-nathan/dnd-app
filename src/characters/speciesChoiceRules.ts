import type {
  AbilityScore,
  Character,
  CharacterSpeciesChoice,
  CreatureSize,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { itemReferenceMatches } from './creationData';
import { SKILLS } from './proficiencies';
import { ALL_LANGUAGE_OPTIONS } from './choiceOptions';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];

const abilitySet = new Set<AbilityScore>(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
const creatureSizeSet = new Set<CreatureSize>(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']);

const asAbilities = (value: unknown): AbilityScore[] =>
  asStringArray(value)
    .map((entry) => entry.toUpperCase())
    .filter((entry): entry is AbilityScore => abilitySet.has(entry as AbilityScore));

const titleCase = (value: string): string =>
  value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bClouds\b/, "Cloud's")
    .replace(/\bFires\b/, "Fire's")
    .replace(/\bFrosts\b/, "Frost's")
    .replace(/\bHills\b/, "Hill's")
    .replace(/\bStones\b/, "Stone's")
    .replace(/\bStorms\b/, "Storm's");

const optionLabel = (id: string, value: unknown): string => {
  const base = titleCase(id);
  if (typeof value === 'string' && value.trim()) return `${base} · ${titleCase(value)}`;
  const record = asRecord(value);
  const resistance = asString(record.resistance);
  if (resistance) return `${base} · resistência a ${resistance}`;
  return base;
};

export type SpeciesChoiceKind = 'ancestry' | 'lineage' | 'legacy' | 'revelation' | 'option' | 'size' | 'variableTrait' | 'language';

export interface SpeciesChoiceOption {
  id: string;
  label: string;
  skillChoiceCount?: number;
  skillOptions?: string[];
}

export interface SpeciesChoiceRequirement {
  speciesItemId: string;
  featureItemId: string;
  featureName: string;
  kind: SpeciesChoiceKind;
  levelGained: number;
  options: SpeciesChoiceOption[];
  spellcastingAbilityOptions: AbilityScore[];
}

export interface SpeciesFeatChoiceRequirement {
  speciesItemId: string;
  count: number;
  mustQualify: boolean;
  acquisitionLevel: number;
  restriction?: string;
}

const optionsFromRecord = (value: unknown): SpeciesChoiceOption[] =>
  Object.entries(asRecord(value)).map(([id, option]) => ({ id, label: optionLabel(id, option) }));

const effectTemplateOptions = (payload: Record<string, unknown>): SpeciesChoiceOption[] => {
  const templates = Array.isArray(payload.effectTemplates) ? payload.effectTemplates : [];
  for (const template of templates) {
    const record = asRecord(template);
    if (!record.choiceRequired || !Array.isArray(record.options)) continue;
    const options = record.options
      .map((entry) => asRecord(entry))
      .map((entry) => asString(entry.id))
      .filter((entry): entry is string => Boolean(entry))
      .map((id) => ({ id, label: titleCase(id) }));
    if (options.length) return options;
  }
  return [];
};

const choiceDefinition = (
  speciesItem: StoredCompendiumItem,
  featureItem: StoredCompendiumItem
): SpeciesChoiceRequirement | undefined => {
  const payload = asRecord(featureItem.normalizedJson);
  const levelGained = Math.max(1, asNumber(payload.levelGained) ?? 1);
  const spellcastingAbilityOptions = asAbilities(payload.spellcastingAbilityChoice);

  const definitions: Array<{ key: string; kind: SpeciesChoiceKind }> = [
    { key: 'ancestryOptions', kind: 'ancestry' },
    { key: 'lineageOptions', kind: 'lineage' },
    { key: 'legacyOptions', kind: 'legacy' },
    { key: 'options', kind: 'option' }
  ];

  for (const definition of definitions) {
    const options = optionsFromRecord(payload[definition.key]);
    if (options.length) {
      return {
        speciesItemId: speciesItem.id,
        featureItemId: featureItem.id,
        featureName: featureItem.name,
        kind: definition.kind,
        levelGained,
        options,
        spellcastingAbilityOptions
      };
    }
  }

  const revelationOptions = effectTemplateOptions(payload);
  if (revelationOptions.length) {
    return {
      speciesItemId: speciesItem.id,
      featureItemId: featureItem.id,
      featureName: featureItem.name,
      kind: 'revelation',
      levelGained,
      options: revelationOptions,
      spellcastingAbilityOptions
    };
  }

  return undefined;
};

const directChoiceDefinitions = (speciesItem: StoredCompendiumItem): SpeciesChoiceRequirement[] => {
  const payload = asRecord(speciesItem.normalizedJson);
  const requirements: SpeciesChoiceRequirement[] = [];
  const sizes = asStringArray(payload.sizeOptions).filter((entry) => creatureSizeSet.has(entry as CreatureSize));
  if (sizes.length > 1) {
    requirements.push({
      speciesItemId: speciesItem.id,
      featureItemId: `${speciesItem.id}::size`,
      featureName: 'Tamanho',
      kind: 'size',
      levelGained: 1,
      options: sizes.map((size) => ({ id: size, label: size })),
      spellcastingAbilityOptions: []
    });
  }

  const languageChoice = asRecord(payload.languageProficiencyChoice);
  const languageChoiceCount = Math.max(0, Math.floor(asNumber(languageChoice.count) ?? 0));
  if (languageChoiceCount > 0) {
    const configuredLanguages = asStringArray(languageChoice.options);
    requirements.push({
      speciesItemId: speciesItem.id,
      featureItemId: `${speciesItem.id}::language`,
      featureName: 'Idioma da espécie',
      kind: 'language',
      levelGained: 1,
      options: (configuredLanguages.length ? configuredLanguages : ALL_LANGUAGE_OPTIONS).map((language) => ({ id: language, label: language })),
      spellcastingAbilityOptions: []
    });
  }

  const variableTraitChoice = asRecord(payload.variableTraitChoice);
  const variableOptions = Array.isArray(variableTraitChoice.options) ? variableTraitChoice.options : [];
  if (variableOptions.length) {
    const options: SpeciesChoiceOption[] = variableOptions.flatMap((raw): SpeciesChoiceOption[] => {
      const option = asRecord(raw);
      const id = asString(option.id);
      if (!id) return [];
      const grants = asRecord(option.grants);
      const skillChoice = asRecord(grants.skillProficiencyChoice);
      const skillChoiceCount = Math.max(0, Math.floor(asNumber(skillChoice.count) ?? 0));
      const skillDescriptor = skillChoice.options;
      return [{
        id,
        label: id === 'darkvision' ? 'Darkvision · 60 ft' : id === 'skill-proficiency' ? 'Proficiência em perícia' : titleCase(id),
        skillChoiceCount,
        skillOptions: skillChoiceCount > 0
          ? (skillDescriptor === 'anySkill' ? [...SKILLS] : asStringArray(skillDescriptor))
          : undefined
      }];
    });
    if (options.length) {
      requirements.push({
        speciesItemId: speciesItem.id,
        featureItemId: `${speciesItem.id}::variable-trait`,
        featureName: 'Traço variável',
        kind: 'variableTrait',
        levelGained: 1,
        options,
        spellcastingAbilityOptions: []
      });
    }
  }
  return requirements;
};

export const getSpeciesFeatChoiceRequirement = (
  speciesItem: StoredCompendiumItem | undefined
): SpeciesFeatChoiceRequirement | undefined => {
  if (!speciesItem) return undefined;
  const featChoice = asRecord(asRecord(speciesItem.normalizedJson).featChoice);
  const count = Math.max(0, Math.floor(asNumber(featChoice.count) ?? 0));
  if (!count) return undefined;
  const speciesMechanics = asRecord(asRecord(speciesItem.normalizedJson).mechanics);
  const acquisitionLevel = Math.max(1, Math.floor(
    asNumber(featChoice.levelGained) ?? asNumber(speciesMechanics.availableAtCharacterLevel) ?? 1
  ));
  return {
    speciesItemId: speciesItem.id,
    count,
    mustQualify: featChoice.mustQualify !== false,
    acquisitionLevel,
    restriction: asString(featChoice.restriction)
  };
};

export const getSpeciesFeatureItems = (
  speciesItem: StoredCompendiumItem | undefined,
  allItems: StoredCompendiumItem[]
): StoredCompendiumItem[] => {
  if (!speciesItem) return [];
  const references = asStringArray(asRecord(speciesItem.normalizedJson).featureIds);
  return references
    .map((reference) => allItems.find((item) => item.type === 'feature' && itemReferenceMatches(item, reference)))
    .filter((item): item is StoredCompendiumItem => Boolean(item));
};

export const getSpeciesChoiceRequirements = (
  speciesItem: StoredCompendiumItem | undefined,
  allItems: StoredCompendiumItem[],
  characterLevel: number
): SpeciesChoiceRequirement[] => {
  if (!speciesItem) return [];
  return [
    ...directChoiceDefinitions(speciesItem),
    ...getSpeciesFeatureItems(speciesItem, allItems)
      .map((featureItem) => choiceDefinition(speciesItem, featureItem))
      .filter((requirement): requirement is SpeciesChoiceRequirement => Boolean(requirement))
  ].filter((requirement) => requirement.levelGained <= characterLevel);
};

export const speciesChoiceForRequirement = (
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesChoiceRequirement
): CharacterSpeciesChoice | undefined =>
  choices.find((choice) =>
    choice.speciesItemId === requirement.speciesItemId &&
    choice.featureItemId === requirement.featureItemId
  );

export const setSpeciesChoiceOption = (
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesChoiceRequirement,
  optionId: string
): CharacterSpeciesChoice[] => {
  const current = speciesChoiceForRequirement(choices, requirement);
  const next: CharacterSpeciesChoice = {
    speciesItemId: requirement.speciesItemId,
    featureItemId: requirement.featureItemId,
    choiceKind: requirement.kind,
    optionId,
    spellcastingAbility: current?.spellcastingAbility,
    skill: current?.optionId === optionId ? current.skill : undefined,
    language: current?.optionId === optionId ? current.language : undefined
  };
  return [
    ...choices.filter((choice) => choice.featureItemId !== requirement.featureItemId),
    next
  ];
};

export const setSpeciesChoiceSkill = (
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesChoiceRequirement,
  skill: string
): CharacterSpeciesChoice[] => {
  const current = speciesChoiceForRequirement(choices, requirement);
  const next: CharacterSpeciesChoice = {
    speciesItemId: requirement.speciesItemId,
    featureItemId: requirement.featureItemId,
    choiceKind: requirement.kind,
    optionId: current?.optionId ?? '',
    spellcastingAbility: current?.spellcastingAbility,
    skill
  };
  return [...choices.filter((choice) => choice.featureItemId !== requirement.featureItemId), next];
};

export const setSpeciesChoiceSpellcastingAbility = (
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesChoiceRequirement,
  spellcastingAbility: AbilityScore
): CharacterSpeciesChoice[] => {
  const current = speciesChoiceForRequirement(choices, requirement);
  const next: CharacterSpeciesChoice = {
    speciesItemId: requirement.speciesItemId,
    featureItemId: requirement.featureItemId,
    choiceKind: requirement.kind,
    optionId: current?.optionId ?? '',
    spellcastingAbility,
    skill: current?.skill,
    language: current?.language
  };
  return [
    ...choices.filter((choice) => choice.featureItemId !== requirement.featureItemId),
    next
  ];
};

export const validateSpeciesChoices = (
  requirements: SpeciesChoiceRequirement[],
  choices: CharacterSpeciesChoice[]
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  for (const requirement of requirements) {
    const choice = speciesChoiceForRequirement(choices, requirement);
    if (!choice?.optionId) {
      issues.push({ severity: 'error', code: 'SPECIES_OPTION_REQUIRED', message: `Escolha uma opção para ${requirement.featureName}.` });
      continue;
    }
    const option = requirement.options.find((candidate) => candidate.id === choice.optionId);
    if (!option) {
      issues.push({ severity: 'error', code: 'SPECIES_OPTION_INVALID', message: `A opção escolhida para ${requirement.featureName} não está disponível.` });
      continue;
    }
    if (option.skillChoiceCount && (!choice.skill || !(option.skillOptions ?? []).includes(choice.skill))) {
      issues.push({ severity: 'error', code: 'SPECIES_SKILL_REQUIRED', message: `Escolha uma perícia para ${requirement.featureName}.` });
    }
    if (
      requirement.spellcastingAbilityOptions.length > 0 &&
      (!choice.spellcastingAbility || !requirement.spellcastingAbilityOptions.includes(choice.spellcastingAbility))
    ) {
      issues.push({ severity: 'error', code: 'SPECIES_SPELLCASTING_ABILITY_REQUIRED', message: `Escolha o atributo de conjuração de ${requirement.featureName}.` });
    }
  }
  return issues;
};

export const getSpeciesChoiceProficiencyGrants = (
  requirements: SpeciesChoiceRequirement[],
  choices: CharacterSpeciesChoice[]
): { skills: string[]; languages: string[] } => ({
  skills: Array.from(new Set(requirements.flatMap((requirement) => {
    const option = requirement.options.find((candidate) => candidate.id === speciesChoiceForRequirement(choices, requirement)?.optionId);
    const choice = speciesChoiceForRequirement(choices, requirement);
    return option?.skillChoiceCount && choice?.skill && (option.skillOptions ?? []).includes(choice.skill) ? [choice.skill] : [];
  }))),
  languages: Array.from(new Set(requirements.flatMap((requirement) => {
    const choice = speciesChoiceForRequirement(choices, requirement);
    return requirement.kind === 'language' && choice?.optionId && requirement.options.some((option) => option.id === choice.optionId)
      ? [choice.optionId]
      : [];
  })))
});

export const applyDirectSpeciesChoiceEffects = (
  character: Character,
  speciesItem: StoredCompendiumItem,
  requirements: SpeciesChoiceRequirement[],
  choices: CharacterSpeciesChoice[]
): Character => {
  let next = character;
  const sizeRequirement = requirements.find((requirement) => requirement.kind === 'size');
  const sizeChoice = sizeRequirement ? speciesChoiceForRequirement(choices, sizeRequirement) : undefined;
  if (next.species && sizeChoice && creatureSizeSet.has(sizeChoice.optionId as CreatureSize)) {
    next = { ...next, species: { ...next.species, size: sizeChoice.optionId as CreatureSize } };
  }

  const senseId = `species-choice-${speciesItem.id}-darkvision`;
  const variableRequirement = requirements.find((requirement) => requirement.kind === 'variableTrait');
  const variableChoice = variableRequirement ? speciesChoiceForRequirement(choices, variableRequirement) : undefined;
  const retainedSenses = (next.senses ?? []).filter((sense) => sense.id !== senseId);
  if (variableChoice?.optionId === 'darkvision') {
    next = {
      ...next,
      senses: [...retainedSenses, { id: senseId, name: 'Darkvision', kind: 'darkvision', rangeFeet: 60, notes: `Escolha de ${speciesItem.name}.` }]
    };
  } else if ((next.senses ?? []).length !== retainedSenses.length) {
    next = { ...next, senses: retainedSenses };
  }
  return next;
};

const speciesReference = (speciesItem: StoredCompendiumItem): string =>
  asString(asRecord(speciesItem.rawJson).id) ?? speciesItem.importItemId;

const featureSpeciesReference = (featureItem: StoredCompendiumItem): string | undefined =>
  asString(asRecord(featureItem.normalizedJson).speciesId);

const choiceExistsForFeature = (
  character: Character,
  speciesItem: StoredCompendiumItem,
  featureItem: StoredCompendiumItem
): boolean => {
  const requirement = choiceDefinition(speciesItem, featureItem);
  if (!requirement || requirement.levelGained > character.level) return true;
  return validateSpeciesChoices([requirement], character.buildChoices?.speciesChoices ?? []).length === 0;
};

export const removeSpeciesProgressionFeatures = (
  character: Character,
  allItems: StoredCompendiumItem[]
): Character => {
  const speciesFeatureLinks = (character.compendiumLinks ?? []).filter((link) => {
    if (link.appliedAs !== 'feature' || link.status !== 'active') return false;
    const item = allItems.find((candidate) => candidate.id === link.itemId);
    return Boolean(item && featureSpeciesReference(item));
  });
  if (!speciesFeatureLinks.length) return character;
  const entityIds = new Set(speciesFeatureLinks.map((link) => link.appliedEntityId));
  const resourceIds = new Set(
    character.features
      .filter((feature) => entityIds.has(feature.id))
      .map((feature) => feature.resource?.id)
      .filter((id): id is string => Boolean(id))
  );
  return {
    ...character,
    features: character.features.filter((feature) => !entityIds.has(feature.id)),
    resources: character.resources.filter((resource) => !resourceIds.has(resource.id)),
    compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
      speciesFeatureLinks.some((speciesLink) => speciesLink.id === link.id)
        ? { ...link, status: 'removed' as const }
        : link
    )
  };
};

export interface ApplyAutomaticSpeciesProgressionResult {
  character: Character;
  appliedItems: StoredCompendiumItem[];
  issues: RuleValidationIssue[];
}

export const applyAutomaticSpeciesProgression = (
  character: Character,
  allItems: StoredCompendiumItem[]
): ApplyAutomaticSpeciesProgressionResult => {
  const speciesLink = (character.compendiumLinks ?? []).find(
    (link) => link.appliedAs === 'species' && link.status === 'active'
  );
  const speciesItem = allItems.find((item) => item.id === speciesLink?.itemId && item.type === 'species');
  if (!speciesItem) return { character, appliedItems: [], issues: [] };

  let next = character;
  const issues: RuleValidationIssue[] = [];
  const appliedItems: StoredCompendiumItem[] = [];
  const currentSpeciesReference = speciesReference(speciesItem);

  const staleFeatureLinks = (next.compendiumLinks ?? []).filter((link) => {
    if (link.appliedAs !== 'feature' || link.status !== 'active') return false;
    const item = allItems.find((candidate) => candidate.id === link.itemId);
    const owner = item ? featureSpeciesReference(item) : undefined;
    return Boolean(owner && owner !== currentSpeciesReference);
  });

  if (staleFeatureLinks.length) {
    const staleEntityIds = new Set(staleFeatureLinks.map((link) => link.appliedEntityId));
    const staleResourceIds = new Set(
      next.features
        .filter((feature) => staleEntityIds.has(feature.id))
        .map((feature) => feature.resource?.id)
        .filter((id): id is string => Boolean(id))
    );
    next = {
      ...next,
      features: next.features.filter((feature) => !staleEntityIds.has(feature.id)),
      resources: next.resources.filter((resource) => !staleResourceIds.has(resource.id)),
      compendiumLinks: (next.compendiumLinks ?? []).map((link) =>
        staleFeatureLinks.some((stale) => stale.id === link.id)
          ? { ...link, status: 'removed' as const }
          : link
      )
    };
  }

  for (const featureItem of getSpeciesFeatureItems(speciesItem, allItems)) {
    const levelGained = Math.max(1, asNumber(asRecord(featureItem.normalizedJson).levelGained) ?? 1);
    if (levelGained > next.level) continue;
    if (!choiceExistsForFeature(next, speciesItem, featureItem)) {
      issues.push({
        severity: 'warning',
        code: 'SPECIES_FEATURE_CHOICE_PENDING',
        message: `A escolha de ${featureItem.name} ainda está pendente.`
      });
      continue;
    }
    if (featureItem.status !== 'validated') {
      issues.push({
        severity: 'warning',
        code: 'SPECIES_FEATURE_NOT_VALIDATED',
        message: `A feature de espécie "${featureItem.name}" ainda precisa ser validada.`
      });
      continue;
    }
    const alreadyLinked = (next.compendiumLinks ?? []).some(
      (link) => link.itemId === featureItem.id && link.status === 'active'
    );
    if (alreadyLinked) continue;
    const result = applyCompendiumItemToCharacter(next, featureItem);
    if (result.ok) {
      next = result.character;
      appliedItems.push(featureItem);
    } else {
      issues.push(...result.issues);
    }
  }

  return { character: next, appliedItems, issues };
};
