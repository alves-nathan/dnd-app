import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { annotateLatestSpellWithClass } from '../characters/spellcastingRules';
import { reconcileCharacterBuild } from '../characters/buildReconciliation';
import { createEmptyCharacter } from '../data/mockData';

const source = { id: 'reconcile-source', book: 'Reconcile Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const pack = buildPersistedCompendiumImport({
  id: 'reconcile-pack', source, items: [
    { id: 'bard', kind: 'class', name: 'Bard', source, payload: { level: 1, spellcasting: { progression: 'fullCaster', slotsByLevel: { '1': { '1': 2 } }, cantripsKnownByLevel: [1], preparedSpellsByLevel: [1] } } },
    { id: 'spell-a', kind: 'spell', name: 'Spell A', source, payload: { level: 1, classes: ['Bard'] } },
    { id: 'spell-b', kind: 'spell', name: 'Spell B', source, payload: { level: 1, classes: ['Bard'] } },
    { id: 'wizard', kind: 'class', name: 'Wizard', source, payload: { level: 1, spellcasting: { progression: 'fullCaster', preparationSource: 'spellbook', slotsByLevel: { '1': { '1': 2 } }, cantripsKnownByLevel: [3], preparedSpellsByLevel: [4] } } },
    { id: 'wizard-spell', kind: 'spell', name: 'Wizard Spell', source, payload: { level: 1, classes: ['Wizard'] } },
    { id: 'fire-bolt-homebrew-access', kind: 'spell', name: 'Fire Bolt', source, payload: { level: 0, classes: ['Wizard'], damageFormula: '1d10', damageType: 'fire' } }
  ]
});
const item = (id: string) => pack.items.find((entry) => entry.importItemId === id)!;

describe('build reconciliation', () => {
  it('removes spells above the class limit and persists pending choices', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Bard'), item('bard')).character;
    const classId = character.classes[0]!.id;
    for (const spellId of ['spell-a', 'spell-b']) {
      const before = character;
      const applied = applyCompendiumItemToCharacter(character, item(spellId));
      character = annotateLatestSpellWithClass(before, applied.character, classId, 'Bard');
    }
    const result = reconcileCharacterBuild(character, pack.items);
    expect(result.character.spells).toHaveLength(1);
    expect(result.removedSpellCount).toBeGreaterThanOrEqual(1);
  });

  it('keeps a spell that a custom feature adds to the active class spell list', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Bard'), item('bard')).character;
    const classId = character.classes[0]!.id;
    character = {
      ...character,
      features: [{
        id: 'friendly-fire',
        name: 'Friendly Fire',
        sourceType: 'manual',
        custom: true,
        customRules: {
          spellListAdditions: [{
            id: 'friendly-fire-list',
            spellItemIds: [item('fire-bolt-homebrew-access').id],
            classNames: ['Bard']
          }]
        }
      }]
    };
    const before = character;
    const applied = applyCompendiumItemToCharacter(character, item('fire-bolt-homebrew-access'));
    character = annotateLatestSpellWithClass(before, applied.character, classId, 'Bard');

    const result = reconcileCharacterBuild(character, pack.items);

    expect(result.character.spells.map((spell) => spell.name)).toContain('Fire Bolt');
    expect(result.issues.some((issue) => issue.code === 'SPELLS_REMOVED_BY_CLASS_RECONCILIATION')).toBe(false);
  });

  it('creates a distinct pending spellbook requirement for Wizard', () => {
    const character = applyCompendiumItemToCharacter(createEmptyCharacter('Wizard'), item('wizard')).character;
    const result = reconcileCharacterBuild(character, pack.items);
    const pending = result.character.pendingChoices?.find((choice) => choice.kind === 'spellSelection');
    expect(pending?.description).toContain('6 magia(s) para o spellbook');
    expect(pending?.description).toContain('4 magia(s) preparada(s)');
  });

  it('removes resources, masteries and spells orphaned by a removed feat', () => {
    const character = {
      ...createEmptyCharacter('Orphan cleanup'),
      resources: [{ id: 'feat_free_cast_missing-feat', name: 'Free cast', max: 1, current: 1, recharge: 'longRest' as const }],
      weaponMasteries: [{ id: 'wm-1', sourceKind: 'feat' as const, sourceEntityId: 'missing-feat', weaponName: 'Spear', mastery: 'sap' }],
      spells: [{
        id: 'feat-spell', name: 'Feat Spell', level: 1, castingTime: 'action' as const,
        targeting: { targets: 1 }, grantedByFeatEntityId: 'missing-feat'
      }]
    };
    const result = reconcileCharacterBuild(character, pack.items);
    expect(result.character.resources).toHaveLength(0);
    expect(result.character.weaponMasteries).toHaveLength(0);
    expect(result.character.spells).toHaveLength(0);
  });

});
