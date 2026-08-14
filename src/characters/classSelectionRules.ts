import type { StoredCompendiumItem } from '../compendium/types';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

export const isSidekickClassItem = (item: StoredCompendiumItem): boolean => {
  if (item.type !== 'class') return false;
  const mechanics = asRecord(item.normalizedJson.mechanics);
  if (mechanics?.sidekickClass === true) return true;

  // Compatibility fallback for older persisted snapshots that may predate the
  // structured mechanics marker but still preserve the imported sidekick tag/id.
  return item.tags.some((tag) => tag.trim().toLowerCase() === 'sidekick') ||
    item.importItemId.includes('-class-sidekick-');
};

export const isPlayerCharacterClassItem = (item: StoredCompendiumItem): boolean =>
  item.type === 'class' && !isSidekickClassItem(item);
