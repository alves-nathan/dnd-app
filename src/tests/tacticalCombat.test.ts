import { createEmptyCharacter, defaultCombatState } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { createCombatScenario } from '../rules-engine/turns/compareRotations';
import {
  advanceScenarioToNextSourceTurn,
  combatStateForTarget,
  consumeTargetAttack,
  createTacticalTarget,
  effectiveTargetSpeed,
  recoverAutomaticBattlefieldItems,
  recoverBattlefieldItem,
  resolveTacticalRotation,
  spendRotationThrownWeapons
} from '../rules-engine/turns/tacticalCombat';
import type { AttackAction, Character, TacticalActionResolution, TurnRotation, WeaponMasteryApplication } from '../types';

const masteryAttack = (id: string, mastery: WeaponMasteryApplication): AttackAction => ({
  id,
  type: 'attack',
  name: id,
  actionCost: 'action',
  sourceType: 'weapon',
  attackAbility: 'STR',
  damage: parseDamageFormula('1d8 + STR'),
  attacksCount: 1,
  mastery
});

const scenarioFor = (characterId: string) => {
  const scenario = createCombatScenario({
    id: 'scenario',
    characterId,
    name: 'Arena',
    combatState: { ...defaultCombatState, targetAC: 15 },
    now: '2026-01-01T00:00:00.000Z'
  });
  return {
    ...scenario,
    actorPositionFeet: 0,
    actorSpeedFeet: 30,
    difficultTerrain: true,
    round: 1,
    targets: [createTacticalTarget({ id: 'target', name: 'Ogre', armorClass: 15, positionFeet: 30, speedFeet: 40, size: 'Large' })],
    battlefieldItems: [],
    tacticalLog: []
  };
};

