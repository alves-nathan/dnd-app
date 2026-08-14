import type { SQLiteDatabase } from 'expo-sqlite';

export const COMPENDIUM_SQLITE_DATABASE_NAME = 'dnd-combat-math.db';
export const COMPENDIUM_SQLITE_SCHEMA_VERSION = 3;

export const initializeSQLiteCompendiumDatabase = async (db: SQLiteDatabase): Promise<void> => {
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = versionRow?.user_version ?? 0;

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  if (currentVersion === 0) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS compendium_sources (
        id TEXT PRIMARY KEY NOT NULL,
        json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS compendium_packs (
        id TEXT PRIMARY KEY NOT NULL,
        source_id TEXT NOT NULL,
        json TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES compendium_sources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS compendium_items (
        id TEXT PRIMARY KEY NOT NULL,
        import_item_id TEXT NOT NULL,
        pack_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        json TEXT NOT NULL,
        search_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (pack_id) REFERENCES compendium_packs(id) ON DELETE CASCADE,
        FOREIGN KEY (source_id) REFERENCES compendium_sources(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_compendium_sources_enabled ON compendium_sources(enabled);
      CREATE INDEX IF NOT EXISTS idx_compendium_packs_source_id ON compendium_packs(source_id);
      CREATE INDEX IF NOT EXISTS idx_compendium_items_pack_id ON compendium_items(pack_id);
      CREATE INDEX IF NOT EXISTS idx_compendium_items_source_id ON compendium_items(source_id);
      CREATE INDEX IF NOT EXISTS idx_compendium_items_type_status ON compendium_items(type, status);
      CREATE INDEX IF NOT EXISTS idx_compendium_items_name ON compendium_items(name COLLATE NOCASE);
    `);
  }

  if (currentVersion < 3) {
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_compendium_items_source_type_status_name
        ON compendium_items(source_id, type, status, name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_compendium_items_status_type_name
        ON compendium_items(status, type, name COLLATE NOCASE);
    `);
  }

  await db.execAsync(`PRAGMA user_version = ${COMPENDIUM_SQLITE_SCHEMA_VERSION}`);
};
