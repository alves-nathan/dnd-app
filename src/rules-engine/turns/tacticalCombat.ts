import type {
  BattlefieldItem,
  Character,
  CharacterAction,
  CombatScenario,
  CombatState,
  Equipment,
  RuleValidationIssue,
  TacticalActionResolution,
  TacticalCombatLogEntry,
  TacticalEffectEvent,
  TacticalMovementSummary,
  TacticalMapPoint,
  TacticalTarget,
  TacticalTargetEffect,
  TurnAction,
  TurnRotation
} from '../../types';
import { createId } from '../../utils/id';
import { turnActionAttackCount } from '../../characters/interactionEconomyRules';
import { defaultCombatState } from '../../data/mockData';
import { equipmentAmmunitionType, rotationAmmunitionCosts } from '../../characters/ammunitionRules';
import { tacticalActionTargetLimit } from '../targeting/areaTemplates';
import {
  actorMapPoint,
  moveMapPointRelativeTo,
  moveTargetAwayFromActor,
  tacticalDiagonalRule,
  tacticalDistanceBetweenTargets,
  tacticalDistanceToTarget,
  tacticalMovementCostBetweenPoints,
  targetMapPoint
} from '../targeting/spatialMap';
import { resolveTurnFeatureActivations } from './turnFeatureActivations';

const now = (): string => new Date().toISOString();

export const createTacticalTarget = (params: Partial<TacticalTarget> & { name?: string } = {}): TacticalTarget => ({
  id: params.id ?? createId('target'),
  name: params.name?.trim() || 'Alvo',
  armorClass: params.armorClass,
  hitPoints: params.hitPoints ? {
    current: Math.max(0, Math.floor(params.hitPoints.current)),
    max: Math.max(0, Math.floor(params.hitPoints.max)),
    temporary: Math.max(0, Math.floor(params.hitPoints.temporary ?? 0))
  } : undefined,
  initiative: params.initiative,
  size: params.size ?? 'Medium',
  positionFeet: Math.max(0, params.positionFeet ?? 5),
  mapPosition: params.mapPosition ? { xFeet: Number(params.mapPosition.xFeet) || 0, yFeet: Number(params.mapPosition.yFeet) || 0 } : undefined,
  speedFeet: Math.max(0, params.speedFeet ?? 30),
  cover: params.cover ?? 'none',
  lineOfSight: params.lineOfSight !== false,
  conditions: params.conditions ?? [],
  effects: params.effects ?? [],
  sourceCreatureItemId: params.sourceCreatureItemId,
  sourceCreatureImportItemId: params.sourceCreatureImportItemId,
  statBlockActions: params.statBlockActions?.map((action) => ({ ...action, conditionIds: action.conditionIds ? [...action.conditionIds] : undefined })),
  statBlockResources: params.statBlockResources?.map((resource) => ({ ...resource })),
  notes: params.notes
});

export const normalizeCombatScenario = (scenario: CombatScenario): CombatScenario => {
  const targetFromLegacy = createTacticalTarget({
    id: `${scenario.id}:primary`,
    name: 'Alvo principal',
    armorClass: scenario.combatState.targetAC,
    size: scenario.combatState.targetSize ?? 'Medium',
    positionFeet: scenario.combatState.targetDistanceFeet ?? 5,
    cover: scenario.combatState.cover ?? 'none',
    lineOfSight: scenario.combatState.lineOfSight !== false
  });
  const targets = (scenario.targets?.length ? scenario.targets : [targetFromLegacy]).map((target) => {
    const normalized = createTacticalTarget(target);
    return scenario.spatialMode === 'map2d' && !normalized.mapPosition
      ? { ...normalized, mapPosition: { xFeet: normalized.positionFeet, yFeet: 0 } }
      : normalized;
  });
  return {
    ...scenario,
    combatState: { ...defaultCombatState, ...scenario.combatState },
    targets,
    actorPositionFeet: Math.max(0, scenario.actorPositionFeet ?? 0),
    actorMapPosition: scenario.spatialMode === 'map2d'
      ? { xFeet: Number(scenario.actorMapPosition?.xFeet ?? scenario.actorPositionFeet ?? 0), yFeet: Number(scenario.actorMapPosition?.yFeet ?? 0) }
      : scenario.actorMapPosition,
    actorSpeedFeet: Math.max(0, scenario.actorSpeedFeet ?? 30),
    spatialMode: scenario.spatialMode ?? 'linear',
    diagonalRule: scenario.diagonalRule ?? 'fiveFeet',
    terrainRegions: (scenario.terrainRegions ?? []).map((region) => ({
      ...region,
      xFeet: Number(region.xFeet) || 0,
      yFeet: Number(region.yFeet) || 0,
      widthFeet: region.widthFeet === undefined ? undefined : Math.max(0, Number(region.widthFeet) || 0),
      heightFeet: region.heightFeet === undefined ? undefined : Math.max(0, Number(region.heightFeet) || 0),
      radiusFeet: region.radiusFeet === undefined ? undefined : Math.max(0, Number(region.radiusFeet) || 0),
      movementMultiplier: Math.max(1, Number(region.movementMultiplier) || 2)
    })),
    difficultTerrain: Boolean(scenario.difficultTerrain),
    round: Math.max(1, scenario.round ?? 1),
    battlefieldItems: scenario.battlefieldItems ?? [],
    tacticalLog: scenario.tacticalLog ?? [],
    participants: scenario.participants ?? [],
    turnPhase: scenario.activeParticipantId ? 'active' : (scenario.turnPhase ?? 'idle'),
    readyActions: scenario.readyActions ?? []
  };
};

