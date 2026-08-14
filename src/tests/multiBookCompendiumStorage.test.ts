import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

const sharedSource = {
  id: 'shared-rules-2024',
  book: 'Shared Rules',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const
};

const bookSource = (id: string, book: string) => ({
  id,
  book,
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const
});

const pack = (id: string, source: ReturnType<typeof bookSource>, itemId: string, itemSource = source) => JSON.stringify({
  id,
  source,
  items: [{ id: itemId, kind: 'feature', name: itemId, source: itemSource, payload: { summary: itemId } }]
});

describe('multiple compendium books and shared sources', () => {
  it('preserves a shared source while at least one package still references it', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const sourceA = bookSource('book-a', 'Book A');
    const sourceB = bookSource('book-b', 'Book B');
    const first = await repository.saveImportJson(pack('pack-a', sourceA, 'item-a', sharedSource));
    const second = await repository.saveImportJson(pack('pack-b', sourceB, 'item-b', sharedSource));

    expect(second.snapshot.sources.map((source) => source.id).sort()).toEqual(['book-a', 'book-b', 'shared-rules-2024']);

    const afterFirstRemoval = await repository.removePack(first.imported!.pack.id);
    expect(afterFirstRemoval.sources.some((source) => source.id === sharedSource.id)).toBe(true);
    expect(afterFirstRemoval.items).toHaveLength(1);

    const afterSecondRemoval = await repository.removePack(second.imported!.pack.id);
    expect(afterSecondRemoval.sources).toHaveLength(0);
    expect(afterSecondRemoval.enabledSourceIds).toHaveLength(0);
  });

  it('replacing a package prunes item-specific sources no longer referenced', async () => {
    const repository = new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
    const sourceA = bookSource('book-replace', 'Replace Book');
    await repository.saveImportJson(pack('replace-pack', sourceA, 'old-item', sharedSource));
    const replacement = await repository.saveImportJson(pack('replace-pack', sourceA, 'new-item', sourceA));

    expect(replacement.snapshot.items.map((item) => item.importItemId)).toEqual(['new-item']);
    expect(replacement.snapshot.sources.map((source) => source.id)).toEqual(['book-replace']);
    expect(replacement.snapshot.enabledSourceIds).toEqual(['book-replace']);
  });
});
