import { createDefaultCharacter } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { analyzeTurnRotation } from '../rules-engine/turns/analyzeTurn';
import { adjustSpellSlot, checkRotationSpellSlots, spendRotationSpellSlots } from '../rules-engine/resources/spellSlotManager';
import { defaultCombatState } from '../data/mockData';
import { Spell, TurnRotation } from '../types';

describe('spell slot manager', () => {
  it('validates selected spell slot availability', () => {
    const character = { ...createDefaultCharacter('Caster'), spellSlots: [{ level: 1 as const, max: 2, current: 1, recharge: 'longRest' as const }] };
    const action = {
      id: 'spell_test',
      type: 'spell' as const,
      name: 'Slot Spell',
      actionCost: 'action' as const,
      sourceType: 'spell' as const,
      spellId: 'spell_1',
      spellLevel: 1,
      minimumSlotLevel: 1 as const,
      castAtSlotLevel: 1 as const,
      consumesSpellSlot: true,
      damage: parseDamageFormula('2d6', { defaultSourceType: 'spell' })
    };
    const rotation: TurnRotation = {
      id: 'rotation-slot',
      characterId: character.id,
      name: 'Cast once',
      actions: [{ id: 'turn-slot', name: action.name, actionCost: 'action', action, selectedSpellSlotLevel: 1 }]
    };

    expect(checkRotationSpellSlots(rotation, character).ok).toBe(true);
    const spent = spendRotationSpellSlots(character, rotation).character;
    expect(spent.spellSlots[0].current).toBe(0);
  });

  it('blocks a slot lower than the spell minimum', () => {
    const character = { ...createDefaultCharacter('Caster'), spellSlots: [{ level: 1 as const, max: 1, current: 1, recharge: 'longRest' as const }] };
    const action = {
      id: 'spell_test_2',
      type: 'spell' as const,
      name: 'Higher Spell',
      actionCost: 'action' as const,
      sourceType: 'spell' as const,
      spellId: 'spell_2',
      spellLevel: 2,
      minimumSlotLevel: 2 as const,
      castAtSlotLevel: 2 as const,
      consumesSpellSlot: true,
      damage: parseDamageFormula('3d6', { defaultSourceType: 'spell' })
    };
    const rotation: TurnRotation = {
      id: 'rotation-slot-low',
      characterId: character.id,
      name: 'Invalid slot',
      actions: [{ id: 'turn-slot-low', name: action.name, actionCost: 'action', action, selectedSpellSlotLevel: 1 }]
    };

    const result = checkRotationSpellSlots(rotation, character);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'SPELL_SLOT_TOO_LOW')).toBe(true);
  });

  it('uses selected slot level to resolve upcast damage', () => {
    const character = { ...createDefaultCharacter('Caster'), spellSlots: [{ level: 3 as const, max: 1, current: 1, recharge: 'longRest' as const }] };
    const spell: Spell = {
      id: 'upcast_spell',
      name: 'Upcast Spell',
      level: 1,
      castingTime: 'action',
      damage: parseDamageFormula('2d6', { defaultSourceType: 'spell' }),
      scaling: {
        kind: 'slotLevel',
        steps: [
          { slotLevel: 1, formula: parseDamageFormula('2d6', { defaultSourceType: 'spell' }) },
          { slotLevel: 3, formula: parseDamageFormula('4d6', { defaultSourceType: 'spell' }) }
        ]
      }
    };
    const withSpell = { ...character, spells: [spell] };
    const action = {
      id: 'spell_upcast_spell',
      type: 'spell' as const,
      name: spell.name,
      actionCost: 'action' as const,
      sourceType: 'spell' as const,
      spellId: spell.id,
      spellLevel: 1,
      minimumSlotLevel: 1 as const,
      castAtSlotLevel: 1 as const,
      consumesSpellSlot: true,
      damage: spell.damage
    };
    const rotation: TurnRotation = {
      id: 'rotation-upcast',
      characterId: withSpell.id,
      name: 'Upcast',
      actions: [{ id: 'turn-upcast', name: action.name, actionCost: 'action', action, selectedSpellSlotLevel: 3 }]
    };

    const analysis = analyzeTurnRotation(rotation, withSpell, defaultCombatState);
    expect(analysis.actions[0].formula).toBe('4d6');
    expect(analysis.total.average).toBe(14);
    expect(analysis.spellSlotAvailability.ok).toBe(true);
  });

  it('keeps regular and Pact Magic pools separate at the same slot level', () => {
    const character = {
      ...createDefaultCharacter('Pact multicaster'),
      spellSlots: [
        { id: 'regular-1', level: 1 as const, max: 2, current: 2, recharge: 'longRest' as const, poolKind: 'spellcasting' as const },
        { id: 'pact-1', level: 1 as const, max: 1, current: 1, recharge: 'shortRest' as const, poolKind: 'pactMagic' as const, sourceClassId: 'warlock-class' }
      ]
    };
    const regularSpent = adjustSpellSlot({ character, slotLevel: 1, delta: -1, reason: 'regular first' }).character;
    expect(regularSpent.spellSlots.find((slot) => slot.poolKind === 'spellcasting')?.current).toBe(1);
    expect(regularSpent.spellSlots.find((slot) => slot.poolKind === 'pactMagic')?.current).toBe(1);
    const pactSpent = adjustSpellSlot({ character, slotLevel: 1, delta: -1, reason: 'pact only', poolKind: 'pactMagic', sourceClassId: 'warlock-class' }).character;
    expect(pactSpent.spellSlots.find((slot) => slot.poolKind === 'spellcasting')?.current).toBe(2);
    expect(pactSpent.spellSlots.find((slot) => slot.poolKind === 'pactMagic')?.current).toBe(0);
  });

});
