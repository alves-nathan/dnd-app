import type { CharacterCompendiumLink } from '../types';
import type { StoredCompendiumItem } from './types';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const unique = (values: Array<string | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

const stripKnownReferencePrefix = (reference: string): string => {
  let current = reference.trim();
  let previous = '';
  while (current && current !== previous) {
    previous = current;
    current = current.replace(/^(catalog|compendium):/i, '');
  }
  return current;
};

const referenceKeys = (reference: string | undefined): string[] => {
  if (!reference?.trim()) return [];
  const trimmed = reference.trim();
  const bare = stripKnownReferencePrefix(trimmed);
  return unique([trimmed, bare]);
};

export const compendiumReferencesMatch = (
  left: string | undefined,
  right: string | undefined
): boolean => {
  const leftKeys = new Set(referenceKeys(left));
  return referenceKeys(right).some((key) => leftKeys.has(key));
};

const characterChoiceMetadata = (item: StoredCompendiumItem): Record<string, unknown> =>
  asRecord(item.normalizedJson.__characterChoice);

const rawImportItemId = (item: StoredCompendiumItem): string | undefined =>
  asString(asRecord(item.rawJson).id);

export const getCompendiumItemReferenceCandidates = (
  item: StoredCompendiumItem
): string[] => {
  const metadata = characterChoiceMetadata(item);
  return unique([
    asString(metadata.catalogEntityId),
    item.importItemId,
    rawImportItemId(item),
    asString(metadata.entityId),
    asString(metadata.choiceId),
    asString(item.normalizedJson.originalCompendiumItemId),
    asString(item.normalizedJson.id),
    item.id
  ]);
};

export const compendiumItemMatchesReference = (
  item: StoredCompendiumItem,
  reference: string | undefined
): boolean =>
  Boolean(reference) && getCompendiumItemReferenceCandidates(item).some((candidate) =>
    compendiumReferencesMatch(candidate, reference)
  );

/**
 * Resolves a free-form Compendium/catalog reference without changing the
 * historical first-match behavior used by non-character callers.
 */
export const findCompendiumItemByReference = (
  items: StoredCompendiumItem[],
  reference: string
): StoredCompendiumItem | undefined =>
  items.find((item) => compendiumItemMatchesReference(item, reference));

const logicalIdentityCandidates = (item: StoredCompendiumItem): string[] => {
  const metadata = characterChoiceMetadata(item);
  return unique([
    asString(metadata.catalogEntityId),
    item.importItemId,
    rawImportItemId(item),
    asString(metadata.entityId)
  ]);
};

export const getLogicalCompendiumItemKey = (
  item: StoredCompendiumItem
): string => {
  const preferred = logicalIdentityCandidates(item)[0] ?? item.id;
  return stripKnownReferencePrefix(preferred);
};

export const sameLogicalCompendiumItem = (
  left: StoredCompendiumItem,
  right: StoredCompendiumItem
): boolean => {
  if (left.id === right.id) return true;
  const leftCandidates = logicalIdentityCandidates(left);
  const rightCandidates = logicalIdentityCandidates(right);
  return leftCandidates.some((leftReference) =>
    rightCandidates.some((rightReference) =>
      compendiumReferencesMatch(leftReference, rightReference)
    )
  );
};

export const uniqueLogicalCompendiumItems = (
  items: StoredCompendiumItem[]
): StoredCompendiumItem[] =>
  Array.from(new Map(items.map((item) => [getLogicalCompendiumItemKey(item), item] as const)).values());

const linkReferenceWeights = (link: CharacterCompendiumLink): Array<{
  reference: string | undefined;
  weight: number;
}> => [
  { reference: link.catalogEntityId, weight: 400 },
  { reference: link.importItemId, weight: 300 },
  { reference: link.choiceId, weight: 200 },
  { reference: link.itemId, weight: 100 }
];

const itemMatchesLinkReference = (
  item: StoredCompendiumItem,
  reference: string | undefined
): boolean =>
  Boolean(reference) && getCompendiumItemReferenceCandidates(item).some((candidate) =>
    compendiumReferencesMatch(candidate, reference)
  );

const linkCandidateScore = (
  link: CharacterCompendiumLink,
  item: StoredCompendiumItem
): number =>
  linkReferenceWeights(link).reduce(
    (score, entry) => score + (itemMatchesLinkReference(item, entry.reference) ? entry.weight : 0),
    0
  );

/**
 * Resolves a persisted character link with stable identities taking priority
 * over the mutable storage carrier id. If two different logical items tie for
 * the best identity score, the result is intentionally undefined rather than
 * guessing.
 */
export const findCompendiumItemForCharacterLink = (
  items: StoredCompendiumItem[],
  link: CharacterCompendiumLink
): StoredCompendiumItem | undefined => {
  const expectedType = link.itemType ?? link.appliedAs;
  const scored = items
    .filter((item) => item.type === expectedType)
    .map((item) => ({ item, score: linkCandidateScore(link, item) }))
    .filter(({ score }) => score > 0);

  if (!scored.length) return undefined;

  const bestScore = Math.max(...scored.map(({ score }) => score));
  const best = scored.filter(({ score }) => score === bestScore).map(({ item }) => item);
  const uniqueBest = uniqueLogicalCompendiumItems(best);
  if (uniqueBest.length !== 1) return undefined;

  const logical = uniqueBest[0]!;
  return best.find((item) => sameLogicalCompendiumItem(item, logical)) ?? logical;
};

export const characterLinkMatchesCompendiumItem = (
  items: StoredCompendiumItem[],
  link: CharacterCompendiumLink,
  item: StoredCompendiumItem
): boolean => {
  const resolved = findCompendiumItemForCharacterLink(items, link);
  return Boolean(resolved && sameLogicalCompendiumItem(resolved, item));
};

export const characterLinkMatchesReference = (
  items: StoredCompendiumItem[],
  link: CharacterCompendiumLink,
  reference: string
): boolean => {
  const resolved = findCompendiumItemForCharacterLink(items, link);
  return Boolean(resolved && compendiumItemMatchesReference(resolved, reference));
};
