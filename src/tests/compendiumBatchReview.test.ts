import { buildPersistedCompendiumImport } from '../compendium/importer';
import { KeyValueCompendiumRepository, applyCompendiumReviewBatchToSnapshot } from '../storage/compendiumRepository';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

const source = {
  id: 'batch-source',
  book: 'Batch fixture',
  status: 'active' as const,
  confidence: 'exact' as const
};

const input = {
  id: 'batch-pack',
  source,
  items: [
    { id: 'batch-a', kind: 'feature' as const, name: 'Batch A', source, payload: { summary: 'A' } },
    { id: 'batch-b', kind: 'feature' as const, name: 'Batch B', source, payload: { summary: 'B' } },
    { id: 'batch-c', kind: 'feature' as const, name: 'Batch C', source, payload: { summary: 'C' } }
  ]
};

describe('transactional compendium review batches', () => {
  it('applies several review updates with one shared timestamp', () => {
    const persisted = buildPersistedCompendiumImport(input);
    const snapshot = {
      sources: [persisted.source],
      packs: [persisted.pack],
      items: persisted.items,
      enabledSourceIds: [persisted.source.id]
    };
    const updated = applyCompendiumReviewBatchToSnapshot(snapshot, [
      { itemId: persisted.items[0]!.id, update: { status: 'needsReview', reviewDecision: 'pending', reviewedBy: 'Batch' } },
      { itemId: persisted.items[1]!.id, update: { status: 'disabled', reviewDecision: 'rejected', reviewedBy: 'Batch' } }
    ], '2026-07-14T20:00:00.000Z');

    expect(updated.items[0]?.status).toBe('needsReview');
    expect(updated.items[1]?.status).toBe('disabled');
    expect(updated.items[2]?.status).toBe('validated');
    expect(updated.items[0]?.updatedAt).toBe('2026-07-14T20:00:00.000Z');
    expect(updated.items[1]?.updatedAt).toBe('2026-07-14T20:00:00.000Z');
  });

  it('does not partially persist when an item id is missing', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const saved = await repository.saveImportJson(JSON.stringify(input));
    const firstId = saved.imported!.items[0]!.id;

    await expect(repository.updateItemsReview([
      { itemId: firstId, update: { status: 'disabled', reviewDecision: 'rejected' } },
      { itemId: 'missing-item', update: { status: 'validated', reviewDecision: 'approved' } }
    ])).rejects.toThrow('missing-item');

    const snapshot = await repository.loadSnapshot();
    expect(snapshot.items.find((item) => item.id === firstId)?.status).toBe('validated');
  });

  it('persists all requested updates through the repository batch method', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const saved = await repository.saveImportJson(JSON.stringify(input));
    const entries = saved.imported!.items.map((item) => ({
      itemId: item.id,
      update: { status: 'needsReview' as const, reviewDecision: 'pending' as const, reviewNotes: 'batch review' }
    }));

    const snapshot = await repository.updateItemsReview(entries);
    expect(snapshot.items.every((item) => item.status === 'needsReview')).toBe(true);
    expect(snapshot.items.every((item) => item.reviewNotes === 'batch review')).toBe(true);
  });
});
