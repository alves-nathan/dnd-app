import { HitChanceResult, RollMode } from '../../types';

interface D20Outcome {
  roll: number;
  probability: number;
}

const normalOutcomes = (): D20Outcome[] => Array.from({ length: 20 }, (_, i) => ({ roll: i + 1, probability: 1 / 20 }));

const pairedOutcomes = (mode: Exclude<RollMode, 'normal'>): D20Outcome[] => {
  const counts = new Map<number, number>();
  for (let a = 1; a <= 20; a += 1) {
    for (let b = 1; b <= 20; b += 1) {
      const roll = mode === 'advantage' ? Math.max(a, b) : Math.min(a, b);
      counts.set(roll, (counts.get(roll) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).map(([roll, count]) => ({ roll, probability: count / 400 }));
};

const getOutcomes = (mode: RollMode): D20Outcome[] => (mode === 'normal' ? normalOutcomes() : pairedOutcomes(mode));

export const calculateHitChance = (params: {
  attackBonus: number;
  targetAC: number;
  rollMode: RollMode;
  critRange?: number;
  criticalGuaranteed?: boolean;
  /** A successful hit becomes critical; the attack can still miss. */
  criticalOnHit?: boolean;
}): HitChanceResult => {
  if (params.criticalGuaranteed) {
    return { hitChance: 1, critChance: 1, normalHitChance: 0 };
  }

  const critRange = params.critRange ?? 20;
  let hitChance = 0;
  let critChance = 0;

  for (const outcome of getOutcomes(params.rollMode)) {
    const natural = outcome.roll;
    const isCrit = params.criticalOnHit === true || natural >= critRange;
    const isAutoMiss = natural === 1;
    const isAutoHit = natural === 20;
    const hitsByAC = natural + params.attackBonus >= params.targetAC;
    const hits = !isAutoMiss && (isAutoHit || hitsByAC);

    if (hits) hitChance += outcome.probability;
    if (hits && isCrit) critChance += outcome.probability;
  }

  return {
    hitChance,
    critChance,
    normalHitChance: Math.max(0, hitChance - critChance)
  };
};
