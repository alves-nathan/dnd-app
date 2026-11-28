import { Platform } from 'react-native';
import { KeyValueCompendiumRepository } from './compendiumRepository';
import type { CompendiumRepository } from './compendiumRepository';
import type { CompendiumPersistenceState } from './compendiumSnapshot';
import { COMPENDIUM_STORAGE_KEY } from './compendiumSnapshot';
import { asyncStorageAdapter } from './asyncStorageAdapter';
import { indexedDbStorageAdapter } from './indexedDbStorageAdapter';
import {observeExistingKeyValueCompendium,type IndependentCompendiumObservation} from './readOnlyCompendiumObservation';
import { SQLiteCompendiumRepository, createSQLiteCompendiumRepository } from './sqliteCompendiumRepository';
import { ensureRequiredCharacterCreationCompendium, initializeBundledCompendium, reconcileBundledCompendium } from './bundledCompendiumBootstrap';

export interface CompendiumBootstrapResult {
  snapshot: CompendiumPersistenceState;
  migratedLegacySnapshot: boolean;
  usedLegacyFallback: boolean;
  seededBundledCompendium: boolean;
  seededPackIds: string[];
  seededItemCount: number;
  preparedCoreItemCount: number;
  bundledWarningCount: number;
  reconciledBundledCompendium: boolean;
  reconciledPackIds: string[];
  deferredBundledPackIds: string[];
  backfilledContentHashCount: number;
  restoredRequiredBundledPackIds: string[];
  requiredBundledRepairIssues: string[];
}

export type ActiveCompendiumRepositoryKind = 'sqlite' | 'web' | 'legacy';

let activeRepository: CompendiumRepository | undefined;
let activeRepositoryKind: ActiveCompendiumRepositoryKind = 'sqlite';

export const preferredCompendiumRepositoryKindForPlatform = (
  platform: string
): ActiveCompendiumRepositoryKind => platform === 'web' ? 'web' : 'sqlite';

const isEmptySnapshot = (snapshot: CompendiumPersistenceState): boolean =>
  snapshot.sources.length === 0 && snapshot.packs.length === 0 && snapshot.items.length === 0 && snapshot.enabledSourceIds.length === 0;

const emptyBootstrapMetadata = () => ({
  seededBundledCompendium: false,
  seededPackIds: [],
  seededItemCount: 0,
  preparedCoreItemCount: 0,
  bundledWarningCount: 0,
  reconciledBundledCompendium: false,
  reconciledPackIds: [],
  deferredBundledPackIds: [],
  backfilledContentHashCount: 0,
  restoredRequiredBundledPackIds: [],
  requiredBundledRepairIssues: []
});

const reconciliationMetadata = (
  result: Awaited<ReturnType<typeof reconcileBundledCompendium>>
) => ({
  reconciledBundledCompendium: result.reconciled,
  reconciledPackIds: result.reconciledPackIds,
  deferredBundledPackIds: result.deferredPackIds,
  backfilledContentHashCount: result.contentHashesBackfilled,
  bundledWarningCount: result.warningCount
});

const createLegacyRepository = (): KeyValueCompendiumRepository =>
  new KeyValueCompendiumRepository(asyncStorageAdapter, COMPENDIUM_STORAGE_KEY);

const createWebRepository = (): KeyValueCompendiumRepository =>
  new KeyValueCompendiumRepository(indexedDbStorageAdapter, COMPENDIUM_STORAGE_KEY);

const loadLegacySnapshot = async (): Promise<CompendiumPersistenceState> =>
  createLegacyRepository().loadSnapshot();

export const getActiveCompendiumRepository = (): CompendiumRepository => {
  const preferredKind = preferredCompendiumRepositoryKindForPlatform(Platform.OS);

  // expo-sqlite on Web uses OPFS sync access handles. A browser tab/HMR
  // session can legitimately leave another handle open for the same file,
  // causing createSyncAccessHandle() to throw NoModificationAllowedError.
  // Browser persistence does not need SQLite for this snapshot-oriented
  // repository, so use IndexedDB as the authoritative read/write boundary.
  // This also avoids AsyncStorage/localStorage quota limits for full books.
  if (!activeRepository || activeRepositoryKind !== preferredKind) {
    if (preferredKind === 'web') {
      activeRepository = createWebRepository();
      activeRepositoryKind = 'web';
    } else if (preferredKind === 'legacy') {
      activeRepository = createLegacyRepository();
      activeRepositoryKind = 'legacy';
    } else {
      activeRepository = createSQLiteCompendiumRepository();
      activeRepositoryKind = 'sqlite';
    }
  }
  return activeRepository;
};

