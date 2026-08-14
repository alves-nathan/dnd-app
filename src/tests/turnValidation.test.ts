import { createDefaultCharacter, defaultCombatState } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { analyzeTurnRotation } from '../rules-engine/turns/analyzeTurn';
import { AttackAction, SpellAction, TurnRotation } from '../types';

const attack: AttackAction = {
  id: 'attack',
  type: 'attack',
  name: 'Attack',
  actionCost: 'action',
  sourceType: 'weapon',
  attackAbility: 'STR',
  damage: parseDamageFormula('1d8 + STR'),
  attacksCount: 1
};

const offhand: AttackAction = {
  id: 'offhand',
  type: 'attack',
  name: 'Offhand',
  actionCost: 'bonusAction',
  sourceType: 'weapon',
  attackAbility: 'DEX',
  damage: parseDamageFormula('1d6'),
  attacksCount: 1
};

describe('turn analysis and validation', () => {
  it('calculates turn with action plus bonus action', () => {
    const character = createDefaultCharacter();
    const rotation: TurnRotation = {
      id: 'r1',
      characterId: character.id,
      name: 'Action + bonus',
      actions: [
        { id: 'ta1', name: attack.name, actionCost: 'action', action: attack },
        { id: 'ta2', name: offhand.name, actionCost: 'bonusAction', action: offhand }
      ]
    };
    const result = analyzeTurnRotation(rotation, character, defaultCombatState);
    expect(result.validation.ok).toBe(true);
    expect(result.total.average).toBe(11);
  });

  it('flags action economy conflict', () => {
    const character = createDefaultCharacter();
    const rotation: TurnRotation = {
      id: 'r2',
      characterId: character.id,
      name: 'Two actions',
      actions: [
        { id: 'ta1', name: attack.name, actionCost: 'action', action: attack },
        { id: 'ta2', name: attack.name, actionCost: 'action', action: attack }
      ]
    };
    const result = analyzeTurnRotation(rotation, character, defaultCombatState);
    expect(result.validation.ok).toBe(false);
    expect(result.validation.issues.some((issue) => issue.code === 'ACTION_ECONOMY_CONFLICT')).toBe(true);
  });

  it('flags concentration conflict', () => {
    const character = createDefaultCharacter();
    const spellA: SpellAction = { id: 'c1', type: 'spell', name: 'Concentration A', actionCost: 'action', sourceType: 'spell', damage: parseDamageFormula('1d6'), concentration: true };
    const spellB: SpellAction = { id: 'c2', type: 'spell', name: 'Concentration B', actionCost: 'bonusAction', sourceType: 'spell', damage: parseDamageFormula('1d6'), concentration: true };
    const rotation: TurnRotation = {
      id: 'r3',
      characterId: character.id,
      name: 'Two concentrations',
      actions: [
        { id: 'ta1', name: spellA.name, actionCost: 'action', action: spellA },
        { id: 'ta2', name: spellB.name, actionCost: 'bonusAction', action: spellB }
      ]
    };
    const result = analyzeTurnRotation(rotation, character, defaultCombatState);
    expect(result.validation.issues.some((issue) => issue.code === 'CONCENTRATION_CONFLICT')).toBe(true);
  });

  it('flags once per turn resource conflict', () => {
    const character = createDefaultCharacter();
    const featureAttack: AttackAction = {
      ...attack,
      id: 'once',
      consumes: [{ resourceId: 'sneak-like', amount: 1, label: 'Once per turn damage', oncePerTurnKey: 'once-per-turn-damage' }]
    };
    const rotation: TurnRotation = {
      id: 'r4',
      characterId: character.id,
      name: 'Twice once-per-turn',
      actions: [
        { id: 'ta1', name: featureAttack.name, actionCost: 'action', action: featureAttack },
        { id: 'ta2', name: featureAttack.name, actionCost: 'bonusAction', action: { ...featureAttack, actionCost: 'bonusAction' } }
      ]
    };
    const result = analyzeTurnRotation(rotation, character, defaultCombatState);
    expect(result.validation.issues.some((issue) => issue.code === 'ONCE_PER_TURN_CONFLICT')).toBe(true);
  });
});
