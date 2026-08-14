import {
  ActiveEffect,
  Character,
  CombatScenario,
  DamageRange,
  ResourcePool,
  RestType,
  RuleValidationIssue,
  SpellSlotPool,
  TurnAnalysisResult,
  TurnRotation
} from '../types';
import { analyzeTurnRotation } from '../rules-engine/turns/analyzeTurn';
import { createCombatScenario } from '../rules-engine/turns/compareRotations';
import { spellSlotLabel, spellSlotPoolKey, spellSlotPoolLabel } from '../rules-engine/resources/spellSlotManager';
import { getActiveConcentrationEffect } from '../rules-engine/effects/activeEffects';
import { defaultCombatState } from '../data/mockData';

export type TableModeRotationStatus = 'ready' | 'warning' | 'blocked';
export type TableModeResourceStatus = 'full' | 'available' | 'low' | 'empty';
export type TableModeEffectUrgency = 'stable' | 'soon' | 'manual';

export interface TableModeRotationCard {
  rotationId: string;
  name: string;
  favorite: boolean;
  actionCount: number;
  attackCount: number;
  min: number;
  max: number;
  average: number;
  weightedAverage?: number;
  guaranteedAverage: number;
  status: TableModeRotationStatus;
  canExecute: boolean;
  resourceText: string;
  spellSlotText: string;
  warningCount: number;
  errorCount: number;
  issues: RuleValidationIssue[];
  analysis: TurnAnalysisResult;
}

export interface TableModeResourceCard {
  id: string;
  label: string;
  current: number;
  max: number;
  status: TableModeResourceStatus;
  kind: 'resource' | 'spellSlot';
  subtitle: string;
}

export interface TableModeEffectCard {
  id: string;
  name: string;
  concentration: boolean;
  conditionText: string;
  durationText: string;
  urgency: TableModeEffectUrgency;
}

export interface TableModeSummary {
  scenario: CombatScenario;
  rotationCards: TableModeRotationCard[];
  favoriteCards: TableModeRotationCard[];
  bestCard?: TableModeRotationCard;
  resources: TableModeResourceCard[];
  activeEffects: TableModeEffectCard[];
  concentrationName?: string;
  quickWarnings: RuleValidationIssue[];
  suggestedNextSteps: string[];
}

const zeroRange: DamageRange = { min: 0, max: 0, average: 0 };

export const createTableModeScenario = (characterId: string): CombatScenario =>
  createCombatScenario({
    id: `table_mode_${characterId}`,
    characterId,
    name: 'Mesa rápida',
    combatState: defaultCombatState,
    favorite: true,
    notes: 'Cenário compacto padrão usado pelo modo mesa.'
  });

const issueCount = (analysis: TurnAnalysisResult, severity: RuleValidationIssue['severity']): number =>
  [
    ...analysis.validation.issues,
    ...analysis.resourceAvailability.issues,
    ...analysis.spellSlotAvailability.issues,
    ...analysis.actions.flatMap((action) => action.warnings)
  ].filter((issue) => issue.severity === severity).length;

const allIssues = (analysis: TurnAnalysisResult): RuleValidationIssue[] => [
  ...analysis.validation.issues,
  ...analysis.resourceAvailability.issues,
  ...analysis.spellSlotAvailability.issues,
  ...analysis.actions.flatMap((action) => action.warnings)
];

const statusFromAnalysis = (analysis: TurnAnalysisResult): TableModeRotationStatus => {
  const errors = issueCount(analysis, 'error');
  if (errors > 0 || !analysis.resourceAvailability.ok || !analysis.spellSlotAvailability.ok) return 'blocked';
  if (issueCount(analysis, 'warning') > 0) return 'warning';
  return 'ready';
};

const resourceCostText = (analysis: TurnAnalysisResult): string => {
  if (!analysis.resourcesConsumed.length) return 'Sem recurso limitado';
  const grouped = new Map<string, { label: string; amount: number }>();
  for (const cost of analysis.resourcesConsumed) {
    const current = grouped.get(cost.resourceId) ?? { label: cost.label ?? cost.resourceId, amount: 0 };
    current.amount += cost.amount;
    grouped.set(cost.resourceId, current);
  }
  return Array.from(grouped.values()).map((cost) => `${cost.label} ×${cost.amount}`).join(', ');
};

