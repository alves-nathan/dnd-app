import type { StoredCompendiumItem } from '../compendium/types';
import type { CharacterChoiceItem } from './characterChoiceTypes';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export type CharacterChoiceLookup = (itemId: string) => CharacterChoiceItem | undefined;

/**
 * Items exposed by useCharacterChoiceBridge use canonical UI IDs such as
 * `compendium:<stored-id>`. Review persistence must always target the original
 * StoredCompendiumItem ID that exists in SQLite/AsyncStorage.
 */
export const getCompendiumReviewTargetId = (
  item: StoredCompendiumItem,
  choiceForItemId?: CharacterChoiceLookup
): string | undefined => {
  const choice = choiceForItemId?.(item.id);
  if (choice?.compendiumItemId) {
    return choice.compendiumItemId;
  }

  const normalized = asRecord(item.normalizedJson);
  const metadata = asRecord(normalized.__characterChoice);
  const provenance = asRecord(metadata.provenance);
  const originalItemId = asString(normalized.originalCompendiumItemId)
    ?? asString(provenance.compendiumItemId);
  if (originalItemId) return originalItemId;

  if (item.id.startsWith('compendium:')) {
    const stripped = item.id.slice('compendium:'.length).trim();
    return stripped || undefined;
  }

  return item.id;
};
