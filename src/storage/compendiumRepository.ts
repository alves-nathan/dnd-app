import { parseAndBuildPersistedImport } from '../compendium/importer';
import { parseAndPreviewImportPack, parseIssuesAsPreviewIssues } from '../compendium/parseImportPreview';
import { createCompendiumImportV2UpsertPlan, type CompendiumImportV2UpsertPlan } from '../compendium/importUpsertPlan';
import type { CompendiumImportV2Preview, ImportPreviewIssue } from '../compendium/importPreview';
import { applyCompendiumImportV2PlanToSnapshot, existingPreviewItemsFromSnapshot, type CompendiumImportV2PersistenceSummary } from './compendiumV2Persistence';
import type { CompendiumItemMappingUpdate, CompendiumItemReviewBatchEntry, CompendiumItemReviewUpdate, CompendiumItemSearchFilters, PersistedCompendiumImport, StoredCompendiumItem, StoredCompendiumItemStatus } from '../compendium/types';
import type { RuleSource, RuleValidationIssue } from '../types';
import { COMPENDIUM_PERSISTENCE_VERSION, COMPENDIUM_STORAGE_KEY, emptyCompendiumPersistenceState, sanitizeCompendiumPersistenceState } from './compendiumSnapshot';
import type { CompendiumPersistenceState } from './compendiumSnapshot';
import type { KeyValueStorageAdapter } from './keyValueStorage';

interface ZustandPersistEnvelope {
  state: CompendiumPersistenceState;
  version: number;
}

export interface CompendiumRepositoryImportResult {
  ok: boolean;
  snapshot?: CompendiumPersistenceState;
  issues: RuleValidationIssue[];
}

export interface SaveCompendiumRepositoryImportResult {
  ok: boolean;
  imported?: PersistedCompendiumImport;
  snapshot: CompendiumPersistenceState;
  issues: RuleValidationIssue[];
}

export type CompendiumRepositorySearchFilters = CompendiumItemSearchFilters;

export interface SaveCompendiumRepositoryV2ImportResult {
  ok: boolean;
  snapshot: CompendiumPersistenceState;
  preview?: CompendiumImportV2Preview;
  plan?: CompendiumImportV2UpsertPlan;
  summary?: CompendiumImportV2PersistenceSummary;
  issues: ImportPreviewIssue[];
}


export interface CompendiumRepository {
  loadSnapshot: () => Promise<CompendiumPersistenceState>;
  saveSnapshot: (snapshot: CompendiumPersistenceState) => Promise<void>;
  clearSnapshot: () => Promise<void>;
  exportSnapshot: () => Promise<string>;
  importSnapshot: (json: string) => Promise<CompendiumRepositoryImportResult>;
  listSources: () => Promise<CompendiumPersistenceState['sources']>;
  listPacks: () => Promise<CompendiumPersistenceState['packs']>;
  listItems: () => Promise<StoredCompendiumItem[]>;
  saveImportJson: (json: string) => Promise<SaveCompendiumRepositoryImportResult>;
  /** Canonical V2 path. Legacy saveImportJson remains intact for V1 compatibility. */
  saveImportV2Json: (json: string) => Promise<SaveCompendiumRepositoryV2ImportResult>;
  removePack: (packId: string) => Promise<CompendiumPersistenceState>;
  setSourceEnabled: (sourceId: string, enabled: boolean) => Promise<CompendiumPersistenceState>;
  setItemStatus: (itemId: string, status: StoredCompendiumItemStatus) => Promise<CompendiumPersistenceState>;
  updateItemReview: (itemId: string, update: CompendiumItemReviewUpdate) => Promise<CompendiumPersistenceState>;
  updateItemsReview: (entries: CompendiumItemReviewBatchEntry[]) => Promise<CompendiumPersistenceState>;
  updateItemMapping: (itemId: string, update: CompendiumItemMappingUpdate) => Promise<CompendiumPersistenceState>;
  searchItems: (query: string, filters?: CompendiumRepositorySearchFilters) => Promise<StoredCompendiumItem[]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parsePersistedEnvelope = (raw: string | null): CompendiumPersistenceState => {
  if (!raw) return emptyCompendiumPersistenceState();

  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) return emptyCompendiumPersistenceState();

  const maybeEnvelope = parsed as Partial<ZustandPersistEnvelope>;
  if (isRecord(maybeEnvelope.state)) return sanitizeCompendiumPersistenceState(maybeEnvelope.state);

  return sanitizeCompendiumPersistenceState(parsed);
};

const createPersistedEnvelope = (snapshot: CompendiumPersistenceState): ZustandPersistEnvelope => ({
  state: sanitizeCompendiumPersistenceState(snapshot),
  version: COMPENDIUM_PERSISTENCE_VERSION
});

