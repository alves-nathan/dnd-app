import {
  Character,
  RestType,
  RuleValidationIssue,
  SpellSlotAvailabilityResult,
  SpellSlotCost,
  SpellSlotLevel,
  SpellSlotPool,
  SpellSlotPoolKind,
  SpellSlotTransaction,
  TurnAction,
  TurnRotation
} from '../../types';
import { createId } from '../../utils/id';

export const SPELL_SLOT_LEVELS: SpellSlotLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const issue = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({ severity, code, message });

export const isSpellSlotLevel = (value: unknown): value is SpellSlotLevel =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9;

export const toSpellSlotLevel = (value: unknown): SpellSlotLevel | undefined => {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return isSpellSlotLevel(numeric) ? numeric : undefined;
};

export const spellSlotLabel = (level: SpellSlotLevel): string => `${level}º círculo`;

export const spellSlotPoolLabel = (slot: SpellSlotPool): string => {
  const base = spellSlotLabel(slot.level);
  if (slot.poolKind === 'pactMagic') return `${base} · Pact Magic${slot.sourceClassName ? ` (${slot.sourceClassName})` : ''}`;
  if (slot.poolKind === 'spellcasting') return `${base} · Spellcasting`;
  return base;
};

export const spellSlotPoolKey = (slot: SpellSlotPool): string =>
  `${slot.poolKind ?? 'manual'}:${slot.sourceClassId ?? 'shared'}:${slot.level}`;

export const normalizeSpellSlotPool = (slot: SpellSlotPool): SpellSlotPool => {
  const level = toSpellSlotLevel(slot.level) ?? 1;
  const max = Math.max(0, Math.floor(Number(slot.max) || 0));
  const current = Math.max(0, Math.min(Math.floor(Number(slot.current) || 0), max));
  const recharge = slot.recharge === 'shortRest' || slot.recharge === 'manual' ? slot.recharge : 'longRest';
  const poolKind: SpellSlotPoolKind = slot.poolKind === 'spellcasting' || slot.poolKind === 'pactMagic' ? slot.poolKind : 'manual';
  return {
    ...slot,
    id: slot.id ?? `slot-${poolKind}-${slot.sourceClassId ?? 'shared'}-${level}`,
    level,
    max,
    current,
    recharge,
    poolKind
  };
};

export const normalizeSpellSlots = (slots: SpellSlotPool[] = []): SpellSlotPool[] => {
  const byKey = new Map<string, SpellSlotPool>();
  for (const slot of slots) {
    const normalized = normalizeSpellSlotPool(slot);
    const key = spellSlotPoolKey(normalized);
    const existing = byKey.get(key);
    byKey.set(key, existing ? normalizeSpellSlotPool({
      ...normalized,
      max: existing.max + normalized.max,
      current: existing.current + normalized.current
    }) : normalized);
  }
  return Array.from(byKey.values()).sort((left, right) => left.level - right.level || spellSlotPoolKey(left).localeCompare(spellSlotPoolKey(right)));
};

export const findSpellSlotPools = (
  character: Character,
  level: SpellSlotLevel,
  filter?: { poolKind?: SpellSlotPoolKind; sourceClassId?: string }
): SpellSlotPool[] =>
  normalizeSpellSlots(character.spellSlots ?? [])
    .filter((slot) => slot.level === level)
    .filter((slot) => filter?.poolKind ? slot.poolKind === filter.poolKind : true)
    .filter((slot) => filter?.sourceClassId ? slot.sourceClassId === filter.sourceClassId : true)
    .sort((left, right) => {
      const weight = (slot: SpellSlotPool) => slot.poolKind === 'spellcasting' ? 0 : slot.poolKind === 'pactMagic' ? 1 : 2;
      return weight(left) - weight(right);
    });

export const findSpellSlotPool = (character: Character, level: SpellSlotLevel): SpellSlotPool | undefined =>
  findSpellSlotPools(character, level)[0];

