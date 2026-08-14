import { createDefaultCharacter, defaultCombatState } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { compareRotationsForScenario, createCombatScenario, summarizeResources } from '../rules-engine/turns/compareRotations';
import { AttackAction, TurnRotation } from '../types';

const makeAttack = (id: string, formula: string, attacksCount = 1): AttackAction => ({
  id,
  type: 'attack',
  name: id,
  actionCost: 'action',
  sourceType: 'weapon',
  attackAbility: 'STR',
  damage: parseDamageFormula(formula),
  attacksCount
});

describe('rotation comparison', () => {
  it('identifies the best rotation by raw average', () => {
    const character = createDefaultCharacter();
    const weak: TurnRotation = {
      id: 'weak',
      characterId: character.id,
      name: 'Weak',
      actions: [{ id: 'ta1', name: 'weak', actionCost: 'action', action: makeAttack('weak', '1d4') }]
    };
    const strong: TurnRotation = {
      id: 'strong',
      characterId: character.id,
      name: 'Strong',
      actions: [{ id: 'ta2', name: 'strong', actionCost: 'action', action: makeAttack('strong', '1d12 + STR') }]
    };
    const scenario = createCombatScenario({ characterId: character.id, name: 'No AC', combatState: defaultCombatState, id: 'scenario', now: '2026-01-01T00:00:00.000Z' });

    const result = compareRotationsForScenario([weak, strong], character, scenario);

    expect(result.bestByAverageRotationId).toBe('strong');
    expect(result.rows.find((row) => row.rotationId === 'strong')?.total.average).toBeGreaterThan(
      result.rows.find((row) => row.rotationId === 'weak')?.total.average ?? 0
    );
  });

  it('calculates weighted averages when target AC exists', () => {
    const character = createDefaultCharacter();
    const rotation: TurnRotation = {
      id: 'r1',
      characterId: character.id,
      name: 'Attack AC',
      actions: [{ id: 'ta1', name: 'attack', actionCost: 'action', action: makeAttack('attack', '1d8 + STR') }]
    };
    const scenario = createCombatScenario({ characterId: character.id, name: 'AC 15', combatState: { ...defaultCombatState, targetAC: 15 }, id: 'scenario', now: '2026-01-01T00:00:00.000Z' });

    const result = compareRotationsForScenario([rotation], character, scenario);

    expect(result.rows[0]?.weightedAverage).toBeGreaterThan(0);
    expect(result.bestByWeightedAverageRotationId).toBe('r1');
  });

  it('summarizes resources consumed by label and once-per-turn keys', () => {
    const resources = summarizeResources([
      { resourceId: 'slot-1', amount: 1, label: 'Slot 1' },
      { resourceId: 'slot-1', amount: 1, label: 'Slot 1' },
      { resourceId: 'sneak', amount: 1, label: 'Sneak', oncePerTurnKey: 'sneak-attack' }
    ]);

    expect(resources.find((item) => item.resourceId === 'slot-1')?.amount).toBe(2);
    expect(resources.find((item) => item.resourceId === 'sneak')?.oncePerTurnKeys).toContain('sneak-attack');
  });
});
