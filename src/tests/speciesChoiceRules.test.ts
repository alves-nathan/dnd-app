import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import {
  applyAutomaticSpeciesProgression,
  getSpeciesChoiceRequirements,
  setSpeciesChoiceOption,
  setSpeciesChoiceSpellcastingAbility,
  validateSpeciesChoices
} from '../characters/speciesChoiceRules';
import { createEmptyCharacter } from '../data/mockData';

const source = {
  id: 'species-choice-source',
  book: 'Species Choice Test',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const
};

const persisted = buildPersistedCompendiumImport({
  id: 'species-choice-pack',
  source,
  items: [
    {
      id: 'elf-test',
      kind: 'species',
      name: 'Elf Test',
      source,
      payload: {
        featureIds: ['elf-lineage-test', 'elf-passive-test']
      }
    },
    {
      id: 'elf-lineage-test',
      kind: 'feature',
      name: 'Elven Lineage Test',
      source,
      payload: {
        sourceType: 'speciesTrait',
        speciesId: 'elf-test',
        choiceRequired: true,
        spellcastingAbilityChoice: ['INT', 'WIS', 'CHA'],
        lineageOptions: {
          drow: {},
          'high-elf': {},
          'wood-elf': {}
        }
      }
    },
    {
      id: 'elf-passive-test',
      kind: 'feature',
      name: 'Fey Ancestry Test',
      source,
      payload: {
        sourceType: 'speciesTrait',
        speciesId: 'elf-test'
      }
    }
  ]
});

describe('species choice rules', () => {
  it('extracts lineage options and requires a spellcasting ability', () => {
    const species = persisted.items.find((item) => item.type === 'species')!;
    const requirements = getSpeciesChoiceRequirements(species, persisted.items, 1);

    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.kind).toBe('lineage');
    expect(requirements[0]?.options.map((option) => option.id)).toEqual([
      'drow',
      'high-elf',
      'wood-elf'
    ]);
    expect(validateSpeciesChoices(requirements, [])).toHaveLength(1);

    let choices = setSpeciesChoiceOption([], requirements[0]!, 'wood-elf');
    expect(validateSpeciesChoices(requirements, choices).map((issue) => issue.code)).toEqual([
      'SPECIES_SPELLCASTING_ABILITY_REQUIRED'
    ]);

    choices = setSpeciesChoiceSpellcastingAbility(choices, requirements[0]!, 'WIS');
    expect(validateSpeciesChoices(requirements, choices)).toEqual([]);
  });

  it('applies validated species features after the choice is complete', () => {
    const species = persisted.items.find((item) => item.type === 'species')!;
    const requirements = getSpeciesChoiceRequirements(species, persisted.items, 1);
    let choices = setSpeciesChoiceOption([], requirements[0]!, 'high-elf');
    choices = setSpeciesChoiceSpellcastingAbility(choices, requirements[0]!, 'INT');

    const appliedSpecies = applyCompendiumItemToCharacter(createEmptyCharacter('Elf Hero'), species);
    expect(appliedSpecies.ok).toBe(true);

    const character = {
      ...appliedSpecies.character,
      buildChoices: {
        ...appliedSpecies.character.buildChoices!,
        speciesChoices: choices
      }
    };

    const result = applyAutomaticSpeciesProgression(character, persisted.items);
    expect(result.issues).toEqual([]);
    expect(result.appliedItems.map((item) => item.name).sort()).toEqual([
      'Elven Lineage Test',
      'Fey Ancestry Test'
    ]);
    expect(result.character.features.map((feature) => feature.name).sort()).toEqual([
      'Elven Lineage Test',
      'Fey Ancestry Test'
    ]);

    const repeated = applyAutomaticSpeciesProgression(result.character, persisted.items);
    expect(repeated.appliedItems).toHaveLength(0);
  });
});