export const getActiveCompendiumRepositoryKind = (): ActiveCompendiumRepositoryKind => activeRepositoryKind;

/** Never invokes getActiveCompendiumRepository or bootstrap. Web storage
 * currently has no retained handle, so it is intentionally unavailable. */
export async function observeExistingActiveCompendium():Promise<IndependentCompendiumObservation>{
  const repository=activeRepository,backend=activeRepositoryKind;
  if(!repository)return {status:'unavailable',backend,code:'activeRepositoryNotInitialized'};
  const result=backend==='legacy'?await observeExistingKeyValueCompendium('legacy',asyncStorageAdapter):
    backend==='sqlite'&&repository instanceof SQLiteCompendiumRepository?await repository.observeExistingSnapshot():
    {status:'unavailable' as const,backend,code:'nonInitializingReadUnavailable'};
  if(repository!==activeRepository||backend!==activeRepositoryKind)return {status:'stale',backend,code:'activeRepositoryChanged'};
  return result;
}

/**
 * Switches the active persistence boundary to the AsyncStorage-backed legacy
 * repository for the rest of the current app session. When a snapshot is
 * supplied it is copied first, so subsequent writes operate on the exact state
 * the UI has already hydrated instead of on a stale fallback snapshot.
 */
export const activateLegacyCompendiumFallback = async (
  snapshot?: CompendiumPersistenceState
): Promise<CompendiumRepository> => {
  const legacyRepository = createLegacyRepository();
  if (snapshot) await legacyRepository.saveSnapshot(snapshot);
  activeRepository = legacyRepository;
  activeRepositoryKind = 'legacy';
  return legacyRepository;
};

export const resetActiveCompendiumRepositoryForTests = (
  repository?: CompendiumRepository,
  kind: ActiveCompendiumRepositoryKind = 'sqlite'
): void => {
  activeRepository = repository;
  activeRepositoryKind = kind;
};