export const primaryTacticalTarget = (scenario: CombatScenario): TacticalTarget => normalizeCombatScenario(scenario).targets![0];

export const tacticalTargetById = (scenario: CombatScenario, targetId?: string): TacticalTarget => {
  const normalized = normalizeCombatScenario(scenario);
  return normalized.targets!.find((target) => target.id === targetId) ?? normalized.targets![0];
};

const activeEffect = (target: TacticalTarget, kind: TacticalTargetEffect['kind']): TacticalTargetEffect | undefined =>
  target.effects.find((effect) => effect.kind === kind);

const combineRollMode = (base: CombatState['rollMode'], advantage: boolean, disadvantage: boolean): CombatState['rollMode'] => {
  const hasAdvantage = advantage || base === 'advantage';
  const hasDisadvantage = disadvantage || base === 'disadvantage';
  if (hasAdvantage === hasDisadvantage) return 'normal';
  return hasAdvantage ? 'advantage' : 'disadvantage';
};

export const effectiveTargetSpeed = (target: TacticalTarget): number => {
  const penalty = Math.max(0, ...target.effects.filter((effect) => effect.kind === 'slow').map((effect) => effect.speedPenaltyFeet ?? 10));
  return Math.max(0, target.speedFeet - penalty);
};

export const combatStateForTarget = (
  scenario: CombatScenario,
  targetId?: string,
  options: { consumeVexPreview?: boolean } = {}
): CombatState => {
  const normalized = normalizeCombatScenario(scenario);
  const target = tacticalTargetById(normalized, targetId);
  const distance = tacticalDistanceToTarget(normalized, target);
  const vex = Boolean(activeEffect(target, 'vex'));
  const prone = target.conditions.includes('prone') || Boolean(activeEffect(target, 'prone'));
  const disadvantageFromProne = prone && distance > 5;
  const advantageFromProne = prone && distance <= 5;
  return {
    ...normalized.combatState,
    targetAC: target.armorClass ?? normalized.combatState.targetAC,
    targetDistanceFeet: distance,
    targetSize: target.size,
    cover: target.cover,
    lineOfSight: target.lineOfSight,
    targetCount: 1,
    rollMode: combineRollMode(normalized.combatState.rollMode, vex || advantageFromProne, disadvantageFromProne)
  };
};

const logEntry = (scenario: CombatScenario, kind: TacticalCombatLogEntry['kind'], message: string, targetId?: string, actionId?: string): TacticalCombatLogEntry => ({
  id: createId('tacticalLog'),
  round: scenario.round ?? 1,
  kind,
  message,
  targetId,
  actionId,
  createdAt: now()
});

const replaceEffect = (target: TacticalTarget, effect: TacticalTargetEffect): TacticalTarget => ({
  ...target,
  effects: [...target.effects.filter((entry) => entry.kind !== effect.kind), effect]
});

const effect = (params: {
  scenario: CombatScenario;
  characterId: string;
  rotationId: string;
  actionId: string;
  kind: TacticalTargetEffect['kind'];
  label: string;
  expiry: TacticalTargetEffect['expiry'];
  speedPenaltyFeet?: number;
  remainingUses?: number;
  notes?: string;
}): TacticalTargetEffect => ({
  id: createId('targetEffect'),
  kind: params.kind,
  label: params.label,
  sourceCharacterId: params.characterId,
  sourceActionId: params.actionId,
  sourceRotationId: params.rotationId,
  expiry: params.expiry,
  speedPenaltyFeet: params.speedPenaltyFeet,
  remainingUses: params.remainingUses,
  appliedRound: params.scenario.round ?? 1,
  appliedAt: now(),
  notes: params.notes
});

const targetDirection = (actorPosition: number, targetPosition: number): 1 | -1 => targetPosition >= actorPosition ? 1 : -1;

