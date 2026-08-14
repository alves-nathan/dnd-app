import { diceAverage, diceMax, diceMin } from '../rules-engine/dice/math';

describe('dice math', () => {
  it('calculates min max average for 2d6', () => {
    const term = { count: 2, sides: 6 };
    expect(diceMin(term)).toBe(2);
    expect(diceMax(term)).toBe(12);
    expect(diceAverage(term)).toBe(7);
  });

  it('calculates reroll-once average', () => {
    expect(diceAverage({ count: 1, sides: 6, rerollLessThanOrEqual: 2 })).toBeCloseTo(4.1666, 3);
  });
});
