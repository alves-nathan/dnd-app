import type { RuleSource } from '../types';
import { createImportContentHash } from '../compendium/importContentHash';
import type {
  CanonicalImportPackForPreview,
  ExistingCompendiumPreviewItem
} from '../compendium/importPreview';
import type {
  CompendiumImportUpsertOperation,
  CompendiumImportV2UpsertPlan
} from '../compendium/importUpsertPlan';
import { IMPORT_TEMPLATE_VERSION_V2 } from '../compendium/importVersions';
import type { CompendiumImportItem, CompendiumImportSource } from '../compendium/importDomain';
import type {
  StoredCompendiumItem,
  StoredCompendiumItemStatus,
  StoredCompendiumPack,
  StoredCompendiumReviewDecision
} from '../compendium/types';
import type { CompendiumPersistenceState } from './compendiumSnapshot';

export interface CompendiumImportV2PersistenceOptions {
  importedAt?: string;
}

export interface CompendiumImportV2PersistenceSummary {
  packId: string;
  created: number;
  updated: number;
  unchanged: number;
  contentHashesBackfilled: number;
  preservedStorageIds: string[];
}

export interface CompendiumImportV2PersistenceResult {
  snapshot: CompendiumPersistenceState;
  pack: StoredCompendiumPack;
  summary: CompendiumImportV2PersistenceSummary;
}

const unique = (values: string[]): string[] => Array.from(new Set(values));

const isReviewRequired = (source: CompendiumImportSource): boolean =>
  source.status !== 'active' || source.confidence !== 'exact';

const statusForSource = (
  source: CompendiumImportSource,
  existing?: StoredCompendiumItem
): StoredCompendiumItemStatus => {
  // `disabled` can be a local editorial/user decision. Never silently re-enable
  // an existing entity merely because a new import is otherwise valid.
  if (existing?.status === 'disabled') return 'disabled';
  if (source.status === 'disabled') return 'disabled';
  if (isReviewRequired(source)) return 'needsReview';
  return 'validated';
};

const decisionForStatus = (status: StoredCompendiumItemStatus): StoredCompendiumReviewDecision => {
  if (status === 'validated') return 'approved';
  if (status === 'disabled') return 'rejected';
  return 'pending';
};

const tagsForItem = (item: CompendiumImportItem): string[] => {
  const tags = new Set<string>([item.kind, item.name.toLowerCase()]);
  if (item.source.book) tags.add(item.source.book.toLowerCase());
  const payloadTags = Array.isArray(item.payload.tags)
    ? item.payload.tags.filter((entry): entry is string => typeof entry === 'string')
    : [];
  payloadTags.forEach((tag) => tags.add(tag.toLowerCase()));
  if (item.summary) {
    item.summary
      .toLowerCase()
      .split(/[^a-z0-9À-ÿ]+/i)
      .filter((token) => token.length > 2)
      .slice(0, 20)
      .forEach((token) => tags.add(token));
  }
  return Array.from(tags);
};

const normalizedJsonForItem = (item: CompendiumImportItem, contentHash: string): Record<string, unknown> => ({
  ...item.payload,
  id: item.id,
  name: item.name,
  type: item.kind,
  sourceId: item.source.id,
  sourceStatus: item.source.status,
  sourceConfidence: item.source.confidence,
  requiresReview: isReviewRequired(item.source),
  contentHash
});

/**
 * Storage ids are deliberately separate from canonical compendium ids.
 * Existing ids are preserved on update because characters and other runtime
 * state can reference StoredCompendiumItem.id directly.
 */
export const createCompendiumV2StorageItemId = (packId: string, canonicalItemId: string): string =>
  `${packId}:${canonicalItemId}`;

