import type {
  ActiveEffect,
  Character,
  CharacterAction,
  CombatScenario,
  RollMode,
  RuleValidationIssue,
  SpellAction,
  SpellSlotLevel,
  TacticalParticipant,
  TacticalPendingReaction,
  TacticalCombatLogEntry,
  TacticalReadyAction,
  TacticalTarget,
  TacticalTargetStatBlockAction,
  TurnAction,
  TurnRotation
} from '../../types';
import { createId } from '../../utils/id';
import { buildAvailableActions } from '../actions/buildActions';
import {
  addActiveEffectToCharacter,
  advanceActiveEffectsAtTurnBoundary,
  clearConcentration,
  getActiveConcentrationEffect,
  removeActiveEffectFromCharacter
} from '../effects/activeEffects';
import { checkRotationResources, spendRotationResources } from '../resources/resourceManager';
import { checkRotationSpellSlots, spendRotationSpellSlots, toSpellSlotLevel } from '../resources/spellSlotManager';
import { currentSpellHandState, hasWarCaster, validateSpellComponents } from '../../characters/spellComponentRules';
import { effectiveTargetSpeed, normalizeCombatScenario, tacticalTargetById } from './tacticalCombat';
import { getAbilityModifier, getArmorClass, getProficiencyBonus } from '../characters/derivedStats';
import { resolveCustomNumericModifiers, resolveCustomRollModifiers } from '../../characters/customModifierRules';
import { rollStatBlockActionDamage, statBlockActionDamageRange, statBlockActionMaximumRange } from '../../characters/tacticalStatBlockRules';
import {
  actorMapPoint,
  moveMapPointRelativeTo,
  tacticalDiagonalRule,
  tacticalDistanceBetweenPoints,
  tacticalDistanceToTarget,
  tacticalMovementCostBetweenPoints,
  targetMapPoint
} from '../targeting/spatialMap';

const now = (): string => new Date().toISOString();

const issue = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({ severity, code, message });

export const actorParticipantId = (characterId: string): string => `character:${characterId}`;
export const targetParticipantId = (targetId: string): string => `target:${targetId}`;

const log = (
  scenario: CombatScenario,
  kind: NonNullable<CombatScenario['tacticalLog']>[number]['kind'],
  message: string,
  targetId?: string,
  actionId?: string
) => ({
  id: createId('tacticalLog'),
  round: scenario.round ?? 1,
  kind,
  message,
  targetId,
  actionId,
  createdAt: now()
});

const defaultInitiative = (kind: TacticalParticipant['kind'], index: number): number => kind === 'character' ? 20 : Math.max(1, 15 - index);

export const ensureTacticalParticipants = (scenarioInput: CombatScenario, characterName = 'Personagem'): CombatScenario => {
  const scenario = normalizeCombatScenario(scenarioInput);
  const existing = new Map((scenario.participants ?? []).map((participant) => [participant.id, participant]));
  const actorId = actorParticipantId(scenario.characterId);
  const actorExisting = existing.get(actorId);
  const actor: TacticalParticipant = {
    id: actorId,
    kind: 'character',
    name: characterName.trim() || actorExisting?.name || 'Personagem',
    initiative: actorExisting?.initiative ?? defaultInitiative('character', 0),
    hasActed: actorExisting?.hasActed ?? false,
    reactionAvailable: actorExisting?.reactionAvailable ?? true,
    movementSpentFeet: actorExisting?.movementSpentFeet ?? 0,
    startedRound: actorExisting?.startedRound,
    endedRound: actorExisting?.endedRound
  };
  const targets = (scenario.targets ?? []).map((target, index): TacticalParticipant => {
    const id = targetParticipantId(target.id);
    const current = existing.get(id);
    return {
      id,
      kind: 'target',
      targetId: target.id,
      name: target.name,
      initiative: current?.initiative ?? target.initiative ?? defaultInitiative('target', index),
      hasActed: current?.hasActed ?? false,
      reactionAvailable: current?.reactionAvailable ?? true,
      movementSpentFeet: current?.movementSpentFeet ?? 0,
      startedRound: current?.startedRound,
      endedRound: current?.endedRound
    };
  });
  const validIds = new Set([actor.id, ...targets.map((participant) => participant.id)]);
  const activeParticipantId = scenario.activeParticipantId && validIds.has(scenario.activeParticipantId)
    ? scenario.activeParticipantId
    : undefined;
  return {
    ...scenario,
    participants: [actor, ...targets].sort((left, right) => right.initiative - left.initiative || left.name.localeCompare(right.name)),
    activeParticipantId,
    turnPhase: activeParticipantId ? 'active' : 'idle',
    readyActions: scenario.readyActions ?? []
  };
};

const removeTargetEffectsAtSourceBoundary = (
  scenario: CombatScenario,
  boundary: 'turnStart' | 'turnEnd'
): { scenario: CombatScenario; removedLabels: string[] } => {
  const round = scenario.round ?? 1;
  const removedLabels: string[] = [];
  const targets = (scenario.targets ?? []).map((target) => ({
    ...target,
    effects: target.effects.filter((effect) => {
      const expiresAtStart = boundary === 'turnStart' && effect.expiry === 'startOfSourceTurn' && effect.appliedRound < round;
      const expiresAtEnd = boundary === 'turnEnd' && effect.expiry === 'endOfSourceTurn' && effect.appliedRound < round;
      if (expiresAtStart || expiresAtEnd) removedLabels.push(`${effect.label} em ${target.name}`);
      return !(expiresAtStart || expiresAtEnd);
    })
  }));
  return { scenario: { ...scenario, targets }, removedLabels };
};

export interface TacticalTurnResult {
  scenario: CombatScenario;
  character: Character;
  issues: RuleValidationIssue[];
}