export const spellSlotCostsFromTurnAction = (turnAction: TurnAction): SpellSlotCost[] => {
  const action = turnAction.action;
  if (action.type === 'attack') {
    const enabledConditions = new Set(turnAction.enabledConditionIds ?? []);
    return (action.conditionalSpellSlotCosts ?? [])
      .filter((cost) => enabledConditions.has(cost.conditionId))
      .map(({ conditionId: _conditionId, ...cost }) => ({
        ...cost,
        amount: Math.max(1, Math.floor(Number(cost.amount) || 1))
      }));
  }
  if (action.consumesSpellSlot === false) return [];
  const minimumSlotLevel = toSpellSlotLevel(action.minimumSlotLevel ?? action.spellLevel);
  if (!minimumSlotLevel) return [];
  const selectedSlotLevel = toSpellSlotLevel(turnAction.selectedSpellSlotLevel ?? action.castAtSlotLevel ?? minimumSlotLevel) ?? minimumSlotLevel;
  return [{
    slotLevel: selectedSlotLevel,
    minimumSlotLevel,
    amount: Math.max(1, Math.floor(Number(turnAction.repeat) || 1)),
    spellId: action.spellId,
    spellName: action.name,
    label: `${action.name} (${spellSlotLabel(selectedSlotLevel)})`
  }];
};

export const spellSlotCostsFromRotation = (rotation: TurnRotation): SpellSlotCost[] =>
  rotation.actions.flatMap((turnAction) => spellSlotCostsFromTurnAction(turnAction));

interface PoolState { slot: SpellSlotPool; remaining: number }

const allocateCost = (states: Map<string, PoolState>, character: Character, cost: SpellSlotCost): boolean => {
  const pools = findSpellSlotPools(character, cost.slotLevel, { poolKind: cost.poolKind, sourceClassId: cost.sourceClassId });
  let needed = cost.amount;
  for (const pool of pools) {
    const state = states.get(spellSlotPoolKey(pool));
    if (!state || needed <= 0) continue;
    const spent = Math.min(state.remaining, needed);
    state.remaining -= spent;
    needed -= spent;
  }
  return needed === 0;
};

export const checkSpellSlotAvailability = (
  character: Character,
  costs: SpellSlotCost[],
  overrides: Partial<Record<SpellSlotLevel, number>> = {}
): SpellSlotAvailabilityResult => {
  const issues: RuleValidationIssue[] = [];
  const normalizedSlots = normalizeSpellSlots(character.spellSlots ?? []);
  const states = new Map<string, PoolState>(normalizedSlots.map((slot) => [spellSlotPoolKey(slot), { slot, remaining: slot.current }]));

  for (const level of SPELL_SLOT_LEVELS) {
    if (overrides[level] === undefined) continue;
    const pools = normalizedSlots.filter((slot) => slot.level === level);
    let remainingOverride = Math.max(0, overrides[level] ?? 0);
    for (const pool of pools) {
      const state = states.get(spellSlotPoolKey(pool));
      if (!state) continue;
      state.remaining = Math.min(pool.max, remainingOverride);
      remainingOverride = Math.max(0, remainingOverride - state.remaining);
    }
  }

  for (const cost of costs) {
    if (cost.minimumSlotLevel && cost.slotLevel < cost.minimumSlotLevel) {
      issues.push(issue('error', 'SPELL_SLOT_TOO_LOW', `${cost.spellName ?? 'Magia'} exige slot mínimo de ${spellSlotLabel(cost.minimumSlotLevel)}, mas a rotação usa ${spellSlotLabel(cost.slotLevel)}.`));
      continue;
    }
    const pools = findSpellSlotPools(character, cost.slotLevel, { poolKind: cost.poolKind, sourceClassId: cost.sourceClassId });
    if (!pools.length) {
      issues.push(issue('error', 'SPELL_SLOT_NOT_FOUND', `Slot de magia não cadastrado: ${spellSlotLabel(cost.slotLevel)} para ${cost.spellName ?? cost.label ?? 'magia'}.`));
      continue;
    }
    const available = pools.reduce((sum, pool) => sum + (states.get(spellSlotPoolKey(pool))?.remaining ?? 0), 0);
    if (available < cost.amount || !allocateCost(states, character, cost)) {
      issues.push(issue('error', 'SPELL_SLOT_UNAVAILABLE', `Slot insuficiente de ${spellSlotLabel(cost.slotLevel)}: exige ${cost.amount}, disponível ${available}.`));
    }
  }

  const remaining: Partial<Record<SpellSlotLevel, number>> = {};
  for (const { slot, remaining: value } of states.values()) remaining[slot.level] = (remaining[slot.level] ?? 0) + value;
  return { ok: issues.every((item) => item.severity !== 'error'), remaining, issues, costs };
};

export const checkRotationSpellSlots = (
  rotation: TurnRotation,
  character: Character,
  overrides: Partial<Record<SpellSlotLevel, number>> = {}
): SpellSlotAvailabilityResult => checkSpellSlotAvailability(character, spellSlotCostsFromRotation(rotation), overrides);

