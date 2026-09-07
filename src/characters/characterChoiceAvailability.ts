import type { StoredCompendiumItem, StoredCompendiumItemStatus } from '../compendium/types';
import {
  findCompendiumItemByReference,
  getProgressionFeatureReferences
} from '../compendium/classProgression';

/**
 * Character creation/progression may surface active imported content that is
 * still awaiting editorial review. Selecting one of these records is an
 * explicit character-level decision: catalog-backed choices may be applied
 * without mutating the compendium's global editorial status. Disabled content
 * remains unavailable.
 */
export const REVIEWABLE_CHARACTER_CHOICE_STATUSES: StoredCompendiumItemStatus[] = [
  'validated',
  'needsReview',
  'draft'
];

/**
 * Collect the owner plus the class/subclass progression features that are
 * reachable at the selected class level. This mirrors species selection and
 * keeps the complete mechanical dependency set visible to the character flow
 * without treating character use as an editorial approval operation.
 */
export const getExplicitProgressionSelectionReviewItems = (
  owner: StoredCompendiumItem,
  items: StoredCompendiumItem[],
  classLevel: number
): StoredCompendiumItem[] => {
  const byId = new Map<string, StoredCompendiumItem>();
  byId.set(owner.id, owner);

  if (owner.type !== 'class' && owner.type !== 'subclass') {
    return Array.from(byId.values());
  }

  for (const reference of getProgressionFeatureReferences(owner, classLevel)) {
    const feature = findCompendiumItemByReference(items, reference);
    if (feature?.type === 'feature') byId.set(feature.id, feature);
  }

  return Array.from(byId.values());
};
