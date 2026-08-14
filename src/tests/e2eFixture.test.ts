import { buildPersistedCompendiumImport } from '../compendium/importer';
import { e2eCharacterCreationFixture } from '../fixtures/e2eCharacterCreation';

it('keeps the development E2E creation fixture deterministic and directly usable', () => {
  const persisted = buildPersistedCompendiumImport(e2eCharacterCreationFixture);
  expect(persisted.items).toHaveLength(4);
  expect(persisted.items.every((item) => item.status === 'validated')).toBe(true);
  expect(persisted.items.map((item) => item.type).sort()).toEqual(['background', 'class', 'feat', 'species']);
  expect(persisted.source.status).toBe('active');
});
