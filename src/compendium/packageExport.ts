import type { CompendiumItemType, StoredCompendiumItem, StoredCompendiumItemStatus } from './types';
import type { CompendiumPersistenceState } from '../storage/compendiumSnapshot';
import type { RuleValidationIssue } from '../types';
import type { CompendiumImportV2Input } from './importV2Schemas';
import {
  buildCompendiumV2ExportFromStoredItems,
  type CompendiumV2RoundTripVerification
} from './importV2Export';
import { IMPORT_TEMPLATE_VERSION_V2 } from './importVersions';

export interface CompendiumPackageExportOptions {
  exportId?: string;
  exportName?: string;
  packIds?: string[];
  sourceIds?: string[];
  types?: CompendiumItemType[];
  statuses?: StoredCompendiumItemStatus[];
  onlyEnabledSources?: boolean;
  includeDisabledItems?: boolean;
  includeReviewMetadata?: boolean;
  includeOriginalSourceMetadata?: boolean;
  forceNeedsReview?: boolean;
  exportedAt?: string;
}

export interface CompendiumPackageExportSummary {
  selectedItemCount: number;
  selectedPackCount: number;
  selectedSourceCount: number;
  exportedItemCount: number;
  sourceMode: 'singleSource' | 'multipleSources';
  roundTripVerified: boolean;
}

export interface CompendiumPackageExportResult {
  ok: boolean;
  issues: RuleValidationIssue[];
  data?: CompendiumImportV2Input;
  json?: string;
  roundTrip?: CompendiumV2RoundTripVerification;
  summary: CompendiumPackageExportSummary;
}

const unique = <T extends string>(values: T[]): T[] => Array.from(new Set(values.filter(Boolean)));

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'export';

const nowStamp = (now = new Date()): string => now.toISOString().replace(/[:.]/g, '-');

const filterItems = (snapshot: CompendiumPersistenceState, options: CompendiumPackageExportOptions): StoredCompendiumItem[] => {
  const packSet = options.packIds?.length ? new Set(options.packIds) : undefined;
  const sourceSet = options.sourceIds?.length ? new Set(options.sourceIds) : undefined;
  const typeSet = options.types?.length ? new Set(options.types) : undefined;
  const statusSet = options.statuses?.length ? new Set(options.statuses) : undefined;
  const enabledSourceSet = new Set(snapshot.enabledSourceIds);

  return snapshot.items
    .filter((item) => (packSet ? packSet.has(item.packId) : true))
    .filter((item) => (sourceSet ? sourceSet.has(item.sourceId) : true))
    .filter((item) => (typeSet ? typeSet.has(item.type) : true))
    .filter((item) => (statusSet ? statusSet.has(item.status) : options.includeDisabledItems ? true : item.status !== 'disabled'))
    .filter((item) => (options.onlyEnabledSources ? enabledSourceSet.has(item.sourceId) : true))
    .sort((left, right) => `${left.type}:${left.name}:${left.importItemId}`.localeCompare(`${right.type}:${right.name}:${right.importItemId}`));
};

/**
 * User-facing compendium export now emits the canonical V2 format.
 * V1 remains import-compatible through parseImportPack()/migrateImportV1ToV2(),
 * but new exports no longer reproduce the legacy schema.
 */
export const buildCompendiumPackageExport = (
  snapshot: CompendiumPersistenceState,
  options: CompendiumPackageExportOptions = {}
): CompendiumPackageExportResult => {
  const selectedItems = filterItems(snapshot, options);
  const selectedPackIds = unique(selectedItems.map((item) => item.packId));
  const selectedSourceIds = unique(selectedItems.map((item) => item.sourceId));
  const selectedTypes = unique(selectedItems.map((item) => item.type));
  const selectedStatuses = unique(selectedItems.map((item) => item.status));
  const sourceMode: CompendiumPackageExportSummary['sourceMode'] = selectedSourceIds.length <= 1 ? 'singleSource' : 'multipleSources';
  const issues: RuleValidationIssue[] = [];

  if (!selectedItems.length) {
    issues.push({ severity: 'error', code: 'COMPENDIUM_EXPORT_EMPTY', message: 'Nenhum item do compêndio corresponde aos filtros de exportação.' });
    return {
      ok: false,
      issues,
      summary: {
        selectedItemCount: 0,
        selectedPackCount: 0,
        selectedSourceCount: 0,
        exportedItemCount: 0,
        sourceMode,
        roundTripVerified: false
      }
    };
  }

  if (sourceMode === 'multipleSources') {
    issues.push({
      severity: 'info',
      code: 'COMPENDIUM_EXPORT_V2_MULTIPLE_SOURCES',
      message: 'A exportação reúne múltiplas fontes. O envelope usa uma fonte sintética, enquanto cada item preserva sua fonte canônica individual.'
    });
  }

  const exportName = options.exportName?.trim() || (selectedSourceIds.length === 1
    ? snapshot.sources.find((source) => source.id === selectedSourceIds[0])?.book ?? 'Compendium export'
    : `Compendium export · ${selectedSourceIds.length} fontes`);
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const exportId = options.exportId
    ? slugify(options.exportId)
    : `export-${slugify(exportName)}-${nowStamp(new Date(exportedAt))}`;

  const built = buildCompendiumV2ExportFromStoredItems(snapshot, selectedItems, {
    exportId,
    exportName,
    createdAt: exportedAt,
    forceNeedsReview: options.forceNeedsReview,
    includeReviewMetadata: options.includeReviewMetadata,
    includeOriginalSourceMetadata: options.includeOriginalSourceMetadata,
    selectedPackIds,
    selectedSourceIds,
    selectedTypes,
    selectedStatuses
  });
  issues.push(...built.issues);

  const data = built.pack as CompendiumImportV2Input | undefined;
  const json = data ? JSON.stringify(data, null, 2) : undefined;
  const ok = Boolean(data) && issues.every((issue) => issue.severity !== 'error') && Boolean(built.roundTrip?.valid);

  return {
    ok,
    issues,
    data,
    json,
    roundTrip: built.roundTrip,
    summary: {
      selectedItemCount: selectedItems.length,
      selectedPackCount: selectedPackIds.length,
      selectedSourceCount: selectedSourceIds.length,
      exportedItemCount: data?.items.length ?? 0,
      sourceMode,
      roundTripVerified: Boolean(built.roundTrip?.valid)
    }
  };
};

export const buildCompendiumPackageExportFileName = (result: Pick<CompendiumPackageExportResult, 'data'>): string => {
  const id = result.data?.id ? slugify(result.data.id) : `compendium-export-${nowStamp()}`;
  return `${id}.json`;
};

export const summarizeCompendiumPackageExport = (result: CompendiumPackageExportResult): string => [
  `${result.summary.exportedItemCount} item(ns) exportados`,
  `${result.summary.selectedPackCount} pacote(s)`,
  `${result.summary.selectedSourceCount} fonte(s)`,
  result.summary.roundTripVerified ? `${IMPORT_TEMPLATE_VERSION_V2} · round-trip OK` : `${IMPORT_TEMPLATE_VERSION_V2} · round-trip pendente`
].join(' · ');
