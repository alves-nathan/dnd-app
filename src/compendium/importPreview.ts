import {
  COMPENDIUM_ENTITY_KINDS,
  type CompendiumEntityKind,
  type CompendiumImportItem,
  type CompendiumImportSource
} from './importDomain';
import { createCompendiumImportItemContentHash, canonicalizeImportContentForHash } from './importContentHash';
import {
  normalizeCompendiumImportItem,
  normalizeCompendiumImportPack,
  type ImportNormalizationIssue,
  type RawCompendiumItemShape
} from './importNormalization';
import {
  analyzeCompendiumImportV2Semantics,
  type ImportSemanticIssue,
  type ImportSemanticValidationResult
} from './importSemanticValidation';
import { IMPORT_TEMPLATE_VERSION_V2 } from './importVersions';

export type ImportPreviewDisposition = 'create' | 'update' | 'unchanged' | 'conflict';
export type ImportPreviewConflictReason =
  | 'duplicateExistingId'
  | 'existingItemUncomparable'
  | 'kindMismatch'
  | 'sourceMismatch'
  | 'rulesEraMismatch';

export interface CompendiumImportPackMetadata extends Record<string, unknown> {
  /** Optional dependency groups retained by extracted/compatibility packs. */
  externalDependencies?: Record<string, unknown>;
}

export interface CanonicalImportPackForPreview {
  templateVersion: typeof IMPORT_TEMPLATE_VERSION_V2;
  id: string;
  source: CompendiumImportSource;
  metadata?: CompendiumImportPackMetadata;
  items: CompendiumImportItem[];
  [extension: string]: unknown;
}

/**
 * Structural adapter for today's StoredCompendiumItem and future V2 snapshots.
 * `id` may be the storage id (`pack:item`); `importItemId` is preferred when
 * present because it is the stable canonical compendium id.
 */
export interface ExistingCompendiumPreviewItem {
  id: string;
  importItemId?: string;
  type?: CompendiumEntityKind;
  kind?: CompendiumEntityKind;
  name?: string;
  summary?: string;
  sourceId?: string;
  version?: string;
  source?: CompendiumImportSource;
  payload?: Record<string, unknown>;
  rawJson?: unknown;
  normalizedJson?: Record<string, unknown>;
  contentHash?: string;
}

export interface ImportPreviewIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  itemId?: string;
  itemKind?: CompendiumEntityKind;
  path?: string;
  relatedId?: string;
}

export interface ImportPreviewItemDecision {
  itemId: string;
  kind: CompendiumEntityKind;
  name: string;
  disposition: ImportPreviewDisposition;
  incomingHash: string;
  existingHash?: string;
  existingStorageId?: string;
  changedPaths: string[];
  conflictReason?: ImportPreviewConflictReason;
  conflictMessage?: string;
}

export interface CompendiumImportV2Preview {
  valid: boolean;
  itemsFound: number;
  byKind: Record<CompendiumEntityKind, number>;
  creates: number;
  updates: number;
  unchanged: number;
  conflicts: number;
  decisions: ImportPreviewItemDecision[];
  errors: ImportPreviewIssue[];
  warnings: ImportPreviewIssue[];
  infos: ImportPreviewIssue[];
  issues: ImportPreviewIssue[];
  semanticValidation: ImportSemanticValidationResult;
  existingNormalizationIssues: ImportNormalizationIssue[];
}

export interface BuildImportPreviewOptions {
  /** Maximum number of changed JSON paths retained per updated entity. */
  maxChangedPathsPerItem?: number;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const sourceFallback = (item: ExistingCompendiumPreviewItem): CompendiumImportSource => ({
  id: item.sourceId ?? 'existing-catalog',
  version: item.version,
  status: 'needsReview',
  confidence: 'importedNeedsReview'
});

const storageMetadataKeys = new Set([
  'id', 'name', 'type', 'kind', 'sourceId', 'sourceStatus', 'sourceConfidence',
  'requiresReview', 'contentHash', 'checksum', 'createdAt', 'updatedAt', 'importedAt',
  'reviewedAt', 'reviewedBy', 'reviewDecision', 'reviewNotes'
]);

const payloadFromNormalized = (normalized: Record<string, unknown> | undefined): Record<string, unknown> => {
  if (!normalized) return {};
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(normalized)) {
    if (!storageMetadataKeys.has(key)) payload[key] = value;
  }
  return payload;
};

