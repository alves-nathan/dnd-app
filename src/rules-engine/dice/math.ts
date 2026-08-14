import { DiceTerm } from '../../types';

export const diceMin = (term: DiceTerm): number => term.count;
export const diceMax = (term: DiceTerm): number => term.count * term.sides;

export const dieAverage = (sides: number, rerollLessThanOrEqual?: number): number => {
  if (!rerollLessThanOrEqual || rerollLessThanOrEqual <= 0) return (sides + 1) / 2;
  const threshold = Math.min(rerollLessThanOrEqual, sides);
  const naturalAverage = (sides + 1) / 2;
  let sum = 0;
  for (let roll = 1; roll <= sides; roll += 1) {
    sum += roll <= threshold ? naturalAverage : roll;
  }
  return sum / sides;
};

export const diceAverage = (term: DiceTerm): number => term.count * dieAverage(term.sides, term.rerollLessThanOrEqual);

export interface DiceRange {
  min: number;
  max: number;
  average: number;
}

export const diceRange = (term: DiceTerm): DiceRange => ({
  min: diceMin(term),
  max: diceMax(term),
  average: diceAverage(term)
});
