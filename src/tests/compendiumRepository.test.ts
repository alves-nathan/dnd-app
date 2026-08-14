import { buildPersistedCompendiumImport } from '../compendium/importer';
import { CompendiumImportInput } from '../compendium/schemas';
import { COMPENDIUM_PERSISTENCE_VERSION, COMPENDIUM_STORAGE_KEY } from '../storage/compendiumSnapshot';
import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

const input: CompendiumImportInput = {
  id: 'repo-pack',
  source: { id: 'repo-source', book: 'Fonte autoral', page: '7', version: '2024', status: 'active', confidence: 'exact' },
  items: [
    {
      id: 'repo-weapon',
      kind: 'weapon',
      name: 'Espada autoral',
      source: { id: 'repo-source', book: 'Fonte autoral', page: '7', version: '2024', status: 'active', confidence: 'exact' },
      payload: { damageFormula: '1d8 + STR' }
    }
  ]
};

describe('KeyValueCompendiumRepository', () => {
  it('saves and loads a compendium snapshot through the storage abstraction', async () => {
    const storage = createMemoryKeyValueStorage();
    const repository = new KeyValueCompendiumRepository(storage);
    const persisted = buildPersistedCompendiumImport(input, { importedAt: '2026-07-11T00:00:00.000Z' });

    await repository.saveSnapshot({
      sources: [persisted.source],
      packs: [persisted.pack],
      items: persisted.items,
      enabledSourceIds: [persisted.source.id]
    });

    const loaded = await repository.loadSnapshot();
    expect(loaded.sources).toHaveLength(1);
    expect(loaded.packs[0]?.id).toBe('repo-pack');
    expect(loaded.items[0]?.name).toBe('Espada autoral');
    expect(loaded.enabledSourceIds).toEqual(['repo-source']);
  });

  it('exports the same envelope used by Zustand persist', async () => {
    const storage = createMemoryKeyValueStorage();
    const repository = new KeyValueCompendiumRepository(storage);
    await repository.saveSnapshot({ sources: [], packs: [], items: [], enabledSourceIds: [] });

    const raw = storage.dump()[COMPENDIUM_STORAGE_KEY];
    expect(raw).toBeTruthy();

    const exported = JSON.parse(await repository.exportSnapshot()) as { version: number; state: unknown };
    expect(exported.version).toBe(COMPENDIUM_PERSISTENCE_VERSION);
    expect(exported.state).toEqual({ sources: [], packs: [], items: [], enabledSourceIds: [] });
  });

  it('imports a raw snapshot without exposing the UI to the storage backend', async () => {
    const storage = createMemoryKeyValueStorage();
    const repository = new KeyValueCompendiumRepository(storage);
    const result = await repository.importSnapshot(JSON.stringify({ sources: [], packs: [], items: [], enabledSourceIds: ['src-a'] }));

    expect(result.ok).toBe(true);
    expect(result.snapshot?.enabledSourceIds).toEqual(['src-a']);

    const loaded = await repository.loadSnapshot();
    expect(loaded.enabledSourceIds).toEqual(['src-a']);
  });



  it('saves an import JSON and searches persisted items through repository methods', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const result = await repository.saveImportJson(JSON.stringify(input));

    expect(result.ok).toBe(true);
    expect(await repository.listSources()).toHaveLength(1);
    expect(await repository.listPacks()).toHaveLength(1);
    expect(await repository.listItems()).toHaveLength(1);

    const matches = await repository.searchItems('espada', { onlyEnabled: true });
    expect(matches[0]?.name).toBe('Espada autoral');
  });

  it('removes packs and disables sources when they are no longer used', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const saved = await repository.saveImportJson(JSON.stringify(input));
    const packId = saved.imported?.pack.id;
    expect(packId).toBeTruthy();

    const snapshot = await repository.removePack(packId ?? 'missing');
    expect(snapshot.packs).toHaveLength(0);
    expect(snapshot.items).toHaveLength(0);
    expect(snapshot.sources).toHaveLength(0);
    expect(snapshot.enabledSourceIds).toHaveLength(0);
  });

  it('persists review notes and status transitions', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const saved = await repository.saveImportJson(JSON.stringify(input));
    const itemId = saved.imported?.items[0]?.id ?? 'missing';

    const snapshot = await repository.updateItemReview(itemId, {
      status: 'needsReview',
      reviewDecision: 'pending',
      reviewNotes: 'Conferir fórmula e página antes de usar.',
      reviewedBy: 'Nathan'
    });

    const item = snapshot.items.find((entry) => entry.id === itemId);
    expect(item?.status).toBe('needsReview');
    expect(item?.reviewDecision).toBe('pending');
    expect(item?.reviewNotes).toContain('Conferir fórmula');
    expect(item?.reviewedBy).toBe('Nathan');
    expect(item?.reviewedAt).toBeTruthy();
  });

  it('filters search by status and source', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const saved = await repository.saveImportJson(JSON.stringify(input));
    const itemId = saved.imported?.items[0]?.id ?? 'missing';
    await repository.updateItemReview(itemId, { status: 'needsReview', reviewDecision: 'pending', reviewNotes: 'precisa revisão' });

    const hidden = await repository.searchItems('espada', { statuses: ['validated'], onlyEnabled: true });
    const visible = await repository.searchItems('revisão', { statuses: ['needsReview'], sourceIds: ['repo-source'], onlyEnabled: true });

    expect(hidden).toHaveLength(0);
    expect(visible[0]?.id).toBe(itemId);
  });



  it('persists V2 imports incrementally and preserves storage ids across updates', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const v2 = {
      templateVersion: 'dnd-combat-import.v2',
      id: 'v2-repo-pack',
      source: { ...input.source, rulesEra: '2024', contentType: 'official' },
      items: [{
        id: 'v2-feature', kind: 'feature', name: 'V2 Feature',
        source: { ...input.source, rulesEra: '2024', contentType: 'official' },
        payload: { sourceType: 'classFeature', actionCost: 'action' }
      }]
    };
    const first = await repository.saveImportV2Json(JSON.stringify(v2));
    expect(first.ok).toBe(true);
    expect(first.summary?.created).toBe(1);
    const storedId = first.snapshot.items[0]?.id;
    expect(first.snapshot.items[0]?.contentHash).toMatch(/^cmpv2_/);

    const second = await repository.saveImportV2Json(JSON.stringify({
      ...v2,
      items: [{ ...v2.items[0], payload: { ...v2.items[0].payload, actionCost: 'bonusAction' } }]
    }));
    expect(second.ok).toBe(true);
    expect(second.summary?.updated).toBe(1);
    expect(second.snapshot.items[0]?.id).toBe(storedId);
    expect(second.snapshot.items[0]?.normalizedJson.actionCost).toBe('bonusAction');
  });

  it('does not commit a V2 snapshot when the key-value write fails', async () => {
    const backing = createMemoryKeyValueStorage();
    const repository = new KeyValueCompendiumRepository(backing);
    await repository.saveSnapshot({ sources: [], packs: [], items: [], enabledSourceIds: [] });
    const before = backing.dump();
    let failWrites = true;
    const failingStorage = {
      getItem: backing.getItem,
      removeItem: backing.removeItem,
      setItem: (name: string, value: string) => {
        if (failWrites) throw new Error('simulated write failure');
        return backing.setItem(name, value);
      }
    };
    const failingRepository = new KeyValueCompendiumRepository(failingStorage);
    const v2 = {
      templateVersion: 'dnd-combat-import.v2', id: 'rollback-pack',
      source: { ...input.source, rulesEra: '2024', contentType: 'official' },
      items: [{ id: 'rollback-feature', kind: 'feature', name: 'Rollback Feature', source: { ...input.source, rulesEra: '2024', contentType: 'official' }, payload: { sourceType: 'classFeature' } }]
    };
    const result = await failingRepository.saveImportV2Json(JSON.stringify(v2));
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'COMPENDIUM_V2_PERSISTENCE_FAILED')).toBe(true);
    expect(backing.dump()).toEqual(before);
    failWrites = false;
  });

  it('reports invalid snapshot JSON as a validation issue', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const result = await repository.importSnapshot('{ invalid');

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('COMPENDIUM_SNAPSHOT_IMPORT_ERROR');
  });
});
