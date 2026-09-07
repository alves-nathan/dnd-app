import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import {
  applyAutomaticSpeciesProgression,
  getSelectedSpeciesFeatureChoice,
  getSpeciesChoiceRequirements,
  setSpeciesChoiceOption,
  setSpeciesChoiceSpellcastingAbility,
  validateSpeciesChoices
} from '../characters/speciesChoiceRules';
import { createEmptyCharacter } from '../data/mockData';
import { normalizeCharacterChoiceReference } from '../catalog/characterChoiceBridge';

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
const goliathPersisted = buildPersistedCompendiumImport({
  id: 'goliath-choice-pack',
  source,
  items: [
    {
      id: 'goliath-test',
      kind: 'species',
      name: 'Goliath Test',
      source,
      payload: { featureIds: ['goliath-giant-ancestry-test'] }
    },
    {
      id: 'goliath-giant-ancestry-test',
      kind: 'feature',
      name: 'Giant Ancestry',
      source,
      payload: {
        sourceType: 'speciesTrait',
        speciesId: 'goliath-test',
        engineKey: 'species.goliath.giant_ancestry',
        choiceRequired: true,
        resource: { id: 'goliath-giant-ancestry', name: 'Giant Ancestry', max: 'PB', recharge: 'longRest' },
        options: {
          'fires-burn': { trigger: 'hitWithAttackRollAndDealDamage', extraDamage: '1d10 fire' },
          'stones-endurance': { actionCost: 'reaction', trigger: 'takeDamage', damageReduction: '1d12 + CON' }
        }
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

  it('materializes review-pending automatic species features while preserving their editorial flag on the link', () => {
    const species = persisted.items.find((item) => item.type === 'species')!;
    const reviewItems = persisted.items.map((item) =>
      item.type === 'feature'
        ? { ...item, status: 'needsReview' as const }
        : item
    );
    const requirements = getSpeciesChoiceRequirements(species, reviewItems, 1);
    let choices = setSpeciesChoiceOption([], requirements[0]!, 'high-elf');
    choices = setSpeciesChoiceSpellcastingAbility(choices, requirements[0]!, 'INT');
    const appliedSpecies = applyCompendiumItemToCharacter(createEmptyCharacter('Review Elf'), species);
    const character = {
      ...appliedSpecies.character,
      buildChoices: { ...appliedSpecies.character.buildChoices!, speciesChoices: choices }
    };

    const result = applyAutomaticSpeciesProgression(character, reviewItems);
    expect(result.appliedItems).toHaveLength(2);
    expect(result.character.features.map((feature) => feature.name).sort()).toEqual([
      'Elven Lineage Test',
      'Fey Ancestry Test'
    ]);
    expect(result.character.compendiumLinks?.filter((link) => link.appliedAs === 'feature')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'active', manualReviewRequired: true })
      ])
    );
    expect(reviewItems.filter((item) => item.type === 'feature').every((item) => item.status === 'needsReview')).toBe(true);
  });



  it('matches catalog-normalized persisted species choices against the current carrier requirement', () => {
    const species = goliathPersisted.items.find((item) => item.type === 'species')!;
    const requirement = getSpeciesChoiceRequirements(species, goliathPersisted.items, 5)[0]!;
    const currentChoice = setSpeciesChoiceOption([], requirement, 'fires-burn')[0]!;
    const migratedChoice = {
      ...currentChoice,
      speciesItemId: normalizeCharacterChoiceReference(currentChoice.speciesItemId),
      featureItemId: normalizeCharacterChoiceReference(currentChoice.featureItemId)
    };
    const appliedSpecies = applyCompendiumItemToCharacter(createEmptyCharacter('Migrated Fire Goliath'), species);
    const character = {
      ...appliedSpecies.character,
      level: 5,
      buildChoices: { ...appliedSpecies.character.buildChoices!, speciesChoices: [migratedChoice] }
    };

    const progressed = applyAutomaticSpeciesProgression(character, goliathPersisted.items);
    expect(progressed.issues).toEqual([]);
    const feature = progressed.character.features.find((entry) => entry.name === 'Giant Ancestry');
    expect(feature).toBeDefined();
    expect(getSelectedSpeciesFeatureChoice(progressed.character, goliathPersisted.items, feature!.id)?.option.id).toBe('fires-burn');
  });

  it('resolves the persisted Giant Ancestry option with its concrete mechanics for presentation and combat', () => {
    const species = goliathPersisted.items.find((item) => item.type === 'species')!;
    const requirement = getSpeciesChoiceRequirements(species, goliathPersisted.items, 5)[0]!;
    const choices = setSpeciesChoiceOption([], requirement, 'fires-burn');
    const appliedSpecies = applyCompendiumItemToCharacter(createEmptyCharacter('Fire Goliath'), species);
    const character = {
      ...appliedSpecies.character,
      level: 5,
      buildChoices: { ...appliedSpecies.character.buildChoices!, speciesChoices: choices }
    };

    const progressed = applyAutomaticSpeciesProgression(character, goliathPersisted.items);
    const feature = progressed.character.features.find((entry) => entry.name === 'Giant Ancestry');
    expect(feature).toBeDefined();

    const selected = getSelectedSpeciesFeatureChoice(progressed.character, goliathPersisted.items, feature!.id);
    expect(selected?.option.id).toBe('fires-burn');
    expect(selected?.option.label).toBe("Fire's Burn");
    expect(selected?.description).toContain('1d10 fire');
    expect(selected?.mechanics).toEqual(expect.objectContaining({
      trigger: 'hitWithAttackRollAndDealDamage',
      extraDamage: '1d10 fire'
    }));
  });

});