export const startTacticalTurn = (params: {
  scenario: CombatScenario;
  character: Character;
  participantId: string;
}): TacticalTurnResult => {
  let scenario = ensureTacticalParticipants(params.scenario, params.character.name);
  let character = params.character;
  const issues: RuleValidationIssue[] = [];
  const participant = scenario.participants?.find((entry) => entry.id === params.participantId);
  if (!participant) return { scenario, character, issues: [issue('error', 'TACTICAL_PARTICIPANT_NOT_FOUND', 'Participante não encontrado no cenário.')] };
  if (scenario.activeParticipantId && scenario.activeParticipantId !== participant.id) {
    return { scenario, character, issues: [issue('error', 'TACTICAL_TURN_ALREADY_ACTIVE', `Encerre o turno de ${scenario.participants?.find((entry) => entry.id === scenario.activeParticipantId)?.name ?? 'outro participante'} antes de iniciar outro.`)] };
  }
  if (participant.hasActed) return { scenario, character, issues: [issue('error', 'TACTICAL_PARTICIPANT_ALREADY_ACTED', `${participant.name} já agiu neste round.`)] };

  let removedLabels: string[] = [];
  if (participant.kind === 'character') {
    const boundary = removeTargetEffectsAtSourceBoundary(scenario, 'turnStart');
    scenario = boundary.scenario;
    removedLabels = boundary.removedLabels;
    character = advanceActiveEffectsAtTurnBoundary(character, 'turnStart');
  }

  const readyActions = (scenario.readyActions ?? []).filter((ready) => {
    const expired = ready.participantId === participant.id && ready.createdRound < (scenario.round ?? 1);
    if (expired) {
      removedLabels.push(`Ready: ${ready.actionName}`);
      if (ready.heldEffectId) character = removeActiveEffectFromCharacter(character, ready.heldEffectId, `Ready expirou antes de ${ready.actionName} ser liberada.`);
    }
    return !expired;
  });

  scenario = {
    ...scenario,
    activeParticipantId: participant.id,
    turnPhase: 'active',
    readyActions,
    participants: scenario.participants?.map((entry) => entry.id === participant.id ? {
      ...entry,
      reactionAvailable: true,
      movementSpentFeet: 0,
      startedRound: scenario.round ?? 1
    } : entry),
    tacticalLog: [
      ...(scenario.tacticalLog ?? []),
      log(scenario, 'turn', `Início do turno de ${participant.name}.${removedLabels.length ? ` Expiraram: ${removedLabels.join(', ')}.` : ''}`)
    ],
    updatedAt: now()
  };
  return { scenario, character, issues };
};

export const endTacticalTurn = (params: {
  scenario: CombatScenario;
  character: Character;
}): TacticalTurnResult => {
  let scenario = ensureTacticalParticipants(params.scenario, params.character.name);
  let character = params.character;
  const active = scenario.participants?.find((entry) => entry.id === scenario.activeParticipantId);
  if (!active) return { scenario, character, issues: [issue('error', 'TACTICAL_NO_ACTIVE_TURN', 'Nenhum turno está ativo.')] };

  let removedLabels: string[] = [];
  if (active.kind === 'character') {
    const boundary = removeTargetEffectsAtSourceBoundary(scenario, 'turnEnd');
    scenario = boundary.scenario;
    removedLabels = boundary.removedLabels;
    character = advanceActiveEffectsAtTurnBoundary(character, 'turnEnd');
  }

  let participants = (scenario.participants ?? []).map((entry) => entry.id === active.id ? {
    ...entry,
    hasActed: true,
    endedRound: scenario.round ?? 1
  } : entry);
  const allActed = participants.length > 0 && participants.every((entry) => entry.hasActed);
  let round = scenario.round ?? 1;
  const entries = [log(scenario, 'turn', `Fim do turno de ${active.name}.${removedLabels.length ? ` Expiraram: ${removedLabels.join(', ')}.` : ''}`)];
  if (allActed) {
    round += 1;
    participants = participants.map((entry) => ({ ...entry, hasActed: false, movementSpentFeet: 0 }));
    entries.push({ ...log({ ...scenario, round }, 'turn', `Todos os participantes agiram. Início do round ${round}.`), round });
  }
  scenario = {
    ...scenario,
    round,
    participants,
    activeParticipantId: undefined,
    turnPhase: 'idle',
    tacticalLog: [...(scenario.tacticalLog ?? []), ...entries],
    updatedAt: now()
  };
  return { scenario, character, issues: [] };
};

const consumeSap = (target: TacticalTarget): { target: TacticalTarget; hadSap: boolean } => {
  const sap = target.effects.find((effect) => effect.kind === 'sap');
  if (!sap) return { target, hadSap: false };
  return { target: { ...target, effects: target.effects.filter((effect) => effect.id !== sap.id) }, hadSap: true };
};

const applyDamageToCharacter = (character: Character, amount: number): Character => {
  const damage = Math.max(0, Math.floor(amount));
  const hp = character.hitPoints ?? { current: 0, max: 0, temporary: 0 };
  const temporarySpent = Math.min(hp.temporary, damage);
  const remaining = damage - temporarySpent;
  return {
    ...character,
    hitPoints: {
      ...hp,
      temporary: hp.temporary - temporarySpent,
      current: Math.max(0, hp.current - remaining)
    }
  };
};

export interface TargetAttackResult extends TacticalTurnResult {
  rollMode: RollMode;
  concentrationDC?: number;
}

export const recordTargetAttack = (params: {
  scenario: CombatScenario;
  character: Character;
  targetId: string;
  attackName: string;
  hit: boolean;
  damage?: number;
  concentrationSave?: 'success' | 'failure' | 'pending';
}): TargetAttackResult => {
  let scenario = ensureTacticalParticipants(params.scenario, params.character.name);
  let character = params.character;
  const target = tacticalTargetById(scenario, params.targetId);
  const activeId = targetParticipantId(target.id);
  const issues: RuleValidationIssue[] = [];
  if (scenario.activeParticipantId !== activeId) issues.push(issue('error', 'TARGET_ATTACK_OUTSIDE_TURN', `Inicie o turno de ${target.name} antes de registrar o ataque.`));
  if (issues.length) return { scenario, character, issues, rollMode: 'normal' };

  const sapResult = consumeSap(target);
  const rollMode: RollMode = sapResult.hadSap ? 'disadvantage' : 'normal';
  const damage = params.hit ? Math.max(0, Math.floor(params.damage ?? 0)) : 0;
  const hpBefore = character.hitPoints?.current ?? 0;
  if (damage > 0) character = applyDamageToCharacter(character, damage);
  const entries = [
    log(scenario, 'attack', `${target.name} usou ${params.attackName || 'Ataque'}${sapResult.hadSap ? ' com desvantagem por Sap' : ''}: ${params.hit ? 'acertou' : 'errou'}.`, target.id)
  ];
  if (damage > 0) entries.push(log(scenario, 'damage', `${character.name || 'Personagem'} sofreu ${damage} de dano (${hpBefore} → ${character.hitPoints?.current ?? 0} PV).`, target.id));

  let concentrationDC: number | undefined;
  const concentration = getActiveConcentrationEffect(character);
  if (damage > 0 && concentration) {
    concentrationDC = Math.max(10, Math.floor(damage / 2));
    const result = params.concentrationSave ?? 'pending';
    if (result === 'failure') character = clearConcentration(character, `Falhou no teste de concentração CD ${concentrationDC} após sofrer ${damage} de dano.`);
    entries.push(log(
      scenario,
      'concentration',
      result === 'success'
        ? `Teste de concentração CD ${concentrationDC}: sucesso; ${concentration.name} continua.`
        : result === 'failure'
          ? `Teste de concentração CD ${concentrationDC}: falha; ${concentration.name} foi encerrada.`
          : `Teste de concentração CD ${concentrationDC} pendente para ${concentration.name}.`,
      target.id
    ));
  }

  scenario = {
    ...scenario,
    targets: scenario.targets?.map((entry) => entry.id === target.id ? sapResult.target : entry),
    tacticalLog: [...(scenario.tacticalLog ?? []), ...entries],
    updatedAt: now()
  };
  return { scenario, character, issues, rollMode, concentrationDC };
};

