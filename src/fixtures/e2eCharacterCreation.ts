import type { CompendiumImportInput } from '../compendium/schemas';

const source = {
  id: 'e2e-character-creation-source',
  book: 'E2E character creation fixture',
  page: 'fixture',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const
};

/** Minimal deterministic content used only by development E2E flows. */
export const e2eCharacterCreationFixture: CompendiumImportInput = {
  id: 'e2e-character-creation-pack-v1',
  source,
  items: [
    {
      id: 'e2e-adventurer',
      kind: 'class',
      name: 'E2E Adventurer',
      source,
      payload: {
        level: 1,
        hitDie: 8,
        savingThrowProficiencies: ['CON', 'WIS'],
        skillChoiceCount: 0,
        progression: []
      }
    },
    {
      id: 'e2e-human',
      kind: 'species',
      name: 'E2E Human',
      source,
      payload: { speed: 30, size: 'Medium', featureIds: [] }
    },
    {
      id: 'e2e-wanderer',
      kind: 'background',
      name: 'E2E Wanderer',
      source,
      payload: {
        abilityScoreOptions: ['STR', 'DEX', 'CON'],
        featIds: ['e2e-alert'],
        skillProficiencies: [],
        toolProficiencies: [],
        equipmentOptions: []
      }
    },
    {
      id: 'e2e-alert',
      kind: 'feat',
      name: 'E2E Alert',
      source,
      payload: { category: 'origin', repeatable: false }
    }
  ]
};
