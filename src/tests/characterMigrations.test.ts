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
      expect(character?.buildChoices!.mysticArcanumChoices).toEqual([]);
      expect(character?.buildChoices!.classMetamagicChoices).toEqual([]);
      expect(character?.spellbookEntries).toEqual([]);
      expect(character?.weaponMasteries).toEqual([]);
      expect(character?.spellChangeTransactions).toEqual([]);
      expect(character?.abilityUseTransactions).toEqual([]);
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
    expect(character?.buildChoices?.mysticArcanumChoices).toEqual([]);
    expect(character?.buildChoices?.classMetamagicChoices).toEqual([]);
    expect(character?.proficiencies.skills).toEqual(['Arcana']);
    expect(character?.proficiencies.tools).toEqual([]);
  });

  it('preserves feat-granted invocation and Fighting Style references during normalization', () => {
    const current = createEmptyCharacter('Feat subchoices');
    const partial = {
      ...current,
      featChoices: [{
        id: 'feat-choice',
        featEntityId: 'feat-parent',
        featItemId: 'tcoe-2020-feat-eldritch-adept',
        instanceIndex: 0,
        fightingStyleItemId: 'phb-2024-feat-archery',
        metamagicOptionIds: [
          'feat-option-phb2024-metamagic-careful-spell',
          'feat-option-phb2024-metamagic-careful-spell',
          'feat-option-phb2024-metamagic-distant-spell'
        ],
        maneuverOptionIds: [
          'feat-option-tcoe2020-maneuver-brace',
          'feat-option-phb2024-maneuver-trip-attack'
        ],
        eldritchInvocationItemId: 'phb-2024-feature-warlock-pact-of-the-chain',
        eldritchInvocationChoice: {
          id: 'invocation-choice',
          invocationItemId: 'phb-2024-feature-warlock-pact-of-the-chain',
          instanceIndex: 0,
          familiarCreatureItemId: 'phb-2024-creature-imp',
          familiarVariant: 'special'
        }
      }],
      feats: [{ id: 'nested-style', name: 'Archery', grantedByFeatEntityId: 'feat-parent' }],
      companions: [{
        id: 'feat-familiar',
        name: 'Imp',
        sourceCreatureItemId: 'phb-2024-creature-imp',
        grantedByInvocationItemId: 'phb-2024-feature-warlock-pact-of-the-chain',
        grantedByFeatEntityId: 'feat-parent',
        variant: 'special',
        resources: [],
        activeEffects: [],
        transactions: []
      }],
      resources: [{ id: 'feat-resource', name: 'Feat resource', max: 1, current: 1, recharge: 'longRest', sourceFeatEntityId: 'feat-parent' }]
    } as any;

    const migrated = migrateCharacterStoreState({ characters: [partial] }, CHARACTER_STORE_VERSION).characters?.[0];
    expect(migrated?.featChoices?.[0]).toEqual(expect.objectContaining({
      fightingStyleItemId: 'catalog:phb-2024-feat-archery',
      metamagicOptionIds: [
        'feat-option-phb2024-metamagic-careful-spell',
        'feat-option-phb2024-metamagic-distant-spell'
      ],
      maneuverOptionIds: [
        'feat-option-tcoe2020-maneuver-brace',
        'feat-option-phb2024-maneuver-trip-attack'
      ],
      eldritchInvocationItemId: 'catalog:phb-2024-feature-warlock-pact-of-the-chain',
      eldritchInvocationChoice: expect.objectContaining({
        invocationItemId: 'catalog:phb-2024-feature-warlock-pact-of-the-chain',
        familiarCreatureItemId: 'catalog:phb-2024-creature-imp'
      })
    }));
    expect(migrated?.feats[0]?.grantedByFeatEntityId).toBe('feat-parent');
    expect(migrated?.companions?.[0]?.grantedByFeatEntityId).toBe('feat-parent');
    expect(migrated?.resources[0]?.sourceFeatEntityId).toBe('feat-parent');
  });

  it('keeps v24 -> v25 structural and defers catalog-aware carrier repair', () => {
    const current = createEmptyCharacter('Legacy carrier');
    current.compendiumLinks = [{
      id: 'legacy-class-link',
      characterId: current.id,
      itemId: 'stale-class-carrier',
      importItemId: 'stable-class-id',
      packId: 'legacy-pack',
      sourceId: 'legacy-source',
      itemType: 'class',
      appliedAs: 'class',
      appliedEntityId: current.classes[0]?.id ?? 'legacy-class-entity',
      appliedEntityName: 'Legacy Class',
      status: 'active',
      addedAt: '2026-01-01T00:00:00.000Z'
    }];

    const migrated = migrateCharacterStoreState({ characters: [current] }, 24);

    expect(migrated.characters?.[0]?.compendiumLinks?.[0]).toEqual(expect.objectContaining({
      // The persisted migration is structural only: it must preserve the stale
      // carrier verbatim. Canonical carrier repair belongs to the catalog-aware
      // pass, after the Compendium has hydrated.
      itemId: 'stale-class-carrier',
      choiceId: 'stale-class-carrier',
      importItemId: 'stable-class-id',
      origin: 'compendium',
      catalogEntityId: undefined
    }));
    expect(migrated.catalogAwareReconciliation).toEqual(expect.objectContaining({
      version: 0,
      changedCharacterIds: [],
      repairedLinkCount: 0,
      unresolvedLinkCount: 0
    }));
  });

});
