import { createDefaultCharacter, defaultCombatState } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { analyzeActionDamage } from '../rules-engine/damage/calculateDamage';
import { AttackAction } from '../types';

describe('attack damage', () => {
  it('calculates simple attack', () => {
    const character = createDefaultCharacter();
    const action: AttackAction = {
      id: 'a1',
      type: 'attack',
      name: 'Test',
      actionCost: 'action',
      sourceType: 'weapon',
      attackAbility: 'STR',
      damage: parseDamageFormula('1d8'),
      attacksCount: 1
    };
    const result = analyzeActionDamage({ action, character, combatState: defaultCombatState });
    expect(result.perHit.min).toBe(1);
    expect(result.perHit.max).toBe(8);
    expect(result.perHit.average).toBe(4.5);
  });

  it('calculates attack with ability modifier', () => {
    const character = createDefaultCharacter();
    const action: AttackAction = {
      id: 'a2',
      type: 'attack',
      name: 'Test',
      actionCost: 'action',
      sourceType: 'weapon',
      attackAbility: 'STR',
      damage: parseDamageFormula('1d8 + STR'),
      attacksCount: 1
    };
    const result = analyzeActionDamage({ action, character, combatState: defaultCombatState });
    expect(result.perHit.min).toBe(4);
    expect(result.perHit.max).toBe(11);
    expect(result.perHit.average).toBe(7.5);
  });

  it('calculates multiple attacks', () => {
    const character = createDefaultCharacter();
    const action: AttackAction = {
      id: 'a3',
      type: 'attack',
      name: 'Two attacks',
      actionCost: 'action',
      sourceType: 'weapon',
      attackAbility: 'STR',
      damage: parseDamageFormula('1d8 + STR'),
      attacksCount: 2
    };
    const result = analyzeActionDamage({ action, character, combatState: defaultCombatState });
    expect(result.total.average).toBe(15);
  });

  it('calculates weighted average against AC', () => {
    const character = createDefaultCharacter();
    const action: AttackAction = {
      id: 'a4',
      type: 'attack',
      name: 'AC test',
      actionCost: 'action',
      sourceType: 'weapon',
      attackAbility: 'STR',
      damage: parseDamageFormula('1d8 + STR'),
      attacksCount: 1
    };
    const result = analyzeActionDamage({ action, character, combatState: { ...defaultCombatState, targetAC: 15 } });
    expect(result.hitChance?.hitChance).toBeGreaterThan(0);
    expect(result.weightedAverage).toBeGreaterThan(0);
  });
});
