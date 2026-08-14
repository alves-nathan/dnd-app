import type {
  CatalogEntityState,
  CatalogFilterState,
  CatalogSnapshot
} from '../catalog/types';
import { ContentPolicyService } from '../catalog/contentPolicyService';
import {
  createCatalogConfigurationHistoryEntry,
  isCatalogConfigurationHistoryEntry,
  type CatalogConfigurationCommitContext,
  type CatalogConfigurationHistoryEntry
} from '../catalog/catalogConfigurationHistory';
import type { FilterImpactReport } from '../catalog/types';
import type { KeyValueStorageAdapter } from './keyValueStorage';

export const CATALOG_FILTER_PREFERENCES_KEY =
  '@dnd-combat-math/catalog-filter-preferences/v1';

export const CATALOG_FILTER_PREFERENCES_SCHEMA =
  'dnd-combat-catalog-filter-preferences.v1' as const;

export interface CatalogFilterPreferencesDocument {
  schemaVersion: typeof CATALOG_FILTER_PREFERENCES_SCHEMA;
  catalogVersion: string;
  savedAt: string;
  revision?: number;
  filterState: CatalogFilterState;
  history?: CatalogConfigurationHistoryEntry[];
}


export interface CatalogConfigurationCheckpointDocument {
  filterState: CatalogFilterState;
  revision: number;
  history: CatalogConfigurationHistoryEntry[];
  savedAt?: string;
}

export interface CatalogFilterPreferencesLoadResult {
  state: CatalogFilterState;
  restored: boolean;
  migratedAcrossCatalogVersion: boolean;
  revision: number;
  history: CatalogConfigurationHistoryEntry[];
  issues: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isEntityState = (value: unknown): value is CatalogEntityState =>
  value === 'enabled' || value === 'disabled' || value === 'inherit';

export const cloneCatalogFilterState = (
  state: CatalogFilterState
): CatalogFilterState => ({
  bookStates: { ...state.bookStates },
  categoryStates: { ...state.categoryStates },
  entityStates: { ...state.entityStates }
});

/**
 * Keeps only IDs that still exist in the loaded catalog. This allows persisted
 * preferences to survive catalog upgrades without reintroducing removed IDs.
 */
export const sanitizeCatalogFilterState = (
  snapshot: CatalogSnapshot,
  candidate: unknown,
  fallback: CatalogFilterState
): CatalogFilterState => {
  const result = cloneCatalogFilterState(fallback);
  if (!isRecord(candidate)) return result;

  const bookStates = isRecord(candidate.bookStates)
    ? candidate.bookStates
    : {};
  for (const bookId of snapshot.manifest.sourceBooks) {
    const value = bookStates[bookId];
    if (typeof value === 'boolean') result.bookStates[bookId] = value;
  }

  const validCategoryIds = new Set(snapshot.categories.map((entry) => entry.id));
  const categoryStates = isRecord(candidate.categoryStates)
    ? candidate.categoryStates
    : {};
  for (const [categoryId, value] of Object.entries(categoryStates)) {
    if (validCategoryIds.has(categoryId) && typeof value === 'boolean') {
      result.categoryStates[categoryId] = value;
    }
  }

  const entityStates = isRecord(candidate.entityStates)
    ? candidate.entityStates
    : {};
  for (const [entityId, value] of Object.entries(entityStates)) {
    if (snapshot.entryById.has(entityId) && isEntityState(value)) {
      if (value === 'inherit') delete result.entityStates[entityId];
      else result.entityStates[entityId] = value;
    }
  }

  return result;
};

export const createCatalogFilterPreferencesRepository = (
  storage: KeyValueStorageAdapter,
  now: () => Date = () => new Date()
) => ({
  load: async (
    snapshot: CatalogSnapshot,
    fallback: CatalogFilterState
  ): Promise<CatalogFilterPreferencesLoadResult> => {
    const raw = await storage.getItem(CATALOG_FILTER_PREFERENCES_KEY);
    if (!raw) {
      return {
        state: cloneCatalogFilterState(fallback),
        restored: false,
        migratedAcrossCatalogVersion: false,
        revision: 0,
        history: [],
        issues: []
      };
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed)) throw new Error('Documento não é um objeto JSON.');
      if (parsed.schemaVersion !== CATALOG_FILTER_PREFERENCES_SCHEMA) {
        throw new Error('Schema de preferências não suportado.');
      }

      const sourceVersion =
        typeof parsed.catalogVersion === 'string'
          ? parsed.catalogVersion
          : 'unknown';
      const migratedAcrossCatalogVersion =
        sourceVersion !== snapshot.catalogVersion;
      const state = sanitizeCatalogFilterState(
        snapshot,
        parsed.filterState,
        fallback
      );

      const history = Array.isArray(parsed.history)
        ? parsed.history.filter(isCatalogConfigurationHistoryEntry).map((entry) => ({
            ...entry,
            beforeState: sanitizeCatalogFilterState(snapshot, entry.beforeState, fallback),
            afterState: sanitizeCatalogFilterState(snapshot, entry.afterState, fallback)
          }))
        : [];
      const revision = typeof parsed.revision === 'number'
        ? Math.max(parsed.revision, history.reduce((maximum, entry) => Math.max(maximum, entry.revision), 0))
        : history.reduce((maximum, entry) => Math.max(maximum, entry.revision), 0);

      return {
        state,
        restored: true,
        migratedAcrossCatalogVersion,
        revision,
        history,
        issues: migratedAcrossCatalogVersion
          ? [
              `Preferências e histórico compatíveis migrados do catálogo ${sourceVersion} para ${snapshot.catalogVersion}.`
            ]
          : []
      };
    } catch (error) {
      return {
        state: cloneCatalogFilterState(fallback),
        restored: false,
        migratedAcrossCatalogVersion: false,
        revision: 0,
        history: [],
        issues: [
          error instanceof Error
            ? `Preferências do catálogo ignoradas: ${error.message}`
            : 'Preferências do catálogo ignoradas por estarem corrompidas.'
        ]
      };
    }
  },