const spellSlotCostText = (analysis: TurnAnalysisResult): string => {
  if (!analysis.spellSlotsConsumed.length) return 'Sem spell slot';
  const grouped = new Map<number, number>();
  for (const cost of analysis.spellSlotsConsumed) grouped.set(cost.slotLevel, (grouped.get(cost.slotLevel) ?? 0) + cost.amount);
  return Array.from(grouped.entries()).map(([level, amount]) => `${spellSlotLabel(level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9)} ×${amount}`).join(', ');
};

const rotationFavorite = (rotations: TurnRotation[], rotationId: string): boolean =>
  Boolean(rotations.find((rotation) => rotation.id === rotationId)?.favorite);

export const createTableModeRotationCard = (
  rotation: TurnRotation,
  character: Character,
  scenario: CombatScenario
): TableModeRotationCard => {
  const analysis = analyzeTurnRotation(rotation, character, scenario.combatState);
  const status = statusFromAnalysis(analysis);
  const guaranteed = analysis.actions.reduce((sum, action) => sum + action.guaranteed.average, zeroRange.average);
  const warnings = issueCount(analysis, 'warning');
  const errors = issueCount(analysis, 'error');

  return {
    rotationId: rotation.id,
    name: analysis.rotationName,
    favorite: Boolean(rotation.favorite),
    actionCount: analysis.actions.length,
    attackCount: analysis.attackCount,
    min: analysis.total.min,
    max: analysis.total.max,
    average: analysis.total.average,
    weightedAverage: analysis.weightedAverage,
    guaranteedAverage: guaranteed,
    status,
    canExecute: status !== 'blocked',
    resourceText: resourceCostText(analysis),
    spellSlotText: spellSlotCostText(analysis),
    warningCount: warnings,
    errorCount: errors,
    issues: allIssues(analysis),
    analysis
  };
};

const resourceStatus = (current: number, max: number): TableModeResourceStatus => {
  if (max <= 0 || current <= 0) return 'empty';
  if (current >= max) return 'full';
  if (current <= Math.max(1, Math.floor(max * 0.25))) return 'low';
  return 'available';
};

const resourceCardFromPool = (resource: ResourcePool): TableModeResourceCard => ({
  id: resource.id,
  label: resource.name,
  current: resource.current,
  max: resource.max,
  status: resourceStatus(resource.current, resource.max),
  kind: 'resource',
  subtitle: `Recarga: ${resource.recharge}`
});

const resourceCardFromSlot = (slot: SpellSlotPool): TableModeResourceCard => ({
  id: `slot-${spellSlotPoolKey(slot)}`,
  label: spellSlotPoolLabel(slot),
  current: slot.current,
  max: slot.max,
  status: resourceStatus(slot.current, slot.max),
  kind: 'spellSlot',
  subtitle: `Recarga: ${slot.recharge}`
});

const durationText = (effect: ActiveEffect): string => {
  if (effect.duration.unit === 'manual') return 'Duração manual';
  if (effect.duration.remaining === undefined) return `${effect.duration.unit} sem contador`;
  return `${effect.duration.remaining} ${effect.duration.unit}${effect.duration.remaining === 1 ? '' : 's'}`;
};

const effectUrgency = (effect: ActiveEffect): TableModeEffectUrgency => {
  if (effect.duration.unit === 'manual' || effect.duration.remaining === undefined) return 'manual';
  return effect.duration.remaining <= 1 ? 'soon' : 'stable';
};

const effectCardFromEffect = (effect: ActiveEffect): TableModeEffectCard => ({
  id: effect.id,
  name: effect.name,
  concentration: Boolean(effect.concentration),
  conditionText: effect.conditionIds?.length ? effect.conditionIds.join(', ') : 'Sem condição mecânica',
  durationText: durationText(effect),
  urgency: effectUrgency(effect)
});

const sortRotationCards = (cards: TableModeRotationCard[]): TableModeRotationCard[] =>
  cards.slice().sort((left, right) => {
    const favoriteDelta = Number(right.favorite) - Number(left.favorite);
    if (favoriteDelta) return favoriteDelta;
    const statusRank: Record<TableModeRotationStatus, number> = { ready: 2, warning: 1, blocked: 0 };
    const statusDelta = statusRank[right.status] - statusRank[left.status];
    if (statusDelta) return statusDelta;
    return (right.weightedAverage ?? right.average) - (left.weightedAverage ?? left.average);
  });

