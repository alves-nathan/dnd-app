import type { StoredCompendiumItem } from './types';
import type { CompendiumPersistenceState } from '../storage/compendiumSnapshot';

export const CORE_CHARACTER_ITEM_TYPES = [
  'class',
  'subclass',
  'species',
  'background',
  'feat',
  'spell'
] as const;

const coreTypeSet = new Set<
  StoredCompendiumItem['type']
>(CORE_CHARACTER_ITEM_TYPES);

const asRecord = (
  value: unknown
): Record<string, unknown> =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (
  value: unknown
): string | undefined =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;

const asStringArray = (
  value: unknown
): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string'
      )
    : [];

const rawImportId = (
  item: StoredCompendiumItem
): string | undefined =>
  asString(asRecord(item.rawJson).id);

const collectProgressionReferences = (
  items: StoredCompendiumItem[]
): Set<string> => {
  const references = new Set<string>();

  for (const item of items) {
    if (
      item.type !== 'class' &&
      item.type !== 'subclass' &&
      item.type !== 'species' &&
      item.type !== 'background' &&
      item.type !== 'feat'
    ) {
      continue;
    }

    const payload = asRecord(item.normalizedJson);

    for (const featureId of [
      ...asStringArray(payload.featureIds),
      ...asStringArray(payload.grantsFeatureIds)
    ]) {
      references.add(featureId);
    }

    if (Array.isArray(payload.progression)) {
      for (const entry of payload.progression) {
        for (const featureId of asStringArray(
          asRecord(entry).featureIds
        )) {
          references.add(featureId);
        }
      }
    }
  }

  return references;
};

export const isCoreCharacterPreparationItem = (
  item: StoredCompendiumItem,
  allItems: StoredCompendiumItem[]
): boolean => {
  if (coreTypeSet.has(item.type)) return true;
  if (item.type !== 'feature') return false;

  const references =
    collectProgressionReferences(allItems);

  return [
    item.id,
    item.importItemId,
    rawImportId(item)
  ].some(
    (candidate) =>
      Boolean(candidate) &&
      references.has(candidate as string)
  );
};

export interface PrepareCoreCharacterContentOptions {
  now?: string;
  reviewedBy?: string;
  /** Optional scope used by additive bundled repairs/installations. */
  packIds?: readonly string[];
}

export interface PreparedCoreCharacterContent {
  snapshot: CompendiumPersistenceState;
  eligibleItemCount: number;
  newlyValidatedItemCount: number;
  enabledSourceCount: number;
  sourceIds: string[];
}

const unique = (values: string[]): string[] =>
  Array.from(new Set(values));

const approvalNote =
  'Aprovado em lote para uso na criação e progressão de personagem.';

const appendApprovalNote = (
  existing: string | undefined
): string => {
  if (!existing?.trim()) return approvalNote;

  if (existing.includes(approvalNote)) {
    return existing;
  }

  return `${existing.trim()}\n${approvalNote}`;
};

export const prepareCoreCharacterContentSnapshot = (
  snapshot: CompendiumPersistenceState,
  options: PrepareCoreCharacterContentOptions = {}
): PreparedCoreCharacterContent => {
  const now =
    options.now ?? new Date().toISOString();

  const reviewedBy =
    options.reviewedBy ??
    'Preparação em lote de criação e progressão';

  const packScope = options.packIds?.length ? new Set(options.packIds) : undefined;
  const eligibleItems = snapshot.items.filter(
    (item) =>
      (!packScope || packScope.has(item.packId)) &&
      item.status !== 'disabled' &&
      isCoreCharacterPreparationItem(
        item,
        snapshot.items
      )
  );

  const eligibleIds = new Set(
    eligibleItems.map((item) => item.id)
  );

  const sourceIds = unique(
    eligibleItems.map((item) => item.sourceId)
  );

  let newlyValidatedItemCount = 0;

  const items = snapshot.items.map((item) => {
    if (
      !eligibleIds.has(item.id) ||
      item.status === 'disabled' ||
      item.status === 'validated'
    ) {
      return item;
    }

    newlyValidatedItemCount += 1;

    return {
      ...item,
      status: 'validated' as const,
      reviewDecision: 'approved' as const,
      reviewNotes: appendApprovalNote(
        item.reviewNotes
      ),
      reviewedBy,
      reviewedAt: now,
      updatedAt: now
    };
  });

  const previouslyEnabled = new Set(
    snapshot.enabledSourceIds
  );

  const enabledSourceCount = sourceIds.filter(
    (sourceId) =>
      !previouslyEnabled.has(sourceId)
  ).length;

  return {
    snapshot: {
      ...snapshot,
      items,
      enabledSourceIds: unique([
        ...snapshot.enabledSourceIds,
        ...sourceIds
      ])
    },
    eligibleItemCount: eligibleItems.length,
    newlyValidatedItemCount,
    enabledSourceCount,
    sourceIds
  };
};
