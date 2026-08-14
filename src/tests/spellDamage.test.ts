import { createDefaultCharacter, defaultCombatState } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { analyzeActionDamage } from '../rules-engine/damage/calculateDamage';
import { SpellAction } from '../types';

describe('spell damage', () => {
  it('calculates cantrip-like scalable formula once imported/resolved', () => {
    const character = createDefaultCharacter();
    const action: SpellAction = {
      id: 's1',
      type: 'spell',
      name: 'Manual cantrip',
      actionCost: 'action',
      sourceType: 'spell',
      spellLevel: 0,
      damage: parseDamageFormula('2d10'),
      targets: 1
    };
    const result = analyzeActionDamage({ action, character, combatState: defaultCombatState });
    expect(result.total.min).toBe(2);
    expect(result.total.max).toBe(20);
    expect(result.total.average).toBe(11);
  });

  it('calculates upcast spell after chosen slot formula is resolved', () => {
    const character = createDefaultCharacter();
    const action: SpellAction = {
      id: 's2',
      type: 'spell',
      name: 'Manual upcast',
      actionCost: 'action',
      sourceType: 'spell',
      spellLevel: 3,
      damage: parseDamageFormula('5d6'),
      targets: 2
    };
    const result = analyzeActionDamage({ action, character, combatState: defaultCombatState });
    expect(result.total.average).toBe(35);
  });
});