const collectQuickWarnings = (cards: TableModeRotationCard[], resources: TableModeResourceCard[], effects: TableModeEffectCard[]): RuleValidationIssue[] => {
  const warnings: RuleValidationIssue[] = [];
  const blocked = cards.filter((card) => card.status === 'blocked').length;
  const lowResources = resources.filter((resource) => resource.status === 'low' || resource.status === 'empty');
  const expiringEffects = effects.filter((effect) => effect.urgency === 'soon');

  if (blocked > 0) {
    warnings.push({ severity: 'warning', code: 'TABLE_BLOCKED_ROTATIONS', message: `${blocked} rotação(ões) estão bloqueadas por conflito, recurso ou slot.` });
  }
  if (lowResources.length > 0) {
    warnings.push({ severity: 'warning', code: 'TABLE_LOW_RESOURCES', message: `${lowResources.length} recurso(s)/slot(s) estão baixos ou vazios.` });
  }
  if (expiringEffects.length > 0) {
    warnings.push({ severity: 'info', code: 'TABLE_EXPIRING_EFFECTS', message: `${expiringEffects.length} efeito(s) podem expirar no próximo avanço de turno.` });
  }

  return warnings;
};

const suggestedNextSteps = (character: Character, cards: TableModeRotationCard[], resources: TableModeResourceCard[], effects: TableModeEffectCard[]): string[] => {
  const steps: string[] = [];
  if (!character.rotations.length) steps.push('Crie pelo menos uma rotação favorita para usar o modo mesa com um toque.');
  if (cards.some((card) => card.status === 'blocked')) steps.push('Abra a análise detalhada das rotações bloqueadas antes de executá-las.');
  if (resources.some((resource) => resource.status === 'empty')) steps.push('Considere descanso curto/longo ou ajuste manual de recursos vazios.');
  if (effects.some((effect) => effect.urgency === 'soon')) steps.push('Avance o turno e confirme se efeitos com duração baixa expiraram.');
  if (!steps.length) steps.push('Tudo pronto para a mesa: escolha uma rotação favorita e registre o gasto quando usar.');
  return steps;
};

export const buildTableModeSummary = (character: Character, scenario: CombatScenario = createTableModeScenario(character.id)): TableModeSummary => {
  const rotationCards = sortRotationCards(character.rotations.map((rotation) => createTableModeRotationCard(rotation, character, scenario)));
  const favoriteCards = rotationCards.filter((card) => card.favorite);
  const bestCard = rotationCards
    .filter((card) => card.status !== 'blocked')
    .slice()
    .sort((left, right) => (right.weightedAverage ?? right.average) - (left.weightedAverage ?? left.average))[0];
  const resources = [
    ...(character.spellSlots ?? []).map(resourceCardFromSlot),
    ...(character.resources ?? []).map(resourceCardFromPool)
  ];
  const activeEffects = (character.activeEffects ?? [])
    .filter((effect) => effect.status === 'active')
    .map(effectCardFromEffect);
  const concentration = getActiveConcentrationEffect(character);
  const quickWarnings = collectQuickWarnings(rotationCards, resources, activeEffects);

  return {
    scenario,
    rotationCards,
    favoriteCards,
    bestCard,
    resources,
    activeEffects,
    concentrationName: concentration?.name,
    quickWarnings,
    suggestedNextSteps: suggestedNextSteps(character, rotationCards, resources, activeEffects)
  };
};

export const tableModeRestLabel = (restType: RestType): string => {
  if (restType === 'turnStart') return 'Início do turno';
  if (restType === 'shortRest') return 'Descanso curto';
  if (restType === 'longRest') return 'Descanso longo';
  return 'Ajuste manual';
};

export const findTableModeCard = (summary: TableModeSummary, rotationId: string): TableModeRotationCard | undefined =>
  summary.rotationCards.find((card) => card.rotationId === rotationId);

export const isFavoriteRotationInTableMode = (character: Character, rotationId: string): boolean =>
  rotationFavorite(character.rotations, rotationId);