const rawShapeForExisting = (item: ExistingCompendiumPreviewItem): RawCompendiumItemShape => {
  const raw = asRecord(item.rawJson);
  if (raw?.id && raw.kind && raw.name && raw.source && raw.payload) return raw as RawCompendiumItemShape;

  const directSource = asRecord(item.source) as CompendiumImportSource | undefined;
  const rawSource = asRecord(raw?.source) as CompendiumImportSource | undefined;
  const normalized = item.normalizedJson;
  const normalizedKind = typeof normalized?.type === 'string' ? normalized.type as CompendiumEntityKind : undefined;
  const normalizedId = typeof normalized?.id === 'string' ? normalized.id : undefined;
  const normalizedName = typeof normalized?.name === 'string' ? normalized.name : undefined;

  return {
    id: item.importItemId ?? normalizedId ?? raw?.id ?? item.id,
    kind: item.kind ?? item.type ?? normalizedKind ?? raw?.kind,
    name: item.name ?? normalizedName ?? raw?.name,
    summary: item.summary ?? raw?.summary,
    source: directSource ?? rawSource ?? sourceFallback(item),
    payload: item.payload ?? asRecord(raw?.payload) ?? payloadFromNormalized(normalized)
  };
};

interface CanonicalExistingRecord {
  canonical: CompendiumImportItem;
  storage: ExistingCompendiumPreviewItem;
  hash: string;
  declaredHash?: string;
}

interface ExistingCanonicalization {
  byId: Map<string, CanonicalExistingRecord[]>;
  items: CanonicalExistingRecord[];
  issues: ImportNormalizationIssue[];
  failedIds: Map<string, ExistingCompendiumPreviewItem[]>;
}

const canonicalizeExisting = (
  existingItems: ExistingCompendiumPreviewItem[],
  incomingPack?: CanonicalImportPackForPreview
): ExistingCanonicalization => {
  if (!existingItems.length) return { byId: new Map(), items: [], issues: [], failedIds: new Map() };

  const rawItems = existingItems.map(rawShapeForExisting);
  // Existing storage rows must be canonicalized independently. Normalizing the
  // entire installed catalog as one synthetic pack makes spell class-name
  // resolution depend on unrelated books that happen to be installed, which
  // changes content hashes and breaks idempotent re-imports of incremental
  // packs. Per-item normalization preserves the persisted item's own canonical
  // payload while semantic validation still receives the full catalog below.
  const normalizationIssues: ImportNormalizationIssue[] = [];
  const canonicalQueues = new Map<string, CompendiumImportItem[]>();
  rawItems.forEach((rawItem, index) => {
    const result = normalizeCompendiumImportItem(rawItem, index);
    normalizationIssues.push(...result.issues);
    if (!result.value) return;
    const queue = canonicalQueues.get(result.value.id) ?? [];
    queue.push(result.value);
    canonicalQueues.set(result.value.id, queue);
  });

  // V1 -> V2 migration resolves spell class names against classes in the same
  // incoming pack. Existing legacy rows are normalized one-by-one above to
  // avoid unrelated installed books affecting hashes, so mirror only that
  // incoming-pack resolution here. This keeps full-pack replays idempotent
  // without making comparison depend on the rest of the installed catalog.
  if (incomingPack) {
    const incomingClassIdsByName = new Map<string, string>();
    for (const item of incomingPack.items) {
      if (item.kind === 'class') incomingClassIdsByName.set(item.name.trim().toLowerCase(), item.id);
    }
    for (const queue of canonicalQueues.values()) {
      for (const canonical of queue) {
        if (canonical.kind !== 'spell' || canonical.payload.classIds?.length) continue;
        const classIds = canonical.payload.classes
          .map((className) => incomingClassIdsByName.get(className.trim().toLowerCase()))
          .filter((classId): classId is string => Boolean(classId));
        if (classIds.length) canonical.payload.classIds = Array.from(new Set(classIds));
      }
    }
  }

  const byId = new Map<string, CanonicalExistingRecord[]>();
  const items: CanonicalExistingRecord[] = [];
  const failedIds = new Map<string, ExistingCompendiumPreviewItem[]>();

  for (const storage of existingItems) {
    const rawShape = rawShapeForExisting(storage);
    const expectedId = typeof rawShape.id === 'string' ? rawShape.id : storage.importItemId ?? storage.id;
    const queue = canonicalQueues.get(expectedId);
    const canonical = queue?.shift();
    if (!canonical) {
      const failed = failedIds.get(expectedId) ?? [];
      failed.push(storage);
      failedIds.set(expectedId, failed);
      continue;
    }
    const computedHash = createCompendiumImportItemContentHash(canonical);
    const record: CanonicalExistingRecord = {
      canonical,
      storage,
      hash: computedHash,
      declaredHash: storage.contentHash?.startsWith('cmpv2_') ? storage.contentHash : undefined
    };
    items.push(record);
    const bucket = byId.get(canonical.id) ?? [];
    bucket.push(record);
    byId.set(canonical.id, bucket);
  }

  return { byId, items, issues: normalizationIssues, failedIds };
};

const pathJoin = (prefix: string, segment: string | number): string => {
  if (typeof segment === 'number') return `${prefix}[${segment}]`;
  return prefix ? `${prefix}.${segment}` : segment;
};

