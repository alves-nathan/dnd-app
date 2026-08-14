import { create } from 'zustand';
import type { CompendiumItemMappingUpdate, CompendiumItemReviewBatchEntry, CompendiumItemReviewUpdate, CompendiumItemSearchFilters, PersistedCompendiumImport, StoredCompendiumItem, StoredCompendiumItemStatus } from '../compendium/types';
import { COMPENDIUM_PERSISTENCE_VERSION, createCompendiumPersistenceState, emptyCompendiumPersistenceState, sanitizeCompendiumPersistenceState } from '../storage/compendiumSnapshot';
import type { CompendiumPersistenceState } from '../storage/compendiumSnapshot';
import { activateLegacyCompendiumFallback, getActiveCompendiumRepository, getActiveCompendiumRepositoryKind, loadCompendiumSnapshotWithLegacyFallback } from '../storage/activeCompendiumRepository';
import { ensureRequiredCharacterCreationCompendium, installBundledCompendiumPack } from '../storage/bundledCompendiumBootstrap';
import { prepareCoreCharacterContentSnapshot } from '../compendium/coreCharacterContentPreparation';
import { detectCompendiumImportVersion } from '../compendium/importVersion';
import { IMPORT_TEMPLATE_VERSION_V2, LEGACY_IMPORT_TEMPLATE_VERSION_V1 } from '../compendium/importVersions';
import type { RuleValidationIssue } from '../types';
import { isRequiredCharacterCreationBundledPack } from '../compendium/bundledCompendium';

export interface SaveCompendiumImportResult {
  ok: boolean;
  imported?: PersistedCompendiumImport;
  /** Number of items handled by either V1 or V2 persistence. */
  itemCount: number;
  /** Canonical format used by the persistence path when known. */
  importFormat?: 'v1' | 'v2';
  issues: RuleValidationIssue[];
}

export interface CompendiumStoreOperationResult {
  ok: boolean;
  issues: RuleValidationIssue[];
}

export interface PrepareCoreCharacterContentResult
  extends CompendiumStoreOperationResult {
  eligibleItemCount: number;
  validatedItemCount: number;
  enabledSourceCount: number;
}

interface CompendiumStore extends CompendiumPersistenceState {
  isHydrated: boolean;
  isHydrating: boolean;
  isSaving: boolean;
  lastStorageError?: string;
  persistenceVersion: number;
  hydrate: () => Promise<CompendiumStoreOperationResult>;
  saveImportJson: (json: string) => Promise<SaveCompendiumImportResult>;
  removePack: (packId: string) => Promise<CompendiumStoreOperationResult>;
  installBundledPack: (packId: string) => Promise<CompendiumStoreOperationResult>;
  repairRequiredBundledContent: () => Promise<CompendiumStoreOperationResult>;
  setSourceEnabled: (sourceId: string, enabled: boolean) => Promise<CompendiumStoreOperationResult>;
  prepareCoreCharacterContent: () => Promise<PrepareCoreCharacterContentResult>;
  setItemStatus: (itemId: string, status: StoredCompendiumItemStatus) => Promise<CompendiumStoreOperationResult>;
  updateItemReview: (itemId: string, update: CompendiumItemReviewUpdate) => Promise<CompendiumStoreOperationResult>;
  updateItemsReview: (entries: CompendiumItemReviewBatchEntry[]) => Promise<CompendiumStoreOperationResult>;
  updateItemMapping: (itemId: string, update: CompendiumItemMappingUpdate) => Promise<CompendiumStoreOperationResult>;
  searchItems: (query: string, filters?: CompendiumItemSearchFilters) => StoredCompendiumItem[];
  replaceSnapshot: (snapshot: CompendiumPersistenceState) => Promise<CompendiumStoreOperationResult>;
  getSnapshot: () => CompendiumPersistenceState;
  exportSnapshotJson: () => string;
  importSnapshotJson: (json: string) => Promise<CompendiumStoreOperationResult>;
  clearCompendium: () => Promise<CompendiumStoreOperationResult>;
}

const genericStorageIssue = (code: string, message: string): RuleValidationIssue => ({ severity: 'error', code, message });

const itemMatchesSearch = (item: StoredCompendiumItem, normalizedQuery: string): boolean => {
  if (!normalizedQuery) return true;
  const haystack = [item.name, item.summary ?? '', item.type, item.sourceId, item.status, item.reviewDecision ?? '', item.reviewNotes ?? '', JSON.stringify(item.normalizedJson ?? {}), ...item.tags].join(' ').toLowerCase();
  return normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
};