const resolveMovement = (
  scenario: CombatScenario,
  actorPosition: number,
  actorMapPosition: TacticalMapPoint,
  action: TurnAction,
  target: TacticalTarget,
  remainingCostBudget: number
): { position: number; mapPosition: TacticalMapPoint; cost: number; actualDistance: number; difficultTerrainFeet: number; issue?: RuleValidationIssue } => {
  const movement = action.movement;
  if (!movement || movement.distanceFeet <= 0) return { position: actorPosition, mapPosition: actorMapPosition, cost: 0, actualDistance: 0, difficultTerrainFeet: 0 };
  const desired = Math.max(0, movement.distanceFeet);

  if (scenario.spatialMode === 'map2d') {
    const direction = movement.kind === 'retreat' ? 'away' : 'toward';
    const targetPoint = targetMapPoint(target);
    const candidateFor = (distance: number) => moveMapPointRelativeTo(actorMapPosition, targetPoint, distance, direction, tacticalDiagonalRule(scenario));
    let actualDistance = desired;
    let candidate = candidateFor(actualDistance);
    let movementCost = tacticalMovementCostBetweenPoints(scenario, actorMapPosition, candidate);
    if (movementCost.costFeet > remainingCostBudget) {
      let low = 0;
      let high = desired;
      for (let index = 0; index < 28; index += 1) {
        const middle = (low + high) / 2;
        const middlePoint = candidateFor(middle);
        const middleCost = tacticalMovementCostBetweenPoints(scenario, actorMapPosition, middlePoint).costFeet;
        if (middleCost <= remainingCostBudget) low = middle;
        else high = middle;
      }
      actualDistance = Math.floor(low * 10) / 10;
      candidate = candidateFor(actualDistance);
      movementCost = tacticalMovementCostBetweenPoints(scenario, actorMapPosition, candidate);
    }
    return {
      position: actorPosition,
      mapPosition: candidate,
      cost: movementCost.costFeet,
      actualDistance,
      difficultTerrainFeet: movementCost.difficultTerrainFeet,
      issue: actualDistance + 0.05 < desired ? {
        severity: 'error',
        code: 'TACTICAL_MOVEMENT_EXCEEDS_SPEED',
        message: `Movimento antes de "${action.name}" exige mais do que os ${remainingCostBudget} pés disponíveis no mapa${movementCost.crossesDifficultTerrain ? ' por atravessar terreno difícil' : ''}.`
      } : undefined
    };
  }

  const multiplier = scenario.difficultTerrain ? 2 : 1;
  const affordable = Math.floor(remainingCostBudget / multiplier);
  const actualDistance = Math.min(desired, affordable);
  const direction = targetDirection(actorPosition, target.positionFeet);
  const delta = movement.kind === 'approach' ? direction * actualDistance
    : movement.kind === 'retreat' ? -direction * actualDistance
      : direction * actualDistance;
  const next = Math.max(0, actorPosition + delta);
  return {
    position: next,
    mapPosition: actorMapPosition,
    cost: actualDistance * multiplier,
    actualDistance,
    difficultTerrainFeet: scenario.difficultTerrain ? actualDistance : 0,
    issue: actualDistance < desired ? {
      severity: 'error',
      code: 'TACTICAL_MOVEMENT_EXCEEDS_SPEED',
      message: `Movimento antes de "${action.name}" exige ${desired * multiplier} pés do orçamento, mas apenas ${remainingCostBudget} estão disponíveis.`
    } : undefined
  };
};

const resolutionForAction = (resolutions: TacticalActionResolution[], action: TurnAction): TacticalActionResolution =>
  resolutions.find((entry) => entry.actionId === action.id) ?? {
    actionId: action.id,
    targetId: action.targetId,
    confirmedHits: 0,
    toppleSave: 'pending'
  };

const targetResultsForAction = (resolution: TacticalActionResolution, fallbackTargetId: string) => {
  const results = resolution.targetResults?.filter((entry) => entry.targetId) ?? [];
  if (results.length) return results;
  return [{
    targetId: resolution.targetId ?? fallbackTargetId,
    confirmedHits: resolution.confirmedHits,
    saveResult: 'pending' as const
  }];
};

const applyDamageToTacticalTarget = (target: TacticalTarget, amount: number): TacticalTarget => {
  if (!target.hitPoints) return target;
  const damage = Math.max(0, Math.floor(amount));
  const temporary = Math.max(0, target.hitPoints.temporary ?? 0);
  const temporarySpent = Math.min(temporary, damage);
  return {
    ...target,
    hitPoints: {
      ...target.hitPoints,
      temporary: temporary - temporarySpent,
      current: Math.max(0, target.hitPoints.current - (damage - temporarySpent))
    }
  };
};

const applyConditionsToTacticalTarget = (target: TacticalTarget, conditionIds: string[]): TacticalTarget => {
  if (!conditionIds.length) return target;
  const conditions = new Set(target.conditions);
  conditionIds.forEach((conditionId) => conditionId.trim() && conditions.add(conditionId.trim().toLowerCase()));
  return { ...target, conditions: Array.from(conditions) };
};

