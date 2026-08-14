import { parseDamageFormula } from '../rules-engine/dice/parser';
import { analyzeTurnRotation } from '../rules-engine/turns/analyzeTurn';
import { applyRest, checkRotationResources, costsFromRotation, spendRotationResources } from '../rules-engine/resources/resourceManager';
import { createDefaultCharacter } from '../data/mockData';
import { AttackAction, ResourcePool, TurnRotation } from '../types';

const limitedAttack = (resourceId: string, amount = 1): AttackAction => ({
  id: 'limited-attack',
  type: 'attack',
  name: 'Limited Attack',
  actionCost: 'action',
  sourceType: 'classFeature',
  attackAbility: 'STR',
  damage: parseDamageFormula('1d8 + STR', { defaultSourceType: 'classFeature' }),
  attacksCount: 1,
  consumes: [{ resourceId, amount, label: 'Limited Use' }]
});

const resource = (current: number): ResourcePool => ({
  id: 'limited-use',
  name: 'Limited Use',
  max: 2,
  current,
  recharge: 'shortRest'
});

describe('resource manager', () => {
  it('collects and validates costs from a rotation', () => {
    const character = { ...createDefaultCharacter('Tester'), resources: [resource(1)] };
    const action = limitedAttack('limited-use');
    const rotation: TurnRotation = {
      id: 'rotation',
      characterId: character.id,
      name: 'Use resource',
      actions: [{ id: 'turn-action', name: action.name, actionCost: action.actionCost, action }]
    };

    expect(costsFromRotation(rotation)).toHaveLength(1);
    expect(checkRotationResources(rotation, character).ok).toBe(true);
  });

  it('marks rotations invalid when the resource is unavailable', () => {
    const character = { ...createDefaultCharacter('Tester'), resources: [resource(0)] };
    const action = limitedAttack('limited-use');
    const rotation: TurnRotation = {
      id: 'rotation',
      characterId: character.id,
      name: 'Use resource',
      actions: [{ id: 'turn-action', name: action.name, actionCost: action.actionCost, action }]
    };

    const result = analyzeTurnRotation(rotation, character, { rollMode: 'normal', targetCount: 1, resistanceMultiplier: 1 });
    expect(result.resourceAvailability.ok).toBe(false);
    expect(result.validation.ok).toBe(false);
  });

  it('spends resources and restores them on the matching rest', () => {
    const character = { ...createDefaultCharacter('Tester'), resources: [resource(2)] };
    const action = limitedAttack('limited-use', 2);
    const rotation: TurnRotation = {
      id: 'rotation',
      characterId: character.id,
      name: 'Use all',
      actions: [{ id: 'turn-action', name: action.name, actionCost: action.actionCost, action }]
    };

    const spent = spendRotationResources(character, rotation);
    expect(spent.character.resources[0].current).toBe(0);
    expect(spent.transactions).toHaveLength(1);

    const rested = applyRest(spent.character, 'shortRest');
    expect(rested.character.resources[0].current).toBe(2);
    expect(rested.transactions).toHaveLength(1);
  });

  it('validates and spends resources owned by a Pact Familiar', () => {
    const base = createDefaultCharacter('Chain Warlock');
    const character = {
      ...base,
      companions: [{
        id: 'familiar',
        name: 'Imp',
        sourceCreatureItemId: 'imp-item',
        grantedByInvocationItemId: 'pact-chain',
        variant: 'special' as const,
        armorClass: 13,
        hitPoints: { current: 10, max: 10 },
        speed: { walk: 20, fly: 40 },
        traits: [],
        actions: [],
        resources: [{ id: 'familiar-sting-use', name: 'Sting use', max: 1, current: 1, recharge: 'longRest' as const }],
        activeEffects: [],
        transactions: [],
        initiative: 'own' as const,
        command: 'bonusAction' as const,
        canAttack: true,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }]
    };
    const action = limitedAttack('familiar-sting-use');
    const rotation: TurnRotation = {
      id: 'familiar-resource-rotation',
      characterId: character.id,
      name: 'Familiar resource',
      actions: [{ id: 'familiar-turn-action', name: action.name, actionCost: action.actionCost, action }]
    };

    expect(checkRotationResources(rotation, character).ok).toBe(true);
    const spent = spendRotationResources(character, rotation);
    expect(spent.character.companions?.[0]?.resources[0]?.current).toBe(0);
    expect(spent.character.companions?.[0]?.transactions.at(-1)?.action).toBe('resourceSpent');
    expect(spent.transactions).toHaveLength(1);

    const rested = applyRest(spent.character, 'longRest');
    expect(rested.character.companions?.[0]?.resources[0]?.current).toBe(1);
    expect(rested.character.companions?.[0]?.transactions.at(-1)?.action).toBe('resourceRecovered');
  });

});