export const recordTargetSavingThrow = (params: {
  scenario: CombatScenario;
  characterName?: string;
  targetId: string;
  ability: string;
  dc?: number;
  result: 'success' | 'failure';
  failureCondition?: string;
}): CombatScenario => {
  const scenario = ensureTacticalParticipants(params.scenario, params.characterName);
  const target = tacticalTargetById(scenario, params.targetId);
  const condition = params.result === 'failure' ? params.failureCondition?.trim() : undefined;
  return {
    ...scenario,
    targets: scenario.targets?.map((entry) => entry.id === target.id && condition && !entry.conditions.includes(condition)
      ? { ...entry, conditions: [...entry.conditions, condition] }
      : entry),
    tacticalLog: [...(scenario.tacticalLog ?? []), log(scenario, 'savingThrow', `${target.name}: salvaguarda de ${params.ability}${params.dc ? ` CD ${params.dc}` : ''} — ${params.result === 'success' ? 'sucesso' : 'falha'}${condition ? `; condição aplicada: ${condition}` : ''}.`, target.id)],
    updatedAt: now()
  };
};

const targetActionRoll = (rng: () => number): number =>
  Math.floor(Math.max(0, Math.min(0.999999999, rng())) * 20) + 1;

const targetActionDamage = (
  action: TacticalTargetStatBlockAction,
  mode: 'average' | 'roll',
  critical: boolean,
  rng: () => number
): { amount: number; average: number; unresolvedTokens: string[] } => {
  const range = statBlockActionDamageRange(action, critical);
  if (mode === 'average') {
    return {
      amount: Math.max(0, Math.floor(range.average)),
      average: range.average,
      unresolvedTokens: range.unresolvedTokens
    };
  }
  const rolled = rollStatBlockActionDamage(action, { critical, rng });
  return { amount: rolled.total, average: range.average, unresolvedTokens: rolled.unresolvedTokens };
};

const applyTargetActionConditions = (
  character: Character,
  target: TacticalTarget,
  action: TacticalTargetStatBlockAction
): Character => {
  if (!action.conditionIds?.length) return character;
  const existing = new Set(character.activeEffects.flatMap((effect) => effect.status === 'active' ? effect.conditionIds ?? [] : []));
  const conditionIds = action.conditionIds.filter((conditionId) => !existing.has(conditionId));
  if (!conditionIds.length) return character;
  const conditionEffect: ActiveEffect = {
    id: createId('effect'),
    name: `${target.name} · ${action.name}`,
    kind: 'condition',
    sourceType: 'condition',
    status: 'active',
    conditionIds,
    duration: { unit: 'manual', expiresOn: 'manual' },
    notes: `Condição aplicada pela ação de stat block ${action.name} de ${target.name}.`,
    createdAt: now()
  };
  return { ...character, activeEffects: [...character.activeEffects, conditionEffect] };
};

const spendTargetStatBlockResource = (
  target: TacticalTarget,
  action: TacticalTargetStatBlockAction
): TacticalTarget => {
  if (!action.resourceId) return target;
  return {
    ...target,
    statBlockResources: (target.statBlockResources ?? []).map((resource) =>
      resource.id === action.resourceId
        ? { ...resource, current: Math.max(0, resource.current - 1) }
        : resource
    )
  };
};

const targetActionResourceIssue = (
  target: TacticalTarget,
  action: TacticalTargetStatBlockAction
): RuleValidationIssue | undefined => {
  if (!action.resourceId) return undefined;
  const resource = target.statBlockResources?.find((entry) => entry.id === action.resourceId);
  if (!resource) return issue('error', 'TARGET_STATBLOCK_RESOURCE_MISSING', `O recurso de ${action.name} não foi encontrado no alvo.`);
  if (resource.current <= 0) return issue('error', 'TARGET_STATBLOCK_RESOURCE_EMPTY', `${action.name} está sem usos disponíveis.`);
  return undefined;
};

const applyIncomingDamageWithConcentration = (params: {
  scenario: CombatScenario;
  character: Character;
  target: TacticalTarget;
  action: TacticalTargetStatBlockAction;
  damage: number;
  concentrationSave: 'success' | 'failure' | 'pending';
}): { character: Character; entries: TacticalCombatLogEntry[]; concentrationDC?: number } => {
  let character = params.character;
  const entries: TacticalCombatLogEntry[] = [];
  const incomingModifier = resolveCustomNumericModifiers(character, 'damageTaken', {
    damageTypes: params.action.damageType ? [params.action.damageType] : []
  });
  const damage = Math.max(0, Math.floor((params.damage + incomingModifier.add) * incomingModifier.multiplier));
  if (damage <= 0) return { character, entries };
  const hpBefore = character.hitPoints?.current ?? 0;
  character = applyDamageToCharacter(character, damage);
  entries.push(log(params.scenario, 'damage', `${character.name || 'Personagem'} sofreu ${damage} de dano de ${params.target.name} · ${params.action.name} (${hpBefore} → ${character.hitPoints?.current ?? 0} PV).`, params.target.id, params.action.id));

  let concentrationDC: number | undefined;
  const concentration = getActiveConcentrationEffect(character);
  if (concentration) {
    concentrationDC = Math.max(10, Math.floor(damage / 2));
    if (params.concentrationSave === 'failure') {
      character = clearConcentration(character, `Falhou no teste de concentração CD ${concentrationDC} após sofrer ${damage} de dano.`);
    }
    entries.push(log(
      params.scenario,
      'concentration',
      params.concentrationSave === 'success'
        ? `Teste de concentração CD ${concentrationDC}: sucesso; ${concentration.name} continua.`
        : params.concentrationSave === 'failure'
          ? `Teste de concentração CD ${concentrationDC}: falha; ${concentration.name} foi encerrada.`
          : `Teste de concentração CD ${concentrationDC} pendente para ${concentration.name}.`,
      params.target.id,
      params.action.id
    ));
  }
  return { character, entries, concentrationDC };
};

