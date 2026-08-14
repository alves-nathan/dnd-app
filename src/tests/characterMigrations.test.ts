import { createEmptyCharacter } from '../data/mockData';
import {
  CHARACTER_STORE_VERSION,
  ensureCharacterCollections,
  migrateCharacterStoreState
} from '../storage/characterMigrations';

describe('explicit character store migrations', () => {
  const legacyCharacter = {
    ...createEmptyCharacter('Legacy'),
    proficiencies: undefined,
    abilityScoreBonuses: undefined,
    featChoices: undefined,
    buildChoices: undefined,
    pendingChoices: undefined,
    spellbookEntries: undefined,
    weaponMasteries: undefined,
    spellChangeTransactions: undefined,
    currency: undefined
  } as unknown;

  for (let version = 0; version <= CHARACTER_STORE_VERSION; version += 1) {
    it(`migrates version ${version} to the current complete shape`, () => {
      const migrated = migrateCharacterStoreState({ characters: [legacyCharacter] }, version);
      const character = migrated.characters?.[0];
      expect(character?.proficiencies.skills).toEqual([]);
      expect(character?.buildChoices!.speciesChoices).toEqual([]);
      expect(character?.buildChoices!.subclassChoices).toEqual([]);
      expect(character?.buildChoices!.spellAssignments).toEqual({});
      expect(character?.buildChoices!.spellbookAssignments).toEqual({});
      expect(character?.buildChoices!.eldritchInvocationCounts).toEqual({});
      expect(character?.buildChoices!.eldritchInvocationChoices).toEqual([]);
      expect(character?.spellbookEntries).toEqual([]);
      expect(character?.weaponMasteries).toEqual([]);
      expect(character?.spellChangeTransactions).toEqual([]);
      expect(character?.currency).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
    });
  }

  it('is idempotent for current characters', () => {
    const current = ensureCharacterCollections(createEmptyCharacter('Current'));
    const once = migrateCharacterStoreState({ characters: [current] }, CHARACTER_STORE_VERSION);
    const twice = migrateCharacterStoreState(once, CHARACTER_STORE_VERSION);
    expect(twice).toEqual(once);
  });
  it('deeply normalizes partially persisted build choices and collections', () => {
    const partial = {
      ...createEmptyCharacter('Partial'),
      classes: undefined,
      spells: undefined,
      buildChoices: { spellAssignments: { spellA: 'wizard' } },
      proficiencies: { skills: ['Arcana'] }
    } as unknown;

    const migrated = migrateCharacterStoreState({ characters: [partial] }, 8);
    const character = migrated.characters?.[0];

    expect(character?.classes).toEqual([]);
    expect(character?.spells).toEqual([]);
    expect(character?.buildChoices?.speciesChoices).toEqual([]);
    expect(character?.buildChoices?.subclassChoices).toEqual([]);
    expect(character?.buildChoices?.classSkillChoices).toEqual([]);
    expect(character?.buildChoices?.spellAssignments).toEqual({ spellA: 'wizard' });
    expect(character?.buildChoices?.spellbookAssignments).toEqual({});
    expect(character?.buildChoices?.eldritchInvocationCounts).toEqual({});
    expect(character?.buildChoices?.eldritchInvocationChoices).toEqual([]);
    expect(character?.proficiencies.skills).toEqual(['Arcana']);
    expect(character?.proficiencies.tools).toEqual([]);
  });

});
