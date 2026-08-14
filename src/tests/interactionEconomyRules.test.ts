import { createEmptyCharacter } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { buildAvailableActions, buildWeaponAttackAction } from '../rules-engine/actions/buildActions';
import { validateTurnRotation } from '../rules-engine/turns/validateTurn';
import type { Character, SpellAction, TurnRotation, Weapon } from '../types';

const weapon = (id: string, name: string, overrides: Partial<Weapon> = {}): Weapon => ({
  id,
  name,
  weaponType: 'melee',
  damage: parseDamageFormula('1d8 + STR', { defaultSourceType: 'weapon' }),
  attackAbility: 'STR',
  damageAbility: 'STR',
  quantity: 1,
  equipped: false,
  handsRequired: 1,
  properties: [],
  ...overrides
});

const fighter = (level: number): Character => {
  const sword = weapon('sword', 'Longsword', {
    properties: ['versatile'],
    versatileDamage: parseDamageFormula('1d10 + STR', { defaultSourceType: 'weapon' })
  });
  const axe = weapon('axe', 'Battleaxe');
  return {
    ...createEmptyCharacter(`Fighter ${level}`),
    level,
    classes: [{ id: 'fighter-class', name: 'Fighter', level, hitDie: 10 }],
    weapons: [sword, axe],
    buildChoices: {
      ...createEmptyCharacter().buildChoices!,
      activeLoadout: { explicit: true, mainHandWeaponId: sword.id, armorAccessoryIds: [] }
    }
  };
};

const rotation = (character: Character, actions: TurnRotation['actions']): TurnRotation => ({
  id: 'rotation',
  characterId: character.id,
  name: 'Interaction rotation',
  actions
});