export interface TargetStatBlockActionResult extends TacticalTurnResult {
  action?: TacticalTargetStatBlockAction;
  rollMode?: RollMode;
  attackRolls?: number[];
  attackRoll?: number;
  attackTotal?: number;
  characterArmorClass?: number;
  hit?: boolean;
  critical?: boolean;
  saveRoll?: number;
  saveBonus?: number;
  saveTotal?: number;
  saveDC?: number;
  saveSuccess?: boolean;
  damage?: number;
  damageAverage?: number;
  concentrationDC?: number;
}

/**
 * Resolve uma ação estruturada importada de creatureStatBlock contra o personagem.
 * A resolução automática exige attackBonus/saveDC numéricos. Fórmulas dependentes de
 * caster/spell level permanecem disponíveis no alvo, mas precisam do fluxo manual.
 */
export const resolveTargetStatBlockAction = (params: {
  scenario: CombatScenario;
  character: Character;
  targetId: string;
  actionId: string;
  damageMode?: 'average' | 'roll';
  concentrationSave?: 'success' | 'failure' | 'pending';
  rng?: () => number;
}): TargetStatBlockActionResult => {
  let scenario = ensureTacticalParticipants(params.scenario, params.character.name);
  let character = params.character;
  let target = tacticalTargetById(scenario, params.targetId);
  const action = target.statBlockActions?.find((entry) => entry.id === params.actionId);
  const issues: RuleValidationIssue[] = [];
  if (!action) return { scenario, character, issues: [issue('error', 'TARGET_STATBLOCK_ACTION_NOT_FOUND', 'A ação do stat block não foi encontrada.')] };

  const participantId = targetParticipantId(target.id);
  const participant = scenario.participants?.find((entry) => entry.id === participantId);
  if (action.section === 'reaction') {
    if (!participant?.reactionAvailable) issues.push(issue('error', 'TARGET_REACTION_UNAVAILABLE', `${target.name} já usou sua reação.`));
  } else if (scenario.activeParticipantId !== participantId) {
    issues.push(issue('error', 'TARGET_STATBLOCK_ACTION_OUTSIDE_TURN', `Inicie o turno de ${target.name} antes de usar ${action.name}.`));
  }
  const resourceIssue = targetActionResourceIssue(target, action);
  if (resourceIssue) issues.push(resourceIssue);
  if (issues.length) return { scenario, character, issues, action };

  const rng = params.rng ?? Math.random;
  const damageMode = params.damageMode ?? 'average';
  const concentrationSave = params.concentrationSave ?? 'pending';
  const distance = tacticalDistanceToTarget(scenario, target);
  const range = statBlockActionMaximumRange(action);
  if (distance > range.long) {
    issues.push(issue('error', 'TARGET_STATBLOCK_ACTION_OUT_OF_RANGE', `${action.name} alcança no máximo ${range.long} pés, mas o personagem está a ${distance} pés.`));
    return { scenario, character, issues, action };
  }

  let updatedTarget = target;
  const entries: TacticalCombatLogEntry[] = [];
  let damage = 0;
  let damageAverage = 0;
  let concentrationDC: number | undefined;
  let rollMode: RollMode = 'normal';
  let attackRolls: number[] | undefined;
  let attackRoll: number | undefined;
  let attackTotal: number | undefined;
  let characterArmorClass: number | undefined;
  let hit: boolean | undefined;
  let critical = false;
  let saveRoll: number | undefined;
  let saveBonus: number | undefined;
  let saveTotal: number | undefined;
  let saveDC: number | undefined;
  let saveSuccess: boolean | undefined;

  if (action.type === 'attack') {
    if (action.attackBonus === undefined) {
      issues.push(issue('error', 'TARGET_STATBLOCK_ATTACK_BONUS_UNRESOLVED', `${action.name} usa bônus de ataque dinâmico (${action.attackBonusFormula ?? 'não informado'}). Resolva pelo formulário manual.`));
      return { scenario, character, issues, action };
    }
    const sapResult = consumeSap(target);
    updatedTarget = sapResult.target;
    const longRange = distance > range.normal;
    rollMode = sapResult.hadSap || longRange ? 'disadvantage' : 'normal';
    attackRolls = rollMode === 'disadvantage' ? [targetActionRoll(rng), targetActionRoll(rng)] : [targetActionRoll(rng)];
    attackRoll = rollMode === 'disadvantage' ? Math.min(...attackRolls) : attackRolls[0];
    characterArmorClass = getArmorClass(character);
    attackTotal = attackRoll + action.attackBonus;
    critical = attackRoll === 20;
    hit = critical || (attackRoll !== 1 && attackTotal >= characterArmorClass);
    if (hit) {
      const resolvedDamage = targetActionDamage(action, damageMode, critical, rng);
      damage = resolvedDamage.amount;
      damageAverage = resolvedDamage.average;
      if (resolvedDamage.unresolvedTokens.length) issues.push(issue('warning', 'TARGET_STATBLOCK_DAMAGE_PARTIAL', `${action.name} possui partes de dano não resolvidas automaticamente: ${resolvedDamage.unresolvedTokens.join(', ')}.`));
      if (action.conditionIds?.length) character = applyTargetActionConditions(character, target, action);
    }
    entries.push(log(scenario, 'attack', `${target.name} usou ${action.name}${rollMode === 'disadvantage' ? ' com desvantagem' : ''}: d20 ${attackRoll} + ${action.attackBonus} = ${attackTotal} contra CA ${characterArmorClass} — ${hit ? 'acertou' : 'errou'}${critical ? ' (crítico)' : ''}.`, target.id, action.id));
  } else if (action.type === 'saveEffect') {
    if (!action.saveAbility || action.saveDC === undefined) {
      issues.push(issue('error', 'TARGET_STATBLOCK_SAVE_UNRESOLVED', `${action.name} possui salvaguarda dinâmica (${action.saveAbility ?? '?'} / ${action.saveDCFormula ?? '?'}). Resolva manualmente.`));
      return { scenario, character, issues, action };
    }
    saveDC = action.saveDC;
    const saveModifier = resolveCustomRollModifiers(character, 'savingThrow', { ability: action.saveAbility });
    const saveRolls = saveModifier.rollMode === 'normal' ? [targetActionRoll(rng)] : [targetActionRoll(rng), targetActionRoll(rng)];
    saveRoll = saveModifier.rollMode === 'advantage' ? Math.max(...saveRolls) : saveModifier.rollMode === 'disadvantage' ? Math.min(...saveRolls) : saveRolls[0];
    const baseSaveBonus = getAbilityModifier(character.abilities, action.saveAbility) + (character.proficiencies.savingThrows.includes(action.saveAbility) ? getProficiencyBonus(character) : 0);
    saveBonus = Math.floor((baseSaveBonus + saveModifier.add) * saveModifier.multiplier);
    saveTotal = saveRoll + saveBonus;
    saveSuccess = saveTotal >= saveDC;
    const fullDamage = targetActionDamage(action, damageMode, false, rng);
    damageAverage = fullDamage.average;
    if (fullDamage.unresolvedTokens.length) issues.push(issue('warning', 'TARGET_STATBLOCK_DAMAGE_PARTIAL', `${action.name} possui partes de dano não resolvidas automaticamente: ${fullDamage.unresolvedTokens.join(', ')}.`));
    damage = saveSuccess
      ? action.saveSuccessDamage === 'half' ? Math.floor(fullDamage.amount / 2) : 0
      : fullDamage.amount;
    if (!saveSuccess && action.conditionIds?.length) character = applyTargetActionConditions(character, target, action);
    entries.push(log(scenario, 'savingThrow', `${character.name || 'Personagem'} fez salvaguarda de ${action.saveAbility} contra ${target.name} · ${action.name}: d20 ${saveRoll} + ${saveBonus} = ${saveTotal} contra CD ${saveDC} — ${saveSuccess ? 'sucesso' : 'falha'}.`, target.id, action.id));
  } else {
    entries.push(log(scenario, action.section === 'reaction' ? 'reaction' : 'turn', `${target.name} usou ${action.name}${action.trigger ? ` (${action.trigger})` : ''}.`, target.id, action.id));
  }

  updatedTarget = spendTargetStatBlockResource(updatedTarget, action);
  if (damage > 0) {
    const incoming = applyIncomingDamageWithConcentration({ scenario, character, target, action, damage, concentrationSave });
    character = incoming.character;
    entries.push(...incoming.entries);
    concentrationDC = incoming.concentrationDC;
  }

  scenario = {
    ...scenario,
    targets: scenario.targets?.map((entry) => entry.id === target.id ? updatedTarget : entry),
    participants: action.section === 'reaction'
      ? scenario.participants?.map((entry) => entry.id === participantId ? { ...entry, reactionAvailable: false } : entry)
      : scenario.participants,
    tacticalLog: [...(scenario.tacticalLog ?? []), ...entries],
    updatedAt: now()
  };

  return {
    scenario,
    character,
    issues,
    action,
    rollMode,
    attackRolls,
    attackRoll,
    attackTotal,
    characterArmorClass,
    hit,
    critical,
    saveRoll,
    saveBonus,
    saveTotal,
    saveDC,
    saveSuccess,
    damage,
    damageAverage,
    concentrationDC
  };
};

