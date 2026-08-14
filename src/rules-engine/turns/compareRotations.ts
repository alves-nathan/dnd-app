import {
  Character,
  CombatScenario,
  CombatState,
  DamageRange,
  ResourceCost,
  RotationComparisonResult,
  RotationComparisonRow,
  RotationResourceSummary,
  TurnAnalysisResult,
  TurnRotation
} from '../../types';
import { analyzeTurnRotation } from './analyzeTurn';
import { spellSlotLabel } from '../resources/spellSlotManager';
import { SpellSlotCost } from '../../types';
import { defaultCombatState } from '../../data/mockData';

const zeroRange = (): DamageRange => ({ min: 0, max: 0, average: 0 });

const addRange = (left: DamageRange, right: DamageRange): DamageRange => ({
  min: left.min + right.min,
  max: left.max + right.max,
  average: left.average + right.average
});

const countSeverity = (analysis: TurnAnalysisResult, severity: 'warning' | 'error'): number => {
  const validationIssues = analysis.validation.issues.filter((issue) => issue.severity === severity).length;
  const resourceIssues = analysis.resourceAvailability.issues.filter((issue) => issue.severity === severity).length;
  const spellSlotIssues = analysis.spellSlotAvailability.issues.filter((issue) => issue.severity === severity).length;
  const ammunitionIssues = (analysis.ammunitionAvailability?.issues ?? []).filter((issue) => issue.severity === severity).length;
  const actionIssues = analysis.actions.flatMap((action) => action.warnings).filter((issue) => issue.severity === severity).length;
  return validationIssues + resourceIssues + spellSlotIssues + ammunitionIssues + actionIssues;
};

export const summarizeResources = (resources: ResourceCost[]): RotationResourceSummary[] => {
  const grouped = new Map<string, RotationResourceSummary>();

  for (const cost of resources) {
    const current = grouped.get(cost.resourceId) ?? {
      resourceId: cost.resourceId,
      label: cost.label ?? cost.resourceId,
      amount: 0,
      oncePerTurnKeys: []
    };
    current.amount += cost.amount;
    if (cost.oncePerTurnKey && !current.oncePerTurnKeys.includes(cost.oncePerTurnKey)) {
      current.oncePerTurnKeys.push(cost.oncePerTurnKey);
    }
    grouped.set(cost.resourceId, current);
  }

  return Array.from(grouped.values()).sort((left, right) => left.label.localeCompare(right.label));
};

export const summarizeSpellSlots = (costs: SpellSlotCost[]): RotationResourceSummary[] => {
  const grouped = new Map<string, RotationResourceSummary>();
  for (const cost of costs) {
    const key = `spellSlot:${cost.slotLevel}`;
    const current = grouped.get(key) ?? {
      resourceId: key,
      label: spellSlotLabel(cost.slotLevel),
      amount: 0,
      oncePerTurnKeys: []
    };
    current.amount += cost.amount;
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).sort((left, right) => left.resourceId.localeCompare(right.resourceId));
};

export const comparisonRowFromAnalysis = (analysis: TurnAnalysisResult): RotationComparisonRow => {
  const guaranteed = analysis.actions.reduce<DamageRange>((acc, action) => addRange(acc, action.guaranteed), zeroRange());
  const hitDependent = analysis.actions.reduce<DamageRange>((acc, action) => addRange(acc, action.hitDependent), zeroRange());
  const conditioned = analysis.actions.reduce<DamageRange>((acc, action) => addRange(acc, action.conditioned), zeroRange());
  const saveDependent = analysis.actions.reduce<DamageRange>((acc, action) => addRange(acc, action.saveDependent), zeroRange());

  return {
    rotationId: analysis.rotationId,
    rotationName: analysis.rotationName,
    actionCount: analysis.actions.length,
    attackCount: analysis.attackCount,
    total: analysis.total,
    weightedAverage: analysis.weightedAverage,
    guaranteed,
    hitDependent,
    conditioned,
    saveDependent,
    resourcesConsumed: [
      ...summarizeResources(analysis.resourcesConsumed),
      ...summarizeSpellSlots(analysis.spellSlotsConsumed),
      ...(analysis.ammunitionAvailability?.costs ?? []).map((cost) => ({
        resourceId: `ammunition:${cost.type}`,
        label: `Munição · ${cost.label}`,
        amount: cost.amount,
        oncePerTurnKeys: []
      }))
    ],
    warningCount: countSeverity(analysis, 'warning'),
    errorCount: countSeverity(analysis, 'error'),
    validation: analysis.validation
  };
};

const bestBy = (rows: RotationComparisonRow[], getValue: (row: RotationComparisonRow) => number | undefined): string | undefined => {
  let best: RotationComparisonRow | undefined;
  let bestValue = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const value = getValue(row);
    if (value === undefined) continue;
    if (value > bestValue) {
      best = row;
      bestValue = value;
    }
  }

  return best?.rotationId;
};

export const compareRotationsForScenario = (
  rotations: TurnRotation[],
  character: Character,
  scenario: CombatScenario
): RotationComparisonResult => {
  const rows = rotations.map((rotation) => comparisonRowFromAnalysis(analyzeTurnRotation(rotation, character, scenario)));

  return {
    scenario,
    rows,
    bestByAverageRotationId: bestBy(rows, (row) => row.total.average),
    bestByWeightedAverageRotationId: bestBy(rows, (row) => row.weightedAverage),
    bestByGuaranteedRotationId: bestBy(rows, (row) => row.guaranteed.average)
  };
};

export const createCombatScenario = (params: {
  characterId: string;
  name: string;
  combatState?: Partial<CombatState>;
  notes?: string;
  favorite?: boolean;
  id?: string;
  now?: string;
}): CombatScenario => {
  const now = params.now ?? new Date().toISOString();
  return {
    id: params.id ?? `scenario_${Math.random().toString(36).slice(2, 10)}`,
    characterId: params.characterId,
    name: params.name,
    combatState: {
      ...defaultCombatState,
      ...params.combatState,
      targetCount: Math.max(1, params.combatState?.targetCount ?? defaultCombatState.targetCount),
      resistanceMultiplier: params.combatState?.resistanceMultiplier ?? defaultCombatState.resistanceMultiplier,
      rollMode: params.combatState?.rollMode ?? defaultCombatState.rollMode
    },
    favorite: params.favorite,
    notes: params.notes,
    createdAt: now,
    updatedAt: now
  };
};