export const loadCompendiumSnapshotWithLegacyFallback = async (
  repository: CompendiumRepository = getActiveCompendiumRepository()
): Promise<CompendiumBootstrapResult> => {
  // Browser compendium persistence uses IndexedDB directly. This avoids both
  // expo-sqlite/OPFS access-handle collisions and the small localStorage quota
  // used by AsyncStorage's Web implementation. On the first run after the
  // migration, copy any existing AsyncStorage snapshot into IndexedDB before
  // reconciliation so already-installed supplements are preserved.
  if (getActiveCompendiumRepositoryKind() === 'web') {
    let webSnapshot = await repository.loadSnapshot();
    let migratedLegacySnapshot = false;

    if (isEmptySnapshot(webSnapshot)) {
      const legacySnapshot = await loadLegacySnapshot();
      if (!isEmptySnapshot(legacySnapshot)) {
        await repository.saveSnapshot(legacySnapshot);
        webSnapshot = legacySnapshot;
        migratedLegacySnapshot = true;
      }
    }

    if (isEmptySnapshot(webSnapshot)) {
      const bundled = await initializeBundledCompendium(repository);
      if (!bundled.ok) {
        const message = bundled.issues.map((issue) => issue.message).join(' ');
        throw new Error(message || 'Falha ao instalar o compêndio incluído no aplicativo.');
      }
      return {
        snapshot: bundled.snapshot,
        migratedLegacySnapshot,
        usedLegacyFallback: false,
        seededBundledCompendium: bundled.seeded,
        seededPackIds: bundled.importedPackIds,
        seededItemCount: bundled.importedItemCount,
        preparedCoreItemCount: bundled.preparedCoreItemCount,
        bundledWarningCount: bundled.warningCount,
        reconciledBundledCompendium: false,
        reconciledPackIds: [],
        deferredBundledPackIds: [],
        backfilledContentHashCount: 0,
        restoredRequiredBundledPackIds: [],
        requiredBundledRepairIssues: []
      };
    }

    const reconciled = await reconcileBundledCompendium(repository);
    const repaired = await ensureRequiredCharacterCreationCompendium(repository);
    return {
      snapshot: repaired.snapshot,
      migratedLegacySnapshot,
      usedLegacyFallback: false,
      ...emptyBootstrapMetadata(),
      ...reconciliationMetadata(reconciled),
      restoredRequiredBundledPackIds: repaired.restoredPackIds,
      requiredBundledRepairIssues: repaired.ok ? [] : repaired.issues.map((issue) => issue.message)
    };
  }

  // AsyncStorage remains an emergency/native legacy fallback only.
  if (getActiveCompendiumRepositoryKind() === 'legacy') {
    const legacySnapshot = await repository.loadSnapshot();
    const reconciled = await reconcileBundledCompendium(repository);
    const repaired = await ensureRequiredCharacterCreationCompendium(repository);
    return {
      snapshot: repaired.snapshot,
      migratedLegacySnapshot: false,
      usedLegacyFallback: true,
      ...emptyBootstrapMetadata(),
      ...reconciliationMetadata(reconciled),
      restoredRequiredBundledPackIds: repaired.restoredPackIds,
      requiredBundledRepairIssues: repaired.ok ? [] : repaired.issues.map((issue) => issue.message)
    };
  }

  let sqliteSnapshot: CompendiumPersistenceState;

  try {
    sqliteSnapshot = await repository.loadSnapshot();
  } catch (error) {
    const legacyRepository = createLegacyRepository();
    const legacySnapshot = await legacyRepository.loadSnapshot();
    if (!isEmptySnapshot(legacySnapshot)) {
      activeRepository = legacyRepository;
      activeRepositoryKind = 'legacy';
      const repaired = await ensureRequiredCharacterCreationCompendium(legacyRepository);
      return {
        snapshot: repaired.snapshot,
        migratedLegacySnapshot: false,
        usedLegacyFallback: true,
        ...emptyBootstrapMetadata(),
        restoredRequiredBundledPackIds: repaired.restoredPackIds,
        requiredBundledRepairIssues: repaired.ok ? [] : repaired.issues.map((issue) => issue.message)
      };
    }
    throw error;
  }

  if (!isEmptySnapshot(sqliteSnapshot)) {
    const reconciled = await reconcileBundledCompendium(repository);
    const repaired = await ensureRequiredCharacterCreationCompendium(repository);
    return {
      snapshot: repaired.snapshot,
      migratedLegacySnapshot: false,
      usedLegacyFallback: false,
      ...emptyBootstrapMetadata(),
      ...reconciliationMetadata(reconciled),
      restoredRequiredBundledPackIds: repaired.restoredPackIds,
      requiredBundledRepairIssues: repaired.ok ? [] : repaired.issues.map((issue) => issue.message)
    };
  }

  const legacySnapshot = await loadLegacySnapshot();

  if (isEmptySnapshot(legacySnapshot)) {
    const bundled = await initializeBundledCompendium(repository);
    if (!bundled.ok) {
      const message = bundled.issues.map((issue) => issue.message).join(' ');
      throw new Error(message || 'Falha ao instalar o compêndio incluído no aplicativo.');
    }

    return {
      snapshot: bundled.snapshot,
      migratedLegacySnapshot: false,
      usedLegacyFallback: false,
      seededBundledCompendium: bundled.seeded,
      seededPackIds: bundled.importedPackIds,
      seededItemCount: bundled.importedItemCount,
      preparedCoreItemCount: bundled.preparedCoreItemCount,
      bundledWarningCount: bundled.warningCount,
      reconciledBundledCompendium: false,
      reconciledPackIds: [],
      deferredBundledPackIds: [],
      backfilledContentHashCount: 0,
      restoredRequiredBundledPackIds: [],
      requiredBundledRepairIssues: []
    };
  }

  try {
    await repository.saveSnapshot(legacySnapshot);
    const reconciled = await reconcileBundledCompendium(repository);
    const repaired = await ensureRequiredCharacterCreationCompendium(repository);
    return {
      snapshot: repaired.snapshot,
      migratedLegacySnapshot: true,
      usedLegacyFallback: false,
      ...emptyBootstrapMetadata(),
      ...reconciliationMetadata(reconciled),
      restoredRequiredBundledPackIds: repaired.restoredPackIds,
      requiredBundledRepairIssues: repaired.ok ? [] : repaired.issues.map((issue) => issue.message)
    };
  } catch {
    // SQLite may be readable but not writable on the current platform/runtime.
    // Keep the app operational by promoting the already-loaded legacy snapshot
    // to the active write repository instead of returning a read-only fallback.
    const legacyRepository = await activateLegacyCompendiumFallback(legacySnapshot);
    const repaired = await ensureRequiredCharacterCreationCompendium(legacyRepository);
    return {
      snapshot: repaired.snapshot,
      migratedLegacySnapshot: false,
      usedLegacyFallback: true,
      ...emptyBootstrapMetadata(),
      restoredRequiredBundledPackIds: repaired.restoredPackIds,
      requiredBundledRepairIssues: repaired.ok ? [] : repaired.issues.map((issue) => issue.message)
    };
  }
};
