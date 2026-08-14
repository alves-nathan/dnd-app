import type { CompendiumImportItem } from './importDomain';
import type { CanonicalImportPackForPreview, CompendiumImportV2Preview, ImportPreviewDisposition } from './importPreview';

export type ImportUpsertOperationKind = Extract<ImportPreviewDisposition, 'create' | 'update'>;

export interface CompendiumImportUpsertOperation {
  kind: ImportUpsertOperationKind;
  itemId: string;
  contentHash: string;
  item: CompendiumImportItem;
  existingStorageId?: string;
  changedPaths: string[];
}

export interface CompendiumImportV2UpsertPlan {
  packId: string;
  creates: CompendiumImportUpsertOperation[];
  updates: CompendiumImportUpsertOperation[];
  unchangedItemIds: string[];
  /** Canonical hashes retained so persistence can backfill legacy rows without re-diffing. */
  unchangedContentHashes: Record<string, string>;
  conflictItemIds: string[];
  executable: boolean;
}

/**
 * Converts an immutable preview into deterministic storage intentions.
 * Execution itself belongs to the persistence phase; this function never
 * writes to SQLite/AsyncStorage.
 */
export const createCompendiumImportV2UpsertPlan = (
  pack: CanonicalImportPackForPreview,
  preview: CompendiumImportV2Preview
): CompendiumImportV2UpsertPlan => {
  const itemsById = new Map(pack.items.map((item) => [item.id, item] as const));
  const creates: CompendiumImportUpsertOperation[] = [];
  const updates: CompendiumImportUpsertOperation[] = [];
  const unchangedItemIds: string[] = [];
  const unchangedContentHashes: Record<string, string> = {};
  const conflictItemIds: string[] = [];

  for (const decision of preview.decisions) {
    const item = itemsById.get(decision.itemId);
    if (!item) throw new Error(`Preview references missing incoming item ${decision.itemId}.`);

    if (decision.disposition === 'create') {
      creates.push({
        kind: 'create',
        itemId: decision.itemId,
        contentHash: decision.incomingHash,
        item,
        changedPaths: []
      });
    } else if (decision.disposition === 'update') {
      updates.push({
        kind: 'update',
        itemId: decision.itemId,
        contentHash: decision.incomingHash,
        item,
        existingStorageId: decision.existingStorageId,
        changedPaths: decision.changedPaths
      });
    } else if (decision.disposition === 'unchanged') {
      unchangedItemIds.push(decision.itemId);
      unchangedContentHashes[decision.itemId] = decision.incomingHash;
    } else {
      conflictItemIds.push(decision.itemId);
    }
  }

  return {
    packId: pack.id,
    creates,
    updates,
    unchangedItemIds,
    unchangedContentHashes,
    conflictItemIds,
    executable: preview.valid && conflictItemIds.length === 0
  };
};