const collectChangedPaths = (left: unknown, right: unknown, limit: number, prefix = ''): string[] => {
  if (limit <= 0) return [];
  const a = canonicalizeImportContentForHash(left);
  const b = canonicalizeImportContentForHash(right);
  if (Object.is(a, b)) return [];
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return [prefix || 'item'];

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return [prefix || 'item'];
    const paths: string[] = [];
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length && paths.length < limit; index += 1) {
      if (index >= a.length || index >= b.length) paths.push(pathJoin(prefix, index));
      else paths.push(...collectChangedPaths(a[index], b[index], limit - paths.length, pathJoin(prefix, index)));
    }
    return paths;
  }

  const leftRecord = a as Record<string, unknown>;
  const rightRecord = b as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])).sort();
  const paths: string[] = [];
  for (const key of keys) {
    if (paths.length >= limit) break;
    if (!(key in leftRecord) || !(key in rightRecord)) paths.push(pathJoin(prefix, key));
    else paths.push(...collectChangedPaths(leftRecord[key], rightRecord[key], limit - paths.length, pathJoin(prefix, key)));
  }
  return paths;
};

const semanticProjection = (item: CompendiumImportItem): Record<string, unknown> => ({
  id: item.id,
  kind: item.kind,
  name: item.name,
  summary: item.summary,
  source: item.source,
  payload: item.payload
});

const previewIssueFromSemantic = (issue: ImportSemanticIssue): ImportPreviewIssue => ({
  severity: issue.severity,
  code: issue.code,
  message: issue.message,
  itemId: issue.itemId,
  itemKind: issue.itemKind,
  path: issue.path,
  relatedId: issue.relatedId
});

const byKindCounts = (items: CompendiumImportItem[]): Record<CompendiumEntityKind, number> => {
  const result = Object.fromEntries(COMPENDIUM_ENTITY_KINDS.map((kind) => [kind, 0])) as Record<CompendiumEntityKind, number>;
  for (const item of items) result[item.kind] += 1;
  return result;
};

const conflictDecision = (
  item: CompendiumImportItem,
  incomingHash: string,
  reason: ImportPreviewConflictReason,
  message: string,
  existing?: CanonicalExistingRecord
): ImportPreviewItemDecision => ({
  itemId: item.id,
  kind: item.kind,
  name: item.name,
  disposition: 'conflict',
  incomingHash,
  existingHash: existing?.hash,
  existingStorageId: existing?.storage.id,
  changedPaths: [],
  conflictReason: reason,
  conflictMessage: message
});

/**
 * Pure preview/diff layer. It never mutates storage.
 *
 * Identity semantics:
 * - missing canonical id => create
 * - same id + same canonical content => unchanged
 * - same id + same source identity + changed content => update
 * - duplicate existing id, kind/source/rules-era collision, or unreadable existing
 *   entity => conflict
 */