  save: async (
    snapshot: CatalogSnapshot,
    filterState: CatalogFilterState,
    options?: {
      beforeState?: CatalogFilterState;
      label?: string;
      impact?: FilterImpactReport;
      context?: CatalogConfigurationCommitContext;
    }
  ): Promise<CatalogFilterPreferencesDocument & { historyEntry?: CatalogConfigurationHistoryEntry }> => {
    const raw = await storage.getItem(CATALOG_FILTER_PREFERENCES_KEY);
    let existingHistory: CatalogConfigurationHistoryEntry[] = [];
    let existingRevision = 0;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as CatalogFilterPreferencesDocument;
        existingHistory = Array.isArray(parsed.history)
          ? parsed.history.filter(isCatalogConfigurationHistoryEntry)
          : [];
        existingRevision = typeof parsed.revision === 'number'
          ? parsed.revision
          : existingHistory.reduce((maximum, entry) => Math.max(maximum, entry.revision), 0);
      } catch {
        existingHistory = [];
        existingRevision = 0;
      }
    }

    const savedAt = now().toISOString();
    const sanitizedAfter = sanitizeCatalogFilterState(snapshot, filterState, filterState);
    const beforeState = options?.beforeState
      ? sanitizeCatalogFilterState(snapshot, options.beforeState, options.beforeState)
      : undefined;
    const nextRevision = beforeState ? existingRevision + 1 : existingRevision;
    const historyEntry = beforeState
      ? createCatalogConfigurationHistoryEntry({
          revision: nextRevision,
          committedAt: savedAt,
          label: options?.label ?? 'Atualizar configuração do catálogo',
          origin: options?.context?.origin ?? 'manual',
          catalogVersion: snapshot.catalogVersion,
          catalogSnapshotId: snapshot.snapshotId,
          beforeState,
          afterState: sanitizedAfter,
          impact: options?.impact ?? new ContentPolicyService(snapshot).previewImpact(beforeState, sanitizedAfter),
          context: options?.context
        })
      : undefined;
    const history = historyEntry
      ? [...existingHistory, historyEntry].slice(-50)
      : existingHistory.slice(-50);
    const document: CatalogFilterPreferencesDocument = {
      schemaVersion: CATALOG_FILTER_PREFERENCES_SCHEMA,
      catalogVersion: snapshot.catalogVersion,
      savedAt,
      revision: nextRevision,
      filterState: sanitizedAfter,
      history
    };
    await storage.setItem(
      CATALOG_FILTER_PREFERENCES_KEY,
      JSON.stringify(document)
    );
    return { ...document, historyEntry };
  },

  replace: async (
    snapshot: CatalogSnapshot,
    checkpoint: CatalogConfigurationCheckpointDocument
  ): Promise<CatalogFilterPreferencesDocument> => {
    const fallback = new ContentPolicyService(snapshot).createDefaultState();
    const filterState = sanitizeCatalogFilterState(snapshot, checkpoint.filterState, fallback);
    const history = checkpoint.history
      .filter(isCatalogConfigurationHistoryEntry)
      .map((entry) => ({
        ...entry,
        beforeState: sanitizeCatalogFilterState(snapshot, entry.beforeState, fallback),
        afterState: sanitizeCatalogFilterState(snapshot, entry.afterState, fallback)
      }))
      .slice(-50);
    const revision = Math.max(
      checkpoint.revision,
      history.reduce((maximum, entry) => Math.max(maximum, entry.revision), 0)
    );
    const document: CatalogFilterPreferencesDocument = {
      schemaVersion: CATALOG_FILTER_PREFERENCES_SCHEMA,
      catalogVersion: snapshot.catalogVersion,
      savedAt: checkpoint.savedAt ?? now().toISOString(),
      revision,
      filterState,
      history
    };
    await storage.setItem(CATALOG_FILTER_PREFERENCES_KEY, JSON.stringify(document));
    return document;
  },

  clear: async (): Promise<void> => {
    await storage.removeItem(CATALOG_FILTER_PREFERENCES_KEY);
  }
});
