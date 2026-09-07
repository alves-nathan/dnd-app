import type { StoredCompendiumItem } from '../compendium/types';
import { itemReferenceMatches } from './creationData';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const variantType = (item: StoredCompendiumItem): string | undefined => {
  const payload = asRecord(item.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  return asString(payload.optionType) ?? asString(mechanics.optionType);
};

export const isNestedSpeciesVariant = (item: StoredCompendiumItem): boolean => {
  if (item.type !== 'species') return false;
  const payload = asRecord(item.normalizedJson);
  const type = normalize(variantType(item) ?? '');
  return type === 'subrace'
    || type === 'variantrace'
    || Boolean(asString(payload.inheritsFrom))
    || asStringArray(payload.inheritsFromChoice).length > 0;
};

const findSpeciesByReference = (
  items: StoredCompendiumItem[],
  reference: string
): StoredCompendiumItem | undefined => items.find((candidate) =>
  candidate.type === 'species' && itemReferenceMatches(candidate, reference)
);

const findSpeciesByName = (
  items: StoredCompendiumItem[],
  name: string
): StoredCompendiumItem | undefined => {
  const normalizedName = normalize(name);
  return items.find((candidate) => candidate.type === 'species' && normalize(candidate.name) === normalizedName);
};

/** Resolve the base species that owns a legacy subrace/variant record. */
export const getSpeciesVariantBaseItem = (
  item: StoredCompendiumItem | undefined,
  allSpecies: StoredCompendiumItem[]
): StoredCompendiumItem | undefined => {
  if (!item || item.type !== 'species' || !isNestedSpeciesVariant(item)) return item;
  const payload = asRecord(item.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const references = [
    asString(payload.inheritsFrom),
    asString(mechanics.inheritsFrom),
    ...asStringArray(payload.inheritsFromChoice),
    ...asStringArray(mechanics.inheritsFromChoice)
  ].filter((entry): entry is string => Boolean(entry));

  for (const reference of references) {
    const base = findSpeciesByReference(allSpecies, reference);
    if (base && !isNestedSpeciesVariant(base)) return base;
  }

  const baseName = asString(payload.baseSpecies) ?? asString(mechanics.baseSpecies);
  if (baseName) {
    for (const candidateName of baseName.split(/\s+or\s+/i)) {
      const base = findSpeciesByName(allSpecies, candidateName);
      if (base && !isNestedSpeciesVariant(base)) return base;
    }
  }
  return undefined;
};

export const getTopLevelSpeciesChoices = (
  speciesItems: StoredCompendiumItem[]
): StoredCompendiumItem[] => speciesItems.filter((item) => !isNestedSpeciesVariant(item));

export const getNestedSpeciesVariantsForBase = (
  baseSpecies: StoredCompendiumItem | undefined,
  allSpecies: StoredCompendiumItem[]
): StoredCompendiumItem[] => {
  if (!baseSpecies) return [];
  return allSpecies
    .filter(isNestedSpeciesVariant)
    .filter((candidate) => getSpeciesVariantBaseItem(candidate, allSpecies)?.id === baseSpecies.id)
    .sort((left, right) => left.name.localeCompare(right.name));
};

export const getSpeciesVariantLabel = (item: StoredCompendiumItem): string => {
  const payload = asRecord(item.normalizedJson);
  return asString(payload.dragonmark)
    ?? item.name.replace(/^Tiefling\s*\((.+)\)$/i, '$1').trim();
};

export const getSpeciesVariantRelationshipDescription = (
  item: StoredCompendiumItem,
  allSpecies: StoredCompendiumItem[]
): string | undefined => {
  if (!isNestedSpeciesVariant(item)) return undefined;
  const payload = asRecord(item.normalizedJson);
  const base = getSpeciesVariantBaseItem(item, allSpecies);
  const replaces = asStringArray(payload.replacesTraits)
    .map((entry) => entry.replace(/([a-z])([A-Z])/g, '$1 $2'));
  const dragonmark = asString(payload.dragonmark);
  const parts = [
    dragonmark ? `Dragonmark legado de ${base?.name ?? asString(payload.baseSpecies) ?? 'uma espécie-base'}.` : `Variante legada de ${base?.name ?? asString(payload.baseSpecies) ?? 'uma espécie-base'}.`,
    replaces.length ? `Substitui: ${replaces.join(', ')}.` : undefined,
    'Bônus de atributo legados são ignorados na criação 2024.'
  ].filter((entry): entry is string => Boolean(entry));
  return parts.join(' ');
};
