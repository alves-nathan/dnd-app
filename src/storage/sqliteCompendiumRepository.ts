import * as SQLite from 'expo-sqlite';
import { parseAndBuildPersistedImport } from '../compendium/importer';
import { parseAndPreviewImportPack, parseIssuesAsPreviewIssues } from '../compendium/parseImportPreview';
import { createCompendiumImportV2UpsertPlan } from '../compendium/importUpsertPlan';
import type { CompendiumItemMappingUpdate, CompendiumItemReviewBatchEntry, CompendiumItemReviewUpdate, PersistedCompendiumImport, StoredCompendiumItem, StoredCompendiumItemStatus, StoredCompendiumPack } from '../compendium/types';
import type { RuleSource, RuleValidationIssue } from '../types';
import { COMPENDIUM_PERSISTENCE_VERSION, emptyCompendiumPersistenceState, sanitizeCompendiumPersistenceState } from './compendiumSnapshot';
import type { CompendiumPersistenceState } from './compendiumSnapshot';
import { collectPersistedImportSources } from './compendiumRepository';
import { applyCompendiumImportV2PlanToSnapshot, existingPreviewItemsFromSnapshot } from './compendiumV2Persistence';
import type { CompendiumRepository, CompendiumRepositoryImportResult, CompendiumRepositorySearchFilters, SaveCompendiumRepositoryImportResult, SaveCompendiumRepositoryV2ImportResult } from './compendiumRepository';
import { COMPENDIUM_SQLITE_DATABASE_NAME, initializeSQLiteCompendiumDatabase } from './sqliteCompendiumMigrations';

interface SourceRow {
  id: string;
  json: string;
  enabled: number;
}

interface PackRow {
  id: string;
  json: string;
}

interface ItemRow {
  id: string;
  json: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const unique = (values: string[]): string[] => Array.from(new Set(values));

const parseJsonOrUndefined = <T>(raw: string): T | undefined => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const searchTextForItem = (item: StoredCompendiumItem): string => {
  const source = item.rawJson.source;
  return [
    item.name,
    item.summary ?? '',
    item.type,
    item.status,
    item.sourceId,
    source.book ?? '',
    source.page ?? '',
    source.version ?? '',
    item.reviewDecision ?? '',
    item.reviewNotes ?? '',
    JSON.stringify(item.normalizedJson ?? {}),
    ...item.tags
  ]
    .join(' ')
    .toLowerCase();
};

export const applyCompendiumItemReviewUpdate = (
  item: StoredCompendiumItem,
  update: CompendiumItemReviewUpdate,
  updatedAt: string = new Date().toISOString()
): StoredCompendiumItem => ({
  ...item,
  ...update,
  reviewNotes: 'reviewNotes' in update ? update.reviewNotes : item.reviewNotes,
  reviewedAt: update.reviewDecision || update.status || ('reviewNotes' in update) || ('reviewedBy' in update) ? updatedAt : item.reviewedAt,
  updatedAt
});

export const applyCompendiumItemReviewBatch = (
  items: StoredCompendiumItem[],
  entries: CompendiumItemReviewBatchEntry[],
  updatedAt: string = new Date().toISOString()
): StoredCompendiumItem[] => {
  if (!entries.length) return items;
  const entriesById = new Map(entries.map((entry) => [entry.itemId, entry.update]));
  const itemIds = new Set(items.map((item) => item.id));
  const missingIds = Array.from(entriesById.keys()).filter((itemId) => !itemIds.has(itemId));
  if (missingIds.length) throw new Error(`Itens do compêndio não encontrados: ${missingIds.join(', ')}.`);
  return items.map((item) => {
    const update = entriesById.get(item.id);
    return update ? applyCompendiumItemReviewUpdate(item, update, updatedAt) : item;
  });
};

export const applyCompendiumItemMappingUpdate = (
  item: StoredCompendiumItem,
  update: CompendiumItemMappingUpdate,
  updatedAt: string = new Date().toISOString()
): StoredCompendiumItem => ({
  ...item,
  normalizedJson: update.normalizedJson,
  status: update.status ?? item.status,
  reviewDecision: update.reviewDecision ?? item.reviewDecision,
  reviewNotes: 'reviewNotes' in update ? update.reviewNotes : item.reviewNotes,
  reviewedBy: 'reviewedBy' in update ? update.reviewedBy : item.reviewedBy,
  reviewedAt: update.reviewDecision || update.status || ('reviewNotes' in update) || ('reviewedBy' in update) ? updatedAt : item.reviewedAt,
  updatedAt
});

const parseSnapshotEnvelope = (json: string): CompendiumPersistenceState => {
  const parsed = JSON.parse(json) as unknown;
  if (isRecord(parsed) && isRecord(parsed.state)) return sanitizeCompendiumPersistenceState(parsed.state);
  return sanitizeCompendiumPersistenceState(parsed);
};

const createSnapshotEnvelope = (snapshot: CompendiumPersistenceState) => ({
  state: sanitizeCompendiumPersistenceState(snapshot),
  version: COMPENDIUM_PERSISTENCE_VERSION
});

const upsertById = <T extends { id: string }>(current: T[], incoming: T[]): T[] => {
  const incomingIds = new Set(incoming.map((item) => item.id));
  return [...current.filter((item) => !incomingIds.has(item.id)), ...incoming];
};

const mergeImportIntoSnapshot = (
  current: CompendiumPersistenceState,
  imported: PersistedCompendiumImport
): CompendiumPersistenceState => {
  const importedSources = collectPersistedImportSources(imported);
  const importedSourceIds = new Set(
    importedSources.map((source) => source.id)
  );

  const enabledSourceIds = unique([
    ...current.enabledSourceIds.filter(
      (sourceId) => !importedSourceIds.has(sourceId)
    ),
    ...importedSources
      .filter((source) => source.status === 'active')
      .map((source) => source.id)
  ]);

  return {
    sources: upsertById(
      current.sources,
      importedSources
    ),
    packs: upsertById(current.packs, [imported.pack]),
    items: [
      ...current.items.filter(
        (item) => item.packId !== imported.pack.id
      ),
      ...imported.items
    ],
    enabledSourceIds
  };
};

const itemMatchesInMemorySearch = (item: StoredCompendiumItem, normalizedQuery: string): boolean => {
  if (!normalizedQuery) return true;
  const haystack = searchTextForItem(item);
  return normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
};

export class SQLiteCompendiumRepository implements CompendiumRepository {
  private dbPromise?: Promise<SQLite.SQLiteDatabase>;