describe('PHB 2024 interaction economy', () => {
  it('allows a level 5 fighter to stow and draw between two attacks', () => {
    const character = fighter(5);
    const sword = buildWeaponAttackAction(character, 'sword')!;
    const axe = buildWeaponAttackAction(character, 'axe')!;
    const result = validateTurnRotation(rotation(character, [
      { id: 'a1', name: sword.name, actionCost: 'action', action: sword, attackCountOverride: 1, weaponOperation: { kind: 'stow', timing: 'after', weaponId: 'sword' } },
      { id: 'a2', name: axe.name, actionCost: 'action', action: axe, attackCountOverride: 1, weaponOperation: { kind: 'draw', timing: 'before', weaponId: 'axe', hand: 'main' } }
    ]), character);
    expect(result.ok).toBe(true);
  });

  it('blocks attacks above the Attack action capacity', () => {
    const character = fighter(1);
    const sword = buildWeaponAttackAction(character, 'sword')!;
    const axe = buildWeaponAttackAction(character, 'axe')!;
    const result = validateTurnRotation(rotation(character, [
      { id: 'a1', name: sword.name, actionCost: 'action', action: sword, attackCountOverride: 1, weaponOperation: { kind: 'stow', timing: 'after', weaponId: 'sword' } },
      { id: 'a2', name: axe.name, actionCost: 'action', action: axe, attackCountOverride: 1, weaponOperation: { kind: 'draw', timing: 'before', weaponId: 'axe' } }
    ]), character);
    expect(result.issues.some((issue) => issue.code === 'ATTACK_ACTION_CAPACITY_EXCEEDED')).toBe(true);
  });

  it('builds one-handed and two-handed Versatile variants', () => {
    const character = fighter(5);
    const actions = buildAvailableActions(character, { includeStowedWeapons: true }).filter((entry) => entry.type === 'attack' && entry.weaponId === 'sword');
    expect(actions.some((entry) => entry.type === 'attack' && entry.weaponGrip === 'oneHanded' && entry.damage.raw.includes('1d8'))).toBe(true);
    expect(actions.some((entry) => entry.type === 'attack' && entry.weaponGrip === 'twoHanded' && entry.damage.raw.includes('1d10'))).toBe(true);
  });

  it('validates Two-Handed only when the attack is made', () => {
    const greatsword = weapon('greatsword', 'Greatsword', { handsRequired: 2, properties: ['two-handed'] });
    const character: Character = {
      ...fighter(5),
      weapons: [greatsword],
      armorAccessories: [{ id: 'shield', name: 'Shield', baseAC: 0, acBonus: 2, armorCategory: 'shield', stacksWithArmor: true, equipped: true }],
      buildChoices: {
        ...fighter(5).buildChoices!,
        activeLoadout: { explicit: true, mainHandWeaponId: greatsword.id, armorAccessoryIds: ['shield'] }
      }
    };
    const action = buildWeaponAttackAction(character, greatsword.id)!;
    const result = validateTurnRotation(rotation(character, [{ id: 'a1', name: action.name, actionCost: 'action', action }]), character);
    expect(result.issues.some((issue) => issue.code === 'TWO_HANDED_ATTACK_HAND_BLOCKED')).toBe(true);
  });

  it('applies Loading per action unless Crossbow Expert ignores it', () => {
    const crossbow = weapon('crossbow', 'Light Crossbow', {
      weaponType: 'ranged',
      attackAbility: 'DEX',
      damageAbility: 'DEX',
      properties: ['ammunition', 'loading', 'two-handed'],
      handsRequired: 2,
      ammunitionType: 'bolt'
    });
    const base: Character = {
      ...fighter(5),
      weapons: [crossbow],
      equipment: [{ id: 'bolts', name: 'Bolts', quantity: 20, ammunitionType: 'bolt' }],
      buildChoices: { ...fighter(5).buildChoices!, activeLoadout: { explicit: true, mainHandWeaponId: crossbow.id, armorAccessoryIds: [] } }
    };
    const action = buildWeaponAttackAction(base, crossbow.id)!;
    const blocked = validateTurnRotation(rotation(base, [{ id: 'a1', name: action.name, actionCost: 'action', action, attackCountOverride: 2 }]), base);
    expect(blocked.issues.some((issue) => issue.code === 'LOADING_ATTACK_LIMIT')).toBe(true);
    const expert = { ...base, feats: [{ id: 'crossbow-expert', name: 'Crossbow Expert' }] };
    const allowed = validateTurnRotation(rotation(expert, [{ id: 'a1', name: action.name, actionCost: 'action', action, attackCountOverride: 2 }]), expert);
    expect(allowed.issues.some((issue) => issue.code === 'LOADING_ATTACK_LIMIT')).toBe(false);
  });

  it('blocks somatic casting with weapon and shield, then allows War Caster', () => {
    const sword = weapon('sword', 'Longsword');
    const spell: SpellAction = {
      id: 'shield-spell', type: 'spell', name: 'Somatic spell', actionCost: 'action', sourceType: 'spell',
      components: { verbal: false, somatic: true, material: false }
    };
    const base: Character = {
      ...fighter(1),
      weapons: [sword],
      armorAccessories: [{ id: 'shield', name: 'Shield', baseAC: 0, acBonus: 2, armorCategory: 'shield', stacksWithArmor: true, equipped: true }],
      buildChoices: { ...fighter(1).buildChoices!, activeLoadout: { explicit: true, mainHandWeaponId: sword.id, armorAccessoryIds: ['shield'] } }
    };
    const blocked = validateTurnRotation(rotation(base, [{ id: 's1', name: spell.name, actionCost: 'action', action: spell }]), base);
    expect(blocked.issues.some((issue) => issue.code === 'SPELL_SOMATIC_HAND_UNAVAILABLE')).toBe(true);
    const warCaster = { ...base, feats: [{ id: 'war-caster', name: 'War Caster' }] };
    const allowed = validateTurnRotation(rotation(warCaster, [{ id: 's1', name: spell.name, actionCost: 'action', action: spell }]), warCaster);
    expect(allowed.issues.some((issue) => issue.code === 'SPELL_SOMATIC_HAND_UNAVAILABLE')).toBe(false);
  });

  it('uses a held arcane focus for material and somatic components', () => {
    const spell: SpellAction = {
      id: 'material-spell', type: 'spell', name: 'Material spell', actionCost: 'action', sourceType: 'spell',
      components: { verbal: true, somatic: true, material: true }, spellcastingClassName: 'Wizard'
    };
    const character: Character = {
      ...fighter(1),
      weapons: [],
      equipment: [{ id: 'orb', name: 'Arcane Focus (orb)', quantity: 1, spellcastingFocus: true, spellcastingFocusKind: 'arcane', focusRequiresHand: true, materialComponent: true }],
      buildChoices: { ...fighter(1).buildChoices!, activeLoadout: { explicit: true, heldFocusEquipmentId: 'orb', armorAccessoryIds: [] } }
    };
    const result = validateTurnRotation(rotation(character, [{ id: 's1', name: spell.name, actionCost: 'action', action: spell }]), character);
    expect(result.issues.some((issue) => issue.code.startsWith('SPELL_'))).toBe(false);
  });


  it('uses explicit Extra Attack capacity from imported or homebrew features', () => {
    const character: Character = {
      ...fighter(1),
      classes: [{ id: 'homebrew-class', name: 'Custom Martial Class', level: 5 }],
      features: [{
        id: 'custom-extra-attack',
        name: 'Custom Extra Attack',
        sourceType: 'classFeature',
        attackActionAttackCount: 2
      }]
    };
    const sword = buildWeaponAttackAction(character, 'sword')!;
    const result = validateTurnRotation(rotation(character, [{
      id: 'a1',
      name: sword.name,
      actionCost: 'action',
      action: sword,
      attackCountOverride: 2
    }]), character);
    expect(result.issues.some((issue) => issue.code === 'ATTACK_ACTION_CAPACITY_EXCEEDED')).toBe(false);
  });

  it('requires a compatible focus or component pouch for non-costly material components', () => {
    const spell: SpellAction = {
      id: 'material-only-spell', type: 'spell', name: 'Material-only spell', actionCost: 'action', sourceType: 'spell',
      components: { verbal: true, somatic: false, material: true, materialDescription: 'a pinch of sand' },
      materialDescription: 'a pinch of sand',
      spellcastingClassName: 'Wizard'
    };
    const character: Character = {
      ...fighter(1),
      weapons: [],
      equipment: [],
      buildChoices: { ...fighter(1).buildChoices!, activeLoadout: { explicit: true, armorAccessoryIds: [] } }
    };
    const blocked = validateTurnRotation(rotation(character, [{ id: 's1', name: spell.name, actionCost: 'action', action: spell }]), character);
    expect(blocked.issues.some((issue) => issue.code === 'SPELL_MATERIAL_COMPONENT_UNAVAILABLE')).toBe(true);

    const withPouch: Character = {
      ...character,
      equipment: [{ id: 'pouch', name: 'Component Pouch', quantity: 1, spellcastingFocus: true, spellcastingFocusKind: 'componentPouch', focusRequiresHand: false, materialComponent: true }]
    };
    const allowed = validateTurnRotation(rotation(withPouch, [{ id: 's1', name: spell.name, actionCost: 'action', action: spell }]), withPouch);
    expect(allowed.issues.some((issue) => issue.code === 'SPELL_MATERIAL_COMPONENT_UNAVAILABLE')).toBe(false);
  });

  it('does not let a focus replace a costly material component', () => {
    const spell: SpellAction = {
      id: 'costly-material-spell', type: 'spell', name: 'Costly spell', actionCost: 'action', sourceType: 'spell',
      components: { verbal: true, somatic: true, material: true, materialDescription: 'a diamond worth 300 GP' },
      materialDescription: 'a diamond worth 300 GP',
      spellcastingClassName: 'Wizard'
    };
    const character: Character = {
      ...fighter(1),
      weapons: [],
      equipment: [{ id: 'orb', name: 'Arcane Focus (orb)', quantity: 1, spellcastingFocus: true, spellcastingFocusKind: 'arcane', focusRequiresHand: true, materialComponent: true }],
      buildChoices: { ...fighter(1).buildChoices!, activeLoadout: { explicit: true, heldFocusEquipmentId: 'orb', armorAccessoryIds: [] } }
    };
    const result = validateTurnRotation(rotation(character, [{ id: 's1', name: spell.name, actionCost: 'action', action: spell }]), character);
    expect(result.issues.some((issue) => issue.code === 'SPELL_COSTLY_MATERIAL_MISSING')).toBe(true);
  });

  it('auto-draws a stowed Thrown weapon as part of the attack', () => {
    const javelin = weapon('javelin', 'Javelin', { properties: ['thrown'], range: { normal: 30, long: 120, unit: 'ft' }, quantity: 2 });
    const character: Character = {
      ...fighter(1),
      weapons: [javelin],
      buildChoices: { ...fighter(1).buildChoices!, activeLoadout: { explicit: true, armorAccessoryIds: [] } }
    };
    const action = buildWeaponAttackAction(character, javelin.id)!;
    const result = validateTurnRotation(rotation(character, [{ id: 'a1', name: action.name, actionCost: 'action', action }]), character);
    expect(result.issues.some((issue) => issue.code === 'ROTATION_WEAPON_NOT_HELD')).toBe(false);
  });
});
