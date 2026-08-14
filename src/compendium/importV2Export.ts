import type { RuleValidationIssue } from '../types';
import type { CompendiumPersistenceState } from '../storage/compendiumSnapshot';
import type { StoredCompendiumItem } from './types';
import {
  type CompendiumEntityKind,
  type CompendiumImportItem,
  type CompendiumImportSource
} from './importDomain';
import {
  createCompendiumImportItemContentHash,
  createImportContentHash
} from './importContentHash';
import {
  normalizeCompendiumImportPack,
  type ImportNormalizationIssue
} from './importNormalization';
import {
  analyzeCompendiumImportV2Semantics,
  type ImportSemanticValidationResult
} from './importSemanticValidation';
import { parseImportPack } from './parseImportPack';
import { IMPORT_TEMPLATE_VERSION_V2 } from './importVersions';
import type { CanonicalImportPackForPreview } from './importPreview';

export interface CompendiumV2ExportStorageOrigin {
  storedItemId: string;
  canonicalItemId: string;
  packId: string;
  sourceId: string;
}

export interface CompendiumV2ExportReviewMetadata {
  status: StoredCompendiumItem['status'];
  reviewDecision?: StoredCompendiumItem['reviewDecision'];
  reviewNotes?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface BuildCompendiumV2ExportOptions {
  exportId: string;
  exportName: string;
  createdAt?: string;
  forceNeedsReview?: boolean;
  includeReviewMetadata?: boolean;
  includeOriginalSourceMetadata?: boolean;
  selectedPackIds?: string[];
  selectedSourceIds?: string[];
  selectedTypes?: CompendiumEntityKind[];
  selectedStatuses?: StoredCompendiumItem['status'][];
}

export interface CompendiumV2RoundTripVerification {
  valid: boolean;
  itemCount: number;
  reparsedItemCount: number;
  matchingItemHashes: number;
  mismatchedItemIds: string[];
  missingItemIds: string[];
  unexpectedItemIds: string[];
  originalPackHash: string;
  reparsedPackHash?: string;
  issues: RuleValidationIssue[];
}

export interface BuildCompendiumV2ExportResult {
  pack?: CanonicalImportPackForPreview;
  issues: RuleValidationIssue[];
  normalizationIssues: ImportNormalizationIssue[];
  semanticValidation?: ImportSemanticValidationResult;
  roundTrip?: CompendiumV2RoundTripVerification;
}

const normalizationIssuesForRuntime = (issues: ImportNormalizationIssue[]): RuleValidationIssue[] => issues.map((entry) => ({
  severity: entry.severity,
  code: entry.code,
  message: entry.path ? `${entry.path}: ${entry.message}` : entry.message
}));

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const storageMetadataKeys = new Set([
  'id', 'name', 'type', 'kind', 'sourceId', 'sourceStatus', 'sourceConfidence',
  'requiresReview', 'contentHash', 'checksum', 'createdAt', 'updatedAt', 'importedAt',
  'reviewedAt', 'reviewedBy', 'reviewDecision', 'reviewNotes'
]);

const payloadFromRuntimeState = (item: StoredCompendiumItem): Record<string, unknown> => {
  const normalized = asRecord(item.normalizedJson);
  if (!normalized) {
    const raw = asRecord(item.rawJson);
    return asRecord(raw?.payload) ?? {};
  }
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(normalized)) {
    if (!storageMetadataKeys.has(key)) payload[key] = value;
  }
  return payload;
};

/**
 * Export represents the runtime/domain state, not merely the immutable audit
 * copy in rawJson. Mapping/editor corrections live in normalizedJson and would
 * otherwise be lost in a backup/export round-trip.
 */
const rawShapeFromStoredRuntimeState = (
  snapshot: CompendiumPersistenceState,
  item: StoredCompendiumItem
): Record<string, unknown> => {
  const raw = asRecord(item.rawJson);
  const rawSource = asRecord(raw?.source);
  const persistedSource = snapshot.sources.find((source) => source.id === item.sourceId);
  return {
    id: item.importItemId,
    kind: item.type,
    name: item.name,
    summary: item.summary,
    ...(asRecord(raw?.metadata) ? { metadata: asRecord(raw?.metadata) } : {}),
    source: rawSource ?? persistedSource ?? {
      id: item.sourceId,
      version: item.version,
      status: 'needsReview',
      confidence: 'importedNeedsReview'
    },
    payload: payloadFromRuntimeState(item)
  };
};

