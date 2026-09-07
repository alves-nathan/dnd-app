import type { Character, CharacterSpeciesChoice, RuleValidationIssue } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { itemReferenceMatches } from './creationData';
import {
  getSpeciesChoiceRequirements,
  getSpeciesFeatureItems,
  speciesChoiceForRequirement
} from './speciesChoiceRules';
import { getClassSpellListReferences } from './spellListRules';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())) : [];
const normalize = (value: string): string => value
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const unique = <T,>(values: T[]): T[] => Array.from(new Set(values));

const spellLevel = (item: StoredCompendiumItem): number =>
  Math.max(0, Math.floor(asNumber(asRecord(item.normalizedJson).level) ?? 0));

const findSpell = (items: StoredCompendiumItem[], reference: string | undefined): StoredCompendiumItem | undefined =>
  reference ? items.find((item) => item.type === 'spell' && item.status !== 'disabled' && itemReferenceMatches(item, reference)) : undefined;

const classByName = (items: StoredCompendiumItem[], className: string): StoredCompendiumItem | undefined =>
  items.find((item) => item.type === 'class' && normalize(item.name) === normalize(className));

const candidateSpells = (
  items: StoredCompendiumItem[],
  sourceClassNames: string[],
  level: number
): StoredCompendiumItem[] => {
  const references = unique(sourceClassNames.flatMap((className) => {
    const classItem = classByName(items, className);
    return classItem ? getClassSpellListReferences(classItem, items, 20) : [];
  }));
  const byReference = references.flatMap((reference) => {
    const spell = findSpell(items, reference);
    return spell && spellLevel(spell) === level ? [spell] : [];
  });
  const payloadFallback = items.filter((item) => item.type === 'spell' && item.status !== 'disabled')
    .filter((item) => spellLevel(item) === level)
    .filter((item) => {
      const classes = asStringArray(asRecord(item.normalizedJson).classes).map(normalize);
      return sourceClassNames.some((className) => classes.includes(normalize(className)));
    });
  return Array.from(new Map([...byReference, ...payloadFallback].map((item) => [item.id, item] as const)).values())
    .sort((left, right) => left.name.localeCompare(right.name));
};

const selectedOption = (featureItem: StoredCompendiumItem, optionId: string | undefined): Record<string, unknown> => {
  if (!optionId) return {};
  const payload = asRecord(featureItem.normalizedJson);
  for (const key of ['ancestryOptions', 'lineageOptions', 'legacyOptions', 'options']) {
    const option = asRecord(asRecord(payload[key])[optionId]);
    if (Object.keys(option).length) return option;
  }
  return {};
};

const sourceListsFromReplacementText = (value: string): string[] => {
  const cleaned = value.replace(/cantrips?/gi, '').trim();
  return unique(cleaned.split(/[|,;/]+/g).map((entry) => entry.trim()).filter(Boolean));
};

export interface SpeciesSpellReplacementRequirement {
  id: string;
  speciesItemId: string;
  featureItemId: string;
  featureName: string;
  timing: 'longRest';
  spellLevel: number;
  sourceClassNames: string[];
  initialSpellItemId: string;
  currentSpellItemId: string;
  candidateSpells: StoredCompendiumItem[];
}

export const getSpeciesSpellReplacementRequirements = (
  speciesItem: StoredCompendiumItem | undefined,
  items: StoredCompendiumItem[],
  characterLevel: number,
  choices: CharacterSpeciesChoice[]
): SpeciesSpellReplacementRequirement[] => {
  if (!speciesItem) return [];
  const baseRequirements = getSpeciesChoiceRequirements(speciesItem, items, characterLevel);
  const result: SpeciesSpellReplacementRequirement[] = [];

  for (const featureItem of getSpeciesFeatureItems(speciesItem, items)) {
    const payload = asRecord(featureItem.normalizedJson);
    const mechanics = asRecord(payload.mechanics);
    const requirement = baseRequirements.find((entry) => entry.featureItemId === featureItem.id);
    const choice = requirement ? speciesChoiceForRequirement(choices, requirement) : undefined;
    if (requirement && !choice?.optionId) continue;

    const option = selectedOption(featureItem, choice?.optionId);
    const optionReplacement = asString(option.cantripReplacementOnLongRest);
    if (optionReplacement) {
      const sourceClassNames = sourceListsFromReplacementText(optionReplacement);
      const initialReference = asStringArray(option.level1SpellRefs)[0] ?? asStringArray(option.spellRefs)[0];
      const initialSpell = findSpell(items, initialReference);
      if (initialSpell && sourceClassNames.length) {
        const candidates = candidateSpells(items, sourceClassNames, 0);
        const currentSpell = findSpell(items, choice?.replacementSpellItemId) ?? initialSpell;
        result.push({
          id: `${featureItem.id}:long-rest-cantrip`,
          speciesItemId: speciesItem.id,
          featureItemId: featureItem.id,
          featureName: featureItem.name,
          timing: 'longRest',
          spellLevel: 0,
          sourceClassNames,
          initialSpellItemId: initialSpell.id,
          currentSpellItemId: currentSpell.id,
          candidateSpells: candidates
        });
      }
    }

    const spellChoice = asRecord(mechanics.spellChoice);
    const replacementTiming = normalize(asString(spellChoice.replacementTiming) ?? '');
    const initialReference = asString(spellChoice.initialSpellId);
    if (initialReference && replacementTiming.includes('long rest')) {
      const spellLevelValue = Math.max(0, Math.floor(asNumber(spellChoice.level) ?? 0));
      const sourceClassNames = unique([
        ...asStringArray(spellChoice.sourceLists),
        ...(asString(spellChoice.sourceList) ? [asString(spellChoice.sourceList)!] : [])
      ]);
      const initialSpell = findSpell(items, initialReference);
      if (initialSpell && sourceClassNames.length) {
        const candidates = candidateSpells(items, sourceClassNames, spellLevelValue);
        const currentSpell = findSpell(items, choice?.replacementSpellItemId)
          ?? findSpell(items, choice?.optionId)
          ?? initialSpell;
        result.push({
          id: `${featureItem.id}:long-rest-spell`,
          speciesItemId: speciesItem.id,
          featureItemId: featureItem.id,
          featureName: featureItem.name,
          timing: 'longRest',
          spellLevel: spellLevelValue,
          sourceClassNames,
          initialSpellItemId: initialSpell.id,
          currentSpellItemId: currentSpell.id,
          candidateSpells: candidates
        });
      }
    }
  }

  return Array.from(new Map(result.map((entry) => [entry.id, entry] as const)).values());
};

