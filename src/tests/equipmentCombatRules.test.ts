import { createEmptyCharacter, defaultCombatState } from '../data/mockData';
import {
  equipArmor,
  equipWeapon,
  getActiveLoadout,
  getEquippedArmorAccessories,
  toggleArmorAccessory
} from '../characters/equipmentLoadoutRules';
import {
  ammunitionCount,
  checkRotationAmmunition,
  spendRotationAmmunition
} from '../characters/ammunitionRules';
import { getArmorClass } from '../rules-engine/characters/derivedStats';
import { buildAvailableActions, buildWeaponAttackAction } from '../rules-engine/actions/buildActions';
import { analyzeActionDamage } from '../rules-engine/damage/calculateDamage';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import type { Character, TurnRotation, Weapon } from '../types';

const weapon = (overrides: Partial<Weapon> & Pick<Weapon, 'id' | 'name'>): Weapon => ({
  weaponType: 'melee',
  damage: parseDamageFormula('1d8 + STR', { defaultSourceType: 'weapon' }),
  attackAbility: 'STR',
  damageAbility: 'STR',
  handsRequired: 1,
  equipped: false,
  ...overrides
});

const buildCharacter = (): Character => ({
  ...createEmptyCharacter('Equipment test'),
  level: 5,
  classes: [{ id: 'fighter', name: 'Fighter', level: 5, hitDie: 10 }],
  abilities: { STR: 18, DEX: 14, CON: 14, INT: 10, WIS: 10, CHA: 10 }
});