const sourceFromSelectedItems = (
  items: CompendiumImportItem[],
  exportId: string,
  exportName: string,
  forceNeedsReview: boolean
): CompendiumImportSource => {
  const sourceIds = Array.from(new Set(items.map((item) => item.source.id)));
  if (sourceIds.length === 1 && items[0]) {
    const original = items[0].source;
    return forceNeedsReview
      ? {
          ...original,
          status: 'needsReview',
          confidence: 'importedNeedsReview',
          notes: [original.notes, 'Reexportado como rascunho para revisão manual.'].filter(Boolean).join(' ')
        }
      : original;
  }

  return {
    id: `export-source-${exportId}`,
    book: exportName,
    version: 'export-v2',
    status: forceNeedsReview ? 'needsReview' : 'active',
    confidence: forceNeedsReview ? 'importedNeedsReview' : 'manual',
    notes: `Fonte sintética do pacote exportado. Itens preservam suas fontes canônicas individuais: ${sourceIds.join(', ')}.`
  };
};

const externalSemanticItems = (snapshot: CompendiumPersistenceState) => snapshot.items.map((item) => ({
  id: item.importItemId,
  kind: item.type,
  conditionId: item.type === 'condition' && typeof item.normalizedJson.conditionId === 'string'
    ? item.normalizedJson.conditionId
    : undefined
}));

const buildMetadata = (
  selectedItems: StoredCompendiumItem[],
  options: BuildCompendiumV2ExportOptions
): Record<string, unknown> => {
  const metadata: Record<string, unknown> = {
    export: {
      format: IMPORT_TEMPLATE_VERSION_V2,
      createdAt: options.createdAt ?? new Date().toISOString(),
      selectedPackIds: options.selectedPackIds ?? [],
      selectedSourceIds: options.selectedSourceIds ?? [],
      selectedTypes: options.selectedTypes ?? [],
      selectedStatuses: options.selectedStatuses ?? [],
      itemCount: selectedItems.length
    }
  };

  if (options.includeOriginalSourceMetadata ?? true) {
    metadata.storageOrigins = Object.fromEntries(selectedItems.map((item): [string, CompendiumV2ExportStorageOrigin] => [
      item.importItemId,
      {
        storedItemId: item.id,
        canonicalItemId: item.importItemId,
        packId: item.packId,
        sourceId: item.sourceId
      }
    ]));
  }

  if (options.includeReviewMetadata) {
    metadata.review = Object.fromEntries(selectedItems.map((item): [string, CompendiumV2ExportReviewMetadata] => [
      item.importItemId,
      {
        status: item.status,
        reviewDecision: item.reviewDecision,
        reviewNotes: item.reviewNotes,
        reviewedAt: item.reviewedAt,
        reviewedBy: item.reviewedBy
      }
    ]));
  }

  return metadata;
};

/**
 * Verifies the V2 serialization boundary itself. The comparison is intentionally
 * item-semantic: envelope metadata/export timestamps may legitimately change,
 * while every compendium entity must survive JSON -> parseImportPack unchanged.
 */
