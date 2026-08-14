import { ContentPolicyService, initializeBundledCatalog } from '../catalog';
import {
  CATALOG_FILTER_PREFERENCES_KEY,
  createCatalogFilterPreferencesRepository,
  sanitizeCatalogFilterState
} from '../storage/catalogFilterPreferences';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

const snapshot = initializeBundledCatalog();
const fallback = new ContentPolicyService(snapshot).createDefaultState();

describe('catalog filter preferences', () => {
  it('persists and restores compatible book, category and entity overrides', async () => {
    const storage = createMemoryKeyValueStorage();
    const repository = createCatalogFilterPreferencesRepository(
      storage,
      () => new Date('2026-08-03T22:00:00.000Z')
    );
    const entityId = snapshot.entries.find((entry) => entry.sourceBookId === 'phb-2024')?.entityId;
    const categoryId = snapshot.categories.find((entry) => entry.canDisable)?.id;
    expect(entityId).toBeDefined();
    expect(categoryId).toBeDefined();
    if (!entityId || !categoryId) return;

    const state = {
      bookStates: { ...fallback.bookStates, 'mm-2025': false },
      categoryStates: { [categoryId]: false },
      entityStates: { [entityId]: 'disabled' as const }
    };
    const saved = await repository.save(snapshot, state);
    expect(saved.savedAt).toBe('2026-08-03T22:00:00.000Z');
    expect(storage.dump()[CATALOG_FILTER_PREFERENCES_KEY]).toContain('mm-2025');

    const loaded = await repository.load(snapshot, fallback);
    expect(loaded.restored).toBe(true);
    expect(loaded.state.bookStates['mm-2025']).toBe(false);
    expect(loaded.state.categoryStates[categoryId]).toBe(false);
    expect(loaded.state.entityStates[entityId]).toBe('disabled');
  });

  it('drops unknown IDs while preserving valid settings during catalog migration', () => {
    const entityId = snapshot.entries[0]?.entityId;
    expect(entityId).toBeDefined();
    if (!entityId) return;

    const sanitized = sanitizeCatalogFilterState(
      snapshot,
      {
        bookStates: { 'mm-2025': false, 'unknown-book': false },
        categoryStates: { 'unknown-category': false },
        entityStates: {
          [entityId]: 'enabled',
          'unknown-entity': 'disabled'
        }
      },
      fallback
    );

    expect(sanitized.bookStates['mm-2025']).toBe(false);
    expect(sanitized.bookStates['unknown-book']).toBeUndefined();
    expect(sanitized.categoryStates['unknown-category']).toBeUndefined();
    expect(sanitized.entityStates[entityId]).toBe('enabled');
    expect(sanitized.entityStates['unknown-entity']).toBeUndefined();
  });
});
