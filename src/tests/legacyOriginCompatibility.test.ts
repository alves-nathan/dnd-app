import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import {
  ALL_BACKGROUND_ABILITY_OPTIONS,
  getBackgroundAbilityOptions,
  speciesHasIgnoredAbilityScoreIncrease
} from '../characters/creationData';
import { getBackgroundProficiencyRequirement } from '../characters/proficiencyRules';
import { createEmptyCharacter } from '../data/mockData';

const source = {
  id: 'legacy-origin-test',
  book: 'Legacy Origin Test',
  version: '2022',
  status: 'active' as const,
  confidence: 'exact' as const,
  rulesEra: 'legacy' as const
};

const persisted = buildPersistedCompendiumImport({
  id: 'legacy-origin-pack',
  source,
  items: [
    {
      id: 'astral-drifter-test',
      kind: 'background',
      name: 'Astral Drifter',
      source,
      payload: {
        skillProficiencies: ['Insight', 'Religion'],
        toolProficiencies: [],
        featIds: ['magic-initiate-test']
      }
    },
    {
      id: 'astral-elf-test',
      kind: 'species',
      name: 'Astral Elf',
      source,
      payload: {
        abilityScoreIncreaseRule: {
          modes: [
            { distribution: [2, 1], mustUseDifferentAbilities: true },
            { distribution: [1, 1, 1], mustUseDifferentAbilities: true }
          ],
          abilityOptions: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'],
          maximumScoreAfterIncrease: 20
        }
      }
    },
    {
      id: 'magic-initiate-test',
      kind: 'feat',
      name: 'Magic Initiate',
      source,
      payload: { category: 'Origin' }
    }
  ]
});

const item = (id: string) => persisted.items.find((entry) => entry.importItemId === id)!;

describe('legacy origin compatibility with 2024 creation', () => {
  it('fills missing Astral Drifter ability options and tool proficiency with free choices', () => {
    const background = item('astral-drifter-test');
    expect(getBackgroundAbilityOptions(background)).toEqual(ALL_BACKGROUND_ABILITY_OPTIONS);

    const toolRequirement = getBackgroundProficiencyRequirement(background);
    expect(toolRequirement?.fixedTools).toEqual([]);
    expect(toolRequirement?.toolChoiceCount).toBe(1);
    expect(toolRequirement?.toolChoiceLabel).toContain('qualquer ferramenta');
    expect(toolRequirement?.toolOptions).toEqual(expect.arrayContaining([
      "Smith's Tools",
      "Navigator's Tools",
      'Lute',
      'Dice Set'
    ]));
  });

  it('ignores legacy species Ability Score Increase when the species is applied', () => {
    const species = item('astral-elf-test');
    expect(speciesHasIgnoredAbilityScoreIncrease(species)).toBe(true);

    const base = createEmptyCharacter('Legacy Species Hero');
    const character = {
      ...base,
      abilities: { ...base.abilities, STR: 10, DEX: 14, CON: 12, INT: 8, WIS: 13, CHA: 15 },
      abilityScoreBonuses: { CHA: 2, WIS: 1 }
    };

    const result = applyCompendiumItemToCharacter(character, species);
    expect(result.ok).toBe(true);
    expect(result.character.abilities).toEqual(character.abilities);
    expect(result.character.abilityScoreBonuses).toEqual({ CHA: 2, WIS: 1 });
  });
});