const makeTransaction = (params: {
  characterId: string;
  slot: SpellSlotPool;
  before: number;
  after: number;
  reason: string;
  restType?: RestType;
}): SpellSlotTransaction => ({
  id: createId('slotTx'),
  characterId: params.characterId,
  poolId: params.slot.id,
  poolKind: params.slot.poolKind,
  sourceClassId: params.slot.sourceClassId,
  slotLevel: params.slot.level,
  amount: params.after - params.before,
  before: params.before,
  after: params.after,
  reason: params.reason,
  restType: params.restType,
  createdAt: new Date().toISOString()
});

export const spendSpellSlots = (params: {
  character: Character;
  costs: SpellSlotCost[];
  reason?: string;
  allowPartial?: boolean;
}): { character: Character; transactions: SpellSlotTransaction[]; issues: RuleValidationIssue[] } => {
  const availability = checkSpellSlotAvailability(params.character, params.costs);
  if (!availability.ok && !params.allowPartial) return { character: params.character, transactions: [], issues: availability.issues };

  const normalized = normalizeSpellSlots(params.character.spellSlots ?? []);
  const states = new Map<string, PoolState>(normalized.map((slot) => [spellSlotPoolKey(slot), { slot, remaining: slot.current }]));
  for (const cost of params.costs) allocateCost(states, params.character, cost);

  const transactions: SpellSlotTransaction[] = [];
  const spellSlots = normalized.map((slot) => {
    const after = states.get(spellSlotPoolKey(slot))?.remaining ?? slot.current;
    if (after === slot.current) return slot;
    transactions.push(makeTransaction({ characterId: params.character.id, slot, before: slot.current, after, reason: params.reason ?? 'Consumo de slot de magia' }));
    return { ...slot, current: after };
  });
  return {
    character: { ...params.character, spellSlots, spellSlotTransactions: [...(params.character.spellSlotTransactions ?? []), ...transactions] },
    transactions,
    issues: availability.issues
  };
};

export const spendRotationSpellSlots = (character: Character, rotation: TurnRotation) =>
  spendSpellSlots({ character, costs: spellSlotCostsFromRotation(rotation), reason: `Rotação: ${rotation.name}` });

export const adjustSpellSlot = (params: {
  character: Character;
  slotLevel: SpellSlotLevel;
  delta: number;
  reason?: string;
  poolKind?: SpellSlotPoolKind;
  sourceClassId?: string;
}) => {
  const target = findSpellSlotPools(params.character, params.slotLevel, { poolKind: params.poolKind, sourceClassId: params.sourceClassId })[0];
  if (!target) return { character: params.character, transactions: [], issues: [issue('error', 'SPELL_SLOT_NOT_FOUND', `Slot não encontrado: ${spellSlotLabel(params.slotLevel)}.`)] };
  const transactions: SpellSlotTransaction[] = [];
  const spellSlots = normalizeSpellSlots(params.character.spellSlots ?? []).map((slot) => {
    if (spellSlotPoolKey(slot) !== spellSlotPoolKey(target)) return slot;
    const before = slot.current;
    const after = Math.max(0, Math.min(slot.max, before + params.delta));
    if (before !== after) transactions.push(makeTransaction({ characterId: params.character.id, slot, before, after, reason: params.reason ?? (params.delta < 0 ? 'Gasto manual de slot' : 'Recuperação manual de slot'), restType: 'manual' }));
    return { ...slot, current: after };
  });
  return {
    character: { ...params.character, spellSlots, spellSlotTransactions: [...(params.character.spellSlotTransactions ?? []), ...transactions] },
    transactions,
    issues: []
  };
};

const restoredByRest = (slot: SpellSlotPool, restType: RestType): boolean => {
  if (restType === 'turnStart') return false;
  if (restType === 'shortRest') return slot.recharge === 'shortRest';
  if (restType === 'longRest') return slot.recharge === 'shortRest' || slot.recharge === 'longRest';
  return false;
};

export const applySpellSlotRest = (character: Character, restType: RestType) => {
  const transactions: SpellSlotTransaction[] = [];
  const spellSlots = normalizeSpellSlots(character.spellSlots ?? []).map((slot) => {
    if (!restoredByRest(slot, restType) || slot.current >= slot.max) return slot;
    const before = slot.current;
    const after = slot.max;
    transactions.push(makeTransaction({ characterId: character.id, slot, before, after, reason: restType === 'shortRest' ? 'Descanso curto' : 'Descanso longo', restType }));
    return { ...slot, current: after };
  });
  return {
    character: { ...character, spellSlots, spellSlotTransactions: [...(character.spellSlotTransactions ?? []), ...transactions] },
    transactions,
    issues: []
  };
};
