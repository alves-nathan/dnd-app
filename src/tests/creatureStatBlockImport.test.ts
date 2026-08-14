import {
  buildPersistedCompendiumImport,
  validateCompendiumJson
} from '../compendium/importer';
import {
  buildEngineReadinessForItem
} from '../compendium/engineReadiness';
import {
  canApplyCompendiumItemToCharacter
} from '../compendium/mapper';

const source = {
  id: 'creature-test-source',
  book: 'Test Source',
  page: '1',
  version: '2024',
  status: 'needsReview' as const,
  confidence: 'importedNeedsReview' as const
};

const input = {
  id: 'creature-test-pack',
  source,
  items: [
    {
      id: 'creature-wolf-test',
      kind: 'creatureStatBlock' as const,
      name: 'Wolf Test',
      summary: 'Stat block de teste.',
      source,
      payload: {
        size: 'Medium',
        creatureType: 'Beast',
        armorClass: { value: 12 },
        hitPoints: { average: 11, formula: '2d8 + 2' },
        speed: { walk: 40 },
        challenge: '1/4',
        actions: [
          {
            name: 'Bite',
            actionCost: 'action',
            damageFormula: '1d6 + 2'
          }
        ],
        traits: [],
        engineKey: 'creature.wolf_test'
      }
    }
  ]
};

describe('creatureStatBlock import', () => {
  it('accepts creatureStatBlock in the compendium schema', () => {
    const preview = validateCompendiumJson(
      JSON.stringify(input)
    );

    expect(preview.ok).toBe(true);
    expect(preview.data?.items[0]?.kind).toBe(
      'creatureStatBlock'
    );
  });

  it('persists it as needsReview and keeps it non-applicable', () => {
    const preview = validateCompendiumJson(
      JSON.stringify(input)
    );

    if (!preview.data) {
      throw new Error('Creature fixture was not parsed.');
    }

    const persisted = buildPersistedCompendiumImport(
      preview.data
    );

    const item = persisted.items[0];

    expect(item.status).toBe('needsReview');
    expect(
      canApplyCompendiumItemToCharacter(item)
    ).toBe(false);

    const readiness = buildEngineReadinessForItem(item, {
      source: persisted.source,
      pack: persisted.pack,
      enabledSource: true
    });

    expect(readiness.status).toBe('notApplicable');
    expect(readiness.capabilities).toContain('searchOnly');
    expect(
      readiness.issues.some(
        (entry) => entry.code === 'ENGINE_TYPE_NOT_SUPPORTED'
      )
    ).toBe(false);
  });
});