export const buildCompendiumImportV2Preview = (
  pack: CanonicalImportPackForPreview,
  existingItems: ExistingCompendiumPreviewItem[] = [],
  options: BuildImportPreviewOptions = {}
): CompendiumImportV2Preview => {
  const maxChangedPaths = Math.max(1, options.maxChangedPathsPerItem ?? 64);
  const existing = canonicalizeExisting(existingItems, pack);
  const externalItems = existing.items.map((entry) => ({
    id: entry.canonical.id,
    kind: entry.canonical.kind,
    ...(entry.canonical.kind === 'condition' ? { conditionId: entry.canonical.payload.conditionId } : {})
  }));
  const semanticValidation = analyzeCompendiumImportV2Semantics(pack, { externalItems });
  const decisions: ImportPreviewItemDecision[] = [];
  const previewIssues: ImportPreviewIssue[] = semanticValidation.issues.map(previewIssueFromSemantic);

  for (const normalizationIssue of existing.issues) {
    previewIssues.push({
      severity: normalizationIssue.severity === 'error' ? 'warning' : normalizationIssue.severity,
      code: `IMPORT_PREVIEW_EXISTING_${normalizationIssue.code}`,
      message: `Existing catalog normalization: ${normalizationIssue.message}`,
      path: normalizationIssue.path
    });
  }

  for (const existingRecord of existing.items) {
    if (existingRecord.declaredHash && existingRecord.declaredHash !== existingRecord.hash) {
      previewIssues.push({
        severity: 'warning',
        code: 'IMPORT_PREVIEW_STORED_HASH_MISMATCH',
        message: `Stored contentHash for ${existingRecord.canonical.id} does not match its canonical content; the preview recomputed it.`,
        itemId: existingRecord.canonical.id,
        itemKind: existingRecord.canonical.kind
      });
    }
  }

  for (const item of pack.items) {
    const incomingHash = createCompendiumImportItemContentHash(item);
    const matches = existing.byId.get(item.id) ?? [];
    const failedMatches = existing.failedIds.get(item.id) ?? [];

    if (matches.length > 1) {
      const decision = conflictDecision(item, incomingHash, 'duplicateExistingId', `Canonical id ${item.id} already exists ${matches.length} times in the catalog.`);
      decisions.push(decision);
      previewIssues.push({ severity: 'error', code: 'IMPORT_PREVIEW_DUPLICATE_EXISTING_ID', message: decision.conflictMessage ?? 'Duplicate existing id.', itemId: item.id, itemKind: item.kind });
      continue;
    }

    if (!matches.length && failedMatches.length) {
      const decision = conflictDecision(item, incomingHash, 'existingItemUncomparable', `Existing entity ${item.id} could not be normalized safely for comparison.`);
      decisions.push(decision);
      previewIssues.push({ severity: 'error', code: 'IMPORT_PREVIEW_EXISTING_ITEM_UNCOMPARABLE', message: decision.conflictMessage ?? 'Existing item is not comparable.', itemId: item.id, itemKind: item.kind });
      continue;
    }

    if (!matches.length) {
      decisions.push({ itemId: item.id, kind: item.kind, name: item.name, disposition: 'create', incomingHash, changedPaths: [] });
      continue;
    }

    const existingRecord = matches[0];
    if (existingRecord.canonical.kind !== item.kind) {
      const decision = conflictDecision(item, incomingHash, 'kindMismatch', `Canonical id ${item.id} is ${existingRecord.canonical.kind} in the catalog but ${item.kind} in the incoming pack.`, existingRecord);
      decisions.push(decision);
      previewIssues.push({ severity: 'error', code: 'IMPORT_PREVIEW_KIND_CONFLICT', message: decision.conflictMessage ?? 'Kind conflict.', itemId: item.id, itemKind: item.kind, relatedId: existingRecord.canonical.id });
      continue;
    }

    if (existingRecord.canonical.source.id !== item.source.id) {
      const decision = conflictDecision(item, incomingHash, 'sourceMismatch', `Canonical id ${item.id} belongs to source ${existingRecord.canonical.source.id} but the incoming source is ${item.source.id}.`, existingRecord);
      decisions.push(decision);
      previewIssues.push({ severity: 'error', code: 'IMPORT_PREVIEW_SOURCE_CONFLICT', message: decision.conflictMessage ?? 'Source conflict.', itemId: item.id, itemKind: item.kind });
      continue;
    }

    if (existingRecord.canonical.source.rulesEra && item.source.rulesEra && existingRecord.canonical.source.rulesEra !== item.source.rulesEra) {
      const decision = conflictDecision(item, incomingHash, 'rulesEraMismatch', `Canonical id ${item.id} changes rules era from ${existingRecord.canonical.source.rulesEra} to ${item.source.rulesEra}. Use distinct canonical IDs for 2024 and legacy content.`, existingRecord);
      decisions.push(decision);
      previewIssues.push({ severity: 'error', code: 'IMPORT_PREVIEW_RULES_ERA_CONFLICT', message: decision.conflictMessage ?? 'Rules era conflict.', itemId: item.id, itemKind: item.kind });
      continue;
    }

    if (existingRecord.hash === incomingHash) {
      decisions.push({
        itemId: item.id,
        kind: item.kind,
        name: item.name,
        disposition: 'unchanged',
        incomingHash,
        existingHash: existingRecord.hash,
        existingStorageId: existingRecord.storage.id,
        changedPaths: []
      });
      continue;
    }

    decisions.push({
      itemId: item.id,
      kind: item.kind,
      name: item.name,
      disposition: 'update',
      incomingHash,
      existingHash: existingRecord.hash,
      existingStorageId: existingRecord.storage.id,
      changedPaths: collectChangedPaths(semanticProjection(existingRecord.canonical), semanticProjection(item), maxChangedPaths)
    });
  }

  const creates = decisions.filter((entry) => entry.disposition === 'create').length;
  const updates = decisions.filter((entry) => entry.disposition === 'update').length;
  const unchanged = decisions.filter((entry) => entry.disposition === 'unchanged').length;
  const conflicts = decisions.filter((entry) => entry.disposition === 'conflict').length;
  const errors = previewIssues.filter((entry) => entry.severity === 'error');
  const warnings = previewIssues.filter((entry) => entry.severity === 'warning');
  const infos = previewIssues.filter((entry) => entry.severity === 'info');

  return {
    valid: semanticValidation.valid && conflicts === 0 && errors.length === 0,
    itemsFound: pack.items.length,
    byKind: byKindCounts(pack.items),
    creates,
    updates,
    unchanged,
    conflicts,
    decisions,
    errors,
    warnings,
    infos,
    issues: previewIssues,
    semanticValidation,
    existingNormalizationIssues: existing.issues
  };
};