export const rechargeTargetStatBlockResource = (params: {
  scenario: CombatScenario;
  targetId: string;
  resourceId: string;
  rng?: () => number;
}): { scenario: CombatScenario; issues: RuleValidationIssue[]; roll?: number; recharged: boolean } => {
  const scenario = normalizeCombatScenario(params.scenario);
  const target = tacticalTargetById(scenario, params.targetId);
  const resource = target.statBlockResources?.find((entry) => entry.id === params.resourceId);
  if (!resource) return { scenario, issues: [issue('error', 'TARGET_STATBLOCK_RESOURCE_MISSING', 'Recurso do stat block não encontrado.')], recharged: false };
  if (resource.current >= resource.max) return { scenario, issues: [], recharged: false };
  if (resource.recharge !== 'rechargeRoll') {
    const updated = {
      ...target,
      statBlockResources: target.statBlockResources?.map((entry) => entry.id === resource.id ? { ...entry, current: entry.max } : entry)
    };
    return {
      scenario: {
        ...scenario,
        targets: scenario.targets?.map((entry) => entry.id === target.id ? updated : entry),
        tacticalLog: [...(scenario.tacticalLog ?? []), log(scenario, 'resource', `${target.name} recuperou ${resource.name}.`, target.id, resource.sourceActionId)],
        updatedAt: now()
      },
      issues: [],
      recharged: true
    };
  }

  const rng = params.rng ?? Math.random;
  const roll = Math.floor(Math.max(0, Math.min(0.999999999, rng())) * 6) + 1;
  const recharged = roll >= (resource.rechargeMin ?? 6) && roll <= (resource.rechargeMax ?? 6);
  const updated = recharged ? {
    ...target,
    statBlockResources: target.statBlockResources?.map((entry) => entry.id === resource.id ? { ...entry, current: entry.max } : entry)
  } : target;
  return {
    scenario: {
      ...scenario,
      targets: scenario.targets?.map((entry) => entry.id === target.id ? updated : entry),
      tacticalLog: [...(scenario.tacticalLog ?? []), log(scenario, 'resource', `${target.name} rolou recarga de ${resource.name}: d6 ${roll}${recharged ? ' — recuperado' : ' — ainda indisponível'}.`, target.id, resource.sourceActionId)],
      updatedAt: now()
    },
    issues: [],
    roll,
    recharged
  };
};

const updateParticipantMovement = (scenario: CombatScenario, participantId: string, spent: number): CombatScenario => ({
  ...scenario,
  participants: scenario.participants?.map((participant) => participant.id === participantId ? { ...participant, movementSpentFeet: spent } : participant)
});

