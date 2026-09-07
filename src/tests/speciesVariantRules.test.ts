import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  getNestedSpeciesVariantsForBase,
  getSpeciesVariantBaseItem,
  getSpeciesVariantLabel,
  getTopLevelSpeciesChoices,
  isNestedSpeciesVariant
} from '../characters/speciesVariantRules';

const source = {
  id: 'legacy-species-test',
  book: 'Legacy Species Test',
  version: '2019',
  status: 'active' as const,
  confidence: 'exact' as const
};

const persisted = buildPersistedCompendiumImport({
  id: 'species-variant-test',
  source,
  items: [
    { id: 'phb-2024-species-human', kind: 'species', name: 'Human', source, payload: { rulesEdition: '2024' } },
    { id: 'phb-2024-species-tiefling', kind: 'species', name: 'Tiefling', source, payload: { rulesEdition: '2024' } },
    {
      id: 'eberron-mark-handling',
      kind: 'species',
      name: 'Mark of Handling',
      source,
      payload: {
        optionType: 'variantRace',
        baseSpecies: 'Human',
        inheritsFrom: 'phb-2024-species-human',
        dragonmark: 'Mark of Handling'
      }
    },
    {
      id: 'mtof-tiefling-glasya',
      kind: 'species',
      name: 'Tiefling (Glasya)',
      source,
      payload: {
        optionType: 'subrace',
        baseSpecies: 'Tiefling',
        inheritsFrom: 'phb-2024-species-tiefling'
      }
    }
  ]
});

describe('species variant grouping', () => {
  it('keeps Dragonmarks and legacy subraces out of the top-level species list', () => {
    const species = persisted.items.filter((item) => item.type === 'species');
    expect(getTopLevelSpeciesChoices(species).map((item) => item.name)).toEqual(['Human', 'Tiefling']);
    expect(species.filter(isNestedSpeciesVariant).map((item) => item.name)).toEqual([
      'Mark of Handling',
      'Tiefling (Glasya)'
    ]);
  });

  it('groups Tiefling lineages and Dragonmarks under their base species', () => {
    const species = persisted.items.filter((item) => item.type === 'species');
    const human = species.find((item) => item.name === 'Human')!;
    const tiefling = species.find((item) => item.name === 'Tiefling')!;
    const glasya = species.find((item) => item.name === 'Tiefling (Glasya)')!;

    expect(getNestedSpeciesVariantsForBase(human, species).map((item) => item.name)).toEqual(['Mark of Handling']);
    expect(getNestedSpeciesVariantsForBase(tiefling, species).map((item) => item.name)).toEqual(['Tiefling (Glasya)']);
    expect(getSpeciesVariantBaseItem(glasya, species)?.id).toBe(tiefling.id);
    expect(getSpeciesVariantLabel(glasya)).toBe('Glasya');
  });
});
