import type { StoredCompendiumItem } from '../compendium/types';
import { itemReferenceMatches } from './creationData';

export interface ChoiceReferenceLookupResult {
  choiceId: string;
  entityId: string;
  catalogEntityId?: string;
  compendiumItemId?: string;
  provenance?: {
    legacyItemIds?: string[];
  };
}

export type ChoiceReferenceLookup = (reference: string) => ChoiceReferenceLookupResult | undefined;

export interface SpellAssignmentReferenceReconciliationInput {
  assignments: Record<string, string>;
  spellbookAssignments: Record<string, string>;
  spellItems: StoredCompendiumItem[];
  classItems: StoredCompendiumItem[];
  validClassItemIds: string[];
  validSpellbookClassItemIds?: string[];
  choiceForItemId?: ChoiceReferenceLookup;
}

export interface SpellAssignmentReferenceReconciliationResult {
  assignments: Record<string, string>;
  spellbookAssignments: Record<string, string>;
  removedReferences: string[];
  changed: boolean;
}

const referenceAliases = (
  reference: string,
  choiceForItemId?: ChoiceReferenceLookup
): string[] => {
  const choice = choiceForItemId?.(reference);
  return Array.from(new Set([
    reference,
    choice?.choiceId,
    choice?.entityId,
    choice?.catalogEntityId,
    choice?.compendiumItemId,
    ...(choice?.provenance?.legacyItemIds ?? [])
  ].filter((entry): entry is string => Boolean(entry))));
};

const resolveCurrentItemId = (
  reference: string,
  candidates: StoredCompendiumItem[],
  choiceForItemId?: ChoiceReferenceLookup
): string | undefined => {
  const aliases = referenceAliases(reference, choiceForItemId);
  return candidates.find((item) =>
    aliases.some((alias) => itemReferenceMatches(item, alias))
    || aliases.includes(item.id)
  )?.id;
};

const reconcileMap = (
  source: Record<string, string>,
  spellItems: StoredCompendiumItem[],
  classItems: StoredCompendiumItem[],
  validClassItemIds: Set<string>,
  choiceForItemId?: ChoiceReferenceLookup
): { value: Record<string, string>; removedReferences: string[] } => {
  const value: Record<string, string> = {};
  const removedReferences: string[] = [];

  for (const [spellReference, classReference] of Object.entries(source)) {
    const classItemId = resolveCurrentItemId(classReference, classItems, choiceForItemId);
    if (!classItemId || !validClassItemIds.has(classItemId)) {
      removedReferences.push(spellReference, classReference);
      continue;
    }

    const spellItemId = resolveCurrentItemId(spellReference, spellItems, choiceForItemId);
    // Preserve a still-selected but currently unavailable spell reference. The
    // normal availability gate must keep blocking it instead of silently
    // deleting an explicit user choice. Only choices tied to a removed class
    // are discarded automatically.
    value[spellItemId ?? spellReference] = classItemId;
  }

  return { value, removedReferences };
};

export const assignmentMapsEqual = (
  left: Record<string, string>,
  right: Record<string, string>
): boolean => {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, value]) => right[key] === value);
};

export const reconcileSpellAssignmentReferences = ({
  assignments,
  spellbookAssignments,
  spellItems,
  classItems,
  validClassItemIds,
  validSpellbookClassItemIds = validClassItemIds,
  choiceForItemId
}: SpellAssignmentReferenceReconciliationInput): SpellAssignmentReferenceReconciliationResult => {
  const validClasses = new Set(validClassItemIds);
  const validSpellbookClasses = new Set(validSpellbookClassItemIds);
  const prepared = reconcileMap(assignments, spellItems, classItems, validClasses, choiceForItemId);
  const spellbook = reconcileMap(spellbookAssignments, spellItems, classItems, validSpellbookClasses, choiceForItemId);

  return {
    assignments: prepared.value,
    spellbookAssignments: spellbook.value,
    removedReferences: Array.from(new Set([...prepared.removedReferences, ...spellbook.removedReferences])),
    changed:
      !assignmentMapsEqual(assignments, prepared.value)
      || !assignmentMapsEqual(spellbookAssignments, spellbook.value)
  };
};