const saveAdjustedDamage = (action: CharacterAction, damage: number, saveResult?: 'success' | 'failure' | 'pending'): number => {
  const raw = Math.max(0, Math.floor(damage));
  if (action.type !== 'spell' || saveResult !== 'success') return raw;
  if (action.saveSuccessDamage === 'half') return Math.floor(raw / 2);
  if (action.saveSuccessDamage === 'none') return 0;
  return raw;
};

const thrownWeaponBattlefieldItems = (rotation: TurnRotation, character: Character, round: number): BattlefieldItem[] => {
  const grouped = new Map<string, BattlefieldItem>();
  for (const entry of rotation.actions) {
    const action = entry.action;
    if (action.type !== 'attack' || !action.thrownWeapon || !action.weaponId) continue;
    const weapon = character.weapons.find((candidate) => candidate.id === action.weaponId);
    if (!weapon) continue;
    const quantity = Math.max(1, turnActionAttackCount(entry));
    const current = grouped.get(weapon.id) ?? {
      id: createId('battlefield'),
      kind: 'thrownWeapon' as const,
      label: weapon.name,
      quantity: 0,
      weaponId: weapon.id,
      recoverable: true,
      recoveryMode: 'manual' as const,
      recoveryPercent: 100,
      createdRound: round
    };
    current.quantity += quantity;
    grouped.set(weapon.id, current);
  }
  return Array.from(grouped.values());
};

const ammunitionBattlefieldItems = (rotation: TurnRotation, round: number): BattlefieldItem[] =>
  rotationAmmunitionCosts(rotation).map((cost) => ({
    id: createId('battlefield'),
    kind: 'ammunition',
    label: cost.label,
    quantity: cost.amount,
    ammunitionType: cost.type,
    recoverable: true,
    recoveryMode: 'manual',
    recoveryPercent: 50,
    createdRound: round
  }));

export interface ResolveTacticalRotationResult {
  scenario: CombatScenario;
  issues: RuleValidationIssue[];
  effects: TacticalEffectEvent[];
  movement: TacticalMovementSummary;
  battlefieldItems: BattlefieldItem[];
}