const parseSnapshotJson = (json: string): CompendiumPersistenceState => {
  const parsed = JSON.parse(json) as unknown;
  if (parsed && typeof parsed === 'object' && 'state' in parsed) {
    return sanitizeCompendiumPersistenceState((parsed as { state?: unknown }).state);
  }
  return sanitizeCompendiumPersistenceState(parsed);
};

const setSnapshot = (snapshot: CompendiumPersistenceState) => ({ ...createCompendiumPersistenceState(snapshot), isHydrated: true, lastStorageError: undefined });

export const useCompendiumStore = create<CompendiumStore>()((set, get) => ({
  ...emptyCompendiumPersistenceState(),
  isHydrated: false,
  isHydrating: false,
  isSaving: false,
  lastStorageError: undefined,
  persistenceVersion: COMPENDIUM_PERSISTENCE_VERSION,

  hydrate: async () => {
    if (get().isHydrating) return { ok: true, issues: [] };
    set({ isHydrating: true, lastStorageError: undefined });
    try {
      const result = await loadCompendiumSnapshotWithLegacyFallback();
      set({ ...setSnapshot(result.snapshot), isHydrating: false });
      const issues: RuleValidationIssue[] = [];

      if (result.migratedLegacySnapshot) {
        issues.push({
          severity: 'warning',
          code: 'LEGACY_COMPENDIUM_MIGRATED',
          message: 'Snapshot legado do AsyncStorage migrado automaticamente para SQLite.'
        });
      } else if (result.usedLegacyFallback) {
        issues.push({
          severity: 'warning',
          code: 'LEGACY_COMPENDIUM_FALLBACK_USED',
          message: 'O compêndio está usando o armazenamento persistente compatível com esta plataforma para leitura e gravação.'
        });
      }

      if (result.seededBundledCompendium) {
        issues.push({
          severity: 'warning',
          code: 'BUNDLED_COMPENDIUM_SEEDED',
          message:
            `Compêndio incluído instalado automaticamente: ${result.seededPackIds.length} pacote(s), ` +
            `${result.seededItemCount} item(ns) e ${result.preparedCoreItemCount} item(ns) preparados para criação/progressão.`
        });
      }

      if (result.reconciledBundledCompendium) {
        issues.push({
          severity: 'info',
          code: 'BUNDLED_COMPENDIUM_V2_RECONCILED',
          message:
            `Compêndio incluído promovido para Import V2 sem alterar conteúdo: ${result.reconciledPackIds.length} pacote(s), ` +
            `${result.backfilledContentHashCount} hash(es) canônico(s) preenchido(s).`
        });
      }

      if (result.restoredRequiredBundledPackIds.length) {
        issues.push({
          severity: 'info',
          code: 'REQUIRED_CHARACTER_CREATION_CONTENT_RESTORED',
          message:
            `Conteúdo básico necessário para criação restaurado automaticamente: ${result.restoredRequiredBundledPackIds.length} pacote(s).`
        });
      }

      for (const message of result.requiredBundledRepairIssues) {
        issues.push({
          severity: 'warning',
          code: 'REQUIRED_CHARACTER_CREATION_CONTENT_REPAIR_DEFERRED',
          message
        });
      }

      if (result.deferredBundledPackIds.length) {
        issues.push({
          severity: 'warning',
          code: 'BUNDLED_COMPENDIUM_V2_RECONCILIATION_DEFERRED',
          message:
            `A migração automática para Import V2 foi adiada para ${result.deferredBundledPackIds.length} pacote(s) porque o conteúdo local diverge do bundle. Nenhum dado local foi sobrescrito.`
        });
      }

      return { ok: true, issues };
    } catch {
      const issue = genericStorageIssue('COMPENDIUM_SQLITE_HYDRATION_FAILED', 'Não foi possível carregar o compêndio SQLite local.');
      set({ isHydrating: false, isHydrated: true, lastStorageError: issue.message });
      return { ok: false, issues: [issue] };
    }
  },

  saveImportJson: async (json) => {
    set({ isSaving: true, lastStorageError: undefined });
    try {
      const repository = getActiveCompendiumRepository();
      let detected: ReturnType<typeof detectCompendiumImportVersion> = 'unknown';
      try {
        detected = detectCompendiumImportVersion(JSON.parse(json) as unknown);
      } catch {
        // Let the legacy parser return its normal JSON/schema issues below.
      }

      // Any explicitly versioned structured pack crosses the canonical V2
      // preview/upsert boundary. V1 is migrated by parseImportPack inside the
      // repository, so semantic owner/reference validation cannot be bypassed
      // by saving a versioned V1 envelope through the historical persistence
      // path. Truly unversioned legacy payloads keep the old path below.
      if (detected === IMPORT_TEMPLATE_VERSION_V2 || detected === LEGACY_IMPORT_TEMPLATE_VERSION_V1) {
        const result = await repository.saveImportV2Json(json);
        set({ ...setSnapshot(result.snapshot), isSaving: false });
        return {
          ok: result.ok,
          itemCount: result.preview?.itemsFound ?? 0,
          importFormat: 'v2' as const,
          issues: result.issues
        };
      }

      const result = await repository.saveImportJson(json);
      set({ ...setSnapshot(result.snapshot), isSaving: false });
      return {
        ok: result.ok,
        imported: result.imported,
        itemCount: result.imported?.items.length ?? 0,
        importFormat: 'v1' as const,
        issues: result.issues
      };
    } catch {
      const issue = genericStorageIssue('COMPENDIUM_SQLITE_IMPORT_SAVE_FAILED', 'Não foi possível salvar a importação no SQLite.');
      set({ isSaving: false, lastStorageError: issue.message });
      return { ok: false, itemCount: 0, issues: [issue] };
    }
  },

  installBundledPack: async (packId) => {
    set({ isSaving: true, lastStorageError: undefined });
    try {
      let result = await installBundledCompendiumPack(getActiveCompendiumRepository(), packId);

      // On Web or restricted runtimes expo-sqlite can be readable during
      // hydration yet fail when a transaction is opened. If the failure is
      // specifically from the SQLite persistence layer, copy the exact store
      // snapshot to the AsyncStorage repository and retry once there. Content
      // conflicts are deliberately not retried because they are domain errors,
      // not backend availability errors.
      const sqlitePersistenceFailure = result.issues.some((issue) =>
        issue.code.startsWith('SQLITE_')
      );
      if (!result.ok && sqlitePersistenceFailure) {
        const fallback = await activateLegacyCompendiumFallback(
          createCompendiumPersistenceState(get())
        );
        result = await installBundledCompendiumPack(fallback, packId);
      }

      set({ ...setSnapshot(result.snapshot), isSaving: false });
      return { ok: result.ok, issues: result.issues };
    } catch (error) {
      // Some expo-sqlite Web/native failures are thrown by the platform before
      // the repository can convert them into SQLITE_* issues. Retry once on
      // the snapshot backend when SQLite was the active writer.
      if (getActiveCompendiumRepositoryKind() === 'sqlite') {
        try {
          const fallback = await activateLegacyCompendiumFallback(
            createCompendiumPersistenceState(get())
          );
          const retry = await installBundledCompendiumPack(fallback, packId);
          set({ ...setSnapshot(retry.snapshot), isSaving: false });
          return { ok: retry.ok, issues: retry.issues };
        } catch {
          // Preserve the original platform error below; it is usually more
          // actionable than a secondary fallback failure.
        }
      }
      const detail = error instanceof Error ? error.message : String(error);
      const issue = genericStorageIssue(
        'BUNDLED_COMPENDIUM_INSTALL_FAILED',
        `Não foi possível instalar o pacote incluído no aplicativo. Detalhes: ${detail}`
      );
      set({ isSaving: false, lastStorageError: issue.message });
      return { ok: false, issues: [issue] };
    }
  },

  repairRequiredBundledContent: async () => {
    set({ isSaving: true, lastStorageError: undefined });
    try {
      let result = await ensureRequiredCharacterCreationCompendium(
        getActiveCompendiumRepository()
      );
      const sqlitePersistenceFailure = result.issues.some((issue) =>
        issue.code.startsWith('SQLITE_')
      );
      if (!result.ok && sqlitePersistenceFailure) {
        const fallback = await activateLegacyCompendiumFallback(
          createCompendiumPersistenceState(get())
        );
        result = await ensureRequiredCharacterCreationCompendium(fallback);
      }
      set({ ...setSnapshot(result.snapshot), isSaving: false });
      return { ok: result.ok, issues: result.issues };
    } catch (error) {
      if (getActiveCompendiumRepositoryKind() === 'sqlite') {
        try {
          const fallback = await activateLegacyCompendiumFallback(
            createCompendiumPersistenceState(get())
          );
          const retry = await ensureRequiredCharacterCreationCompendium(fallback);
          set({ ...setSnapshot(retry.snapshot), isSaving: false });
          return { ok: retry.ok, issues: retry.issues };
        } catch {
          // Preserve the original platform error below.
        }
      }
      const detail = error instanceof Error ? error.message : String(error);
      const issue = genericStorageIssue(
        'REQUIRED_BUNDLED_COMPENDIUM_REPAIR_FAILED',
        `Não foi possível reparar o conteúdo básico. Detalhes: ${detail}`
      );
      set({ isSaving: false, lastStorageError: issue.message });
      return { ok: false, issues: [issue] };
    }
  },

  removePack: async (packId) => {
    if (isRequiredCharacterCreationBundledPack(packId)) {
      return {
        ok: false,
        issues: [genericStorageIssue(
          'REQUIRED_CHARACTER_CREATION_PACK_CANNOT_BE_REMOVED',
          'O Player’s Handbook 2024 é o conteúdo básico necessário para a criação de personagens e não pode ser removido pelo gerenciador de conteúdo.'
        )]
      };
    }
    set({ isSaving: true, lastStorageError: undefined });
    try {
      const snapshot = await getActiveCompendiumRepository().removePack(packId);
      set({ ...setSnapshot(snapshot), isSaving: false });
      return { ok: true, issues: [] };
    } catch {
      const issue = genericStorageIssue('COMPENDIUM_SQLITE_REMOVE_PACK_FAILED', 'Não foi possível remover o pacote do SQLite.');
      set({ isSaving: false, lastStorageError: issue.message });
      return { ok: false, issues: [issue] };
    }
  },

  setSourceEnabled: async (sourceId, enabled) => {
    set({ isSaving: true, lastStorageError: undefined });
    try {
      let repository = getActiveCompendiumRepository();
      try {
        const snapshot = await repository.setSourceEnabled(sourceId, enabled);
        set({ ...setSnapshot(snapshot), isSaving: false });
        return { ok: true, issues: [] };
      } catch {
        repository = await activateLegacyCompendiumFallback(
          createCompendiumPersistenceState(get())
        );
        const snapshot = await repository.setSourceEnabled(sourceId, enabled);
        set({ ...setSnapshot(snapshot), isSaving: false });
        return { ok: true, issues: [] };
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const issue = genericStorageIssue(
        'COMPENDIUM_SOURCE_TOGGLE_FAILED',
        `Não foi possível atualizar a fonte do compêndio. Detalhes: ${detail}`
      );
      set({ isSaving: false, lastStorageError: issue.message });
      return { ok: false, issues: [issue] };
    }
  },

  prepareCoreCharacterContent: async () => {
    set({
      isSaving: true,
      lastStorageError: undefined
    });

    try {
      const prepared =
        prepareCoreCharacterContentSnapshot(
          createCompendiumPersistenceState(get())
        );

      await getActiveCompendiumRepository().saveSnapshot(
        prepared.snapshot
      );

      set({
        ...setSnapshot(prepared.snapshot),
        isSaving: false
      });

      return {
        ok: true,
        issues: [],
        eligibleItemCount: prepared.eligibleItemCount,
        validatedItemCount:
          prepared.newlyValidatedItemCount,
        enabledSourceCount:
          prepared.enabledSourceCount
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      const issue = genericStorageIssue(
        'COMPENDIUM_SQLITE_PREPARE_CORE_FAILED',
        `Não foi possível preparar os dados básicos. Detalhes: ${message}`
      );

      set({
        isSaving: false,
        lastStorageError: issue.message
      });

      return {
        ok: false,
        issues: [issue],
        eligibleItemCount: 0,
        validatedItemCount: 0,
        enabledSourceCount: 0
      };
    }
  },

  setItemStatus: async (itemId, status) => {
    return get().updateItemReview(itemId, {
      status,
      reviewDecision: status === 'validated' ? 'approved' : status === 'disabled' ? 'rejected' : 'pending'
    });
  },

  updateItemReview: async (itemId, update) => get().updateItemsReview([{ itemId, update }]),

  updateItemsReview: async (entries) => {
    set({ isSaving: true, lastStorageError: undefined });
    try {
      const snapshot = await getActiveCompendiumRepository().updateItemsReview(entries);
      set({ ...setSnapshot(snapshot), isSaving: false });
      return { ok: true, issues: [] };
    } catch (error) {
      const details = error instanceof Error ? ` Detalhes: ${error.message}` : '';
      const issue = genericStorageIssue('COMPENDIUM_SQLITE_BATCH_REVIEW_FAILED', `Não foi possível salvar a revisão em lote no SQLite.${details}`);
      set({ isSaving: false, lastStorageError: issue.message });
      return { ok: false, issues: [issue] };
    }
  },


  updateItemMapping: async (itemId, update) => {
    set({ isSaving: true, lastStorageError: undefined });
    try {
      const snapshot = await getActiveCompendiumRepository().updateItemMapping(itemId, update);
      set({ ...setSnapshot(snapshot), isSaving: false });
      return { ok: true, issues: [] };
    } catch {
      const issue = genericStorageIssue('COMPENDIUM_SQLITE_ITEM_MAPPING_FAILED', 'Não foi possível salvar o mapeamento visual do item no SQLite.');
      set({ isSaving: false, lastStorageError: issue.message });
      return { ok: false, issues: [issue] };
    }
  },

  searchItems: (query, filters) => {
    const normalizedQuery = query.trim().toLowerCase();
    const typeSet = filters?.types?.length ? new Set(filters.types) : undefined;
    const statusSet = filters?.statuses?.length ? new Set(filters.statuses) : undefined;
    const sourceSet = filters?.sourceIds?.length ? new Set(filters.sourceIds) : undefined;
    const onlyEnabled = filters?.onlyEnabled ?? true;
    const enabledSourceIds = new Set(get().enabledSourceIds);

    return get()
      .items.filter((item) => (typeSet ? typeSet.has(item.type) : true))
      .filter((item) => (statusSet ? statusSet.has(item.status) : item.status !== 'disabled'))
      .filter((item) => (sourceSet ? sourceSet.has(item.sourceId) : true))
      .filter((item) => (onlyEnabled ? enabledSourceIds.has(item.sourceId) : true))
      .filter((item) => itemMatchesSearch(item, normalizedQuery))
      .sort((left, right) => left.name.localeCompare(right.name));
  },

  replaceSnapshot: async (snapshot) => {
    set({ isSaving: true, lastStorageError: undefined });
    try {
      const cleanSnapshot = createCompendiumPersistenceState(snapshot);
      await getActiveCompendiumRepository().saveSnapshot(cleanSnapshot);
      set({ ...setSnapshot(cleanSnapshot), isSaving: false });
      return { ok: true, issues: [] };
    } catch {
      const issue = genericStorageIssue('COMPENDIUM_SQLITE_REPLACE_SNAPSHOT_FAILED', 'Não foi possível substituir o snapshot do compêndio no SQLite.');
      set({ isSaving: false, lastStorageError: issue.message });
      return { ok: false, issues: [issue] };
    }
  },

  getSnapshot: () => createCompendiumPersistenceState(get()),

  exportSnapshotJson: () => JSON.stringify({ state: createCompendiumPersistenceState(get()), version: COMPENDIUM_PERSISTENCE_VERSION }, null, 2),

  importSnapshotJson: async (json) => {
    try {
      const snapshot = parseSnapshotJson(json);
      return await get().replaceSnapshot(snapshot);
    } catch {
      const issue = genericStorageIssue('COMPENDIUM_SNAPSHOT_PARSE_FAILED', 'Snapshot JSON inválido ou corrompido.');
      set({ lastStorageError: issue.message });
      return { ok: false, issues: [issue] };
    }
  },

  clearCompendium: async () => {
    set({ isSaving: true, lastStorageError: undefined });
    try {
      await getActiveCompendiumRepository().clearSnapshot();
      set({ ...emptyCompendiumPersistenceState(), isHydrated: true, isSaving: false });
      return { ok: true, issues: [] };
    } catch {
      const issue = genericStorageIssue('COMPENDIUM_SQLITE_CLEAR_FAILED', 'Não foi possível limpar o compêndio SQLite.');
      set({ isSaving: false, lastStorageError: issue.message });
      return { ok: false, issues: [issue] };
    }
  }
}));