export const moveTargetDuringTurn = (params: {
  scenario: CombatScenario;
  characterName?: string;
  targetId: string;
  distanceFeet: number;
  direction: 'towardActor' | 'awayFromActor';
  actorReachFeet?: number;
}): { scenario: CombatScenario; issues: RuleValidationIssue[]; opportunityProvoked: boolean } => {
  let scenario = ensureTacticalParticipants(params.scenario, params.characterName);
  const target = tacticalTargetById(scenario, params.targetId);
  const participantId = targetParticipantId(target.id);
  const participant = scenario.participants?.find((entry) => entry.id === participantId);
  const issues: RuleValidationIssue[] = [];
  if (scenario.activeParticipantId !== participantId) issues.push(issue('error', 'TARGET_MOVE_OUTSIDE_TURN', `Inicie o turno de ${target.name} antes de movê-lo.`));
  const requested = Math.max(0, Math.floor(params.distanceFeet));
  const speed = effectiveTargetSpeed(target);
  const spent = participant?.movementSpentFeet ?? 0;
  const reach = Math.max(5, params.actorReachFeet ?? 5);
  const actor = scenario.participants?.find((entry) => entry.kind === 'character');

  let cost = 0;
  let beforeDistance = 0;
  let afterDistance = 0;
  let nextTarget = target;
  let crossesDifficultTerrain = Boolean(scenario.difficultTerrain);

  if (scenario.spatialMode === 'map2d') {
    const actorPoint = actorMapPoint(scenario);
    const startPoint = targetMapPoint(target);
    beforeDistance = tacticalDistanceBetweenPoints(startPoint, actorPoint, tacticalDiagonalRule(scenario));
    const endPoint = moveMapPointRelativeTo(
      startPoint,
      actorPoint,
      requested,
      params.direction === 'awayFromActor' ? 'away' : 'toward',
      tacticalDiagonalRule(scenario)
    );
    const movementCost = tacticalMovementCostBetweenPoints(scenario, startPoint, endPoint);
    cost = movementCost.costFeet;
    crossesDifficultTerrain = movementCost.crossesDifficultTerrain;
    afterDistance = tacticalDistanceBetweenPoints(endPoint, actorPoint, tacticalDiagonalRule(scenario));
    nextTarget = { ...target, mapPosition: endPoint };
  } else {
    const multiplier = scenario.difficultTerrain ? 2 : 1;
    cost = requested * multiplier;
    const actorPosition = scenario.actorPositionFeet ?? 0;
    beforeDistance = Math.abs(target.positionFeet - actorPosition);
    const direction = target.positionFeet >= actorPosition ? 1 : -1;
    const delta = params.direction === 'awayFromActor' ? direction * requested : -direction * requested;
    const positionFeet = Math.max(0, target.positionFeet + delta);
    afterDistance = Math.abs(positionFeet - actorPosition);
    nextTarget = { ...target, positionFeet };
  }

  if (spent + cost > speed) {
    issues.push(issue('error', 'TARGET_MOVEMENT_EXCEEDS_SPEED', `${target.name} só possui ${Math.max(0, speed - spent)} pés de movimento disponíveis${crossesDifficultTerrain ? ' e o trajeto atravessa terreno difícil' : ''}.`));
  }
  if (issues.length) return { scenario, issues, opportunityProvoked: false };

  const opportunityProvoked = beforeDistance <= reach && afterDistance > reach && Boolean(actor?.reactionAvailable);
  const pendingReaction: TacticalPendingReaction | undefined = opportunityProvoked && actor ? {
    id: createId('reaction'),
    kind: 'opportunityAttack',
    reactorParticipantId: actor.id,
    provokingTargetId: target.id,
    targetId: target.id,
    trigger: `${target.name} saiu do alcance de ${reach} pés.`,
    createdRound: scenario.round ?? 1
  } : scenario.pendingReaction;

  const coordinateText = scenario.spatialMode === 'map2d' && nextTarget.mapPosition
    ? ` para (${nextTarget.mapPosition.xFeet}, ${nextTarget.mapPosition.yFeet})`
    : '';
  scenario = updateParticipantMovement({
    ...scenario,
    targets: scenario.targets?.map((entry) => entry.id === target.id ? nextTarget : entry),
    pendingReaction,
    tacticalLog: [
      ...(scenario.tacticalLog ?? []),
      log(scenario, 'movement', `${target.name} moveu ${requested} pés ${params.direction === 'awayFromActor' ? 'afastando-se' : 'aproximando-se'} do personagem${coordinateText}${crossesDifficultTerrain ? ` (custo ${cost} ft por terreno difícil)` : ''}.${opportunityProvoked ? ' Um ataque de oportunidade foi provocado.' : ''}`, target.id)
    ],
    updatedAt: now()
  }, participantId, spent + cost);
  return { scenario, issues, opportunityProvoked };
};

export const standTargetFromProne = (params: {
  scenario: CombatScenario;
  characterName?: string;
  targetId: string;
}): { scenario: CombatScenario; issues: RuleValidationIssue[] } => {
  let scenario = ensureTacticalParticipants(params.scenario, params.characterName);
  const target = tacticalTargetById(scenario, params.targetId);
  const participantId = targetParticipantId(target.id);
  const participant = scenario.participants?.find((entry) => entry.id === participantId);
  const issues: RuleValidationIssue[] = [];
  if (scenario.activeParticipantId !== participantId) issues.push(issue('error', 'TARGET_STAND_OUTSIDE_TURN', `Inicie o turno de ${target.name} antes de fazê-lo levantar.`));
  if (!target.conditions.includes('prone')) issues.push(issue('warning', 'TARGET_NOT_PRONE', `${target.name} não está Prone.`));
  const speed = effectiveTargetSpeed(target);
  const cost = Math.floor(speed / 2);
  const spent = participant?.movementSpentFeet ?? 0;
  if (spent + cost > speed) issues.push(issue('error', 'TARGET_STAND_MOVEMENT_UNAVAILABLE', `${target.name} não possui movimento suficiente para se levantar.`));
  if (issues.some((entry) => entry.severity === 'error')) return { scenario, issues };
  scenario = updateParticipantMovement({
    ...scenario,
    targets: scenario.targets?.map((entry) => entry.id === target.id ? {
      ...entry,
      conditions: entry.conditions.filter((condition) => condition !== 'prone'),
      effects: entry.effects.filter((effect) => effect.kind !== 'prone')
    } : entry),
    tacticalLog: [...(scenario.tacticalLog ?? []), log(scenario, 'movement', `${target.name} gastou ${cost} pés de movimento para se levantar.`, target.id)],
    updatedAt: now()
  }, participantId, spent + cost);
  return { scenario, issues };
};

const parseRangeFeet = (range?: string): number | undefined => {
  if (!range) return undefined;
  if (/touch|toque/i.test(range)) return 5;
  const match = range.match(/(\d+)\s*(?:ft|feet|foot|p[eé]s?)/i);
  return match ? Number(match[1]) : undefined;
};

const actionSpell = (character: Character, action: SpellAction) => character.spells.find((spell) => spell.id === action.spellId);

export const eligibleOpportunityAttackActions = (character: Character): CharacterAction[] => {
  const actions = buildAvailableActions(character);
  return actions.filter((action) => {
    if (action.type !== 'attack') return false;
    const weapon = action.weaponId ? character.weapons.find((entry) => entry.id === action.weaponId) : undefined;
    if (!weapon) return false;
    if (weapon.weaponType === 'ranged') return false;
    const normalRange = action.range?.normal ?? weapon.range?.normal;
    return normalRange === undefined || normalRange <= 10;
  });
};

export const eligibleWarCasterReactionSpells = (character: Character, triggerDistanceFeet = 5): SpellAction[] => {
  if (!hasWarCaster(character)) return [];
  return buildAvailableActions(character).filter((action): action is SpellAction => {
    if (action.type !== 'spell' || action.actionCost !== 'action') return false;
    const spell = actionSpell(character, action);
    if (!spell || spell.invocationSelfOnly) return false;
    if ((action.targets ?? spell.targeting?.targets ?? 1) !== 1) return false;
    if (spell.targeting?.area) return false;
    const range = parseRangeFeet(action.range ?? spell.range);
    return range === undefined || range >= triggerDistanceFeet;
  });
};