const upsertById = <T extends { id: string }>(current: T[], incoming: T[]): T[] => {
  const incomingIds = new Set(incoming.map((item) => item.id));
  return [...current.filter((item) => !incomingIds.has(item.id)), ...incoming];
};

/**
 * Um pacote pode ter uma fonte principal e itens extraídos de fontes
 * mais específicas. Todas precisam existir na tabela de fontes antes
 * da persistência dos itens por causa das foreign keys.
 */
export const collectPersistedImportSources = (
  imported: PersistedCompendiumImport
): RuleSource[] => {
  const sourcesById = new Map<string, RuleSource>();

  for (const item of imported.items) {
    sourcesById.set(
      item.rawJson.source.id,
      item.rawJson.source
    );
  }

  /*
   * A fonte principal é inserida por último para que seja a versão
   * autoritativa quando compartilhar o mesmo ID de uma fonte de item.
   */
  sourcesById.set(imported.source.id, imported.source);

  return Array.from(sourcesById.values());
};

const unique = (values: string[]): string[] => Array.from(new Set(values));

const pruneOrphanSources = (snapshot: CompendiumPersistenceState): CompendiumPersistenceState => {
  const referencedSourceIds = new Set([
    ...snapshot.packs.map((pack) => pack.sourceId),
    ...snapshot.items.map((item) => item.sourceId)
  ]);
  return {
    ...snapshot,
    sources: snapshot.sources.filter((source) => referencedSourceIds.has(source.id)),
    enabledSourceIds: snapshot.enabledSourceIds.filter((sourceId) => referencedSourceIds.has(sourceId))
  };
};

export const applyCompendiumReviewBatchToSnapshot = (
  snapshot: CompendiumPersistenceState,
  entries: CompendiumItemReviewBatchEntry[],
  updatedAt: string = new Date().toISOString()
): CompendiumPersistenceState => {
  if (!entries.length) return snapshot;
  const entriesById = new Map(entries.map((entry) => [entry.itemId, entry.update]));
  const itemIds = new Set(snapshot.items.map((item) => item.id));
  const missingIds = Array.from(entriesById.keys()).filter((itemId) => !itemIds.has(itemId));
  if (missingIds.length) throw new Error(`Itens do compêndio não encontrados: ${missingIds.join(', ')}.`);

  return {
    ...snapshot,
    items: snapshot.items.map((item) => {
      const update = entriesById.get(item.id);
      if (!update) return item;
      return {
        ...item,
        ...update,
        reviewNotes: 'reviewNotes' in update ? update.reviewNotes : item.reviewNotes,
        reviewedAt: update.reviewDecision || update.status || ('reviewNotes' in update) || ('reviewedBy' in update) ? updatedAt : item.reviewedAt,
        updatedAt
      };
    })
  };
};

const itemMatchesSearch = (item: StoredCompendiumItem, normalizedQuery: string): boolean => {
  if (!normalizedQuery) return true;
  const haystack = [item.name, item.summary ?? '', item.type, item.sourceId, item.status, item.reviewDecision ?? '', item.reviewNotes ?? '', JSON.stringify(item.normalizedJson ?? {}), ...item.tags].join(' ').toLowerCase();
  return normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
};

export class KeyValueCompendiumRepository implements CompendiumRepository {
  constructor(private readonly storage: KeyValueStorageAdapter, private readonly key: string = COMPENDIUM_STORAGE_KEY) {}

  async loadSnapshot(): Promise<CompendiumPersistenceState> {
    const raw = await this.storage.getItem(this.key);
    try {
      return parsePersistedEnvelope(raw);
    } catch {
      return emptyCompendiumPersistenceState();
    }
  }

  async saveSnapshot(snapshot: CompendiumPersistenceState): Promise<void> {
    await this.storage.setItem(this.key, JSON.stringify(createPersistedEnvelope(snapshot)));
  }

  async clearSnapshot(): Promise<void> {
    await this.storage.removeItem(this.key);
  }

  async exportSnapshot(): Promise<string> {
    const snapshot = await this.loadSnapshot();
    return JSON.stringify(createPersistedEnvelope(snapshot), null, 2);
  }

  async importSnapshot(json: string): Promise<CompendiumRepositoryImportResult> {
    try {
      const parsed = JSON.parse(json) as unknown;
      const snapshot = isRecord(parsed) && isRecord(parsed.state) ? sanitizeCompendiumPersistenceState(parsed.state) : sanitizeCompendiumPersistenceState(parsed);
      await this.saveSnapshot(snapshot);
      return { ok: true, snapshot, issues: [] };
    } catch {
      return { ok: false, issues: [{ severity: 'error', code: 'COMPENDIUM_SNAPSHOT_IMPORT_ERROR', message: 'Snapshot do compêndio inválido ou corrompido.' }] };
    }
  }