export const resolveTacticalRotation = (params: {
  character: Character;
  rotation: TurnRotation;
  scenario: CombatScenario;
  resolutions?: TacticalActionResolution[];
}): ResolveTacticalRotationResult => {
  let scenario = normalizeCombatScenario(params.scenario);
  const activationResolution = resolveTurnFeatureActivations(params.rotation);
  const resolvedRotation = activationResolution.rotation;
  const issues: RuleValidationIssue[] = [...activationResolution.issues];
  const events: TacticalEffectEvent[] = [];
  const resolutions = params.resolutions ?? [];
  let actorPosition = scenario.actorPositionFeet ?? 0;
  let actorMapPosition = actorMapPoint(scenario);
  let movementSpent = 0;
  const speed = scenario.actorSpeedFeet ?? 30;
  let targets = scenario.targets!.map((target) => ({ ...target, effects: [...target.effects], conditions: [...target.conditions] }));
  let log = [...(scenario.tacticalLog ?? [])];

  for (const turnAction of resolvedRotation.actions) {
    const actionResolution = resolutionForAction(resolutions, turnAction);
    const fallbackTargetId = actionResolution.targetId ?? turnAction.targetId ?? targets[0].id;
    const targetResults = targetResultsForAction(actionResolution, fallbackTargetId);
    const targetLimit = tacticalActionTargetLimit(turnAction.action);
    const uniqueTargetIds = new Set(targetResults.map((entry) => entry.targetId));
    if (uniqueTargetIds.size !== targetResults.length) {
      issues.push({ severity: 'error', code: 'TACTICAL_DUPLICATE_TARGET_RESULT', message: `${turnAction.name} possui o mesmo alvo mais de uma vez na resolução.` });
    }
    if (targetLimit !== undefined && targetResults.length > targetLimit) {
      issues.push({ severity: 'error', code: 'TACTICAL_TARGET_LIMIT_EXCEEDED', message: `${turnAction.name} permite no máximo ${targetLimit} alvo(s), mas recebeu ${targetResults.length}.` });
    }
    const primaryTargetId = targetResults[0]?.targetId ?? fallbackTargetId;
    let primaryTargetIndex = targets.findIndex((target) => target.id === primaryTargetId);
    if (primaryTargetIndex < 0) primaryTargetIndex = 0;
    let primaryTarget = targets[primaryTargetIndex];

    const move = resolveMovement(scenario, actorPosition, actorMapPosition, turnAction, primaryTarget, Math.max(0, speed - movementSpent));
    actorPosition = move.position;
    actorMapPosition = move.mapPosition;
    movementSpent += move.cost;
    if (move.issue) issues.push(move.issue);
    if (move.actualDistance > 0) {
      log.push(logEntry(scenario, 'movement', `${params.character.name || 'Personagem'} moveu ${move.actualDistance} pés (${turnAction.movement?.kind ?? 'movimento'}) antes de ${turnAction.name}${move.difficultTerrainFeet > 0 ? `, atravessando ~${move.difficultTerrainFeet} pés de terreno difícil` : ''}.`, primaryTarget.id, turnAction.id));
    }

    if (turnAction.action.type === 'attack') {
      const existingVex = activeEffect(primaryTarget, 'vex');
      if (existingVex) {
        primaryTarget = { ...primaryTarget, effects: primaryTarget.effects.filter((entry) => entry.id !== existingVex.id) };
        targets[primaryTargetIndex] = primaryTarget;
        log.push(logEntry(scenario, 'mastery', `Vex foi consumido pelo ataque ${turnAction.name} contra ${primaryTarget.name}.`, primaryTarget.id, turnAction.id));
      }
    }

    const primaryResult = targetResults[0] ?? { targetId: primaryTarget.id, confirmedHits: actionResolution.confirmedHits };
    const hits = Math.max(0, Math.floor(primaryResult.confirmedHits ?? actionResolution.confirmedHits));
    if (hits > 0 && turnAction.action.type === 'attack' && turnAction.action.mastery) {
      const mastery = turnAction.action.mastery;
      if (mastery.property === 'sap') {
        primaryTarget = replaceEffect(primaryTarget, effect({ scenario, characterId: params.character.id, rotationId: resolvedRotation.id, actionId: turnAction.id, kind: 'sap', label: 'Sap', expiry: 'startOfSourceTurn', remainingUses: 1 }));
        events.push({ id: createId('tacticalEvent'), actionId: turnAction.id, targetId: primaryTarget.id, kind: 'sap', label: 'Sap', description: 'Desvantagem no próximo ataque do alvo.', applied: true });
      }
      if (mastery.property === 'slow') {
        primaryTarget = replaceEffect(primaryTarget, effect({ scenario, characterId: params.character.id, rotationId: resolvedRotation.id, actionId: turnAction.id, kind: 'slow', label: 'Slow', expiry: 'startOfSourceTurn', speedPenaltyFeet: 10 }));
        events.push({ id: createId('tacticalEvent'), actionId: turnAction.id, targetId: primaryTarget.id, kind: 'slow', label: 'Slow', description: 'Speed reduzida em 10 pés, sem acumular.', applied: true });
      }
      if (mastery.property === 'vex') {
        primaryTarget = replaceEffect(primaryTarget, effect({ scenario, characterId: params.character.id, rotationId: resolvedRotation.id, actionId: turnAction.id, kind: 'vex', label: 'Vex', expiry: 'endOfSourceTurn', remainingUses: 1 }));
        events.push({ id: createId('tacticalEvent'), actionId: turnAction.id, targetId: primaryTarget.id, kind: 'vex', label: 'Vex', description: 'Vantagem no próximo ataque contra este alvo.', applied: true });
      }
      if (mastery.property === 'topple') {
        if (actionResolution.toppleSave === 'failure') {
          primaryTarget = replaceEffect(primaryTarget, effect({ scenario, characterId: params.character.id, rotationId: resolvedRotation.id, actionId: turnAction.id, kind: 'prone', label: 'Prone', expiry: 'manual', notes: `Falhou na salvaguarda de CON CD ${mastery.saveDC ?? '?'}.` }));
          if (!primaryTarget.conditions.includes('prone')) primaryTarget = { ...primaryTarget, conditions: [...primaryTarget.conditions, 'prone'] };
          events.push({ id: createId('tacticalEvent'), actionId: turnAction.id, targetId: primaryTarget.id, kind: 'prone', label: 'Topple', description: 'O alvo falhou na salvaguarda e ficou Prone.', applied: true });
        } else {
          events.push({ id: createId('tacticalEvent'), actionId: turnAction.id, targetId: primaryTarget.id, kind: 'prone', label: 'Topple', description: actionResolution.toppleSave === 'success' ? 'O alvo passou na salvaguarda.' : 'Salvaguarda ainda não resolvida.', applied: false });
        }
      }
      if (mastery.property === 'push') {
        const sizeOrder = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
        const max = mastery.maxTargetSize ? sizeOrder.indexOf(mastery.maxTargetSize) : sizeOrder.length - 1;
        if (sizeOrder.indexOf(primaryTarget.size) <= max) {
          const distance = (mastery.forcedMovementFt ?? 10) * hits;
          primaryTarget = moveTargetAwayFromActor({ ...scenario, actorPositionFeet: actorPosition, actorMapPosition }, primaryTarget, distance);
          events.push({ id: createId('tacticalEvent'), actionId: turnAction.id, targetId: primaryTarget.id, kind: 'push', label: 'Push', description: `${primaryTarget.name} foi movido ${distance} pés.`, applied: true });
        }
      }
    }

    targets[primaryTargetIndex] = primaryTarget;

    if (turnAction.action.type === 'attack' && turnAction.action.mastery?.property === 'cleave' && hits > 0 && targetResults.length > 1) {
      const secondaryResult = targetResults[1]!;
      const secondaryIndex = targets.findIndex((entry) => entry.id === secondaryResult.targetId);
      if (secondaryIndex >= 0 && secondaryResult.targetId !== primaryTarget.id) {
        const secondary = targets[secondaryIndex]!;
        const adjacent = tacticalDistanceBetweenTargets(scenario, secondary, primaryTarget) <= 5;
        if (!adjacent) {
          issues.push({ severity: 'error', code: 'TACTICAL_CLEAVE_TARGET_NOT_ADJACENT', message: `${secondary.name} precisa estar a até 5 pés de ${primaryTarget.name} para Cleave.` });
        } else if ((secondaryResult.confirmedHits ?? 0) > 0) {
          events.push({ id: createId('tacticalEvent'), actionId: turnAction.id, targetId: secondary.id, kind: 'cleave', label: 'Cleave', description: `Ataque secundário de Cleave acertou ${secondary.name}.`, applied: true });
        }
      }
    }

    for (const targetResult of targetResults) {
      const targetIndex = targets.findIndex((entry) => entry.id === targetResult.targetId);
      if (targetIndex < 0) {
        issues.push({ severity: 'warning', code: 'TACTICAL_TARGET_RESULT_MISSING', message: `O alvo ${targetResult.targetId} não existe mais no cenário para ${turnAction.name}.` });
        continue;
      }
      if (turnAction.action.type === 'attack' && turnAction.action.mastery?.property === 'cleave' && targetIndex !== primaryTargetIndex) {
        const adjacent = tacticalDistanceBetweenTargets(scenario, targets[targetIndex]!, targets[primaryTargetIndex]!) <= 5;
        if (!adjacent) continue;
      }

      let target = targets[targetIndex]!;
      const targetHits = Math.max(0, Math.floor(targetResult.confirmedHits ?? (targetIndex === primaryTargetIndex ? hits : 0)));
      const rawDamage = Math.max(0, Math.floor(targetResult.damage ?? 0));
      if (turnAction.action.type === 'spell' && turnAction.action.saveAbility && (targetResult.saveResult ?? 'pending') === 'pending') {
        issues.push({ severity: 'error', code: 'TACTICAL_TARGET_SAVE_PENDING', message: `Resolva a salvaguarda de ${turnAction.action.saveAbility} de ${target.name} antes de concluir ${turnAction.name}.` });
        continue;
      }
      const damage = saveAdjustedDamage(turnAction.action, rawDamage, targetResult.saveResult);
      if (rawDamage > 0) {
        const before = target.hitPoints?.current;
        target = applyDamageToTacticalTarget(target, damage);
        log.push(logEntry(
          scenario,
          'damage',
          `${turnAction.name} causou ${damage} de dano em ${target.name}${targetResult.saveResult === 'success' && turnAction.action.type === 'spell' && turnAction.action.saveSuccessDamage === 'half' ? ` (metade de ${rawDamage} após sucesso no save)` : ''}${before !== undefined ? ` (${before} → ${target.hitPoints?.current ?? before} PV)` : ''}.`,
          target.id,
          turnAction.id
        ));
      }

      if (turnAction.action.type === 'spell' && turnAction.action.saveAbility && targetResult.saveResult && targetResult.saveResult !== 'pending') {
        log.push(logEntry(scenario, 'savingThrow', `${target.name}: salvaguarda de ${turnAction.action.saveAbility} contra ${turnAction.name} — ${targetResult.saveResult === 'success' ? 'sucesso' : 'falha'}.`, target.id, turnAction.id));
      }

      const actionConditions = turnAction.action.type === 'spell' ? turnAction.action.conditionIds ?? [] : [];
      const explicitConditions = targetResult.conditionIds ?? [];
      const shouldApplyActionConditions = turnAction.action.type === 'spell'
        && actionConditions.length > 0
        && (turnAction.action.saveAbility ? targetResult.saveResult === 'failure' : targetHits > 0 || rawDamage > 0);
      const conditions = [...explicitConditions, ...(shouldApplyActionConditions ? actionConditions : [])];
      if (conditions.length) {
        target = applyConditionsToTacticalTarget(target, conditions);
        log.push(logEntry(scenario, 'condition', `${target.name} recebeu: ${Array.from(new Set(conditions)).join(', ')} por ${turnAction.name}.`, target.id, turnAction.id));
      }

      if (targetHits > 0 && turnAction.action.type === 'spell' && turnAction.action.forcedMovementFt) {
        const sizeOrder = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
        const maxIndex = turnAction.action.forcedMovementMaxTargetSize ? sizeOrder.indexOf(turnAction.action.forcedMovementMaxTargetSize) : sizeOrder.length - 1;
        if (sizeOrder.indexOf(target.size) <= maxIndex) {
          const distance = turnAction.action.forcedMovementFt * targetHits;
          target = moveTargetAwayFromActor({ ...scenario, actorPositionFeet: actorPosition, actorMapPosition }, target, distance);
          events.push({ id: createId('tacticalEvent'), actionId: turnAction.id, targetId: target.id, kind: 'repellingBlast', label: 'Repelling Blast', description: `${target.name} foi empurrado ${distance} pés.`, applied: true });
        }
      }

      targets[targetIndex] = target;
    }

    for (const event of events.filter((entry) => entry.actionId === turnAction.id)) {
      log.push(logEntry(scenario, event.kind === 'push' || event.kind === 'repellingBlast' ? 'forcedMovement' : 'mastery', `${event.label}: ${event.description}`, event.targetId, turnAction.id));
    }
  }

  const newBattlefieldItems = [
    ...ammunitionBattlefieldItems(resolvedRotation, scenario.round ?? 1),
    ...thrownWeaponBattlefieldItems(resolvedRotation, params.character, scenario.round ?? 1)
  ];
  scenario = {
    ...scenario,
    actorPositionFeet: actorPosition,
    actorMapPosition: scenario.spatialMode === 'map2d' ? actorMapPosition : scenario.actorMapPosition,
    targets,
    battlefieldItems: [...(scenario.battlefieldItems ?? []), ...newBattlefieldItems],
    tacticalLog: [...log, logEntry(scenario, 'turn', `Rotação ${resolvedRotation.name} resolvida no round ${scenario.round ?? 1}.`)],
    updatedAt: now()
  };

  return {
    scenario,
    issues,
    effects: events,
    battlefieldItems: newBattlefieldItems,
    movement: {
      speedFeet: speed,
      movementSpentFeet: movementSpent,
      movementRemainingFeet: Math.max(0, speed - movementSpent),
      difficultTerrain: Boolean(scenario.difficultTerrain) || (scenario.spatialMode === 'map2d' && (scenario.terrainRegions?.length ?? 0) > 0),
      finalPositionFeet: actorPosition,
      finalMapPosition: scenario.spatialMode === 'map2d' ? actorMapPosition : undefined
    }
  };
};

