import { reconcileSpellAssignmentReferences } from '../characters/spellAssignmentReferences';
import type { StoredCompendiumItem } from '../compendium/types';

const item = (id: string, importItemId: string, type: StoredCompendiumItem['type']): StoredCompendiumItem => ({
  id,
  importItemId,
  packId: 'test-pack',
  sourceId: 'phb-2024',
  type,
  name: importItemId,
  rawJson: {
    id: importItemId,
    kind: type,
    name: importItemId,
    source: { id: 'phb-2024', book: 'PHB 2024', status: 'active', confidence: 'exact' },
    payload: {}
  },
  normalizedJson: {},
  tags: [],
  status: 'validated',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
});

describe('spell assignment reference reconciliation', () => {
  const bard = item('catalog:class-bard', 'phb-2024:class:bard', 'class');
  const healingWord = item('catalog:spell-healing-word', 'phb-2024:spell:healing-word', 'spell');

  it('remaps legacy draft references to the current bridge IDs', () => {
    const result = reconcileSpellAssignmentReferences({
      assignments: {
        'compendium:legacy-healing-word': 'compendium:legacy-bard'
      },
      spellbookAssignments: {},
      spellItems: [healingWord],
      classItems: [bard],
      validClassItemIds: [bard.id],
      validSpellbookClassItemIds: [],
      choiceForItemId: (reference) => {
        if (reference === 'compendium:legacy-healing-word') {
          return {
            choiceId: healingWord.id,
            entityId: healingWord.importItemId,
            provenance: { legacyItemIds: ['compendium:legacy-healing-word'] }
          };
        }
        if (reference === 'compendium:legacy-bard') {
          return {
            choiceId: bard.id,
            entityId: bard.importItemId,
            provenance: { legacyItemIds: ['compendium:legacy-bard'] }
          };
        }
        return undefined;
      }
    });

    expect(result.assignments).toEqual({ [healingWord.id]: bard.id });
    expect(result.removedReferences).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it('drops references for classes or spells that are no longer part of the creation', () => {
    const result = reconcileSpellAssignmentReferences({
      assignments: {
        [healingWord.id]: bard.id,
        'missing-spell': bard.id,
        'old-wizard-spell': 'missing-class'
      },
      spellbookAssignments: {
        'old-wizard-book-spell': 'missing-class'
      },
      spellItems: [healingWord],
      classItems: [bard],
      validClassItemIds: [bard.id],
      validSpellbookClassItemIds: []
    });

    expect(result.assignments).toEqual({
      [healingWord.id]: bard.id,
      'missing-spell': bard.id
    });
    expect(result.spellbookAssignments).toEqual({});
    expect(result.removedReferences).toEqual(expect.arrayContaining([
      'old-wizard-spell',
      'missing-class',
      'old-wizard-book-spell'
    ]));
  });
});
