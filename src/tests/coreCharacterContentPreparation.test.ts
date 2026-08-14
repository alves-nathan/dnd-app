import { buildPersistedCompendiumImport } from '../compendium/importer';
import { prepareCoreCharacterContentSnapshot } from '../compendium/coreCharacterContentPreparation';

const source = {
  id: 'phb-core-test',
  book: 'PHB Core Test',
  version: '2024',
  status: 'needsReview' as const,
  confidence: 'importedNeedsReview' as const
};

describe('core character content preparation', () => {
  it('validates creation and progression content', () => {
    const persisted = buildPersistedCompendiumImport({
      id: 'core-preparation-pack',
      source,
      items: [
        {
          id: 'fighter-test',
          kind: 'class',
          name: 'Fighter Test',
          source,
          payload: {
            level: 1,
            hitDie: 10
          }
        },
        {
          id: 'human-test',
          kind: 'species',
          name: 'Human Test',
          source,
          payload: { featureIds: ['human-feature-test'] }
        },
        {
          id: 'human-feature-test',
          kind: 'feature',
          name: 'Human Feature Test',
          source,
          payload: { sourceType: 'speciesTrait', speciesId: 'human-test' }
        },
        {
          id: 'soldier-test',
          kind: 'background',
          name: 'Soldier Test',
          source,
          payload: {}
        },
        { id: 'origin-feat-test', kind: 'feat', name: 'Origin Feat Test', source, payload: { category: 'Origin' } },
        {
          id: 'spell-test',
          kind: 'spell',
          name: 'Spell Test',
          source,
          payload: {
            level: 1
          }
        }
      ]
    });

    const prepared =
      prepareCoreCharacterContentSnapshot(
        {
          sources: [persisted.source],
          packs: [persisted.pack],
          items: persisted.items,
          enabledSourceIds: []
        },
        {
          now: '2026-07-13T12:00:00.000Z',
          reviewedBy: 'Test Runner'
        }
      );

    const byType = new Map(
      prepared.snapshot.items.map(
        (item) => [item.type, item]
      )
    );

    expect(byType.get('class')?.status).toBe(
      'validated'
    );

    expect(byType.get('species')?.status).toBe(
      'validated'
    );

    expect(byType.get('background')?.status).toBe(
      'validated'
    );

    expect(byType.get('feat')?.status).toBe('validated');

    expect(byType.get('spell')?.status).toBe('validated');

    expect(
      prepared.snapshot.enabledSourceIds
    ).toContain(source.id);

    expect(
      prepared.newlyValidatedItemCount
    ).toBe(6);

    expect(prepared.eligibleItemCount).toBe(6);
    expect(prepared.enabledSourceCount).toBe(1);
  });

  it('does not reactivate disabled core items', () => {
    const persisted = buildPersistedCompendiumImport({
      id: 'disabled-core-pack',
      source,
      items: [
        {
          id: 'disabled-class',
          kind: 'class',
          name: 'Disabled Class',
          source,
          payload: {
            level: 1,
            hitDie: 8
          }
        }
      ]
    });

    const disabledItems = persisted.items.map(
      (item) => ({
        ...item,
        status: 'disabled' as const,
        reviewDecision: 'rejected' as const
      })
    );

    const prepared =
      prepareCoreCharacterContentSnapshot({
        sources: [persisted.source],
        packs: [persisted.pack],
        items: disabledItems,
        enabledSourceIds: []
      });

    expect(
      prepared.snapshot.items[0]?.status
    ).toBe('disabled');

    expect(
      prepared.newlyValidatedItemCount
    ).toBe(0);

    expect(prepared.eligibleItemCount).toBe(0);
  });
});