export const verifyCompendiumImportV2RoundTrip = (
  pack: CanonicalImportPackForPreview
): CompendiumV2RoundTripVerification => {
  const json = JSON.stringify(pack);
  const parsed = parseImportPack(json, { validateSemantics: false });
  const issues = [...parsed.issues];
  if (!parsed.ok || !parsed.data) {
    return {
      valid: false,
      itemCount: pack.items.length,
      reparsedItemCount: parsed.data?.items.length ?? 0,
      matchingItemHashes: 0,
      mismatchedItemIds: pack.items.map((item) => item.id),
      missingItemIds: pack.items.map((item) => item.id),
      unexpectedItemIds: [],
      originalPackHash: createImportContentHash(pack),
      issues
    };
  }

  const reparsedItems = parsed.data.items as CompendiumImportItem[];
  const originalHashes = new Map<string, string>(pack.items.map((item) => [item.id, createCompendiumImportItemContentHash(item)]));
  const reparsedHashes = new Map<string, string>(reparsedItems.map((item) => [item.id, createCompendiumImportItemContentHash(item)]));
  const missingItemIds = [...originalHashes.keys()].filter((id) => !reparsedHashes.has(id));
  const unexpectedItemIds = [...reparsedHashes.keys()].filter((id) => !originalHashes.has(id));
  const mismatchedItemIds = [...originalHashes.entries()]
    .filter(([id, hash]) => reparsedHashes.has(id) && reparsedHashes.get(id) !== hash)
    .map(([id]) => id);
  const matchingItemHashes = [...originalHashes.entries()]
    .filter(([id, hash]) => reparsedHashes.get(id) === hash)
    .length;

  if (missingItemIds.length || unexpectedItemIds.length || mismatchedItemIds.length) {
    issues.push({
      severity: 'error',
      code: 'COMPENDIUM_EXPORT_V2_ROUNDTRIP_MISMATCH',
      message: `Round-trip V2 divergiu: ${missingItemIds.length} ausente(s), ${unexpectedItemIds.length} inesperado(s), ${mismatchedItemIds.length} alterado(s).`
    });
  }

  return {
    valid: issues.every((entry) => entry.severity !== 'error'),
    itemCount: pack.items.length,
    reparsedItemCount: reparsedItems.length,
    matchingItemHashes,
    mismatchedItemIds,
    missingItemIds,
    unexpectedItemIds,
    originalPackHash: createImportContentHash(pack),
    reparsedPackHash: createImportContentHash(parsed.data),
    issues
  };
};

/**
 * Converts stored V1/V2 rows back into the canonical V2 import domain.
 * Storage/review data stays in envelope metadata; it is never injected into
 * entity payloads, so exporting and reimporting does not mutate game content.
 */
export const buildCompendiumV2ExportFromStoredItems = (
  snapshot: CompendiumPersistenceState,
  selectedItems: StoredCompendiumItem[],
  options: BuildCompendiumV2ExportOptions
): BuildCompendiumV2ExportResult => {
  const rawPack = {
    templateVersion: IMPORT_TEMPLATE_VERSION_V2,
    id: options.exportId,
    source: {
      id: `export-source-${options.exportId}`,
      book: options.exportName,
      version: 'export-v2',
      status: 'active',
      confidence: 'manual'
    },
    metadata: buildMetadata(selectedItems, options),
    items: selectedItems.map((item) => rawShapeFromStoredRuntimeState(snapshot, item))
  };

  const normalized = normalizeCompendiumImportPack(rawPack);
  const issues = normalizationIssuesForRuntime(normalized.issues);
  if (!normalized.value) return { issues, normalizationIssues: normalized.issues };

  const forcedItems = options.forceNeedsReview
    ? normalized.value.items.map((item): CompendiumImportItem => ({
        ...item,
        source: {
          ...item.source,
          status: 'needsReview',
          confidence: 'importedNeedsReview',
          notes: [item.source.notes, 'Reexportado como rascunho para revisão manual.'].filter(Boolean).join(' ')
        }
      } as CompendiumImportItem))
    : normalized.value.items;

  const pack: CanonicalImportPackForPreview = {
    ...normalized.value,
    templateVersion: IMPORT_TEMPLATE_VERSION_V2,
    id: options.exportId,
    source: sourceFromSelectedItems(forcedItems, options.exportId, options.exportName, Boolean(options.forceNeedsReview)),
    metadata: buildMetadata(selectedItems, options),
    items: forcedItems
  };

  const structural = parseImportPack(pack, { validateSemantics: false });
  issues.push(...structural.issues);
  if (!structural.ok || !structural.data) {
    return { pack, issues, normalizationIssues: normalized.issues };
  }

  const semanticValidation = analyzeCompendiumImportV2Semantics(structural.data, {
    externalItems: externalSemanticItems(snapshot)
  });
  issues.push(...semanticValidation.issues);

  const roundTrip = verifyCompendiumImportV2RoundTrip(structural.data);
  issues.push(...roundTrip.issues.filter((roundTripIssue) => !issues.some((existing) =>
    existing.code === roundTripIssue.code && existing.message === roundTripIssue.message
  )));

  return {
    pack: structural.data,
    issues,
    normalizationIssues: normalized.issues,
    semanticValidation,
    roundTrip
  };
};