describe('persistent tactical combat', () => {
  it('tracks movement cost in difficult terrain and uses the target distance after movement', () => {
    const character = createEmptyCharacter('Mover');
    const action = masteryAttack('spear', { property: 'sap', label: 'Sap', description: 'Sap' });
    action.range = { normal: 20, long: 60, unit: 'ft' };
    const rotation: TurnRotation = {
      id: 'move-turn',
      characterId: character.id,
      name: 'Approach',
      actions: [{ id: 'move-action', name: 'Approach and attack', actionCost: 'action', action, targetId: 'target', movement: { kind: 'approach', distanceFeet: 15, targetId: 'target' } }]
    };

    const result = resolveTacticalRotation({ character, rotation, scenario: scenarioFor(character.id), resolutions: [{ actionId: 'move-action', targetId: 'target', confirmedHits: 0 }] });

    expect(result.movement.movementSpentFeet).toBe(30);
    expect(result.movement.finalPositionFeet).toBe(15);
    expect(combatStateForTarget(result.scenario, 'target').targetDistanceFeet).toBe(15);
    expect(result.issues).toHaveLength(0);
  });

  it('persists Sap, Slow, Topple, Vex and forced movement with their correct continuity', () => {
    const character = createEmptyCharacter('Master');
    const actions = [
      masteryAttack('sap', { property: 'sap', label: 'Sap', description: 'Disadvantage' }),
      masteryAttack('slow', { property: 'slow', label: 'Slow', description: '-10 Speed' }),
      masteryAttack('topple', { property: 'topple', label: 'Topple', description: 'Prone', saveDC: 15 }),
      masteryAttack('vex', { property: 'vex', label: 'Vex', description: 'Advantage' }),
      masteryAttack('push', { property: 'push', label: 'Push', description: 'Push 10', forcedMovementFt: 10, maxTargetSize: 'Large' })
    ];
    const rotation: TurnRotation = {
      id: 'mastery-turn',
      characterId: character.id,
      name: 'Masteries',
      actions: actions.map((action, index) => ({ id: `ta-${index}`, name: action.name, actionCost: 'action', action, targetId: 'target' }))
    };
    const resolutions: TacticalActionResolution[] = rotation.actions.map((entry) => ({
      actionId: entry.id,
      targetId: 'target',
      confirmedHits: 1,
      toppleSave: entry.action.type === 'attack' && entry.action.mastery?.property === 'topple' ? 'failure' : 'pending'
    }));

    const result = resolveTacticalRotation({ character, rotation, scenario: scenarioFor(character.id), resolutions });
    const target = result.scenario.targets![0]!;

    expect(target.effects.map((entry) => entry.kind)).toEqual(expect.arrayContaining(['sap', 'slow', 'prone']));
    expect(result.effects.some((entry) => entry.kind === 'vex' && entry.applied)).toBe(true);
    expect(target.effects.some((entry) => entry.kind === 'vex')).toBe(false);
    expect(target.conditions).toContain('prone');
    expect(effectiveTargetSpeed(target)).toBe(30);
    expect(target.positionFeet).toBe(40);
    expect(combatStateForTarget(result.scenario, target.id).rollMode).toBe('disadvantage');

    const afterTargetAttack = consumeTargetAttack(result.scenario, target.id);
    expect(afterTargetAttack.targets![0]!.effects.some((entry) => entry.kind === 'sap')).toBe(false);

    const afterNextTurn = advanceScenarioToNextSourceTurn(afterTargetAttack);
    expect(afterNextTurn.targets![0]!.effects.some((entry) => entry.kind === 'slow')).toBe(false);
    expect(afterNextTurn.targets![0]!.effects.some((entry) => entry.kind === 'prone')).toBe(true);
  });

  it('records and recovers ammunition and thrown weapons separately', () => {
    const thrown = {
      id: 'handaxe',
      name: 'Handaxe',
      weaponType: 'thrown' as const,
      damage: parseDamageFormula('1d6 + STR'),
      quantity: 2,
      thrownWeapon: true
    };
    const character: Character = {
      ...createEmptyCharacter('Thrower'),
      weapons: [thrown],
      equipment: [{ id: 'arrows', name: 'Arrows', quantity: 5, ammunitionType: 'arrow' }]
    };
    const thrownAction: AttackAction = {
      id: 'throw', type: 'attack', name: 'Throw', actionCost: 'action', sourceType: 'weapon', weaponId: thrown.id,
      attackAbility: 'STR', damage: thrown.damage, attacksCount: 1, thrownWeapon: true
    };
    const bowAction: AttackAction = {
      id: 'bow', type: 'attack', name: 'Bow', actionCost: 'action', sourceType: 'weapon', attackAbility: 'DEX',
      damage: parseDamageFormula('1d6 + DEX'), attacksCount: 2, ammunitionType: 'arrow', ammunitionPerAttack: 1
    };
    const rotation: TurnRotation = {
      id: 'projectiles', characterId: character.id, name: 'Projectiles',
      actions: [
        { id: 'throw-action', name: 'Throw', actionCost: 'action', action: thrownAction, targetId: 'target' },
        { id: 'bow-action', name: 'Bow', actionCost: 'action', action: bowAction, targetId: 'target' }
      ]
    };

    const resolved = resolveTacticalRotation({ character, rotation, scenario: scenarioFor(character.id) });
    expect(resolved.battlefieldItems.map((entry) => entry.kind)).toEqual(expect.arrayContaining(['ammunition', 'thrownWeapon']));
    const spent = spendRotationThrownWeapons(character, rotation);
    expect(spent.weapons[0]?.quantity).toBe(1);

    const thrownItem = resolved.scenario.battlefieldItems!.find((entry) => entry.kind === 'thrownWeapon')!;
    const recoveredThrown = recoverBattlefieldItem({ character: spent, scenario: resolved.scenario, battlefieldItemId: thrownItem.id });
    expect(recoveredThrown.recovered).toBe(1);
    expect(recoveredThrown.character.weapons[0]?.quantity).toBe(2);

    const ammoItem = recoveredThrown.scenario.battlefieldItems!.find((entry) => entry.kind === 'ammunition')!;
    const recoveredAmmo = recoverBattlefieldItem({ character: recoveredThrown.character, scenario: recoveredThrown.scenario, battlefieldItemId: ammoItem.id });
    expect(recoveredAmmo.recovered).toBe(1);
    expect(recoveredAmmo.lost).toBe(1);
    expect(recoveredAmmo.character.equipment.find((entry) => entry.ammunitionType === 'arrow')?.quantity).toBe(6);
  });

  it('resolves only battlefield items configured for automatic recovery', () => {
    const character = createEmptyCharacter('Recovery');
    const scenario = {
      ...scenarioFor(character.id),
      battlefieldItems: [
        { id: 'auto', kind: 'ammunition' as const, label: 'Arrows', quantity: 4, ammunitionType: 'arrow', recoverable: true, recoveryMode: 'automatic' as const, recoveryPercent: 50, createdRound: 1 },
        { id: 'manual', kind: 'ammunition' as const, label: 'Bolts', quantity: 2, ammunitionType: 'bolt', recoverable: true, recoveryMode: 'manual' as const, recoveryPercent: 50, createdRound: 1 }
      ]
    };
    const result = recoverAutomaticBattlefieldItems({ character, scenario });
    expect(result.recovered).toBe(2);
    expect(result.scenario.battlefieldItems?.map((entry) => entry.id)).toEqual(['manual']);
    expect(result.character.equipment.find((entry) => entry.ammunitionType === 'arrow')?.quantity).toBe(2);
  });
});
