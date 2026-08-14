import {
  ActiveEffect,
  ActiveEffectDurationUnit,
  ActiveEffectTransaction,
  Character,
  CombatState,
  RestType,
  RuleValidationIssue
} from '../../types';
import { createId } from '../../utils/id';

const nowIso = () => new Date().toISOString();

const clampRemaining = (value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  return Math.max(0, Math.floor(value));
};

export const normalizeActiveEffect = (effect: ActiveEffect): ActiveEffect => ({
  ...effect,
  kind: effect.kind ?? 'buff',
  status: effect.status ?? 'active',
  sourceType: effect.sourceType ?? 'manual',
  conditionIds: effect.conditionIds ?? [],
  duration: {
    unit: effect.duration?.unit ?? 'manual',
    remaining: clampRemaining(effect.duration?.remaining),
    expiresOn: effect.duration?.expiresOn ?? 'turnStart'
  },
  createdAt: effect.createdAt ?? nowIso()
});

export const activeEffectConditionIds = (character: Character): string[] => {
  const ids = new Set<string>();
  for (const effect of character.activeEffects ?? []) {
    if (effect.status === 'expired' || effect.status === 'removed') continue;
    for (const conditionId of effect.conditionIds ?? []) ids.add(conditionId);
  }
  return [...ids];
};

export const getActiveConcentrationEffect = (character: Character): ActiveEffect | undefined =>
  (character.activeEffects ?? []).find((effect) => effect.concentration && effect.status === 'active');

export const buildCombatStateWithActiveEffects = (character: Character, combatState: CombatState): CombatState => {
  const conditionIds = new Set([...(combatState.activeConditionIds ?? []), ...activeEffectConditionIds(character)]);
  const concentration = getActiveConcentrationEffect(character);
  return {
    ...combatState,
    activeConditionIds: [...conditionIds],
    concentratingOn: combatState.concentratingOn ?? concentration?.name
  };
};

export const addActiveEffectToCharacter = (character: Character, effect: ActiveEffect): Character => {
  const normalized = normalizeActiveEffect(effect);
  const existingConcentration = getActiveConcentrationEffect(character);
  const effects = (character.activeEffects ?? []).filter((item) => {
    if (!normalized.concentration) return true;
    return !(item.concentration && item.status === 'active');
  });
  const transaction: ActiveEffectTransaction = {
    id: createId('effecttx'),
    characterId: character.id,
    effectId: normalized.id,
    effectName: normalized.name,
    action: 'started',
    reason: existingConcentration && normalized.concentration ? `Substituiu concentração em ${existingConcentration.name}` : 'Efeito iniciado',
    createdAt: nowIso()
  };
  const endedTransaction: ActiveEffectTransaction | undefined = existingConcentration && normalized.concentration
    ? {
        id: createId('effecttx'),
        characterId: character.id,
        effectId: existingConcentration.id,
        effectName: existingConcentration.name,
        action: 'ended',
        reason: `Concentração substituída por ${normalized.name}`,
        createdAt: nowIso()
      }
    : undefined;
  return {
    ...character,
    activeEffects: [...effects, normalized],
    activeEffectTransactions: [
      ...(character.activeEffectTransactions ?? []),
      ...(endedTransaction ? [endedTransaction] : []),
      transaction
    ]
  };
};

export const removeActiveEffectFromCharacter = (character: Character, effectId: string, reason = 'Efeito removido'): Character => {
  const effect = (character.activeEffects ?? []).find((item) => item.id === effectId);
  if (!effect) return character;
  const transaction: ActiveEffectTransaction = {
    id: createId('effecttx'),
    characterId: character.id,
    effectId: effect.id,
    effectName: effect.name,
    action: 'ended',
    reason,
    createdAt: nowIso()
  };
  return {
    ...character,
    activeEffects: (character.activeEffects ?? []).filter((item) => item.id !== effectId),
    activeEffectTransactions: [...(character.activeEffectTransactions ?? []), transaction]
  };
};

const shouldTick = (unit: ActiveEffectDurationUnit, restType: RestType): boolean => {
  if (restType === 'turnStart') return unit === 'turn' || unit === 'round';
  if (restType === 'shortRest') return unit === 'minute' || unit === 'turn' || unit === 'round';
  if (restType === 'longRest') return unit !== 'manual';
  return false;
};

const restClearsEffect = (effect: ActiveEffect, restType: RestType): boolean => {
  if (restType === 'longRest') return effect.endsOnLongRest ?? true;
  if (restType === 'shortRest') return effect.endsOnShortRest ?? false;
  return false;
};