describe('active equipment and combat simulation', () => {
  it('uses only equipped armor, shield and hand configuration for AC and attacks', () => {
    const longsword = weapon({ id: 'longsword', name: 'Longsword' });
    const greatsword = weapon({ id: 'greatsword', name: 'Greatsword', handsRequired: 2, properties: ['Two-Handed'] });
    let character: Character = {
      ...buildCharacter(),
      weapons: [longsword, greatsword],
      armors: [{ id: 'leather', name: 'Leather Armor', baseAC: 11, equipped: false }],
      armorAccessories: [{ id: 'shield', name: 'Shield', baseAC: 0, acBonus: 2, stacksWithArmor: true, armorCategory: 'shield', equipped: false }]
    };

    character = equipArmor(character, 'leather');
    character = equipWeapon(character, 'longsword', 'main').character;
    character = toggleArmorAccessory(character, 'shield').character;

    expect(getArmorClass(character)).toBe(15);
    expect(getEquippedArmorAccessories(character).map((entry) => entry.id)).toEqual(['shield']);
    expect(buildAvailableActions(character).map((entry) => entry.name)).toContain('Longsword');
    expect(buildAvailableActions(character).map((entry) => entry.name)).not.toContain('Greatsword');

    character = equipWeapon(character, 'greatsword', 'main').character;
    expect(getActiveLoadout(character).offHandWeaponId).toBeUndefined();
    expect(getEquippedArmorAccessories(character).map((entry) => entry.id)).toEqual(['shield']);
    expect(getArmorClass(character)).toBe(15);
  });

  it('ignores negative Dexterity only for standard heavy armor and preserves custom caps and shields', () => {
    const base = buildCharacter();
    const cases = [
      { armorCategory: 'heavy', dexCap: 0, expected: [16,16,16] },
      { armorCategory: ' Heavy ', dexCap: 0, expected: [16,16,16] },
      { armorCategory: 'manual', dexCap: 0, expected: [15,16,16] },
      { armorCategory: undefined, dexCap: 0, expected: [15,16,16] },
      { armorCategory: 'heavy', dexCap: 1, expected: [15,16,17] },
      { armorCategory: 'heavy', dexCap: undefined, expected: [15,16,20] },
      { armorCategory: 'medium', dexCap: 2, expected: [15,16,18] },
      { armorCategory: 'light', dexCap: undefined, expected: [15,16,20] }
    ];
    for (const {expected,...configuration} of cases) {
      for (const [index,dex] of [8,10,18].entries()) {
        let character: Character = {...base,abilities:{...base.abilities,DEX:dex},
          armors:[{id:'armor',name:'Fixture armor',baseAC:16,equipped:false,...configuration}],
          armorAccessories:[{id:'shield',name:'Shield',baseAC:0,acBonus:2,stacksWithArmor:true,armorCategory:'shield',equipped:false}]};
        character=equipArmor(character,'armor');
        const before=JSON.stringify(character);
        expect(getArmorClass(character)).toBe(expected[index]);
        expect(JSON.stringify(character)).toBe(before);
        character=toggleArmorAccessory(character,'shield').character;
        expect(getArmorClass(character)).toBe(expected[index]+2);
      }
    }
  });

  it('tracks, validates and spends ammunition for a rotation', () => {
    const bow = weapon({
      id: 'shortbow',
      name: 'Shortbow',
      weaponType: 'ranged',
      damage: parseDamageFormula('1d6 + DEX', { defaultSourceType: 'weapon' }),
      attackAbility: 'DEX',
      damageAbility: 'DEX',
      range: { normal: 80, long: 320, unit: 'ft' },
      ammunitionType: 'arrow',
      ammunitionPerAttack: 1,
      attacksCount: 2,
      equipped: true
    });
    const character: Character = {
      ...buildCharacter(),
      weapons: [bow],
      equipment: [{ id: 'arrows', name: 'Arrows', quantity: 2, ammunitionType: 'arrow', tags: ['ammunition'] }],
      buildChoices: {
        ...buildCharacter().buildChoices!,
        activeLoadout: { explicit: true, mainHandWeaponId: bow.id, armorAccessoryIds: [] }
      }
    };
    const action = buildWeaponAttackAction(character, bow.id)!;
    const rotation: TurnRotation = {
      id: 'bow-turn',
      characterId: character.id,
      name: 'Two arrows',
      actions: [{ id: 'bow-action', name: action.name, actionCost: action.actionCost, action }]
    };

    expect(checkRotationAmmunition(rotation, character).ok).toBe(true);
    const spent = spendRotationAmmunition(character, rotation);
    expect(ammunitionCount(spent, 'arrow')).toBe(0);
    expect(checkRotationAmmunition({ ...rotation, actions: [{ ...rotation.actions[0]!, repeat: 2 }] }, character).ok).toBe(false);
  });

  it('applies long-range disadvantage and blocks attacks outside maximum range', () => {
    const crossbow = weapon({
      id: 'crossbow',
      name: 'Light Crossbow',
      weaponType: 'ranged',
      damage: parseDamageFormula('1d8 + DEX', { defaultSourceType: 'weapon' }),
      attackAbility: 'DEX',
      damageAbility: 'DEX',
      range: { normal: 80, long: 320, unit: 'ft' },
      ammunitionType: 'bolt',
      equipped: true
    });
    const character: Character = { ...buildCharacter(), weapons: [crossbow] };
    const action = buildWeaponAttackAction(character, crossbow.id)!;
    const normal = analyzeActionDamage({ action, character, combatState: { ...defaultCombatState, targetAC: 15, targetDistanceFeet: 60 } });
    const long = analyzeActionDamage({ action, character, combatState: { ...defaultCombatState, targetAC: 15, targetDistanceFeet: 160 } });
    const invalid = analyzeActionDamage({ action, character, combatState: { ...defaultCombatState, targetAC: 15, targetDistanceFeet: 400 } });

    expect(long.warnings.some((entry) => entry.code === 'TARGET_AT_LONG_RANGE')).toBe(true);
    expect(long.weightedAverage!).toBeLessThan(normal.weightedAverage!);
    expect(invalid.warnings.some((entry) => entry.code === 'TARGET_OUT_OF_RANGE')).toBe(true);
    expect(invalid.weightedAverage).toBe(0);
  });

  it('applies selected Weapon Mastery rules and creates the Nick attack', () => {
    const grazeWeapon = weapon({ id: 'graze-sword', name: 'Graze Sword', mastery: 'Graze', equipped: true });
    const grazeCharacter: Character = {
      ...buildCharacter(),
      weapons: [grazeWeapon],
      weaponMasteries: [{ id: 'mastery-graze', sourceKind: 'manual', weaponName: grazeWeapon.name, mastery: 'Graze' }]
    };
    const withGraze = buildWeaponAttackAction(grazeCharacter, grazeWeapon.id)!;
    const withoutGraze = buildWeaponAttackAction({ ...grazeCharacter, weaponMasteries: [] }, grazeWeapon.id)!;
    const state = { ...defaultCombatState, targetAC: 25, targetDistanceFeet: 5 };
    const grazeResult = analyzeActionDamage({ action: withGraze, character: grazeCharacter, combatState: state });
    const normalResult = analyzeActionDamage({ action: withoutGraze, character: grazeCharacter, combatState: state });

    expect(withGraze.mastery?.property).toBe('graze');
    expect(grazeResult.masteryEffects?.some((entry) => entry.includes('Graze'))).toBe(true);
    expect(grazeResult.weightedAverage!).toBeGreaterThan(normalResult.weightedAverage!);

    const scimitar = weapon({ id: 'nick-scimitar', name: 'Scimitar', properties: ['Light'], mastery: 'Nick', equipped: true });
    const shortsword = weapon({ id: 'light-shortsword', name: 'Shortsword', properties: ['Light'], equipped: true });
    const nickCharacter: Character = {
      ...buildCharacter(),
      weapons: [scimitar, shortsword],
      weaponMasteries: [{ id: 'mastery-nick', sourceKind: 'manual', weaponName: scimitar.name, mastery: 'Nick' }],
      buildChoices: {
        ...buildCharacter().buildChoices!,
        activeLoadout: { explicit: true, mainHandWeaponId: scimitar.id, offHandWeaponId: shortsword.id, armorAccessoryIds: [] }
      }
    };
    const nickAction = buildAvailableActions(nickCharacter).find((entry) => entry.name.includes('Nick'));
    expect(nickAction?.actionCost).toBe('free');
  });

  it('checks target size for Push mastery', () => {
    const pike = weapon({ id: 'push-pike', name: 'Pike', mastery: 'Push', equipped: true });
    const character: Character = {
      ...buildCharacter(),
      weapons: [pike],
      weaponMasteries: [{ id: 'mastery-push', sourceKind: 'manual', weaponName: pike.name, mastery: 'Push' }]
    };
    const action = buildWeaponAttackAction(character, pike.id)!;
    const result = analyzeActionDamage({ action, character, combatState: { ...defaultCombatState, targetAC: 15, targetSize: 'Huge' } });
    expect(result.warnings.some((entry) => entry.code === 'WEAPON_MASTERY_TARGET_TOO_LARGE')).toBe(true);
    expect(result.masteryEffects).toContain('Push indisponível para o tamanho atual do alvo.');
  });
});
