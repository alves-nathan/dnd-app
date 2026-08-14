import type {
  Character,
  CombatScenario,
  CombatState,
  DamageRange,
  ResourceCost,
  RuleValidationIssue,
  SpellSlotCost,
  TacticalEffectEvent,
  TacticalMovementSummary,
  TurnAction,
  TurnAnalysisResult,
  TurnRotation
} from '../../types';
import { analyzeActionDamage } from '../damage/calculateDamage';
import { checkRotationResources } from '../resources/resourceManager';
import { checkRotationSpellSlots, spellSlotCostsFromTurnAction, toSpellSlotLevel } from '../resources/spellSlotManager';
import { resolveSpellDamageFormula } from '../actions/spellScaling';
import { validateTurnRotation } from './validateTurn';
import { buildCombatStateWithActiveEffects } from '../effects/activeEffects';
import { checkRotationAmmunition } from '../../characters/ammunitionRules';
import { combatStateForTarget, normalizeCombatScenario, tacticalTargetById } from './tacticalCombat';
import { createId } from '../../utils/id';
import { actorMapPoint, moveMapPointRelativeTo, tacticalDiagonalRule, tacticalMovementCostBetweenPoints, targetMapPoint } from '../targeting/spatialMap';

const addRange = (left: DamageRange, right: DamageRange): DamageRange => ({
  min: left.min + right.min,
  max: left.max + right.max,
  average: left.average + right.average
});

const isScenario = (value: CombatState | CombatScenario): value is CombatScenario =>
  'combatState' in value && 'characterId' in value;


const resolveTurnActionAttackOverride = (entry: TurnAction): TurnAction => {
  if (entry.action.type !== 'attack' || entry.attackCountOverride === undefined) return entry;
  return {
    ...entry,
    action: { ...entry.action, attacksCount: Math.max(0, Math.floor(entry.attackCountOverride)) }
  };
};

const applyCompanionAttackReplacement = (actions: TurnAction[]): TurnAction[] => {
  let replacements = actions.reduce((sum, entry) => sum + Math.max(0, entry.action.type === 'attack' ? (entry.action.replacesOwnAttackCount ?? 0) : 0), 0);
  if (!replacements) return actions;
  return actions.map((entry) => {
    if (replacements <= 0 || entry.action.type !== 'attack' || entry.action.tags?.includes('pact-familiar')) return entry;
    const current = Math.max(0, entry.action.attacksCount ?? 1);
    const removed = Math.min(current, replacements);
    replacements -= removed;
    return {
      ...entry,
      action: {
        ...entry.action,
        attacksCount: current - removed,
        ruleNotes: [...(entry.action.ruleNotes ?? []), `${removed} ataque(s) substituído(s) pelo ataque do Pact Familiar.`]
      }
    };
  });
};

const resolveTurnActionSpellSlot = (turnAction: TurnAction, character: Character): TurnAction => {
  const action = turnAction.action;
  if (action.type !== 'spell') return turnAction;

  const selectedSlotLevel = toSpellSlotLevel(turnAction.selectedSpellSlotLevel ?? action.castAtSlotLevel ?? action.spellLevel);
  if (!selectedSlotLevel || !action.spellId) return turnAction;

  const spell = character.spells.find((candidate) => candidate.id === action.spellId);
  if (!spell) return turnAction;

  const resolved = resolveSpellDamageFormula(spell, character, { slotLevel: selectedSlotLevel });
  return {
    ...turnAction,
    selectedSpellSlotLevel: selectedSlotLevel,
    action: {
      ...action,
      castAtSlotLevel: selectedSlotLevel,
      damage: resolved.formula,
      attacksCount: resolved.attacksCount ?? action.attacksCount,
      ruleNotes: [...(action.ruleNotes ?? []), ...resolved.notes]
    }
  };
};

const tacticalEventPreview = (turnAction: TurnAction, targetId: string): TacticalEffectEvent[] => {
  const action = turnAction.action;
  const events: TacticalEffectEvent[] = [];
  if (action.type === 'attack' && action.mastery) {
    const kind = action.mastery.property === 'push' ? 'push' : action.mastery.property === 'topple' ? 'prone' : action.mastery.property;
    if (['sap', 'slow', 'prone', 'vex', 'push'].includes(kind)) events.push({
      id: createId('tacticalPreview'),
      actionId: turnAction.id,
      targetId,
      kind: kind as TacticalEffectEvent['kind'],
      label: action.mastery.label,
      description: action.mastery.description,
      applied: false
    });
  }
  if (action.type === 'spell' && action.forcedMovementFt) events.push({
    id: createId('tacticalPreview'),
    actionId: turnAction.id,
    targetId,
    kind: 'repellingBlast',
    label: 'Movimento forçado',
    description: `Pode empurrar ${action.forcedMovementFt} pés por acerto.`,
    applied: false
  });
  return events;
};

