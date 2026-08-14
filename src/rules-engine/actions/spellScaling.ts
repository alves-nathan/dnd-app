import { Character, DamageFormula, Spell } from '../../types';

const highestMatchingStep = <T extends { minCharacterLevel?: number; slotLevel?: number }>(steps: T[], predicate: (step: T) => boolean, rank: (step: T) => number): T | undefined =>
  steps.filter(predicate).sort((left, right) => rank(right) - rank(left))[0];

export const resolveSpellDamageFormula = (
  spell: Spell,
  character: Character,
  options: { slotLevel?: number } = {}
): { formula?: DamageFormula; attacksCount?: number; notes: string[] } => {
  const notes: string[] = [];
  const scaling = spell.scaling;
  if (!scaling || scaling.kind === 'none') return { formula: spell.damage, notes };

  if (scaling.requiresReview) {
    notes.push(`Escalonamento de ${spell.name} requer revisão manual antes de uso automático.`);
  }

  const steps = scaling.steps ?? [];
  if (scaling.kind === 'characterLevel' && steps.length) {
    const step = highestMatchingStep(
      steps,
      (candidate) => (candidate.minCharacterLevel ?? 0) <= character.level,
      (candidate) => candidate.minCharacterLevel ?? 0
    );
    if (step) return { formula: step.formula, attacksCount: step.attacksCount, notes };
  }

  if (scaling.kind === 'slotLevel' && steps.length) {
    const slotLevel = options.slotLevel ?? spell.level;
    const step = highestMatchingStep(
      steps,
      (candidate) => (candidate.slotLevel ?? 0) <= slotLevel,
      (candidate) => candidate.slotLevel ?? 0
    );
    if (step) return { formula: step.formula, attacksCount: step.attacksCount, notes };
  }

  if (scaling.kind === 'custom' && steps.length) {
    const step = highestMatchingStep(
      steps,
      (candidate) => (candidate.minCharacterLevel ?? 0) <= character.level || (candidate.slotLevel ?? 0) <= (options.slotLevel ?? spell.level),
      (candidate) => Math.max(candidate.minCharacterLevel ?? 0, candidate.slotLevel ?? 0)
    );
    if (step) return { formula: step.formula, attacksCount: step.attacksCount, notes };
  }

  if (scaling.dicePerStep) {
    notes.push(`Escalonamento por dicePerStep em ${spell.name} foi preservado, mas ainda precisa de uma regra de progressão explícita em steps para cálculo seguro.`);
  }

  return { formula: spell.damage, notes };
};
