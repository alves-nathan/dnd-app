import {
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  abilityScoresFromGeneratedAssignments,
  abilityScoresFromValues,
  areGeneratedAbilitiesFullyAssigned,
  isGeneratedValueAssignedElsewhere,
  isValidPointBuy,
  pointBuySpent,
  rollFourDropLowest,
  standardArrayState,
  toggleGeneratedAbilityAssignment
} from '../characters/abilityGeneration';

describe('ability generation', () => {
  it('provides the standard array', () => expect(standardArrayState().generatedValues).toEqual([...STANDARD_ARRAY]));

  it('validates point buy within the 27 point budget', () => {
    const scores = abilityScoresFromValues([15, 15, 15, 8, 8, 8]);
    expect(pointBuySpent(scores)).toBe(POINT_BUY_BUDGET);
    expect(isValidPointBuy(scores)).toBe(true);
  });

  it('rolls four dice and discards the lowest', () => {
    const values = [0, 0.2, 0.5, 0.99];
    let index = 0;
    const result = rollFourDropLowest(() => values[index++] ?? 0);
    expect(result.rolls).toEqual([1, 2, 4, 6]);
    expect(result.discarded).toBe(1);
    expect(result.total).toBe(12);
  });

  it('starts generated assignment separately from the generated pool and toggles a value off', () => {
    const generatedValues = [15, 14, 13, 12, 10, 8];
    const selected = toggleGeneratedAbilityAssignment({}, 'STR', 0);
    expect(selected).toEqual({ STR: 0 });
    expect(abilityScoresFromGeneratedAssignments(generatedValues, selected).STR).toBe(15);
    expect(toggleGeneratedAbilityAssignment(selected, 'STR', 0)).toEqual({});
  });

  it('prevents one generated result from being assigned to two abilities', () => {
    const selected = toggleGeneratedAbilityAssignment({}, 'STR', 0);
    expect(isGeneratedValueAssignedElsewhere(selected, 'DEX', 0)).toBe(true);
    expect(toggleGeneratedAbilityAssignment(selected, 'DEX', 0)).toBe(selected);
  });

  it('treats duplicate rolled totals as separate generated results by index', () => {
    let selected = toggleGeneratedAbilityAssignment({}, 'STR', 0);
    selected = toggleGeneratedAbilityAssignment(selected, 'DEX', 1);
    expect(selected).toEqual({ STR: 0, DEX: 1 });
    expect(abilityScoresFromGeneratedAssignments([15, 15, 13, 12, 10, 8], selected)).toEqual(expect.objectContaining({ STR: 15, DEX: 15 }));
  });

  it('requires all six unique generated results before generated assignment is complete', () => {
    const partial = { STR: 0, DEX: 1, CON: 2, INT: 3, WIS: 4 } as const;
    expect(areGeneratedAbilitiesFullyAssigned(partial, [15, 14, 13, 12, 10, 8])).toBe(false);
    expect(areGeneratedAbilitiesFullyAssigned({ ...partial, CHA: 5 }, [15, 14, 13, 12, 10, 8])).toBe(true);
  });
});