export const advanceScenarioToNextSourceTurn = (scenario: CombatScenario): CombatScenario => {
  const normalized = normalizeCombatScenario(scenario);
  const targets = normalized.targets!.map((target) => ({
    ...target,
    effects: target.effects.filter((effect) => {
      if (effect.expiry === 'startOfSourceTurn') return false;
      if (effect.kind === 'vex' && (effect.expiry === 'afterNextAttackAgainstTarget' || effect.expiry === 'endOfSourceTurn')) {
        return effect.appliedRound >= (normalized.round ?? 1);
      }
      return true;
    })
  }));
  const nextRound = (normalized.round ?? 1) + 1;
  return {
    ...normalized,
    round: nextRound,
    targets,
    tacticalLog: [...(normalized.tacticalLog ?? []), logEntry(normalized, 'turn', `Início do round ${nextRound}: efeitos que expiravam no início do turno foram removidos.`)],
    updatedAt: now()
  };
};

export const consumeTargetAttack = (scenario: CombatScenario, targetId: string): CombatScenario => {
  const normalized = normalizeCombatScenario(scenario);
  const target = tacticalTargetById(normalized, targetId);
  const sap = activeEffect(target, 'sap');
  const targets = normalized.targets!.map((entry) => entry.id === target.id ? {
    ...entry,
    effects: sap ? entry.effects.filter((effect) => effect.id !== sap.id) : entry.effects
  } : entry);
  return {
    ...normalized,
    targets,
    tacticalLog: sap ? [...(normalized.tacticalLog ?? []), logEntry(normalized, 'mastery', `Sap foi consumido no próximo ataque de ${target.name}.`, target.id)] : normalized.tacticalLog,
    updatedAt: now()
  };
};