const analyzeScenarioActions = (
  actions: TurnAction[],
  character: Character,
  scenarioInput: CombatScenario
): {
  actions: TurnAnalysisResult['actions'];
  tacticalEffects: TacticalEffectEvent[];
  movement: TacticalMovementSummary;
  movementIssues: RuleValidationIssue[];
} => {
  let scenario = normalizeCombatScenario(scenarioInput);
  let actorPosition = scenario.actorPositionFeet ?? 0;
  let actorMapPosition = actorMapPoint(scenario);
  const speed = scenario.actorSpeedFeet ?? 30;
  let movementSpent = 0;
  const movementIssues: RuleValidationIssue[] = [];
  const tacticalEffects: TacticalEffectEvent[] = [];
  const results: TurnAnalysisResult['actions'] = [];
  const consumedVex = new Set<string>();

  for (const turnAction of actions) {
    const target = tacticalTargetById(scenario, turnAction.targetId);
    if (turnAction.movement && turnAction.movement.distanceFeet > 0) {
      const desired = Math.max(0, turnAction.movement.distanceFeet);
      if (scenario.spatialMode === 'map2d') {
        const direction = turnAction.movement.kind === 'retreat' ? 'away' : 'toward';
        const reference = targetMapPoint(target);
        const candidateFor = (distance: number) => moveMapPointRelativeTo(actorMapPosition, reference, distance, direction, tacticalDiagonalRule(scenario));
        let actualDistance = desired;
        let candidate = candidateFor(actualDistance);
        let cost = tacticalMovementCostBetweenPoints(scenario, actorMapPosition, candidate).costFeet;
        if (movementSpent + cost > speed) {
          movementIssues.push({
            severity: 'error',
            code: 'TACTICAL_MOVEMENT_EXCEEDS_SPEED',
            message: `Movimento antes de "${turnAction.name}" ultrapassa a Speed disponível (${speed} pés) no mapa.`
          });
          let low = 0;
          let high = desired;
          const remaining = Math.max(0, speed - movementSpent);
          for (let index = 0; index < 28; index += 1) {
            const middle = (low + high) / 2;
            const middlePoint = candidateFor(middle);
            if (tacticalMovementCostBetweenPoints(scenario, actorMapPosition, middlePoint).costFeet <= remaining) low = middle;
            else high = middle;
          }
          actualDistance = Math.floor(low * 10) / 10;
          candidate = candidateFor(actualDistance);
          cost = tacticalMovementCostBetweenPoints(scenario, actorMapPosition, candidate).costFeet;
        }
        actorMapPosition = candidate;
        movementSpent += cost;
      } else {
        const terrainMultiplier = scenario.difficultTerrain ? 2 : 1;
        const requestedCost = desired * terrainMultiplier;
        if (movementSpent + requestedCost > speed) {
          movementIssues.push({
            severity: 'error',
            code: 'TACTICAL_MOVEMENT_EXCEEDS_SPEED',
            message: `Movimento antes de "${turnAction.name}" ultrapassa a Speed disponível (${speed} pés${scenario.difficultTerrain ? ' em terreno difícil' : ''}).`
          });
        }
        const affordableDistance = Math.max(0, Math.floor((speed - movementSpent) / terrainMultiplier));
        const actualDistance = Math.min(desired, affordableDistance);
        const direction = target.positionFeet >= actorPosition ? 1 : -1;
        const delta = turnAction.movement.kind === 'retreat' ? -direction * actualDistance : direction * actualDistance;
        actorPosition = Math.max(0, actorPosition + delta);
        movementSpent += actualDistance * terrainMultiplier;
      }
    }

    let scenarioForAction: CombatScenario = { ...scenario, actorPositionFeet: actorPosition, actorMapPosition: scenario.spatialMode === 'map2d' ? actorMapPosition : scenario.actorMapPosition };
    if (consumedVex.has(target.id)) {
      scenarioForAction = {
        ...scenarioForAction,
        targets: scenarioForAction.targets?.map((entry) => entry.id === target.id ? { ...entry, effects: entry.effects.filter((effect) => effect.kind !== 'vex') } : entry)
      };
    }
    const targetState = buildCombatStateWithActiveEffects(character, combatStateForTarget(scenarioForAction, target.id));
    const result = analyzeActionDamage({
      action: turnAction.action,
      character,
      combatState: targetState,
      repeat: turnAction.repeat,
      enabledConditionIds: turnAction.enabledConditionIds
    });
    results.push({ ...result, spellSlotsConsumed: spellSlotCostsFromTurnAction(turnAction) });
    tacticalEffects.push(...tacticalEventPreview(turnAction, target.id));
    if (turnAction.action.type === 'attack' && target.effects.some((effect) => effect.kind === 'vex')) consumedVex.add(target.id);
  }

  return {
    actions: results,
    tacticalEffects,
    movement: {
      speedFeet: speed,
      movementSpentFeet: movementSpent,
      movementRemainingFeet: Math.max(0, speed - movementSpent),
      difficultTerrain: Boolean(scenario.difficultTerrain) || (scenario.spatialMode === 'map2d' && (scenario.terrainRegions?.length ?? 0) > 0),
      finalPositionFeet: actorPosition,
      finalMapPosition: scenario.spatialMode === 'map2d' ? actorMapPosition : undefined
    },
    movementIssues
  };
};

