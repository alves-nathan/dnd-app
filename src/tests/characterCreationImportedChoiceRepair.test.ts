import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { prefer2024FirstCharacterChoices } from '../characters/characterChoiceCandidates';
import {
  applyAutomaticSpeciesProgression,
  getSpeciesChoiceOptionFeatureItem,
  getSpeciesChoiceRequirements,
  setSpeciesChoiceOption
} from '../characters/speciesChoiceRules';
import { createEmptyCharacter } from '../data/mockData';

const source = {
  id: 'egtw-2020',
  book: "Explorer's Guide to Wildemount",
  version: '2020',
  status: 'active' as const,
  confidence: 'exact' as const
};

const genasiImport = buildPersistedCompendiumImport({
  id: 'genasi-test-pack',
  source,
  items: [
    {
      id: 'egtw-2020-species-genasi',
      kind: 'species',
      name: 'Genasi',
      source,
      payload: {
        featureIds: ['egtw-2020-feature-genasi-subrace-choice'],
        rulesEdition: '2014',
        compatibility: 'legacySourceNative'
      }
    },
    {
      id: 'egtw-2020-feature-genasi-subrace-choice',
      kind: 'feature',
      name: 'Genasi: Subrace Choice',
      source,
      payload: {
        sourceType: 'speciesFeature',
        speciesId: 'egtw-2020-species-genasi',
        mechanics: {
          chooseExactly: 1,
          choiceType: 'subrace',
          optionFeatureIds: [
            'egtw-2020-feature-genasi-subrace-air',
            'egtw-2020-feature-genasi-subrace-earth',
            'egtw-2020-feature-genasi-subrace-fire',
            'egtw-2020-feature-genasi-subrace-water'
          ]
        }
      }
    },
    ...['Air', 'Earth', 'Fire', 'Water'].map((name) => ({
      id: `egtw-2020-feature-genasi-subrace-${name.toLowerCase()}`,
      kind: 'feature' as const,
      name: `Genasi Subrace: ${name}`,
      summary: `${name} Genasi mechanics.`,
      source,
      payload: {
        sourceType: 'speciesFeature',
        speciesId: 'egtw-2020-species-genasi',
        mechanics: { optionType: 'genasiSubrace', name }
      }
    }))
  ]
});

describe('imported character-choice repair', () => {
  it('resolves feature-backed Genasi subraces as four explicit species choices', () => {
    const species = genasiImport.items.find((item) => item.type === 'species')!;
    const requirements = getSpeciesChoiceRequirements(species, genasiImport.items, 3);

    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.kind).toBe('subrace');
    expect(requirements[0]?.options.map((option) => option.label)).toEqual(['Air', 'Earth', 'Fire', 'Water']);
    expect(getSpeciesChoiceOptionFeatureItem(requirements[0]!, requirements[0]!.options[3]!.id, genasiImport.items)?.name)
      .toBe('Genasi Subrace: Water');
  });

  it('applies the selected Genasi subrace feature during species progression', () => {
    const species = genasiImport.items.find((item) => item.type === 'species')!;
    const requirements = getSpeciesChoiceRequirements(species, genasiImport.items, 3);
    const choices = setSpeciesChoiceOption([], requirements[0]!, 'egtw-2020-feature-genasi-subrace-water');
    const appliedSpecies = applyCompendiumItemToCharacter(createEmptyCharacter('Genasi Hero'), species);
    expect(appliedSpecies.ok).toBe(true);

    const character = {
      ...appliedSpecies.character,
      level: 3,
      buildChoices: {
        ...appliedSpecies.character.buildChoices!,
        speciesChoices: choices
      }
    };
    const result = applyAutomaticSpeciesProgression(character, genasiImport.items);
    expect(result.issues).toEqual([]);
    expect(result.appliedItems.map((item) => item.name)).toEqual(expect.arrayContaining([
      'Genasi: Subrace Choice',
      'Genasi Subrace: Water'
    ]));
  });

  it('collapses same-name character-choice reprints with 2024-first precedence', () => {
    const legacy = {
      ...genasiImport.items.find((item) => item.type === 'species')!,
      id: 'legacy-orc-storage',
      importItemId: 'egtw-2020-species-orc',
      name: 'Orc',
      sourceId: 'egtw-2020',
      version: '2020',
      normalizedJson: { rulesEdition: '2014', compatibility: 'legacySourceNative' },
      tags: ['species', 'legacy']
    };
    const current = {
      ...legacy,
      id: 'current-orc-storage',
      importItemId: 'phb-2024-species-orc',
      sourceId: 'phb-2024',
      version: '2024',
      normalizedJson: { rulesEdition: '2024' },
      tags: ['species']
    };

    expect(prefer2024FirstCharacterChoices([legacy, current]).map((item) => item.importItemId))
      .toEqual(['phb-2024-species-orc']);
  });
});
