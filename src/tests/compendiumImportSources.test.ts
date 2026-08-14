import { buildPersistedCompendiumImport } from '../compendium/importer';
import { collectPersistedImportSources } from '../storage/compendiumRepository';

const packSource = {
  id: 'phb',
  book: 'Player Handbook',
  version: '2024',
  status: 'needsReview' as const,
  confidence: 'importedNeedsReview' as const
};

const itemSource = {
  id: 'phb-2024',
  book: 'Player Handbook',
  page: '213-219',
  version: '2024',
  status: 'needsReview' as const,
  confidence: 'importedNeedsReview' as const
};

describe('compendium import sources', () => {
  it('collects the pack source and distinct item sources', () => {
    const persisted = buildPersistedCompendiumImport({
      id: 'phb-multi-source-pack',
      source: packSource,
      items: [
        {
          id: 'weapon-test',
          kind: 'weapon',
          name: 'Weapon Test',
          source: itemSource,
          payload: {
            weaponType: 'melee',
            actionCost: 'action',
            damageFormula: '1d8 + STR'
          }
        }
      ]
    });

    expect(persisted.pack.sourceId).toBe('phb');
    expect(persisted.items[0]?.sourceId).toBe('phb-2024');

    const sources = collectPersistedImportSources(persisted);

    expect(
      sources.map((source) => source.id).sort()
    ).toEqual(['phb', 'phb-2024']);
  });

  it('deduplicates sources by id', () => {
    const persisted = buildPersistedCompendiumImport({
      id: 'single-source-pack',
      source: packSource,
      items: [
        {
          id: 'feature-test',
          kind: 'feature',
          name: 'Feature Test',
          source: packSource,
          payload: {
            summary: 'Test'
          }
        }
      ]
    });

    expect(
      collectPersistedImportSources(persisted)
    ).toHaveLength(1);
  });
});