export const setReadyAction = (params: {
  scenario: CombatScenario;
  character: Character;
  actionId: string;
  trigger: string;
  targetId?: string;
  selectedSlotLevel?: SpellSlotLevel;
}): TacticalTurnResult => {
  let scenario = ensureTacticalParticipants(params.scenario, params.character.name);
  let character = params.character;
  const actorId = actorParticipantId(params.character.id);
  const action = buildAvailableActions(params.character).find((entry) => entry.id === params.actionId);
  const issues: RuleValidationIssue[] = [];
  if (scenario.activeParticipantId !== actorId) issues.push(issue('error', 'READY_OUTSIDE_CHARACTER_TURN', 'Ready deve ser preparado durante o turno do personagem.'));
  if (!action || action.actionCost !== 'action') issues.push(issue('error', 'READY_ACTION_INELIGIBLE', 'Escolha uma ação com custo de Ação para preparar.'));
  if (!params.trigger.trim()) issues.push(issue('error', 'READY_TRIGGER_REQUIRED', 'Descreva um gatilho perceptível para a ação preparada.'));
  if (action?.type === 'spell') issues.push(...validateSpellComponents(character, action, currentSpellHandState(character)));

  const turnAction: TurnAction | undefined = action ? {
    id: createId('readyAction'),
    name: action.name,
    actionCost: 'action',
    action,
    selectedSpellSlotLevel: action.type === 'spell' ? toSpellSlotLevel(params.selectedSlotLevel ?? action.castAtSlotLevel ?? action.spellLevel) : undefined,
    targetId: params.targetId
  } : undefined;
  const rotation: TurnRotation | undefined = turnAction ? {
    id: createId('readyRotation'),
    characterId: character.id,
    name: `Ready: ${action!.name}`,
    actions: [turnAction]
  } : undefined;
  if (rotation) {
    issues.push(...checkRotationResources(rotation, character).issues);
    issues.push(...checkRotationSpellSlots(rotation, character).issues);
  }
  if (issues.some((entry) => entry.severity === 'error') || !action || !rotation) return { scenario, character, issues };

  const previousReady = scenario.readyActions?.find((entry) => entry.participantId === actorId);
  if (previousReady?.heldEffectId) character = removeActiveEffectFromCharacter(character, previousReady.heldEffectId, `Ready substituído por ${action.name}.`);
  character = spendRotationResources(character, rotation).character;
  character = spendRotationSpellSlots(character, rotation).character;
  let heldEffectId: string | undefined;
  if (action.type === 'spell') {
    heldEffectId = createId('effect');
    character = addActiveEffectToCharacter(character, {
      id: heldEffectId,
      name: `Ready: ${action.name}`,
      kind: 'spell',
      sourceType: 'spell',
      source: action.source,
      status: 'active',
      concentration: true,
      conditionIds: [],
      duration: { unit: 'manual', expiresOn: 'manual' },
      notes: `Magia preparada aguardando o gatilho: ${params.trigger.trim()}.`,
      sourceRef: action.origin,
      createdAt: now()
    });
  }

  const ready: TacticalReadyAction = {
    id: createId('ready'),
    participantId: actorId,
    actionId: action.id,
    actionName: action.name,
    trigger: params.trigger.trim(),
    targetId: params.targetId,
    selectedSlotLevel: turnAction?.selectedSpellSlotLevel,
    resourcesCommitted: true,
    heldEffectId,
    createdRound: scenario.round ?? 1
  };
  scenario = {
    ...scenario,
    readyActions: [...(scenario.readyActions ?? []).filter((entry) => entry.participantId !== actorId), ready],
    tacticalLog: [...(scenario.tacticalLog ?? []), log(scenario, 'reaction', `${params.character.name || 'Personagem'} preparou ${action.name}. Recursos foram comprometidos agora. Gatilho: ${ready.trigger}.`, params.targetId, action.id)],
    updatedAt: now()
  };
  return { scenario, character, issues };
};

export const triggerReadyAction = (params: {
  scenario: CombatScenario;
  character: Character;
  readyActionId: string;
  targetId?: string;
}): { scenario: CombatScenario; issues: RuleValidationIssue[] } => {
  let scenario = ensureTacticalParticipants(params.scenario, params.character.name);
  const ready = scenario.readyActions?.find((entry) => entry.id === params.readyActionId);
  const actor = scenario.participants?.find((entry) => entry.id === actorParticipantId(params.character.id));
  const issues: RuleValidationIssue[] = [];
  if (!ready) issues.push(issue('error', 'READY_ACTION_NOT_FOUND', 'Ação preparada não encontrada.'));
  if (!actor?.reactionAvailable) issues.push(issue('error', 'REACTION_UNAVAILABLE', 'A reação do personagem já foi usada.'));
  if (issues.length) return { scenario, issues };
  scenario = {
    ...scenario,
    pendingReaction: {
      id: createId('reaction'),
      kind: 'ready',
      reactorParticipantId: actor!.id,
      targetId: params.targetId ?? ready!.targetId,
      readyActionId: ready!.id,
      trigger: ready!.trigger,
      createdRound: scenario.round ?? 1
    },
    tacticalLog: [...(scenario.tacticalLog ?? []), log(scenario, 'reaction', `Gatilho de Ready ocorreu: ${ready!.trigger}.`, params.targetId, ready!.actionId)],
    updatedAt: now()
  };
  return { scenario, issues };
};

const applyDamageToTarget = (target: TacticalTarget, amount: number): TacticalTarget => {
  if (!target.hitPoints) return target;
  const damage = Math.max(0, Math.floor(amount));
  const temporary = target.hitPoints.temporary ?? 0;
  const tempSpent = Math.min(temporary, damage);
  return {
    ...target,
    hitPoints: {
      ...target.hitPoints,
      temporary: temporary - tempSpent,
      current: Math.max(0, target.hitPoints.current - (damage - tempSpent))
    }
  };
};

const concentrationEffectForReaction = (action: SpellAction): ActiveEffect => ({
  id: createId('effect'),
  name: action.name,
  kind: 'spell',
  sourceType: 'spell',
  source: action.source,
  status: 'active',
  concentration: true,
  conditionIds: [],
  duration: { unit: 'manual', expiresOn: 'manual' },
  notes: 'Concentração iniciada por magia conjurada como reação.',
  sourceRef: action.origin,
  createdAt: now()
});

