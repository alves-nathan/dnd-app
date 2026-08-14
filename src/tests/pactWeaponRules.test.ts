import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createEmptyCharacter } from '../data/mockData';
import { applyEldritchInvocationSelection } from '../characters/eldritchInvocationSelection';
import { setPactWeapon, validatePactWeaponChoice } from '../characters/pactWeaponRules';
import { buildWeaponAttackAction } from '../rules-engine/actions/buildActions';

const source = { id: 'blade-source', book: 'Blade Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const imported = buildPersistedCompendiumImport({
  id: 'blade-pack', source, items: [
    { id: 'warlock', kind: 'class', name: 'Warlock', source, payload: { level: 5 } },
    { id: 'pact-blade', kind: 'feature', name: 'Pact of the Blade', source, payload: { sourceType: 'eldritchInvocation', classId: 'warlock', levelGained: 1, engineKey: 'warlock.pact-of-the-blade' } },
    { id: 'thirsting-blade', kind: 'feature', name: 'Thirsting Blade', source, payload: { sourceType: 'eldritchInvocation', classId: 'warlock', levelGained: 5 } },
    { id: 'magic-longsword', kind: 'weapon', name: 'Magic Longsword', source, payload: { weaponType: 'melee', damageFormula: '1d8 + STR', attackAbility: 'STR', damageAbility: 'STR', magicBonus: 2 } }
  ]
});
const item = (id: string) => imported.items.find((entry) => entry.importItemId === id)!;

describe('Pact Weapon rules and damage action', () => {
  it('conjures a weapon and uses CHA, magic bonus, and Thirsting Blade attacks', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Blade Warlock'), item('warlock')).character;
    character = { ...character, abilities: { ...character.abilities, CHA: 18, STR: 8 } };
    character = applyEldritchInvocationSelection(character, {
      [item('pact-blade').id]: 1,
      [item('thirsting-blade').id]: 1
    }, imported.items).character;
    const result = setPactWeapon(character, {
      mode: 'conjured',
      sourceWeaponItemId: item('magic-longsword').id,
      damageType: 'radiant'
    }, imported.items);
    expect(result.issues).toEqual([]);
    expect(validatePactWeaponChoice(result.character, imported.items)).toEqual([]);
    const pactWeapon = result.character.weapons.find((weapon) => weapon.pactWeapon)!;
    const action = buildWeaponAttackAction(result.character, pactWeapon.id)!;
    expect(action.attackAbility).toBe('CHA');
    expect(action.attackBonusExtra).toBe(2);
    expect(action.attacksCount).toBe(2);
    expect(action.damage.components.some((component) => component.kind === 'abilityModifier' && component.ability === 'CHA')).toBe(true);
    expect(action.damage.components.some((component) => component.kind === 'flat' && component.value === 2)).toBe(true);
    expect(action.tags).toEqual(expect.arrayContaining(['pact-weapon', 'damage-type:radiant']));
  });
});
