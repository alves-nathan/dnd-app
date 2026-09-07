import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  applyClassFeatureChoiceAlternativesToFeatRequirements,
  getClassFeatureChoiceProficiencyGrants,
  getSpellAffectingClassFeatureChoiceRequirements,
  setClassFeatureChoiceOption,
  validateClassFeatureChoices
} from '../characters/classFeatureChoiceRules';

const items = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-15T00:00:00.000Z'
  }).items
);

const findClass = (name: string): StoredCompendiumItem => {
  const item = items.find((candidate) => candidate.type === 'class' && candidate.name === name);
  if (!item) throw new Error(`Classe ausente: ${name}`);
  return item;
};

describe('spell-affecting class feature choices', () => {
  it('requires Divine Order and Primal Order choices while exposing their spell-bearing options', () => {
    const cleric = findClass('Cleric');
    const druid = findClass('Druid');
    const requirements = getSpellAffectingClassFeatureChoiceRequirements([
      { item: cleric, level: 1 },
      { item: druid, level: 1 }
    ], items);

    const divineOrder = requirements.find((entry) => entry.featureName === 'Divine Order');
    const primalOrder = requirements.find((entry) => entry.featureName === 'Primal Order');
    expect(divineOrder).toMatchObject({ required: true });
    expect(divineOrder?.options.map((option) => option.id)).toEqual(['protector', 'thaumaturge']);
    expect(divineOrder?.options.find((option) => option.id === 'thaumaturge')?.activatesBonusSpellChoice).toBe(true);
    expect(primalOrder?.options.map((option) => option.id)).toEqual(['magician', 'warden']);
    expect(validateClassFeatureChoices(requirements, [])).toHaveLength(2);

    let choices = setClassFeatureChoiceOption([], divineOrder!, 'thaumaturge');
    choices = setClassFeatureChoiceOption(choices, primalOrder!, 'magician');
    expect(validateClassFeatureChoices(requirements, choices)).toEqual([]);
    expect(getClassFeatureChoiceProficiencyGrants(requirements, choices)).toEqual({ weapons: [], armor: [] });

    choices = setClassFeatureChoiceOption(choices, divineOrder!, 'protector');
    choices = setClassFeatureChoiceOption(choices, primalOrder!, 'warden');
    expect(getClassFeatureChoiceProficiencyGrants(requirements, choices)).toEqual({ weapons: ['martial'], armor: ['heavy', 'medium'] });
  });

  it('models Blessed Warrior and Druidic Warrior as optional Fighting Style alternatives', () => {
    const paladin = findClass('Paladin');
    const ranger = findClass('Ranger');
    const requirements = getSpellAffectingClassFeatureChoiceRequirements([
      { item: paladin, level: 2 },
      { item: ranger, level: 2 }
    ], items);

    const blessed = requirements.find((entry) => entry.options.some((option) => option.id === 'blessed-warrior'))!;
    const druidic = requirements.find((entry) => entry.options.some((option) => option.id === 'druidic-warrior'))!;
    expect(blessed).toMatchObject({ required: false, alternateFeatCategory: 'fightingStyle' });
    expect(druidic).toMatchObject({ required: false, alternateFeatCategory: 'fightingStyle' });
    expect(validateClassFeatureChoices(requirements, [])).toEqual([]);

    const choices = setClassFeatureChoiceOption([], blessed, 'blessed-warrior');
    expect(applyClassFeatureChoiceAlternativesToFeatRequirements(
      { fightingStyle: 1, general: 0, epicBoon: 0 },
      requirements,
      choices
    ).fightingStyle).toBe(0);
  });
});
