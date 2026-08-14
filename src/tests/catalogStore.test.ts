import { createCatalogStore } from '../store/catalogStore';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

describe('catalog store', () => {
  it('initializes, previews, persists and restores a book-level change', async () => {
    const storage = createMemoryKeyValueStorage();
    const now = () => new Date('2026-08-03T22:30:00.000Z');
    const first = createCatalogStore(storage, now);

    const initialized = await first.getState().initialize();
    expect(initialized.ok).toBe(true);
    expect(first.getState().status).toBe('ready');
    expect(first.getState().snapshot?.entries).toHaveLength(5841);

    const pending = first.getState().previewBookState('mm-2025', false);
    expect(pending.impact.disabledEntityIds.length).toBeGreaterThan(2000);
    expect(pending.impact.hardDependencyBreaks.length).toBeGreaterThan(0);

    const committed = await first.getState().commitPendingChange();
    expect(committed.ok).toBe(true);
    expect(first.getState().filterState?.bookStates['mm-2025']).toBe(false);

    const second = createCatalogStore(storage, now);
    const restored = await second.getState().initialize();
    expect(restored.ok).toBe(true);
    expect(second.getState().preferencesRestored).toBe(true);
    expect(second.getState().filterState?.bookStates['mm-2025']).toBe(false);
  });

  it('does not apply previewed changes before confirmation', async () => {
    const store = createCatalogStore(createMemoryKeyValueStorage());
    await store.getState().initialize();
    const before = store.getState().filterState?.bookStates['dmg-2024'];
    store.getState().previewBookState('dmg-2024', false);
    expect(store.getState().filterState?.bookStates['dmg-2024']).toBe(before);
    store.getState().discardPendingChange();
    expect(store.getState().pendingChange).toBeUndefined();
  });
});
