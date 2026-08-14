import { createDefaultCharacter, defaultCombatState } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { addActiveEffectToCharacter, advanceActiveEffects, buildCombatStateWithActiveEffects, getActiveConcentrationEffect } from '../rules-engine/effects/activeEffects';
import { analyzeActionDamage } from '../rules-engine/damage/calculateDamage';
import { validateTurnRotation } from '../rules-engine/turns/validateTurn';
import { ActiveEffect, TurnRotation } from '../types';

const effect = (id: string, name: string, conditionIds: string[] = [], concentration = false): ActiveEffect => ({
  id,
  name,
  kind: 'spell',
  sourceType: 'spell',
  status: 'active',
  concentration,
  conditionIds,
  duration: { unit: 'round', remaining: 2, expiresOn: 'turnStart' },
  createdAt: '2026-07-11T00:00:00.000Z'
});

describe('active effects and concentration', () => {
  it('activates conditional damage through active effect condition ids', () => {
    const character = addActiveEffectToCharacter(createDefaultCharacter('Marked'), effect('mark-effect', 'Mark', ['marked'], true));
    const formula = parseDamageFormula('1d8 + STR', { defaultSourceType: 'weapon' });
    formula.components.push({
      id: 'conditional-die',
      kind: 'dice',
      operation: 'add',
      dice: { count: 1, sides: 6 },
      sourceType: 'spell',
      application: 'conditional',
      condition: { id: 'marked', label: 'Marked target', requiresConcentration: true },
      criticalBehavior: 'doubleDice',
      label: 'Marked damage'
    });
    const action = {
      id: 'attack-marked',
      type: 'attack' as const,
      name: 'Marked Strike',
      actionCost: 'action' as const,
      sourceType: 'weapon' as const,
      damage: formula,
      attacksCount: 1
    };

    const result = analyzeActionDamage({ action, character, combatState: buildCombatStateWithActiveEffects(character, defaultCombatState) });
    expect(result.conditioned.average).toBe(3.5);
  });

  it('replaces previous concentration when a new concentration effect starts', () => {
    const first = addActiveEffectToCharacter(createDefaultCharacter('Caster'), effect('hex', 'Hex', ['hex'], true));
    const second = addActiveEffectToCharacter(first, effect('mark', 'Hunter Mark', ['mark'], true));

    expect(getActiveConcentrationEffect(second)?.name).toBe('Hunter Mark');
    expect(second.activeEffects.some((item) => item.name === 'Hex')).toBe(false);
  });

  it('ticks duration and expires active effects at turn start', () => {
    const character = addActiveEffectToCharacter(createDefaultCharacter('Timed'), { ...effect('short', 'One round'), duration: { unit: 'round', remaining: 1 } });
    const advanced = advanceActiveEffects(character, 'turnStart');

    expect(advanced.activeEffects.length).toBe(0);
    expect(advanced.activeEffectTransactions?.some((entry) => entry.action === 'expired')).toBe(true);
  });

  it('blocks casting a new concentration spell while concentrating', () => {
    const character = addActiveEffectToCharacter(createDefaultCharacter('Caster'), effect('hex', 'Hex', ['hex'], true));
    const action = {
      id: 'spell-concentration',
      type: 'spell' as const,
      name: 'Another Concentration Spell',
      actionCost: 'action' as const,
      sourceType: 'spell' as const,
      concentration: true,
      damage: parseDamageFormula('1d6', { defaultSourceType: 'spell' })
    };
    const rotation: TurnRotation = {
      id: 'rotation-concentration',
      characterId: character.id,
      name: 'Concentration conflict',
      actions: [{ id: 'turn-concentration', name: action.name, actionCost: 'action', action }]
    };

    const validation = validateTurnRotation(rotation, character, buildCombatStateWithActiveEffects(character, defaultCombatState));
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((issue) => issue.code === 'CONCENTRATION_CONFLICT')).toBe(true);
  });
});