export const buildStoredCompendiumV2Item = (
  operation: CompendiumImportUpsertOperation,
  packId: string,
  importedAt: string,
  existing?: StoredCompendiumItem
): StoredCompendiumItem => {
  const item = operation.item;
  const status = statusForSource(item.source, existing);
  const preservingLocalDisable = existing?.status === 'disabled';
  const reviewRequired = isReviewRequired(item.source);

  return {
    id: existing?.id ?? createCompendiumV2StorageItemId(packId, item.id),
    importItemId: item.id,
    // An update keeps the original pack ownership. This prevents an
    // incremental patch pack from stealing/removing an entity from its base
    // pack while still allowing its canonical content to be updated.
    packId: existing?.packId ?? packId,
    sourceId: item.source.id,
    type: item.kind,
    name: item.name,
    summary: item.summary,
    version: item.source.version,
    rawJson: item,
    normalizedJson: normalizedJsonForItem(item, operation.contentHash),
    contentHash: operation.contentHash,
    tags: tagsForItem(item),
    status,
    reviewDecision: preservingLocalDisable ? existing.reviewDecision ?? 'rejected' : decisionForStatus(status),
    reviewNotes: preservingLocalDisable
      ? existing.reviewNotes
      : reviewRequired
        ? 'Conteúdo importado/atualizado requer revisão manual antes de uso automático.'
        : undefined,
    reviewedAt: preservingLocalDisable ? existing.reviewedAt : undefined,
    reviewedBy: preservingLocalDisable ? existing.reviewedBy : undefined,
    createdAt: existing?.createdAt ?? importedAt,
    updatedAt: importedAt
  };
};

export const buildStoredCompendiumV2Pack = (
  pack: CanonicalImportPackForPreview,
  importedAt: string
): StoredCompendiumPack => ({
  id: pack.id,
  name: pack.source.book ?? pack.id,
  sourceId: pack.source.id,
  schemaVersion: IMPORT_TEMPLATE_VERSION_V2,
  checksum: createImportContentHash(pack),
  importedAt,
  itemCount: pack.items.length
});

export const collectCompendiumV2Sources = (pack: CanonicalImportPackForPreview): RuleSource[] => {
  const sources = new Map<string, RuleSource>();
  for (const item of pack.items) sources.set(item.source.id, item.source);
  sources.set(pack.source.id, pack.source);
  return Array.from(sources.values());
};

const upsertSourcesPreservingLocalEnablement = (
  snapshot: CompendiumPersistenceState,
  incoming: RuleSource[]
): Pick<CompendiumPersistenceState, 'sources' | 'enabledSourceIds'> => {
  const currentById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const incomingById = new Map(incoming.map((source) => [source.id, source]));
  const sources = [
    ...snapshot.sources.filter((source) => !incomingById.has(source.id)),
    ...incoming
  ];

  const enabled = new Set(snapshot.enabledSourceIds);
  for (const source of incoming) {
    const existed = currentById.has(source.id);
    if (source.status !== 'active') {
      enabled.delete(source.id);
      continue;
    }
    // Existing local enable/disable preference wins. New active sources start
    // enabled, matching the legacy importer's behavior.
    if (!existed) enabled.add(source.id);
  }

  const validIds = new Set(sources.map((source) => source.id));
  return {
    sources,
    enabledSourceIds: unique(Array.from(enabled).filter((id) => validIds.has(id)))
  };
};

const assertExecutablePlan = (pack: CanonicalImportPackForPreview, plan: CompendiumImportV2UpsertPlan): void => {
  if (plan.packId !== pack.id) throw new Error(`Plano V2 pertence ao pacote ${plan.packId}, não ${pack.id}.`);
  if (!plan.executable) throw new Error('Plano de upsert V2 contém conflitos ou erros e não pode ser executado.');
};

const findUpdateTarget = (
  itemsByStorageId: Map<string, StoredCompendiumItem>,
  operation: CompendiumImportUpsertOperation
): StoredCompendiumItem => {
  if (!operation.existingStorageId) throw new Error(`Update ${operation.itemId} não possui existingStorageId.`);
  const existing = itemsByStorageId.get(operation.existingStorageId);
  if (!existing) throw new Error(`Item existente ${operation.existingStorageId} não foi encontrado durante o commit V2.`);
  if (existing.importItemId !== operation.itemId) {
    throw new Error(`Plano V2 obsoleto: ${operation.existingStorageId} agora representa ${existing.importItemId}, não ${operation.itemId}.`);
  }
  return existing;
};

/**
 * Pure transaction builder used by the key-value repository and by tests.
 * No mutation or I/O occurs here. If any invariant fails, the caller keeps the
 * original snapshot unchanged.
 */