export const resolvePendingReaction = (params: {
  scenario: CombatScenario;
  character: Character;
  actionId: string;
  selectedSlotLevel?: SpellSlotLevel;
  hit?: boolean;
  damage?: number;
}): TacticalTurnResult => {
  let scenario = ensureTacticalParticipants(params.scenario, params.character.name);
  let character = params.character;
  const pending = scenario.pendingReaction;
  const pendingReady = pending?.kind === 'ready' ? scenario.readyActions?.find((entry) => entry.id === pending.readyActionId) : undefined;
  const actorId = actorParticipantId(character.id);
  const actor = scenario.participants?.find((entry) => entry.id === actorId);
  const actions = buildAvailableActions(character);
  const action = actions.find((entry) => entry.id === params.actionId);
  const issues: RuleValidationIssue[] = [];
  if (!pending) issues.push(issue('error', 'PENDING_REACTION_NOT_FOUND', 'Não existe reação pendente.'));
  if (pending?.reactorParticipantId !== actorId) issues.push(issue('error', 'REACTION_WRONG_ACTOR', 'A reação pendente não pertence a este personagem.'));
  if (!actor?.reactionAvailable) issues.push(issue('error', 'REACTION_UNAVAILABLE', 'A reação do personagem já foi usada.'));
  if (!action) issues.push(issue('error', 'REACTION_ACTION_NOT_FOUND', 'Ação selecionada não está disponível.'));

  if (pending?.kind === 'opportunityAttack' && action) {
    const isWeapon = eligibleOpportunityAttackActions(character).some((entry) => entry.id === action.id);
    const isWarCasterSpell = eligibleWarCasterReactionSpells(character).some((entry) => entry.id === action.id);
    if (!isWeapon && !isWarCasterSpell) issues.push(issue('error', 'OPPORTUNITY_REACTION_INELIGIBLE', 'A reação deve ser um ataque corpo a corpo elegível ou uma magia válida de War Caster.'));
  }
  if (pending?.kind === 'ready') {
    const ready = scenario.readyActions?.find((entry) => entry.id === pending.readyActionId);
    if (!ready || ready.actionId !== action?.id) issues.push(issue('error', 'READY_REACTION_ACTION_MISMATCH', 'A ação usada deve ser a mesma preparada por Ready.'));
  }
  if (action?.type === 'spell' && !pendingReady?.resourcesCommitted) issues.push(...validateSpellComponents(character, action, currentSpellHandState(character)));

  const turnAction: TurnAction | undefined = action ? {
    id: createId('reactionAction'),
    name: action.name,
    actionCost: 'reaction',
    action,
    selectedSpellSlotLevel: action.type === 'spell' ? toSpellSlotLevel(pendingReady?.selectedSlotLevel ?? params.selectedSlotLevel ?? action.castAtSlotLevel ?? action.spellLevel) : undefined,
    targetId: pending?.targetId ?? pending?.provokingTargetId
  } : undefined;
  const rotation: TurnRotation | undefined = turnAction ? {
    id: createId('reactionRotation'),
    characterId: character.id,
    name: `Reação: ${action!.name}`,
    actions: [turnAction]
  } : undefined;
  if (rotation && !pendingReady?.resourcesCommitted) {
    issues.push(...checkRotationResources(rotation, character).issues);
    issues.push(...checkRotationSpellSlots(rotation, character).issues);
  }
  if (issues.some((entry) => entry.severity === 'error') || !pending || !action || !rotation) return { scenario, character, issues };

  if (!pendingReady?.resourcesCommitted) {
    character = spendRotationResources(character, rotation).character;
    character = spendRotationSpellSlots(character, rotation).character;
  }
  if (pendingReady?.heldEffectId) character = removeActiveEffectFromCharacter(character, pendingReady.heldEffectId, `Ready liberado: ${action.name}.`);
  if (action.type === 'spell' && action.concentration) character = addActiveEffectToCharacter(character, concentrationEffectForReaction(action));

  const targetId = pending.targetId ?? pending.provokingTargetId;
  const target = targetId ? tacticalTargetById(scenario, targetId) : undefined;
  const damage = params.hit === false ? 0 : Math.max(0, Math.floor(params.damage ?? 0));
  scenario = {
    ...scenario,
    targets: target && damage > 0 ? scenario.targets?.map((entry) => entry.id === target.id ? applyDamageToTarget(entry, damage) : entry) : scenario.targets,
    participants: scenario.participants?.map((entry) => entry.id === actorId ? { ...entry, reactionAvailable: false } : entry),
    readyActions: pending.kind === 'ready' ? (scenario.readyActions ?? []).filter((entry) => entry.id !== pending.readyActionId) : scenario.readyActions,
    pendingReaction: undefined,
    tacticalLog: [
      ...(scenario.tacticalLog ?? []),
      log(scenario, 'reaction', `${character.name || 'Personagem'} usou a reação ${action.name}${params.hit === false ? ' e errou' : params.hit === true ? ' e acertou' : ''}${damage ? `, causando ${damage} de dano` : ''}.`, targetId, action.id)
    ],
    updatedAt: now()
  };
  return { scenario, character, issues };
};

export const cancelReadyAction = (params: {
  scenario: CombatScenario;
  character: Character;
  readyActionId: string;
}): TacticalTurnResult => {
  const scenario = ensureTacticalParticipants(params.scenario, params.character.name);
  const ready = scenario.readyActions?.find((entry) => entry.id === params.readyActionId);
  if (!ready) return { scenario, character: params.character, issues: [issue('error', 'READY_ACTION_NOT_FOUND', 'Ação preparada não encontrada.')] };
  const character = ready.heldEffectId
    ? removeActiveEffectFromCharacter(params.character, ready.heldEffectId, `Ready cancelado: ${ready.actionName}.`)
    : params.character;
  return {
    character,
    issues: [],
    scenario: {
      ...scenario,
      readyActions: (scenario.readyActions ?? []).filter((entry) => entry.id !== ready.id),
      pendingReaction: scenario.pendingReaction?.readyActionId === ready.id ? undefined : scenario.pendingReaction,
      tacticalLog: [...(scenario.tacticalLog ?? []), log(scenario, 'reaction', `Ready cancelado: ${ready.actionName}. Recursos gastos não foram recuperados.`, ready.targetId, ready.actionId)],
      updatedAt: now()
    }
  };
};

export const declinePendingReaction = (scenarioInput: CombatScenario, characterName?: string): CombatScenario => {
  const scenario = ensureTacticalParticipants(scenarioInput, characterName);
  if (!scenario.pendingReaction) return scenario;
  return {
    ...scenario,
    pendingReaction: undefined,
    tacticalLog: [...(scenario.tacticalLog ?? []), log(scenario, 'reaction', 'A reação pendente foi ignorada.')],
    updatedAt: now()
  };
};