export const clearTargetCondition = (scenario: CombatScenario, targetId: string, condition: string): CombatScenario => {
  const normalized = normalizeCombatScenario(scenario);
  return {
    ...normalized,
    targets: normalized.targets!.map((target) => target.id === targetId ? {
      ...target,
      conditions: target.conditions.filter((entry) => entry !== condition),
      effects: target.effects.filter((effect) => !(condition === 'prone' && effect.kind === 'prone'))
    } : target),
    updatedAt: now()
  };
};

export const checkRotationThrownWeapons = (rotation: TurnRotation, character: Character): { ok: boolean; issues: RuleValidationIssue[]; costs: Array<{ weaponId: string; label: string; amount: number }> } => {
  const grouped = new Map<string, { weaponId: string; label: string; amount: number }>();
  for (const entry of rotation.actions) {
    const action = entry.action;
    if (action.type !== 'attack' || !action.thrownWeapon || !action.weaponId) continue;
    const weapon = character.weapons.find((candidate) => candidate.id === action.weaponId);
    if (!weapon) continue;
    const current = grouped.get(weapon.id) ?? { weaponId: weapon.id, label: weapon.name, amount: 0 };
    current.amount += Math.max(1, turnActionAttackCount(entry));
    grouped.set(weapon.id, current);
  }
  const costs = Array.from(grouped.values());
  const issues = costs.flatMap((cost) => {
    const weapon = character.weapons.find((candidate) => candidate.id === cost.weaponId);
    const available = weapon?.quantity ?? 0;
    return available < cost.amount ? [{
      severity: 'error' as const,
      code: 'THROWN_WEAPON_INSUFFICIENT',
      message: `Armas arremessadas insuficientes: ${cost.label} exige ${cost.amount}, mas a ficha possui ${available}.`
    }] : [];
  });
  return { ok: issues.length === 0, issues, costs };
};