export const applyCompendiumImportV2PlanToSnapshot = (
  snapshot: CompendiumPersistenceState,
  pack: CanonicalImportPackForPreview,
  plan: CompendiumImportV2UpsertPlan,
  options: CompendiumImportV2PersistenceOptions = {}
): CompendiumImportV2PersistenceResult => {
  assertExecutablePlan(pack, plan);
  const importedAt = options.importedAt ?? new Date().toISOString();
  const storedPack = buildStoredCompendiumV2Pack(pack, importedAt);
  const sources = collectCompendiumV2Sources(pack);
  const sourceState = upsertSourcesPreservingLocalEnablement(snapshot, sources);
  const itemsByStorageId = new Map(snapshot.items.map((item) => [item.id, item]));
  const itemsByCanonicalId = new Map(snapshot.items.map((item) => [item.importItemId, item]));
  const nextItems = [...snapshot.items];
  const preservedStorageIds: string[] = [];

  for (const operation of plan.updates) {
    const existing = findUpdateTarget(itemsByStorageId, operation);
    const updated = buildStoredCompendiumV2Item(operation, pack.id, importedAt, existing);
    const index = nextItems.findIndex((item) => item.id === existing.id);
    if (index < 0) throw new Error(`Item ${existing.id} desapareceu durante a transação V2.`);
    nextItems[index] = updated;
    itemsByStorageId.set(updated.id, updated);
    itemsByCanonicalId.set(updated.importItemId, updated);
    preservedStorageIds.push(updated.id);
  }

  for (const operation of plan.creates) {
    if (itemsByCanonicalId.has(operation.itemId)) {
      throw new Error(`Plano V2 obsoleto: canonical id ${operation.itemId} já existe no catálogo.`);
    }
    const created = buildStoredCompendiumV2Item(operation, pack.id, importedAt);
    if (itemsByStorageId.has(created.id)) {
      throw new Error(`Colisão de storage id durante import V2: ${created.id}.`);
    }
    nextItems.push(created);
    itemsByStorageId.set(created.id, created);
    itemsByCanonicalId.set(created.importItemId, created);
  }

  let contentHashesBackfilled = 0;
  for (const itemId of plan.unchangedItemIds) {
    const existing = itemsByCanonicalId.get(itemId);
    if (!existing) throw new Error(`Item unchanged ${itemId} não foi encontrado durante o commit V2.`);
    const decisionHash = plan.unchangedContentHashes?.[itemId];
    if (decisionHash && existing.contentHash !== decisionHash) {
      const index = nextItems.findIndex((item) => item.id === existing.id);
      const backfilled = { ...existing, contentHash: decisionHash };
      if (index < 0) throw new Error(`Item unchanged ${existing.id} desapareceu durante a transação V2.`);
      nextItems[index] = backfilled;
      itemsByStorageId.set(backfilled.id, backfilled);
      itemsByCanonicalId.set(backfilled.importItemId, backfilled);
      contentHashesBackfilled += 1;
    }
  }

  const currentPackIds = new Set(snapshot.packs.map((entry) => entry.id));
  const packs = currentPackIds.has(storedPack.id)
    ? snapshot.packs.map((entry) => entry.id === storedPack.id ? storedPack : entry)
    : [...snapshot.packs, storedPack];

  return {
    snapshot: {
      sources: sourceState.sources,
      packs,
      items: nextItems,
      enabledSourceIds: sourceState.enabledSourceIds
    },
    pack: storedPack,
    summary: {
      packId: pack.id,
      created: plan.creates.length,
      updated: plan.updates.length,
      unchanged: plan.unchangedItemIds.length,
      contentHashesBackfilled,
      preservedStorageIds
    }
  };
};

/** Adapts current persisted rows to the preview boundary without copying data. */
export const existingPreviewItemsFromSnapshot = (
  snapshot: CompendiumPersistenceState
): ExistingCompendiumPreviewItem[] => snapshot.items.map((item) => ({
  id: item.id,
  importItemId: item.importItemId,
  type: item.type,
  name: item.name,
  summary: item.summary,
  sourceId: item.sourceId,
  version: item.version,
  rawJson: item.rawJson,
  normalizedJson: item.normalizedJson,
  contentHash: item.contentHash
}));
