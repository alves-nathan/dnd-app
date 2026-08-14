import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { CatalogQueryService } from '../catalog/catalogQueryService';
import { ContentPolicyService } from '../catalog/contentPolicyService';
import { initializeBundledCatalog } from '../catalog/bundledCatalog';
import { CatalogLoader } from '../catalog/catalogLoader';
import { catalogDigestAdapter } from '../catalog/catalogBundleDigest';
import type {
  CatalogEntityState,
  CatalogFilterState,
  CatalogSearchRequest,
  CatalogSnapshot,
  EntityAvailability,
  FilterImpactReport,
  RuntimeCatalogEntry
} from '../catalog/types';
import { asyncStorageAdapter } from '../storage/asyncStorageAdapter';
import {
  cloneCatalogFilterState,
  createCatalogFilterPreferencesRepository,
  type CatalogConfigurationCheckpointDocument
} from '../storage/catalogFilterPreferences';
import type {
  CatalogConfigurationCommitContext,
  CatalogConfigurationCommitOrigin,
  CatalogConfigurationHistoryEntry
} from '../catalog/catalogConfigurationHistory';
import type { KeyValueStorageAdapter } from '../storage/keyValueStorage';
import { createCatalogPackageRepository, type CatalogRuntimePackageRef } from '../storage/catalogPackageRepository';
import {
  portableCatalogImportMetadata,
  type PortableCatalogAuditComparison,
  type PortableCatalogAuditSection
} from '../backup/portableCatalogBackup';

export type CatalogStoreStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface PendingCatalogFilterChange {
  label: string;
  origin: CatalogConfigurationCommitOrigin;
  restoredFromCommitId?: string;
  nextState: CatalogFilterState;
  impact: FilterImpactReport;
  portableImport?: ReturnType<typeof portableCatalogImportMetadata>;
}

export interface CatalogStoreOperationResult {
  ok: boolean;
  issues: string[];
  historyEntryId?: string;
}

export interface CatalogStore {
  status: CatalogStoreStatus;
  runtimeRef: CatalogRuntimePackageRef;
  snapshot?: CatalogSnapshot;
  filterState?: CatalogFilterState;
  pendingChange?: PendingCatalogFilterChange;
  history: CatalogConfigurationHistoryEntry[];
  revision: number;
  isSaving: boolean;
  preferencesRestored: boolean;
  lastSavedAt?: string;
  lastError?: string;
  initializationIssues: string[];
  initialize: () => Promise<CatalogStoreOperationResult>;
  retry: () => Promise<CatalogStoreOperationResult>;
  previewBookState: (
    bookId: string,
    enabled: boolean
  ) => PendingCatalogFilterChange;
  previewCategoryState: (
    categoryId: string,
    enabled: boolean
  ) => PendingCatalogFilterChange;
  previewEntityState: (
    entityId: string,
    entityState: CatalogEntityState
  ) => PendingCatalogFilterChange;
  previewProfile: (profileId: string) => PendingCatalogFilterChange;
  previewReset: () => PendingCatalogFilterChange;
  previewHistoryRestore: (commitId: string, target?: 'before' | 'after') => PendingCatalogFilterChange;
  previewPortableBackupImport: (section: PortableCatalogAuditSection, comparison: PortableCatalogAuditComparison) => PendingCatalogFilterChange;
  commitPendingChange: (context?: CatalogConfigurationCommitContext) => Promise<CatalogStoreOperationResult>;
  replaceConfigurationCheckpoint: (checkpoint: CatalogConfigurationCheckpointDocument) => Promise<CatalogStoreOperationResult>;
  switchRuntimeCatalog: (ref: CatalogRuntimePackageRef, checkpoint: CatalogConfigurationCheckpointDocument) => Promise<CatalogStoreOperationResult>;
  discardPendingChange: () => void;
  search: (request?: CatalogSearchRequest) => RuntimeCatalogEntry[];
  evaluate: (entityId: string) => EntityAvailability | undefined;
  enabledCount: () => number;
  exportPreferencesJson: () => string;
  importPreferencesJson: (
    json: string
  ) => Promise<CatalogStoreOperationResult>;
}

const requireReady = (
  state: CatalogStore
): {
  snapshot: CatalogSnapshot;
  filterState: CatalogFilterState;
  policy: ContentPolicyService;
} => {
  if (state.status !== 'ready' || !state.snapshot || !state.filterState) {
    throw new Error('O catálogo de regras ainda não está pronto.');
  }
  return {
    snapshot: state.snapshot,
    filterState: state.filterState,
    policy: new ContentPolicyService(state.snapshot)
  };
};

