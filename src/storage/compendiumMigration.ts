import type { RuleValidationIssue } from '../types';
import { KeyValueCompendiumRepository } from './compendiumRepository';
import { asyncStorageAdapter } from './asyncStorageAdapter';
import { COMPENDIUM_STORAGE_KEY } from './compendiumSnapshot';
import type { CompendiumPersistenceState } from './compendiumSnapshot';
import { SQLiteCompendiumRepository, createSQLiteCompendiumRepository } from './sqliteCompendiumRepository';

export interface CompendiumMigrationResult {
  ok: boolean;
  snapshot?: CompendiumPersistenceState;
  sources: number;
  packs: number;
  items: number;
  issues: RuleValidationIssue[];
}

const countSnapshot = (snapshot?: CompendiumPersistenceState) => ({
  sources: snapshot?.sources.length ?? 0,
  packs: snapshot?.packs.length ?? 0,
  items: snapshot?.items.length ?? 0
});

const genericMigrationError = (code: string, message: string): CompendiumMigrationResult => ({
  ok: false,
  sources: 0,
  packs: 0,
  items: 0,
  issues: [{ severity: 'error', code, message }]
});

export const createAsyncStorageCompendiumRepository = (): KeyValueCompendiumRepository => new KeyValueCompendiumRepository(asyncStorageAdapter, COMPENDIUM_STORAGE_KEY);

export const saveSnapshotToSQLiteCompendium = async (
  snapshot: CompendiumPersistenceState,
  sqliteRepository: SQLiteCompendiumRepository = createSQLiteCompendiumRepository()
): Promise<CompendiumMigrationResult> => {
  try {
    await sqliteRepository.saveSnapshot(snapshot);
    return { ok: true, snapshot, ...countSnapshot(snapshot), issues: [] };
  } catch {
    return genericMigrationError('SQLITE_COMPENDIUM_SAVE_FAILED', 'Não foi possível salvar o snapshot atual no SQLite.');
  }
};

export const loadSnapshotFromSQLiteCompendium = async (
  sqliteRepository: SQLiteCompendiumRepository = createSQLiteCompendiumRepository()
): Promise<CompendiumMigrationResult> => {
  try {
    const snapshot = await sqliteRepository.loadSnapshot();
    return { ok: true, snapshot, ...countSnapshot(snapshot), issues: [] };
  } catch {
    return genericMigrationError('SQLITE_COMPENDIUM_LOAD_FAILED', 'Não foi possível carregar o compêndio salvo no SQLite.');
  }
};

export const migrateAsyncStorageCompendiumToSQLite = async (
  sqliteRepository: SQLiteCompendiumRepository = createSQLiteCompendiumRepository(),
  keyValueRepository: KeyValueCompendiumRepository = createAsyncStorageCompendiumRepository()
): Promise<CompendiumMigrationResult> => {
  try {
    const snapshot = await keyValueRepository.loadSnapshot();
    await sqliteRepository.saveSnapshot(snapshot);
    return { ok: true, snapshot, ...countSnapshot(snapshot), issues: [] };
  } catch {
    return genericMigrationError('ASYNC_STORAGE_TO_SQLITE_MIGRATION_FAILED', 'Não foi possível migrar o compêndio do AsyncStorage para SQLite.');
  }
};

export const copySQLiteCompendiumToAsyncStorage = async (
  sqliteRepository: SQLiteCompendiumRepository = createSQLiteCompendiumRepository(),
  keyValueRepository: KeyValueCompendiumRepository = createAsyncStorageCompendiumRepository()
): Promise<CompendiumMigrationResult> => {
  try {
    const snapshot = await sqliteRepository.loadSnapshot();
    await keyValueRepository.saveSnapshot(snapshot);
    return { ok: true, snapshot, ...countSnapshot(snapshot), issues: [] };
  } catch {
    return genericMigrationError('SQLITE_TO_ASYNC_STORAGE_COPY_FAILED', 'Não foi possível copiar o compêndio SQLite para o snapshot Zustand/AsyncStorage.');
  }
};

export const exportSQLiteCompendiumSnapshot = async (
  sqliteRepository: SQLiteCompendiumRepository = createSQLiteCompendiumRepository()
): Promise<{ ok: boolean; json?: string; issues: RuleValidationIssue[] }> => {
  try {
    return { ok: true, json: await sqliteRepository.exportSnapshot(), issues: [] };
  } catch {
    return { ok: false, issues: [{ severity: 'error', code: 'SQLITE_COMPENDIUM_EXPORT_FAILED', message: 'Não foi possível exportar o snapshot do SQLite.' }] };
  }
};

export const importSQLiteCompendiumSnapshot = async (
  json: string,
  sqliteRepository: SQLiteCompendiumRepository = createSQLiteCompendiumRepository()
): Promise<CompendiumMigrationResult> => {
  const result = await sqliteRepository.importSnapshot(json);
  const snapshot = result.snapshot;
  return { ok: result.ok, snapshot, ...countSnapshot(snapshot), issues: result.issues };
};

export const clearSQLiteCompendium = async (
  sqliteRepository: SQLiteCompendiumRepository = createSQLiteCompendiumRepository()
): Promise<CompendiumMigrationResult> => {
  try {
    await sqliteRepository.clearSnapshot();
    const snapshot = await sqliteRepository.loadSnapshot();
    return { ok: true, snapshot, ...countSnapshot(snapshot), issues: [] };
  } catch {
    return genericMigrationError('SQLITE_COMPENDIUM_CLEAR_FAILED', 'Não foi possível limpar o compêndio SQLite.');
  }
};