export const normalizeSpeciesSpellReplacementChoices = (
  speciesItem: StoredCompendiumItem | undefined,
  items: StoredCompendiumItem[],
  characterLevel: number,
  choices: CharacterSpeciesChoice[]
): CharacterSpeciesChoice[] => {
  if (!speciesItem) return choices;
  const requirements = getSpeciesChoiceRequirements(speciesItem, items, characterLevel);
  let changed = false;
  const normalizedChoices = choices.map((choice) => {
    const featureItem = getSpeciesFeatureItems(speciesItem, items).find((feature) => feature.id === choice.featureItemId);
    if (!featureItem) return choice;
    const spellChoice = asRecord(asRecord(featureItem.normalizedJson).mechanics);
    const definition = asRecord(spellChoice.spellChoice);
    const timing = normalize(asString(definition.replacementTiming) ?? '');
    const initialSpell = findSpell(items, asString(definition.initialSpellId));
    if (!initialSpell || !timing.includes('long rest')) return choice;
    if (itemReferenceMatches(initialSpell, choice.optionId)) return choice;
    const baseRequirement = requirements.find((entry) => entry.featureItemId === featureItem.id);
    if (!baseRequirement) return choice;
    const replacementRequirements = getSpeciesSpellReplacementRequirements(speciesItem, items, characterLevel, choices);
    const replacement = replacementRequirements.find((entry) => entry.featureItemId === featureItem.id);
    if (!replacement?.candidateSpells.some((spell) => itemReferenceMatches(spell, choice.optionId))) return choice;
    changed = true;
    return {
      ...choice,
      optionId: initialSpell.id,
      replacementSpellItemId: choice.replacementSpellItemId ?? choice.optionId
    };
  });
  return changed ? normalizedChoices : choices;
};

export const setSpeciesSpellReplacement = (
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesSpellReplacementRequirement,
  spellItemId: string
): CharacterSpeciesChoice[] => choices.map((choice) =>
  choice.featureItemId === requirement.featureItemId
    ? {
        ...choice,
        replacementSpellItemId: spellItemId === requirement.initialSpellItemId ? undefined : spellItemId
      }
    : choice
);

const effectiveReplacementSpellId = (
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesSpellReplacementRequirement
): string => choices.find((choice) => choice.featureItemId === requirement.featureItemId)?.replacementSpellItemId
  ?? requirement.initialSpellItemId;

const replacementUsedAt = (
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesSpellReplacementRequirement
): string | undefined => choices.find((choice) => choice.featureItemId === requirement.featureItemId)?.replacementUsedAt;

export const speciesSpellReplacementAvailable = (
  character: Character,
  choices: CharacterSpeciesChoice[],
  requirement: SpeciesSpellReplacementRequirement
): boolean => {
  if (!character.lastLongRestAt) return false;
  const usedAt = replacementUsedAt(choices, requirement);
  if (!usedAt) return true;
  return Date.parse(character.lastLongRestAt) > Date.parse(usedAt);
};

export const validateSpeciesSpellReplacementEdits = (
  character: Character,
  requirements: SpeciesSpellReplacementRequirement[],
  originalChoices: CharacterSpeciesChoice[],
  nextChoices: CharacterSpeciesChoice[]
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  for (const requirement of requirements) {
    const original = effectiveReplacementSpellId(originalChoices, requirement);
    const next = effectiveReplacementSpellId(nextChoices, requirement);
    if (original === next) continue;
    if (!requirement.candidateSpells.some((spell) => spell.id === next)) {
      issues.push({ severity: 'error', code: 'SPECIES_SPELL_REPLACEMENT_INVALID', message: `${requirement.featureName}: a magia substituta não pertence às listas permitidas.` });
      continue;
    }
    if (!speciesSpellReplacementAvailable(character, originalChoices, requirement)) {
      issues.push({ severity: 'error', code: 'SPECIES_SPELL_REPLACEMENT_REST_REQUIRED', message: `${requirement.featureName}: conclua um novo Descanso Longo antes de trocar a magia concedida.` });
    }
  }
  return issues;
};

export const markSpeciesSpellReplacementsUsed = (
  character: Character,
  requirements: SpeciesSpellReplacementRequirement[],
  originalChoices: CharacterSpeciesChoice[],
  nextChoices: CharacterSpeciesChoice[]
): CharacterSpeciesChoice[] => {
  if (!character.lastLongRestAt) return nextChoices;
  const changedFeatureIds = new Set(requirements.flatMap((requirement) =>
    effectiveReplacementSpellId(originalChoices, requirement) !== effectiveReplacementSpellId(nextChoices, requirement)
      ? [requirement.featureItemId]
      : []
  ));
  if (!changedFeatureIds.size) return nextChoices;
  return nextChoices.map((choice) => changedFeatureIds.has(choice.featureItemId)
    ? { ...choice, replacementUsedAt: character.lastLongRestAt }
    : choice
  );
};
