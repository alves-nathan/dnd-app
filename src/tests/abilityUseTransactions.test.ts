import { createEmptyCharacter } from '../data/mockData';
import { applyAbilityUse, undoAbilityUse } from '../rules-engine/abilities/abilityUseTransactions';
import type { Character } from '../types';

const character = (): Character => ({
  ...createEmptyCharacter('Ability Tx'),
  resources: [
    { id: 'bardic-inspiration', name: 'Bardic Inspiration', max: 4, current: 2, recharge: 'longRest' },
    { id: 'focus', name: 'Focus Points', max: 3, current: 1, recharge: 'shortRest' }
  ],
  spellSlots: [{ id: 'slot-3', level: 3, max: 2, current: 1, recharge: 'longRest', poolKind: 'spellcasting' }]
});

describe('ability use transactions', () => {
  it('spends multiple declared costs atomically and records one grouped use', () => {
    const original = character();
    const result = applyAbilityUse(original, {
      id: 'combo', name: 'Combo', actionCost: 'bonusAction',
      resourceCosts: [
        { resourceId: 'bardic-inspiration', amount: 1 },
        { resourceId: 'focus', amount: 1 }
      ]
    });

    expect(result.issues).toEqual([]);
    expect(result.character.resources.find((entry) => entry.id === 'bardic-inspiration')?.current).toBe(1);
    expect(result.character.resources.find((entry) => entry.id === 'focus')?.current).toBe(0);
    expect(result.transaction).toEqual(expect.objectContaining({ abilityId: 'combo', status: 'applied' }));
    expect(result.transaction?.resourceChanges).toHaveLength(2);
    expect(result.character.abilityUseTransactions).toHaveLength(1);
  });

  it('does not partially spend when any cost is unavailable', () => {
    const original = character();
    const result = applyAbilityUse(original, {
      id: 'too-expensive', name: 'Too Expensive',
      resourceCosts: [
        { resourceId: 'bardic-inspiration', amount: 1 },
        { resourceId: 'focus', amount: 2 }
      ]
    });

    expect(result.issues.some((entry) => entry.code === 'RESOURCE_UNAVAILABLE')).toBe(true);
    expect(result.character).toBe(original);
    expect(result.character.resources.map((entry) => entry.current)).toEqual([2, 1]);
  });

  it('can combine resource and spell-slot costs in the same atomic use', () => {
    const result = applyAbilityUse(character(), {
      id: 'hybrid', name: 'Hybrid',
      resourceCosts: [{ resourceId: 'bardic-inspiration', amount: 1 }],
      spellSlotCosts: [{ slotLevel: 3, amount: 1, poolKind: 'spellcasting' }]
    });

    expect(result.issues).toEqual([]);
    expect(result.character.resources.find((entry) => entry.id === 'bardic-inspiration')?.current).toBe(1);
    expect(result.character.spellSlots[0]?.current).toBe(0);
    expect(result.transaction?.spellSlotChanges).toHaveLength(1);
  });

  it('undoes only the latest clean ability use and records normal inverse resource transactions', () => {
    const used = applyAbilityUse(character(), {
      id: 'mantle', name: 'Mantle of Inspiration',
      resourceCosts: [{ resourceId: 'bardic-inspiration', amount: 1 }]
    });
    const undone = undoAbilityUse(used.character, used.transaction?.id);

    expect(undone.issues).toEqual([]);
    expect(undone.character.resources.find((entry) => entry.id === 'bardic-inspiration')?.current).toBe(2);
    expect(undone.character.abilityUseTransactions?.[0]?.status).toBe('undone');
    expect(undone.character.resourceTransactions?.at(-1)?.reason).toContain('Desfazer habilidade');
  });

  it('refuses undo after the affected pool changed independently', () => {
    const used = applyAbilityUse(character(), {
      id: 'mantle', name: 'Mantle of Inspiration',
      resourceCosts: [{ resourceId: 'bardic-inspiration', amount: 1 }]
    });
    const changed = {
      ...used.character,
      resources: used.character.resources.map((entry) => entry.id === 'bardic-inspiration' ? { ...entry, current: 0 } : entry)
    };
    const undone = undoAbilityUse(changed);

    expect(undone.issues.some((entry) => entry.code === 'ABILITY_UNDO_CONFLICT')).toBe(true);
    expect(undone.character.resources.find((entry) => entry.id === 'bardic-inspiration')?.current).toBe(0);
  });
});