const stageChange = (
  state: CatalogStore,
  label: string,
  nextState: CatalogFilterState,
  origin: CatalogConfigurationCommitOrigin = 'manual',
  restoredFromCommitId?: string,
  portableImport?: ReturnType<typeof portableCatalogImportMetadata>
): PendingCatalogFilterChange => {
  const { filterState, policy } = requireReady(state);
  return {
    label,
    origin,
    restoredFromCommitId,
    nextState: cloneCatalogFilterState(nextState),
    impact: policy.previewImpact(filterState, nextState),
    portableImport
  };
};

export const createCatalogStore = (
  storage: KeyValueStorageAdapter = asyncStorageAdapter,
  now: () => Date = () => new Date()
): UseBoundStore<StoreApi<CatalogStore>> => {
  const preferences = createCatalogFilterPreferencesRepository(storage, now);
  const packages = createCatalogPackageRepository(storage, now);
  let initializationPromise:
    | Promise<CatalogStoreOperationResult>
    | undefined;

  return create<CatalogStore>()((set, get) => ({
    status: 'idle',
    runtimeRef: { kind: 'bundled' },
    snapshot: undefined,
    filterState: undefined,
    pendingChange: undefined,
    history: [],
    revision: 0,
    isSaving: false,
    preferencesRestored: false,
    lastSavedAt: undefined,
    lastError: undefined,
    initializationIssues: [],

    initialize: async () => {
      if (get().status === 'ready') return { ok: true, issues: [] };
      if (initializationPromise) return initializationPromise;

      initializationPromise = (async () => {
        set({
          status: 'loading',
          lastError: undefined,
          initializationIssues: []
        });
        try {
          const activePackage = await packages.loadActive();
          const snapshot = activePackage.ref.kind === 'bundled'
            ? initializeBundledCatalog()
            : await new CatalogLoader().initializeFromText(activePackage.rawText!, {
                expectedSha256: activePackage.descriptor!.checksum,
                digestAdapter: catalogDigestAdapter
              });
          const policy = new ContentPolicyService(snapshot);
          const fallback = policy.createDefaultState();
          const restored = await preferences.load(snapshot, fallback);
          set({
            status: 'ready',
            runtimeRef: activePackage.ref,
            snapshot,
            filterState: restored.state,
            pendingChange: undefined,
            history: restored.history,
            revision: restored.revision,
            preferencesRestored: restored.restored,
            initializationIssues: restored.issues,
            lastError: undefined
          });
          return { ok: true, issues: restored.issues };
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Falha inesperada ao carregar o catálogo.';
          set({
            status: 'failed',
            snapshot: undefined,
            filterState: undefined,
            pendingChange: undefined,
            history: [],
            revision: 0,
            lastError: message
          });
          return { ok: false, issues: [message] };
        } finally {
          initializationPromise = undefined;
        }
      })();

      return initializationPromise;
    },

    retry: async () => {
      set({ status: 'idle', lastError: undefined });
      return get().initialize();
    },

    previewBookState: (bookId, enabled) => {
      const current = get();
      const { snapshot, filterState } = requireReady(current);
      if (!snapshot.manifest.sourceBooks.includes(bookId)) {
        throw new Error(`Livro desconhecido: ${bookId}.`);
      }
      const next = cloneCatalogFilterState(filterState);
      next.bookStates[bookId] = enabled;
      const pendingChange = stageChange(
        current,
        `${enabled ? 'Ativar' : 'Desativar'} ${bookId}`,
        next,
        'book'
      );
      set({ pendingChange });
      return pendingChange;
    },

    previewCategoryState: (categoryId, enabled) => {
      const current = get();
      const { snapshot, filterState } = requireReady(current);
      const category = snapshot.categoryById.get(categoryId);
      if (!category) throw new Error(`Categoria desconhecida: ${categoryId}.`);
      if (!enabled && category.canDisable === false) {
        throw new Error(`A categoria ${categoryId} é obrigatória e não pode ser desativada.`);
      }
      const next = cloneCatalogFilterState(filterState);
      next.categoryStates[categoryId] = enabled;
      const pendingChange = stageChange(
        current,
        `${enabled ? 'Ativar' : 'Desativar'} ${category.name['pt-BR'] ?? category.name.en ?? category.key}`,
        next,
        'category'
      );
      set({ pendingChange });
      return pendingChange;
    },

    previewEntityState: (entityId, entityState) => {
      const current = get();
      const { snapshot, filterState } = requireReady(current);
      const entry = snapshot.entryById.get(entityId);
      if (!entry) throw new Error(`Entidade desconhecida: ${entityId}.`);
      const next = cloneCatalogFilterState(filterState);
      if (entityState === 'inherit') delete next.entityStates[entityId];
      else next.entityStates[entityId] = entityState;
      const pendingChange = stageChange(
        current,
        `Alterar ${entry.displayName}`,
        next,
        'entity'
      );
      set({ pendingChange });
      return pendingChange;
    },

    previewProfile: (profileId) => {
      const current = get();
      const { snapshot, policy } = requireReady(current);
      const profile = snapshot.filterPolicy.profiles.find(
        (candidate) => candidate.id === profileId
      );
      if (!profile) throw new Error(`Perfil desconhecido: ${profileId}.`);
      const pendingChange = stageChange(
        current,
        `Aplicar perfil ${profile.name}`,
        policy.createDefaultState(profileId),
        'profile'
      );
      set({ pendingChange });
      return pendingChange;
    },

    previewReset: () => {
      const current = get();
      const { policy } = requireReady(current);
      const pendingChange = stageChange(
        current,
        'Restaurar filtros padrão',
        policy.createDefaultState(),
        'reset'
      );
      set({ pendingChange });
      return pendingChange;
    },

    previewHistoryRestore: (commitId, target = 'before') => {
      const current = get();
      requireReady(current);
      const entry = current.history.find((candidate) => candidate.id === commitId);
      if (!entry) throw new Error(`Commit de configuração desconhecido: ${commitId}.`);
      const targetState = target === 'before' ? entry.beforeState : entry.afterState;
      const pendingChange = stageChange(
        current,
        `${target === 'before' ? 'Restaurar configuração anterior a' : 'Restaurar estado de'} ${entry.label}`,
        targetState,
        'restore',
        entry.id
      );
      set({ pendingChange });
      return pendingChange;
    },

    previewPortableBackupImport: (section, comparison) => {
      const current = get();
      requireReady(current);
      const pendingChange = stageChange(
        current,
        `Importar backup portátil do catálogo (revisão ${section.revision})`,
        section.filterState,
        'import',
        undefined,
        portableCatalogImportMetadata(section, comparison)
      );
      set({ pendingChange });
      return pendingChange;
    },

    commitPendingChange: async (context) => {
      const current = get();
      if (!current.pendingChange || !current.snapshot) {
        return { ok: false, issues: ['Nenhuma alteração está aguardando confirmação.'] };
      }
      set({ isSaving: true, lastError: undefined });
      try {
        const saved = await preferences.save(
          current.snapshot,
          current.pendingChange.nextState,
          {
            beforeState: current.filterState,
            label: current.pendingChange.label,
            impact: current.pendingChange.impact,
            context: {
              ...context,
              origin: current.pendingChange.origin,
              restoredFromCommitId: current.pendingChange.restoredFromCommitId,
              portableImport: current.pendingChange.portableImport
            }
          }
        );
        set({
          filterState: cloneCatalogFilterState(
            current.pendingChange.nextState
          ),
          pendingChange: undefined,
          history: saved.history ?? current.history,
          revision: saved.revision ?? current.revision,
          isSaving: false,
          preferencesRestored: true,
          lastSavedAt: saved.savedAt,
          lastError: undefined
        });
        return { ok: true, issues: [], historyEntryId: saved.historyEntry?.id };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Não foi possível persistir os filtros do catálogo.';
        set({ isSaving: false, lastError: message });
        return { ok: false, issues: [message] };
      }
    },

    replaceConfigurationCheckpoint: async (checkpoint) => {
      const current = get();
      if (!current.snapshot) return { ok: false, issues: ['O catálogo de regras ainda não está pronto.'] };
      set({ isSaving: true, lastError: undefined });
      try {
        const saved = await preferences.replace(current.snapshot, checkpoint);
        set({
          filterState: cloneCatalogFilterState(saved.filterState),
          pendingChange: undefined,
          history: saved.history ?? [],
          revision: saved.revision ?? 0,
          isSaving: false,
          preferencesRestored: true,
          lastSavedAt: saved.savedAt,
          lastError: undefined
        });
        return { ok: true, issues: [] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Não foi possível restaurar o checkpoint do catálogo.';
        set({ isSaving: false, lastError: message });
        return { ok: false, issues: [message] };
      }
    },


    switchRuntimeCatalog: async (ref, checkpoint) => {
      const current = get();
      const oldRef = current.runtimeRef;
      const oldSnapshot = current.snapshot;
      const oldCheckpoint: CatalogConfigurationCheckpointDocument | undefined = current.filterState ? {
        filterState: cloneCatalogFilterState(current.filterState),
        revision: current.revision,
        history: current.history.map((entry) => ({ ...entry }))
      } : undefined;
      set({ isSaving: true, lastError: undefined });
      try {
        const loaded = ref.kind === 'bundled' ? undefined : await packages.readPackage(ref.packageId);
        const snapshot = ref.kind === 'bundled'
          ? initializeBundledCatalog()
          : await new CatalogLoader().initializeFromText(loaded!.rawText, {
              expectedSha256: loaded!.descriptor.checksum,
              digestAdapter: catalogDigestAdapter
            });
        const indexBefore = await packages.loadIndex();
        await packages.activate(ref);
        try {
          const saved = await preferences.replace(snapshot, checkpoint);
          set({
            status: 'ready',
            runtimeRef: { ...ref },
            snapshot,
            filterState: cloneCatalogFilterState(saved.filterState),
            pendingChange: undefined,
            history: saved.history ?? [],
            revision: saved.revision ?? 0,
            isSaving: false,
            preferencesRestored: true,
            lastSavedAt: saved.savedAt,
            lastError: undefined
          });
          return { ok: true, issues: [] };
        } catch (error) {
          await packages.restoreActive(indexBefore.active, indexBefore.previous);
          if (oldSnapshot && oldCheckpoint) await preferences.replace(oldSnapshot, oldCheckpoint);
          throw error;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Não foi possível trocar a versão ativa do catálogo.';
        set({ runtimeRef: oldRef, isSaving: false, lastError: message });
        return { ok: false, issues: [message] };
      }
    },

    discardPendingChange: () => set({ pendingChange: undefined }),

    search: (request = {}) => {
      const current = get();
      if (
        current.status !== 'ready' ||
        !current.snapshot ||
        !current.filterState
      ) {
        return [];
      }
      return new CatalogQueryService(current.snapshot).search(
        request,
        current.filterState
      );
    },

    evaluate: (entityId) => {
      const current = get();
      if (
        current.status !== 'ready' ||
        !current.snapshot ||
        !current.filterState
      ) {
        return undefined;
      }
      return new ContentPolicyService(current.snapshot).evaluate(
        entityId,
        current.filterState
      );
    },

    enabledCount: () => {
      const current = get();
      if (
        current.status !== 'ready' ||
        !current.snapshot ||
        !current.filterState
      ) {
        return 0;
      }
      const policy = new ContentPolicyService(current.snapshot);
      let count = 0;
      for (const entry of current.snapshot.entries) {
        if (policy.isEnabled(entry.entityId, current.filterState)) count += 1;
      }
      return count;
    },

    exportPreferencesJson: () => {
      const { snapshot, filterState } = requireReady(get());
      return JSON.stringify(
        {
          schemaVersion: 'dnd-combat-catalog-filter-export.v1',
          catalogVersion: snapshot.catalogVersion,
          exportedAt: now().toISOString(),
          filterState
        },
        null,
        2
      );
    },

    importPreferencesJson: async (json) => {
      try {
        const current = get();
        const { snapshot, filterState, policy } = requireReady(current);
        const parsed = JSON.parse(json) as {
          filterState?: CatalogFilterState;
        };
        const candidate = parsed.filterState;
        if (!candidate) throw new Error('O arquivo não contém filterState.');
        const next: CatalogFilterState = {
          bookStates: {
            ...policy.createDefaultState().bookStates,
            ...candidate.bookStates
          },
          categoryStates: { ...candidate.categoryStates },
          entityStates: { ...candidate.entityStates }
        };
        const pendingChange = stageChange(
          { ...current, filterState },
          `Importar preferências para o catálogo ${snapshot.catalogVersion}`,
          next,
          'import'
        );
        set({ pendingChange });
        return { ok: true, issues: [] };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Preferências de catálogo inválidas.';
        set({ lastError: message });
        return { ok: false, issues: [message] };
      }
    }
  }));
};

export const useCatalogStore = createCatalogStore();