export const analyzeTurnRotation = (
  rotation: TurnRotation,
  character: Character,
  combatContext: CombatState | CombatScenario
): TurnAnalysisResult => {
  const resolvedActions = applyCompanionAttackReplacement(rotation.actions.map(resolveTurnActionAttackOverride).map((turnAction) => resolveTurnActionSpellSlot(turnAction, character)));
  const resolvedRotation: TurnRotation = { ...rotation, actions: resolvedActions };
  const baseCombatState = isScenario(combatContext) ? normalizeCombatScenario(combatContext).combatState : combatContext;
  const effectiveCombatState = buildCombatStateWithActiveEffects(character, baseCombatState);
  const baseValidation = validateTurnRotation(rotation, character, effectiveCombatState);
  const scenarioAnalysis = isScenario(combatContext)
    ? analyzeScenarioActions(resolvedActions, character, combatContext)
    : undefined;
  const actions = scenarioAnalysis?.actions ?? resolvedActions.map((turnAction) => {
    const result = analyzeActionDamage({
      action: turnAction.action,
      character,
      combatState: effectiveCombatState,
      repeat: turnAction.repeat,
      enabledConditionIds: turnAction.enabledConditionIds
    });
    return { ...result, spellSlotsConsumed: spellSlotCostsFromTurnAction(turnAction) };
  });

  const total = actions.reduce<DamageRange>((acc, action) => addRange(acc, action.total), { min: 0, max: 0, average: 0 });
  const weightedValues = actions.map((action) => action.weightedAverage).filter((value): value is number => value !== undefined);
  const weightedAverage = weightedValues.length === actions.length ? weightedValues.reduce((sum, value) => sum + value, 0) : undefined;
  const resourcesConsumed: ResourceCost[] = actions.flatMap((action) => action.resourcesConsumed);
  const spellSlotsConsumed: SpellSlotCost[] = actions.flatMap((action) => action.spellSlotsConsumed);
  const resourceAvailability = checkRotationResources(resolvedRotation, character, effectiveCombatState.availableResourceOverrides);
  const spellSlotAvailability = checkRotationSpellSlots(resolvedRotation, character, effectiveCombatState.availableSpellSlotOverrides);
  const ammunitionAvailability = checkRotationAmmunition(resolvedRotation, character);
  const attackCount = actions.reduce((sum, action) => sum + action.attacksCount, 0);
  const validationIssues = [...baseValidation.issues, ...(scenarioAnalysis?.movementIssues ?? [])];

  return {
    rotationId: rotation.id,
    rotationName: rotation.name,
    actions,
    attackCount,
    total,
    weightedAverage,
    resourcesConsumed,
    spellSlotsConsumed,
    resourceAvailability,
    spellSlotAvailability,
    ammunitionAvailability,
    tacticalEffects: scenarioAnalysis?.tacticalEffects,
    movement: scenarioAnalysis?.movement,
    validation: { ok: validationIssues.every((issue) => issue.severity !== 'error'), issues: validationIssues }
  };
};
