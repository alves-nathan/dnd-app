import type { AbilityGenerationState, AbilityScore, AbilityScores } from '../types';

export type GeneratedAbilityAssignments = Partial<Record<AbilityScore, number>>;

export const ABILITY_ORDER: AbilityScore[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export const abilityScoresFromValues = (values: number[]): AbilityScores => ({
  STR: values[0] ?? 10, DEX: values[1] ?? 10, CON: values[2] ?? 10,
  INT: values[3] ?? 10, WIS: values[4] ?? 10, CHA: values[5] ?? 10
});


export const emptyAbilityScores = (value = 10): AbilityScores => ({
  STR: value, DEX: value, CON: value, INT: value, WIS: value, CHA: value
});

export const toggleGeneratedAbilityAssignment = (
  assignments: GeneratedAbilityAssignments,
  ability: AbilityScore,
  valueIndex: number
): GeneratedAbilityAssignments => {
  const currentIndex = assignments[ability];
  if (currentIndex === valueIndex) {
    const next = { ...assignments };
    delete next[ability];
    return next;
  }
  if (ABILITY_ORDER.some((entry) => entry !== ability && assignments[entry] === valueIndex)) {
    return assignments;
  }
  return { ...assignments, [ability]: valueIndex };
};

export const isGeneratedValueAssignedElsewhere = (
  assignments: GeneratedAbilityAssignments,
  ability: AbilityScore,
  valueIndex: number
): boolean => ABILITY_ORDER.some((entry) => entry !== ability && assignments[entry] === valueIndex);

export const areGeneratedAbilitiesFullyAssigned = (
  assignments: GeneratedAbilityAssignments,
  generatedValues: number[]
): boolean => {
  const indexes = ABILITY_ORDER.map((ability) => assignments[ability]);
  return indexes.every((index) => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < generatedValues.length)
    && new Set(indexes).size === ABILITY_ORDER.length;
};

export const abilityScoresFromGeneratedAssignments = (
  generatedValues: number[],
  assignments: GeneratedAbilityAssignments,
  fallback = 10
): AbilityScores => ABILITY_ORDER.reduce((scores, ability) => {
  const index = assignments[ability];
  scores[ability] = typeof index === 'number' && generatedValues[index] !== undefined
    ? generatedValues[index]!
    : fallback;
  return scores;
}, emptyAbilityScores(fallback));

export const inferGeneratedAbilityAssignments = (
  generatedValues: number[],
  scores: AbilityScores
): GeneratedAbilityAssignments => {
  const used = new Set<number>();
  const result: GeneratedAbilityAssignments = {};
  for (const ability of ABILITY_ORDER) {
    const index = generatedValues.findIndex((value, candidateIndex) => !used.has(candidateIndex) && value === scores[ability]);
    if (index >= 0) {
      result[ability] = index;
      used.add(index);
    }
  }
  return result;
};

export const pointBuySpent = (scores: AbilityScores): number =>
  ABILITY_ORDER.reduce((sum, ability) => sum + (POINT_BUY_COST[scores[ability]] ?? Number.POSITIVE_INFINITY), 0);

export const isValidPointBuy = (scores: AbilityScores): boolean => {
  const values = ABILITY_ORDER.map((ability) => scores[ability]);
  return values.every((value) => value >= POINT_BUY_MIN && value <= POINT_BUY_MAX && Number.isInteger(value)) && pointBuySpent(scores) <= POINT_BUY_BUDGET;
};

export const rollFourDropLowest = (random: () => number = Math.random) => {
  const rolls = Array.from({ length: 4 }, () => Math.floor(random() * 6) + 1).sort((a, b) => a - b);
  const [discarded, ...kept] = rolls;
  return { rolls, discarded, total: kept.reduce((sum, value) => sum + value, 0) };
};

export const rollAbilitySet = (random: () => number = Math.random): AbilityGenerationState => {
  const diceRolls = Array.from({ length: 6 }, () => rollFourDropLowest(random));
  return { method: 'diceRoll', generatedValues: diceRolls.map((entry) => entry.total), diceRolls };
};

export const standardArrayState = (): AbilityGenerationState => ({ method: 'standardArray', generatedValues: [...STANDARD_ARRAY] });
export const pointBuyState = (): AbilityGenerationState => ({ method: 'pointBuy', generatedValues: [8, 8, 8, 8, 8, 8], pointBuyBudget: POINT_BUY_BUDGET, pointBuySpent: 0 });
