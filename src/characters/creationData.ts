import type { AbilityScore, CharacterProficiencies } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { emptyCharacterProficiencies, mergeProficiencies } from './proficiencies';

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asString = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asStringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())) : [];
const abilitySet = new Set(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
export const ALL_BACKGROUND_ABILITY_OPTIONS: AbilityScore[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const asAbilities = (value: unknown): AbilityScore[] => asStringArray(value).map((entry) => entry.toUpperCase()).filter((entry): entry is AbilityScore => abilitySet.has(entry));

export const itemReferenceMatches = (item: StoredCompendiumItem, reference: string): boolean =>
  item.id === reference || item.importItemId === reference || asString(asRecord(item.rawJson).id) === reference;

export const backgroundSuggestions = (item?: StoredCompendiumItem) => {
  const payload = asRecord(item?.normalizedJson);
  return {
    abilityOptions: asAbilities(payload.abilityScoreOptions),
    featIds: asStringArray(payload.featIds),
    proficiencies: {
      ...emptyCharacterProficiencies(),
      skills: asStringArray(payload.skillProficiencies),
      tools: asStringArray(payload.toolProficiencies),
      languages: asStringArray(payload.languages)
    }
  };
};


export const getBackgroundAbilityOptions = (item?: StoredCompendiumItem): AbilityScore[] => {
  const configured = backgroundSuggestions(item).abilityOptions;
  return configured.length ? configured : [...ALL_BACKGROUND_ABILITY_OPTIONS];
};

export const speciesHasIgnoredAbilityScoreIncrease = (item?: StoredCompendiumItem): boolean => {
  if (!item || item.type !== 'species') return false;
  const payload = asRecord(item.normalizedJson);
  return payload.abilityScoreIncreaseRule !== undefined || payload.abilityScoreIncrease !== undefined;
};

export const classProficiencies = (item: StoredCompendiumItem): CharacterProficiencies => {
  const payload = asRecord(item.normalizedJson);
  return {
    skills: asStringArray(payload.skillProficiencies),
    expertiseSkills: [],
    tools: asStringArray(payload.toolProficiencies),
    weapons: asStringArray(payload.weaponProficiencies),
    armor: asStringArray(payload.armorTraining ?? payload.armorProficiencies),
    languages: asStringArray(payload.languages),
    savingThrows: asAbilities(payload.savingThrowProficiencies)
  };
};

export const suggestedProficienciesForItems = (items: StoredCompendiumItem[]): CharacterProficiencies =>
  items.reduce((result, item) => item.type === 'background' ? mergeProficiencies(result, backgroundSuggestions(item).proficiencies) : item.type === 'class' ? mergeProficiencies(result, classProficiencies(item)) : result, emptyCharacterProficiencies());

export const featCategory = (item: StoredCompendiumItem): string => {
  const payload = asRecord(item.normalizedJson);
  return (asString(payload.category) ?? asString(payload.featCategory) ?? asString(payload.type) ?? '').toLowerCase();
};

export const isOriginFeatItem = (item: StoredCompendiumItem): boolean =>
  item.type === 'feat' && (featCategory(item).includes('origin') || item.tags.some((tag) => tag.toLowerCase().includes('origin')) || /origin feat/i.test(item.summary ?? ''));

export const getSelectableFeatCandidates = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): StoredCompendiumItem[] => {
  const enabledSources = new Set(enabledSourceIds);
  return items
    .filter((item) => item.type === 'feat' && item.status !== 'disabled')
    .filter((item) => enabledSources.has(item.sourceId))
    .sort((left, right) => left.name.localeCompare(right.name));
};


export const getSelectableSpellCandidates = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): StoredCompendiumItem[] => {
  const enabledSources = new Set(enabledSourceIds);
  return items
    .filter((item) => item.type === 'spell' && item.status !== 'disabled')
    .filter((item) => enabledSources.has(item.sourceId))
    .sort((left, right) => {
      const leftLevel = Number(asRecord(left.normalizedJson).level ?? 0);
      const rightLevel = Number(asRecord(right.normalizedJson).level ?? 0);
      return leftLevel - rightLevel || left.name.localeCompare(right.name);
    });
};

export const getCompendiumChoiceDescription = (
  item: StoredCompendiumItem
): string => {
  const payload = asRecord(item.normalizedJson);
  const description = (
    asString(item.summary) ??
    asString(payload.summary) ??
    asString(payload.description) ??
    'Descrição resumida indisponível. Consulte os detalhes do item no compêndio.'
  );
  const metadata = asRecord(payload.__characterChoice);
  const provenance = asRecord(metadata.provenance);
  const origin = asString(metadata.origin);
  const source = asString(provenance.sourceBookId) ?? asString(provenance.sourceId) ?? item.sourceId;
  const review = metadata.manualReviewRequired === true ? ' · revisão editorial' : '';
  const originLabel = origin === 'catalog' ? 'Oficial' : origin === 'compendium' ? 'Local/homebrew' : undefined;
  return originLabel ? `${description}
${originLabel} · ${source}${review}` : description;
};
