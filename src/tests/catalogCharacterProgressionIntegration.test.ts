import { normalizeCharacterChoiceReference } from '../catalog/characterChoiceBridge';
import { ensureCharacterCollections, migrateCharacterStoreState, CHARACTER_STORE_VERSION } from '../storage/characterMigrations';
import { createEmptyCharacter } from '../data/mockData';

const legacyItemId = 'phb-pack:phb-2024-class-wizard';

describe('APP-03 progression compatibility', () => {
  it('normalizes legacy official IDs into namespaced catalog choices', () => {
    expect(normalizeCharacterChoiceReference(legacyItemId)).toBe('catalog:phb-2024-class-wizard');
    expect(normalizeCharacterChoiceReference('homebrew-pack:class-savant')).toBe('compendium:homebrew-pack:class-savant');

    const character = createEmptyCharacter('Legacy');
    const normalized = ensureCharacterCollections({
      ...character,
      compendiumLinks: [{
        id: 'link', characterId: character.id, itemId: legacyItemId, importItemId: 'phb-2024-class-wizard', packId: 'phb-pack',
        sourceId: 'phb-2024', itemType: 'class', appliedAs: 'class', appliedEntityId: 'class-1', appliedEntityName: 'Wizard',
        status: 'active', addedAt: '2026-01-01T00:00:00.000Z'
      }, {
        id: 'link-local', characterId: character.id, itemId: 'homebrew-pack:class-savant', importItemId: 'class-savant', packId: 'homebrew-pack',
        sourceId: 'homebrew', itemType: 'class', appliedAs: 'class', appliedEntityId: 'class-2', appliedEntityName: 'Savant',
        status: 'active', addedAt: '2026-01-01T00:00:00.000Z'
      }],
      buildChoices: {
        speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [],
        spellAssignments: { 'phb-pack:phb-2024-spell-magic-missile': legacyItemId },
        spellbookAssignments: {}, equipmentSelections: [], eldritchInvocationCounts: {}
      }
    });

    expect(normalized.compendiumLinks?.[0]?.itemId).toBe('catalog:phb-2024-class-wizard');
    expect(normalized.compendiumLinks?.[0]?.origin).toBe('catalog');
    expect(normalized.compendiumLinks?.[1]?.itemId).toBe('compendium:homebrew-pack:class-savant');
    expect(normalized.compendiumLinks?.[1]?.origin).toBe('compendium');
    expect(normalized.buildChoices?.spellAssignments).toEqual({
      'catalog:phb-2024-spell-magic-missile': 'catalog:phb-2024-class-wizard'
    });
  });

  it('advances the persisted store migration boundary', () => {
    const migrated = migrateCharacterStoreState({ characters: [createEmptyCharacter('Migration')] }, 19);
    expect(CHARACTER_STORE_VERSION).toBeGreaterThanOrEqual(21);
    expect(migrated.characters).toHaveLength(1);
  });
});