  constructor(private readonly databaseName: string = COMPENDIUM_SQLITE_DATABASE_NAME) {}

  private async db(): Promise<SQLite.SQLiteDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = SQLite.openDatabaseAsync(this.databaseName).then(async (db) => {
        await initializeSQLiteCompendiumDatabase(db);
        return db;
      });
    }
    return this.dbPromise;
  }

  async loadSnapshot(): Promise<CompendiumPersistenceState> {
    const db = await this.db();
    const [sourceRows, packRows, itemRows] = await Promise.all([
      db.getAllAsync<SourceRow>('SELECT id, json, enabled FROM compendium_sources ORDER BY id COLLATE NOCASE'),
      db.getAllAsync<PackRow>('SELECT id, json FROM compendium_packs ORDER BY imported_at DESC, id COLLATE NOCASE'),
      db.getAllAsync<ItemRow>('SELECT id, json FROM compendium_items ORDER BY name COLLATE NOCASE')
    ]);

    const sources = sourceRows.map((row) => parseJsonOrUndefined<RuleSource>(row.json)).filter((item): item is RuleSource => Boolean(item));
    const packs = packRows.map((row) => parseJsonOrUndefined<StoredCompendiumPack>(row.json)).filter((item): item is StoredCompendiumPack => Boolean(item));
    const items = itemRows.map((row) => parseJsonOrUndefined<StoredCompendiumItem>(row.json)).filter((item): item is StoredCompendiumItem => Boolean(item));
    const enabledSourceIds = sourceRows.filter((row) => row.enabled === 1).map((row) => row.id);

    return sanitizeCompendiumPersistenceState({ sources, packs, items, enabledSourceIds });
  }

  async saveSnapshot(snapshot: CompendiumPersistenceState): Promise<void> {
    const db = await this.db();
    const cleanSnapshot = sanitizeCompendiumPersistenceState(snapshot);
    const enabledIds = new Set(cleanSnapshot.enabledSourceIds);
    const now = new Date().toISOString();

    /*
     * Detecta referências quebradas antes de apagar/regravar o banco.
     * Isso produz uma mensagem útil em vez do erro opaco vindo de
     * NativeStatement.finalizeAsync.
     */
    const sourceIds = new Set(
      cleanSnapshot.sources.map((source) => source.id)
    );

    const packIds = new Set(
      cleanSnapshot.packs.map((pack) => pack.id)
    );

    const packWithoutSource = cleanSnapshot.packs.find(
      (pack) => !sourceIds.has(pack.sourceId)
    );

    if (packWithoutSource) {
      throw new Error(
        `Pacote "${packWithoutSource.id}" referencia a fonte ausente ` +
        `"${packWithoutSource.sourceId}".`
      );
    }

    const itemWithoutPack = cleanSnapshot.items.find(
      (item) => !packIds.has(item.packId)
    );

    if (itemWithoutPack) {
      throw new Error(
        `Item "${itemWithoutPack.id}" referencia o pacote ausente ` +
        `"${itemWithoutPack.packId}".`
      );
    }

    const itemWithoutSource = cleanSnapshot.items.find(
      (item) => !sourceIds.has(item.sourceId)
    );

    if (itemWithoutSource) {
      throw new Error(
        `Item "${itemWithoutSource.id}" referencia a fonte ausente ` +
        `"${itemWithoutSource.sourceId}".`
      );
    }

    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM compendium_items');
      await db.runAsync('DELETE FROM compendium_packs');
      await db.runAsync('DELETE FROM compendium_sources');

      for (const source of cleanSnapshot.sources) {
        await db.runAsync(
          'INSERT OR REPLACE INTO compendium_sources (id, json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [source.id, JSON.stringify(source), enabledIds.has(source.id) ? 1 : 0, now, now]
        );
      }

      for (const pack of cleanSnapshot.packs) {
        await db.runAsync(
          'INSERT OR REPLACE INTO compendium_packs (id, source_id, json, imported_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [pack.id, pack.sourceId, JSON.stringify(pack), pack.importedAt, now]
        );
      }

      for (const item of cleanSnapshot.items) {
        await db.runAsync(
          `INSERT OR REPLACE INTO compendium_items
           (id, import_item_id, pack_id, source_id, type, name, status, json, search_text, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            item.importItemId,
            item.packId,
            item.sourceId,
            item.type,
            item.name,
            item.status,
            JSON.stringify(item),
            searchTextForItem(item),
            item.createdAt,
            item.updatedAt
          ]
        );
      }
    });
  }

  async clearSnapshot(): Promise<void> {
    const db = await this.db();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM compendium_items');
      await db.runAsync('DELETE FROM compendium_packs');
      await db.runAsync('DELETE FROM compendium_sources');
    });
  }

  async exportSnapshot(): Promise<string> {
    const snapshot = await this.loadSnapshot();
    return JSON.stringify(createSnapshotEnvelope(snapshot), null, 2);
  }

  async importSnapshot(json: string): Promise<CompendiumRepositoryImportResult> {
    try {
      const snapshot = parseSnapshotEnvelope(json);
      await this.saveSnapshot(snapshot);
      return { ok: true, snapshot, issues: [] };
    } catch {
      return { ok: false, issues: [{ severity: 'error', code: 'SQLITE_COMPENDIUM_SNAPSHOT_IMPORT_ERROR', message: 'Snapshot SQLite inválido ou corrompido.' }] };
    }
  }

  async listSources(): Promise<CompendiumPersistenceState['sources']> {
    return (await this.loadSnapshot()).sources;
  }

  async listPacks(): Promise<CompendiumPersistenceState['packs']> {
    return (await this.loadSnapshot()).packs;
  }

  async listItems(): Promise<StoredCompendiumItem[]> {
    const db = await this.db();
    const rows = await db.getAllAsync<ItemRow>('SELECT id, json FROM compendium_items ORDER BY name COLLATE NOCASE');
    return rows.map((row) => parseJsonOrUndefined<StoredCompendiumItem>(row.json)).filter((item): item is StoredCompendiumItem => Boolean(item));
  }

  async saveImportJson(json: string): Promise<SaveCompendiumRepositoryImportResult> {
    const result = parseAndBuildPersistedImport(json);

    if (!result.ok || !result.persisted) {
      return {
        ok: false,
        snapshot: await this.loadSnapshot(),
        issues: result.issues
      };
    }

    const imported = result.persisted;
    const importedSources = collectPersistedImportSources(imported);
    const db = await this.db();
    const now = new Date().toISOString();

    try {
      await db.withTransactionAsync(async () => {
        for (const source of importedSources) {
          await db.runAsync(
            `INSERT INTO compendium_sources (id, json, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               json = excluded.json,
               enabled = excluded.enabled,
               updated_at = excluded.updated_at`,
            [source.id, JSON.stringify(source), source.status === 'active' ? 1 : 0, now, now]
          );
        }

        await db.runAsync('DELETE FROM compendium_items WHERE pack_id = ?', [imported.pack.id]);

        await db.runAsync(
          `INSERT INTO compendium_packs (id, source_id, json, imported_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             source_id = excluded.source_id,
             json = excluded.json,
             imported_at = excluded.imported_at,
             updated_at = excluded.updated_at`,
          [imported.pack.id, imported.pack.sourceId, JSON.stringify(imported.pack), imported.pack.importedAt, now]
        );

        for (const item of imported.items) {
          await db.runAsync(
            `INSERT INTO compendium_items
             (id, import_item_id, pack_id, source_id, type, name, status, json, search_text, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               import_item_id = excluded.import_item_id,
               pack_id = excluded.pack_id,
               source_id = excluded.source_id,
               type = excluded.type,
               name = excluded.name,
               status = excluded.status,
               json = excluded.json,
               search_text = excluded.search_text,
               updated_at = excluded.updated_at`,
            [
              item.id,
              item.importItemId,
              item.packId,
              item.sourceId,
              item.type,
              item.name,
              item.status,
              JSON.stringify(item),
              searchTextForItem(item),
              item.createdAt,
              item.updatedAt
            ]
          );
        }

        await db.runAsync(
          `DELETE FROM compendium_sources
           WHERE id NOT IN (SELECT source_id FROM compendium_packs)
             AND id NOT IN (SELECT source_id FROM compendium_items)`
        );
      });

      const snapshot = await this.loadSnapshot();
      return { ok: true, imported, snapshot, issues: imported.issues };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Falha nativa ao persistir importação incremental no SQLite:', {
        error,
        message,
        packId: imported.pack.id,
        itemCount: imported.items.length,
        sourceId: imported.source.id
      });
      return {
        ok: false,
        snapshot: await this.loadSnapshot(),
        issues: [{
          severity: 'error',
          code: 'SQLITE_COMPENDIUM_SAVE_IMPORT_FAILED',
          message: `Não foi possível salvar a importação no SQLite. Detalhes: ${message}`
        }]
      };
    }
  }


  async saveImportV2Json(json: string): Promise<SaveCompendiumRepositoryV2ImportResult> {
    const current = await this.loadSnapshot();
    const parsed = parseAndPreviewImportPack(json, existingPreviewItemsFromSnapshot(current));
    if (!parsed.parse.ok || !parsed.parse.data) {
      return { ok: false, snapshot: current, issues: parseIssuesAsPreviewIssues(parsed.parse) };
    }
    if (!parsed.preview || !parsed.preview.valid) {
      return { ok: false, snapshot: current, preview: parsed.preview, issues: parsed.preview?.issues ?? [] };
    }

    const plan = createCompendiumImportV2UpsertPlan(parsed.parse.data, parsed.preview);
    if (!plan.executable) {
      return { ok: false, snapshot: current, preview: parsed.preview, plan, issues: parsed.preview.issues };
    }

    let transaction: ReturnType<typeof applyCompendiumImportV2PlanToSnapshot>;
    try {
      transaction = applyCompendiumImportV2PlanToSnapshot(current, parsed.parse.data, plan);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        snapshot: current,
        preview: parsed.preview,
        plan,
        issues: [...parsed.preview.issues, { severity: 'error', code: 'SQLITE_COMPENDIUM_V2_PLAN_FAILED', message }]
      };
    }

    const db = await this.db();
    const currentSources = new Map(current.sources.map((source) => [source.id, source]));
    const currentEnabled = new Set(current.enabledSourceIds);
    const currentItems = new Map(current.items.map((item) => [item.id, item]));
    const nextEnabled = new Set(transaction.snapshot.enabledSourceIds);
    const incomingSourceIds = new Set([
      parsed.parse.data.source.id,
      ...parsed.parse.data.items.map((item) => item.source.id)
    ]);
    const sourcesToWrite = transaction.snapshot.sources.filter((source) => {
      if (!incomingSourceIds.has(source.id)) return false;
      const previous = currentSources.get(source.id);
      return JSON.stringify(previous) !== JSON.stringify(source) || currentEnabled.has(source.id) !== nextEnabled.has(source.id);
    });
    const itemsToWrite = transaction.snapshot.items.filter((item) => {
      const previous = currentItems.get(item.id);
      return JSON.stringify(previous) !== JSON.stringify(item);
    });
    const now = new Date().toISOString();

    try {
      await db.withTransactionAsync(async () => {
        for (const source of sourcesToWrite) {
          await db.runAsync(
            `INSERT INTO compendium_sources (id, json, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               json = excluded.json,
               enabled = excluded.enabled,
               updated_at = excluded.updated_at`,
            [source.id, JSON.stringify(source), nextEnabled.has(source.id) ? 1 : 0, now, now]
          );
        }

        const storedPack = transaction.pack;
        await db.runAsync(
          `INSERT INTO compendium_packs (id, source_id, json, imported_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             source_id = excluded.source_id,
             json = excluded.json,
             imported_at = excluded.imported_at,
             updated_at = excluded.updated_at`,
          [storedPack.id, storedPack.sourceId, JSON.stringify(storedPack), storedPack.importedAt, now]
        );

        for (const item of itemsToWrite) {
          await db.runAsync(
            `INSERT INTO compendium_items
             (id, import_item_id, pack_id, source_id, type, name, status, json, search_text, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               import_item_id = excluded.import_item_id,
               pack_id = excluded.pack_id,
               source_id = excluded.source_id,
               type = excluded.type,
               name = excluded.name,
               status = excluded.status,
               json = excluded.json,
               search_text = excluded.search_text,
               updated_at = excluded.updated_at`,
            [
              item.id,
              item.importItemId,
              item.packId,
              item.sourceId,
              item.type,
              item.name,
              item.status,
              JSON.stringify(item),
              searchTextForItem(item),
              item.createdAt,
              item.updatedAt
            ]
          );
        }
      });

      const snapshot = await this.loadSnapshot();
      return {
        ok: true,
        snapshot,
        preview: parsed.preview,
        plan,
        summary: transaction.summary,
        issues: parsed.preview.issues
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Falha transacional ao persistir importação V2 no SQLite:', {
        error,
        message,
        packId: parsed.parse.data.id,
        creates: plan.creates.length,
        updates: plan.updates.length
      });
      return {
        ok: false,
        snapshot: await this.loadSnapshot(),
        preview: parsed.preview,
        plan,
        issues: [...parsed.preview.issues, { severity: 'error', code: 'SQLITE_COMPENDIUM_V2_TRANSACTION_FAILED', message }]
      };
    }
  }

  async removePack(packId: string): Promise<CompendiumPersistenceState> {
    const db = await this.db();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM compendium_packs WHERE id = ?', [packId]);
      await db.runAsync(
        `DELETE FROM compendium_sources
         WHERE id NOT IN (SELECT source_id FROM compendium_packs)
           AND id NOT IN (SELECT source_id FROM compendium_items)`
      );
    });
    return this.loadSnapshot();
  }

  async setSourceEnabled(sourceId: string, enabled: boolean): Promise<CompendiumPersistenceState> {
    const db = await this.db();
    const result = await db.runAsync(
      'UPDATE compendium_sources SET enabled = ?, updated_at = ? WHERE id = ?',
      [enabled ? 1 : 0, new Date().toISOString(), sourceId]
    );
    if (result.changes === 0) throw new Error(`Fonte não encontrada: ${sourceId}.`);
    return this.loadSnapshot();
  }

  async setItemStatus(itemId: string, status: StoredCompendiumItemStatus): Promise<CompendiumPersistenceState> {
    return this.updateItemReview(itemId, {
      status,
      reviewDecision: status === 'validated' ? 'approved' : status === 'disabled' ? 'rejected' : 'pending'
    });
  }

  async updateItemReview(itemId: string, update: CompendiumItemReviewUpdate): Promise<CompendiumPersistenceState> {
    return this.updateItemsReview([{ itemId, update }]);
  }

  async updateItemsReview(entries: CompendiumItemReviewBatchEntry[]): Promise<CompendiumPersistenceState> {
    if (!entries.length) return this.loadSnapshot();
    const db = await this.db();
    const uniqueEntries = Array.from(new Map(entries.map((entry) => [entry.itemId, entry])).values());
    const rows: ItemRow[] = [];
    const selectChunkSize = 400;
    for (let offset = 0; offset < uniqueEntries.length; offset += selectChunkSize) {
      const chunk = uniqueEntries.slice(offset, offset + selectChunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      rows.push(...await db.getAllAsync<ItemRow>(
        `SELECT id, json FROM compendium_items WHERE id IN (${placeholders})`,
        chunk.map((entry) => entry.itemId)
      ));
    }
    const currentItems = rows
      .map((row) => parseJsonOrUndefined<StoredCompendiumItem>(row.json))
      .filter((item): item is StoredCompendiumItem => Boolean(item));
    const updatedItems = applyCompendiumItemReviewBatch(currentItems, uniqueEntries);

    await db.withTransactionAsync(async () => {
      for (const updated of updatedItems) {
        const result = await db.runAsync(
          `UPDATE compendium_items
           SET status = ?, json = ?, search_text = ?, updated_at = ?
           WHERE id = ?`,
          [updated.status, JSON.stringify(updated), searchTextForItem(updated), updated.updatedAt, updated.id]
        );
        if (result.changes === 0) throw new Error(`Item do compêndio não encontrado durante atualização: ${updated.id}.`);
      }
    });
    return this.loadSnapshot();
  }

  async updateItemMapping(itemId: string, update: CompendiumItemMappingUpdate): Promise<CompendiumPersistenceState> {
    const db = await this.db();
    const row = await db.getFirstAsync<ItemRow>('SELECT id, json FROM compendium_items WHERE id = ?', [itemId]);
    const current = row ? parseJsonOrUndefined<StoredCompendiumItem>(row.json) : undefined;
    if (!current) throw new Error(`Item do compêndio não encontrado: ${itemId}.`);

    const updated = applyCompendiumItemMappingUpdate(current, update);
    await db.runAsync(
      `UPDATE compendium_items
       SET status = ?, json = ?, search_text = ?, updated_at = ?
       WHERE id = ?`,
      [updated.status, JSON.stringify(updated), searchTextForItem(updated), updated.updatedAt, itemId]
    );
    return this.loadSnapshot();
  }

  async searchItems(query: string, filters?: CompendiumRepositorySearchFilters): Promise<StoredCompendiumItem[]> {
    const normalizedQuery = query.trim().toLowerCase();
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    const typeFilters = filters?.types ?? [];
    const statusFilters = filters?.statuses ?? [];
    const sourceFilters = filters?.sourceIds ?? [];
    const onlyEnabled = filters?.onlyEnabled ?? true;
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (statusFilters.length) {
      where.push(`i.status IN (${statusFilters.map(() => '?').join(', ')})`);
      params.push(...statusFilters);
    } else {
      where.push('i.status != ?');
      params.push('disabled');
    }
    if (onlyEnabled) where.push('s.enabled = 1');
    if (typeFilters.length) {
      where.push(`i.type IN (${typeFilters.map(() => '?').join(', ')})`);
      params.push(...typeFilters);
    }
    if (sourceFilters.length) {
      where.push(`i.source_id IN (${sourceFilters.map(() => '?').join(', ')})`);
      params.push(...sourceFilters);
    }
    for (const term of terms) {
      where.push('i.search_text LIKE ?');
      params.push(`%${term}%`);
    }

    const db = await this.db();
    const rows = await db.getAllAsync<ItemRow>(
      `SELECT i.id, i.json
       FROM compendium_items i
       INNER JOIN compendium_sources s ON s.id = i.source_id
       WHERE ${where.join(' AND ')}
       ORDER BY i.name COLLATE NOCASE`,
      params
    );

    const items = rows.map((row) => parseJsonOrUndefined<StoredCompendiumItem>(row.json)).filter((item): item is StoredCompendiumItem => Boolean(item));

    // Keep a defensive in-memory check so future search_text changes cannot accidentally return stale matches.
    const statusSet = statusFilters.length ? new Set(statusFilters) : undefined;
    const sourceSet = sourceFilters.length ? new Set(sourceFilters) : undefined;
    return items
      .filter((item) => (statusSet ? statusSet.has(item.status) : item.status !== 'disabled'))
      .filter((item) => (sourceSet ? sourceSet.has(item.sourceId) : true))
      .filter((item) => itemMatchesInMemorySearch(item, normalizedQuery));
  }

  async healthcheck(): Promise<{ ok: boolean; sources: number; packs: number; items: number; issues: RuleValidationIssue[] }> {
    try {
      const snapshot = await this.loadSnapshot();
      return { ok: true, sources: snapshot.sources.length, packs: snapshot.packs.length, items: snapshot.items.length, issues: [] };
    } catch {
      return {
        ok: false,
        sources: 0,
        packs: 0,
        items: 0,
        issues: [{ severity: 'error', code: 'SQLITE_COMPENDIUM_HEALTHCHECK_FAILED', message: 'Não foi possível abrir ou consultar o banco SQLite do compêndio.' }]
      };
    }
  }
}

export const createSQLiteCompendiumRepository = (): SQLiteCompendiumRepository => new SQLiteCompendiumRepository();

export const createEmptySQLiteSnapshot = emptyCompendiumPersistenceState;