export const advanceActiveEffects = (character: Character, restType: RestType): Character => {
  const transactions: ActiveEffectTransaction[] = [];
  const nextEffects: ActiveEffect[] = [];

  for (const effect of character.activeEffects ?? []) {
    if (effect.status === 'expired' || effect.status === 'removed') continue;
    const normalized = normalizeActiveEffect(effect);
    if (restClearsEffect(normalized, restType)) {
      transactions.push({
        id: createId('effecttx'),
        characterId: character.id,
        effectId: normalized.id,
        effectName: normalized.name,
        action: 'expired',
        reason: restType === 'longRest' ? 'Expirou no descanso longo' : 'Expirou no descanso curto',
        restType,
        createdAt: nowIso()
      });
      continue;
    }

    const duration = normalized.duration;
    if (duration.unit !== 'manual' && duration.remaining !== undefined && shouldTick(duration.unit, restType)) {
      const remaining = Math.max(0, duration.remaining - 1);
      if (remaining <= 0) {
        transactions.push({
          id: createId('effecttx'),
          characterId: character.id,
          effectId: normalized.id,
          effectName: normalized.name,
          action: 'expired',
          reason: 'Duração chegou a 0',
          restType,
          createdAt: nowIso()
        });
        continue;
      }
      nextEffects.push({ ...normalized, duration: { ...duration, remaining } });
    } else {
      nextEffects.push(normalized);
    }
  }

  return {
    ...character,
    activeEffects: nextEffects,
    activeEffectTransactions: [...(character.activeEffectTransactions ?? []), ...transactions]
  };
};


export type ActiveEffectTurnBoundary = 'turnStart' | 'turnEnd';

export const advanceActiveEffectsAtTurnBoundary = (
  character: Character,
  boundary: ActiveEffectTurnBoundary
): Character => {
  const transactions: ActiveEffectTransaction[] = [];
  const nextEffects: ActiveEffect[] = [];

  for (const effect of character.activeEffects ?? []) {
    if (effect.status === 'expired' || effect.status === 'removed') continue;
    const normalized = normalizeActiveEffect(effect);
    const duration = normalized.duration;
    const expiresOn = duration.expiresOn ?? 'turnStart';
    const shouldAdvance =
      duration.unit !== 'manual' &&
      duration.remaining !== undefined &&
      expiresOn === boundary &&
      (duration.unit === 'turn' || duration.unit === 'round');

    if (!shouldAdvance) {
      nextEffects.push(normalized);
      continue;
    }

    const remaining = Math.max(0, (duration.remaining ?? 0) - 1);
    if (remaining <= 0) {
      transactions.push({
        id: createId('effecttx'),
        characterId: character.id,
        effectId: normalized.id,
        effectName: normalized.name,
        action: 'expired',
        reason: boundary === 'turnStart' ? 'Expirou no início do turno' : 'Expirou no fim do turno',
        restType: boundary === 'turnStart' ? 'turnStart' : undefined,
        createdAt: nowIso()
      });
      continue;
    }

    nextEffects.push({ ...normalized, duration: { ...duration, remaining } });
    transactions.push({
      id: createId('effecttx'),
      characterId: character.id,
      effectId: normalized.id,
      effectName: normalized.name,
      action: 'advanced',
      reason: boundary === 'turnStart' ? 'Duração avançada no início do turno' : 'Duração avançada no fim do turno',
      restType: boundary === 'turnStart' ? 'turnStart' : undefined,
      createdAt: nowIso()
    });
  }

  return {
    ...character,
    activeEffects: nextEffects,
    activeEffectTransactions: [...(character.activeEffectTransactions ?? []), ...transactions]
  };
};

export const clearConcentration = (character: Character, reason = 'Concentração encerrada'): Character => {
  const concentration = getActiveConcentrationEffect(character);
  if (!concentration) return character;
  return removeActiveEffectFromCharacter(character, concentration.id, reason);
};

export const validateActiveEffectConflicts = (character: Character, combatState: CombatState): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  const concentrationEffects = (character.activeEffects ?? []).filter((effect) => effect.concentration && effect.status === 'active');
  if (concentrationEffects.length > 1) {
    issues.push({
      severity: 'error',
      code: 'ACTIVE_CONCENTRATION_DUPLICATE',
      message: `Personagem possui múltiplas concentrações ativas: ${concentrationEffects.map((effect) => effect.name).join(', ')}.`
    });
  }
  if (combatState.concentratingOn && concentrationEffects.length && combatState.concentratingOn !== concentrationEffects[0].name) {
    issues.push({
      severity: 'warning',
      code: 'COMBAT_STATE_CONCENTRATION_OVERRIDE',
      message: `Estado de combate informa concentração em "${combatState.concentratingOn}", mas a ficha concentra em "${concentrationEffects[0].name}".`
    });
  }
  return issues;
};