export const spendRotationThrownWeapons = (character: Character, rotation: TurnRotation): Character => {
  const costs = new Map<string, number>();
  for (const entry of rotation.actions) {
    const action = entry.action;
    if (action.type !== 'attack' || !action.thrownWeapon || !action.weaponId) continue;
    costs.set(action.weaponId, (costs.get(action.weaponId) ?? 0) + Math.max(1, turnActionAttackCount(entry)));
  }
  return {
    ...character,
    weapons: character.weapons.map((weapon) => ({
      ...weapon,
      quantity: Math.max(0, (weapon.quantity ?? 1) - (costs.get(weapon.id) ?? 0))
    }))
  };
};

const addRecoveredAmmunition = (character: Character, item: BattlefieldItem, quantity: number): Character => {
  const index = character.equipment.findIndex((entry) => equipmentAmmunitionType(entry.name, entry.ammunitionType) === item.ammunitionType);
  if (index >= 0) {
    return {
      ...character,
      equipment: character.equipment.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: entry.quantity + quantity } : entry)
    };
  }
  const equipment: Equipment = {
    id: createId('equipment'),
    name: item.label,
    quantity,
    ammunitionType: item.ammunitionType,
    tags: ['ammunition', 'recovered']
  };
  return { ...character, equipment: [...character.equipment, equipment] };
};

export const recoverBattlefieldItem = (params: {
  character: Character;
  scenario: CombatScenario;
  battlefieldItemId: string;
}): { character: Character; scenario: CombatScenario; recovered: number; lost: number } => {
  const scenario = normalizeCombatScenario(params.scenario);
  const item = scenario.battlefieldItems!.find((entry) => entry.id === params.battlefieldItemId);
  if (!item || !item.recoverable || item.recoveryMode === 'none') return { character: params.character, scenario, recovered: 0, lost: item?.quantity ?? 0 };
  const recovered = Math.max(0, Math.min(item.quantity, Math.floor(item.quantity * Math.max(0, Math.min(100, item.recoveryPercent)) / 100)));
  const lost = Math.max(0, item.quantity - recovered);
  let character = params.character;
  if (recovered > 0 && item.kind === 'ammunition') character = addRecoveredAmmunition(character, item, recovered);
  if (recovered > 0 && item.kind === 'thrownWeapon' && item.weaponId) {
    character = {
      ...character,
      weapons: character.weapons.map((weapon) => weapon.id === item.weaponId ? { ...weapon, quantity: (weapon.quantity ?? 0) + recovered } : weapon)
    };
  }
  const nextScenario: CombatScenario = {
    ...scenario,
    battlefieldItems: scenario.battlefieldItems!.filter((entry) => entry.id !== item.id),
    tacticalLog: [...(scenario.tacticalLog ?? []), logEntry(scenario, 'recovery', `${item.label}: ${recovered} recuperado(s), ${lost} perdido(s).`)],
    updatedAt: now()
  };
  return { character, scenario: nextScenario, recovered, lost };
};

export const recoverAutomaticBattlefieldItems = (params: { character: Character; scenario: CombatScenario }): { character: Character; scenario: CombatScenario; recovered: number; lost: number } => {
  let character = params.character;
  let scenario = normalizeCombatScenario(params.scenario);
  let recovered = 0;
  let lost = 0;
  const ids = (scenario.battlefieldItems ?? []).filter((item) => item.recoveryMode === 'automatic').map((item) => item.id);
  for (const battlefieldItemId of ids) {
    const result = recoverBattlefieldItem({ character, scenario, battlefieldItemId });
    character = result.character;
    scenario = result.scenario;
    recovered += result.recovered;
    lost += result.lost;
  }
  return { character, scenario, recovered, lost };
};