  async listSources(): Promise<CompendiumPersistenceState['sources']> {
    return (await this.loadSnapshot()).sources;
  }

  async listPacks(): Promise<CompendiumPersistenceState['packs']> {
    return (await this.loadSnapshot()).packs;
  }

  async listItems(): Promise<StoredCompendiumItem[]> {
    return (await this.loadSnapshot()).items;
  }

  async saveImportJson(json: string): Promise<SaveCompendiumRepositoryImportResult> {
    const current = await this.loadSnapshot();
    const result = parseAndBuildPersistedImport(json);
    if (!result.ok || !result.persisted) return { ok: false, snapshot: current, issues: result.issues };

    const imported = result.persisted;
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

    const snapshot = pruneOrphanSources({
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
    });

    await this.saveSnapshot(snapshot);
    return { ok: true, imported, snapshot, issues: imported.issues };
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

    try {
      const transaction = applyCompendiumImportV2PlanToSnapshot(current, parsed.parse.data, plan);
      // Key-value persistence commits the fully built snapshot in one write.
      // If setItem rejects, the previous persisted envelope remains authoritative.
      await this.saveSnapshot(transaction.snapshot);
      return {
        ok: true,
        snapshot: transaction.snapshot,
        preview: parsed.preview,
        plan,
        summary: transaction.summary,
        issues: parsed.preview.issues
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        snapshot: current,
        preview: parsed.preview,
        plan,
        issues: [
          ...parsed.preview.issues,
          { severity: 'error', code: 'COMPENDIUM_V2_PERSISTENCE_FAILED', message }
        ]
      };
    }
  }

  async removePack(packId: string): Promise<CompendiumPersistenceState> {
    const current = await this.loadSnapshot();
    const snapshot = pruneOrphanSources({
      ...current,
      packs: current.packs.filter((pack) => pack.id !== packId),
      items: current.items.filter((item) => item.packId !== packId)
    });
    await this.saveSnapshot(snapshot);
    return snapshot;
  }

  async setSourceEnabled(sourceId: string, enabled: boolean): Promise<CompendiumPersistenceState> {
    const current = await this.loadSnapshot();
    const snapshot = {
      ...current,
      enabledSourceIds: enabled ? unique([...current.enabledSourceIds, sourceId]) : current.enabledSourceIds.filter((id) => id !== sourceId)
    };
    await this.saveSnapshot(snapshot);
    return snapshot;
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
    const current = await this.loadSnapshot();
    const snapshot = applyCompendiumReviewBatchToSnapshot(current, entries);
    await this.saveSnapshot(snapshot);
    return snapshot;
  }


  async updateItemMapping(itemId: string, update: CompendiumItemMappingUpdate): Promise<CompendiumPersistenceState> {
    const current = await this.loadSnapshot();
    const updatedAt = new Date().toISOString();
    const snapshot = {
      ...current,
      items: current.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              normalizedJson: update.normalizedJson,
              status: update.status ?? item.status,
              reviewDecision: update.reviewDecision ?? item.reviewDecision,
              reviewNotes: 'reviewNotes' in update ? update.reviewNotes : item.reviewNotes,
              reviewedBy: 'reviewedBy' in update ? update.reviewedBy : item.reviewedBy,
              reviewedAt: update.reviewDecision || update.status || ('reviewNotes' in update) || ('reviewedBy' in update) ? updatedAt : item.reviewedAt,
              updatedAt
            }
          : item
      )
    };
    await this.saveSnapshot(snapshot);
    return snapshot;
  }

  async searchItems(query: string, filters?: CompendiumRepositorySearchFilters): Promise<StoredCompendiumItem[]> {
    const snapshot = await this.loadSnapshot();
    const normalizedQuery = query.trim().toLowerCase();
    const typeSet = filters?.types?.length ? new Set(filters.types) : undefined;
    const statusSet = filters?.statuses?.length ? new Set(filters.statuses) : undefined;
    const sourceSet = filters?.sourceIds?.length ? new Set(filters.sourceIds) : undefined;
    const onlyEnabled = filters?.onlyEnabled ?? true;
    const enabledSourceIds = new Set(snapshot.enabledSourceIds);

    return snapshot.items
      .filter((item) => (typeSet ? typeSet.has(item.type) : true))
      .filter((item) => (statusSet ? statusSet.has(item.status) : item.status !== 'disabled'))
      .filter((item) => (sourceSet ? sourceSet.has(item.sourceId) : true))
      .filter((item) => (onlyEnabled ? enabledSourceIds.has(item.sourceId) : true))
      .filter((item) => itemMatchesSearch(item, normalizedQuery))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}
