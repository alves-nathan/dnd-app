import type { StoredCompendiumItem } from '../compendium/types';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const normalizeName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const sourceYear = (item: StoredCompendiumItem): number => {
  const candidates = [item.version, item.sourceId, item.importItemId];
  for (const candidate of candidates) {
    const match = candidate?.match(/\b(20\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return 0;
};

const preferenceScore = (item: StoredCompendiumItem): number => {
  const payload = asRecord(item.normalizedJson);
  const edition = asString(payload.rulesEdition);
  const compatibility = asString(payload.compatibility);
  const legacy = compatibility === 'legacySourceNative' || item.tags.some((tag) => tag.includes('legacy'));
  const currentRules = edition === '2024' || sourceYear(item) >= 2024;
  const status = item.status === 'validated' ? 3 : item.status === 'needsReview' ? 2 : item.status === 'draft' ? 1 : 0;

  return (currentRules ? 1_000_000 : 0) +
    (legacy ? 0 : 100_000) +
    (status * 10_000) +
    sourceYear(item);
};

/**
 * Character creation is 2024-first.  Source-qualified reprints remain in the
 * Compendium, but the choice UI should not render several indistinguishable
 * buttons for the same named class/species/subclass.  Keep the most suitable
 * version deterministically; nothing is deleted from storage.
 */
export const prefer2024FirstCharacterChoices = (
  items: StoredCompendiumItem[]
): StoredCompendiumItem[] => {
  const byKey = new Map<string, StoredCompendiumItem>();
  for (const item of items) {
    const key = `${item.type}:${normalizeName(item.name)}`;
    const current = byKey.get(key);
    if (!current || preferenceScore(item) > preferenceScore(current)) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values()).sort((left, right) => left.name.localeCompare(right.name));
};
