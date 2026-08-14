import type {
  AbilityScore,
  CreatureSize,
  DamageFormula,
  TacticalTarget,
  TacticalTargetStatBlockAction,
  TacticalTargetStatBlockResource
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { diceAverage, diceMax, diceMin } from '../rules-engine/dice/math';

const creatureSizes: CreatureSize[] = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
const abilityScores: AbilityScore[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asString = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const firstNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = asString(value);
  const match = text?.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};

const numberField = (value: unknown, ...keys: string[]): number | undefined => {
  const direct = asNumber(value);
  if (direct !== undefined) return direct;
  const record = asRecord(value);
  for (const key of keys) {
    const candidate = asNumber(record[key]) ?? firstNumber(record[key]);
    if (candidate !== undefined) return candidate;
  }
  return firstNumber(value);
};

const sizeFromPayload = (value: unknown): CreatureSize => {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = asString(raw);
  return text && creatureSizes.includes(text as CreatureSize) ? text as CreatureSize : 'Medium';
};

const actionCostForSection = (section: TacticalTargetStatBlockAction['section']): TacticalTargetStatBlockAction['actionCost'] =>
  section === 'bonusAction' ? 'bonusAction' : section === 'reaction' ? 'reaction' : 'action';

const actionType = (record: Record<string, unknown>): TacticalTargetStatBlockAction['type'] => {
  const raw = (asString(record.type) ?? '').toLowerCase();
  if (raw.includes('save')) return 'saveEffect';
  if (raw === 'attack' || record.attackBonus !== undefined || asString(record.attackType)) return 'attack';
  return 'utility';
};

const abilityFromValue = (value: unknown): AbilityScore | undefined => {
  const text = asString(value)?.toUpperCase();
  return text && abilityScores.includes(text as AbilityScore) ? text as AbilityScore : undefined;
};

const damageTypeLabel = (value: unknown): string | undefined => {
  const direct = asString(value);
  if (direct) return direct;
  const record = asRecord(value);
  const label = asString(record.label);
  if (label) return label;
  const options = asArray(record.options).filter((entry): entry is string => typeof entry === 'string');
  if (options.length) return options.join(' / ');
  const types = asArray(record.types).filter((entry): entry is string => typeof entry === 'string');
  return types.length ? types.join(' + ') : undefined;
};

const conditionIdsFromAction = (record: Record<string, unknown>): string[] => {
  const values = new Set<string>();
  for (const value of asArray(record.conditionIds)) {
    if (typeof value === 'string' && value.trim()) values.add(value.trim().toLowerCase());
  }
  for (const raw of asArray(record.hitEffects)) {
    const effect = asRecord(raw);
    for (const key of ['condition', 'possibleCondition', 'conditionId']) {
      const value = asString(effect[key]);
      if (value) values.add(value.toLowerCase());
    }
  }
  const onFailure = asRecord(record.onFailure);
  const failureCondition = asString(onFailure.conditionId) ?? asString(onFailure.condition);
  if (failureCondition) values.add(failureCondition.toLowerCase());
  return Array.from(values);
};

const saveSuccessDamage = (record: Record<string, unknown>): TacticalTargetStatBlockAction['saveSuccessDamage'] => {
  for (const raw of asArray(record.hitEffects)) {
    const success = asString(asRecord(raw).success)?.toLowerCase();
    if (success?.includes('half')) return 'half';
  }
  const success = asString(record.onSuccess)?.toLowerCase();
  return success?.includes('half') ? 'half' : 'none';
};

const resourceFromAction = (
  actionId: string,
  actionName: string,
  record: Record<string, unknown>
): TacticalTargetStatBlockResource | undefined => {
  const uses = asString(record.uses);
  if (uses) {
    const match = uses.match(/(\d+)\s*\/\s*(?:day|long\s*rest)/i);
    if (match?.[1]) {
      const max = Math.max(1, Number(match[1]));
      return {
        id: `${actionId}:resource`,
        name: actionName,
        max,
        current: max,
        recharge: 'longRest',
        sourceActionId: actionId
      };
    }
  }

  const recharge = asString(record.recharge);
  if (recharge) {
    const numbers = recharge.match(/\d+/g)?.map(Number) ?? [];
    const min = numbers.length > 1 ? Math.min(...numbers) : numbers[0];
    const max = numbers.length > 1 ? Math.max(...numbers) : 6;
    if (min !== undefined) {
      return {
        id: `${actionId}:resource`,
        name: `${actionName} · Recarga ${recharge}`,
        max: 1,
        current: 1,
        recharge: 'rechargeRoll',
        rechargeMin: min,
        rechargeMax: max,
        sourceActionId: actionId
      };
    }
  }
  return undefined;
};

const actionRows = (payload: Record<string, unknown>): Array<{ section: TacticalTargetStatBlockAction['section']; raw: unknown }> => [
  ...asArray(payload.actions).map((raw) => ({ section: 'action' as const, raw })),
  ...asArray(payload.bonusActions).map((raw) => ({ section: 'bonusAction' as const, raw })),
  ...asArray(payload.reactions).map((raw) => ({ section: 'reaction' as const, raw }))
];

export interface TacticalStatBlockProjection {
  target: Partial<TacticalTarget>;
  actions: TacticalTargetStatBlockAction[];
  resources: TacticalTargetStatBlockResource[];
}

export const projectCreatureStatBlockToTacticalTarget = (
  item: StoredCompendiumItem,
  options: { positionFeet?: number; currentHitPoints?: number } = {}
): TacticalStatBlockProjection => {
  const payload = asRecord(item.normalizedJson);
  const actions: TacticalTargetStatBlockAction[] = [];
  const resources: TacticalTargetStatBlockResource[] = [];

  actionRows(payload).forEach(({ section, raw }, index) => {
    const record = asRecord(raw);
    const name = asString(record.name);
    if (!name) return;
    const actionId = `statblock:${item.importItemId}:${section}:${index}`;
    const attackBonus = asNumber(record.attackBonus);
    const saveDC = asNumber(record.saveDC) ?? asNumber(record.saveDc);
    const resource = resourceFromAction(actionId, name, record);
    if (resource) resources.push(resource);
    const summary = [
      asString(record.summary),
      asString(record.description),
      asString(record.effect),
      asString(record.trigger) ? `Gatilho: ${asString(record.trigger)}` : undefined
    ].filter(Boolean).join(' ');

    actions.push({
      id: actionId,
      name,
      section,
      actionCost: (asString(record.actionCost) as TacticalTargetStatBlockAction['actionCost'] | undefined) ?? actionCostForSection(section),
      type: actionType(record),
      attackType: asString(record.attackType),
      attackBonus,
      attackBonusFormula: attackBonus === undefined ? asString(record.attackBonus) : undefined,
      reach: asString(record.reach),
      range: asString(record.range),
      damageFormula: asString(record.damageFormula) ?? asString(record.damage),
      damageType: damageTypeLabel(record.damageType),
      saveAbility: abilityFromValue(record.saveAbility),
      saveDC,
      saveDCFormula: saveDC === undefined ? asString(record.saveDC) ?? asString(record.saveDc) : undefined,
      saveSuccessDamage: saveSuccessDamage(record),
      conditionIds: conditionIdsFromAction(record),
      trigger: asString(record.trigger),
      summary: summary || undefined,
      resourceId: resource?.id
    });
  });

  const ac = numberField(payload.armorClass, 'value', 'base', 'armorClass');
  const maxHp = Math.max(1, Math.floor(numberField(payload.hitPoints, 'average', 'averageFormula', 'value', 'formula') ?? 1));
  const speedRecord = asRecord(payload.speed);
  const walkSpeed = numberField(speedRecord.walk, 'value')
    ?? Object.values(speedRecord).map((value) => numberField(value, 'value')).find((value) => value !== undefined)
    ?? 30;

  return {
    target: {
      name: item.name,
      armorClass: ac,
      hitPoints: { current: Math.min(maxHp, Math.max(0, Math.floor(options.currentHitPoints ?? maxHp))), max: maxHp, temporary: 0 },
      size: sizeFromPayload(payload.size),
      positionFeet: Math.max(0, options.positionFeet ?? 10),
      speedFeet: Math.max(0, walkSpeed),
      sourceCreatureItemId: item.id,
      sourceCreatureImportItemId: item.importItemId,
      statBlockActions: actions,
      statBlockResources: resources
    },
    actions,
    resources
  };
};

export const eligibleTacticalCreatureStatBlocks = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): StoredCompendiumItem[] => {
  const enabled = new Set(enabledSourceIds);
  return items
    .filter((item) => item.type === 'creatureStatBlock' && item.status !== 'disabled' && enabled.has(item.sourceId))
    .sort((left, right) => left.name.localeCompare(right.name));
};

export interface TacticalDamageRange {
  min: number;
  max: number;
  average: number;
  unresolvedTokens: string[];
}

const evaluateDamageFormula = (formula: DamageFormula, critical = false): TacticalDamageRange => {
  let min = 0;
  let max = 0;
  let average = 0;
  const unresolved = new Set(formula.unresolvedTokens ?? []);
  for (const component of formula.components) {
    const sign = component.operation === 'subtract' ? -1 : 1;
    if (component.kind === 'dice' && component.dice) {
      const multiplier = critical && component.criticalBehavior !== 'notDoubled' ? 2 : 1;
      min += sign * diceMin({ ...component.dice, count: component.dice.count * multiplier });
      max += sign * diceMax({ ...component.dice, count: component.dice.count * multiplier });
      average += sign * diceAverage({ ...component.dice, count: component.dice.count * multiplier });
    } else if (component.kind === 'flat') {
      const value = component.value ?? 0;
      min += sign * value;
      max += sign * value;
      average += sign * value;
    } else {
      unresolved.add(component.label ?? component.variableKey ?? component.kind);
    }
  }
  return { min, max, average, unresolvedTokens: Array.from(unresolved) };
};

export const statBlockActionDamageRange = (action: TacticalTargetStatBlockAction, critical = false): TacticalDamageRange =>
  action.damageFormula
    ? evaluateDamageFormula(parseDamageFormula(action.damageFormula, { defaultSourceType: 'manual' }), critical)
    : { min: 0, max: 0, average: 0, unresolvedTokens: [] };

const rollDie = (sides: number, rng: () => number): number => Math.floor(Math.max(0, Math.min(0.999999999, rng())) * sides) + 1;

export const rollStatBlockActionDamage = (
  action: TacticalTargetStatBlockAction,
  options: { critical?: boolean; rng?: () => number } = {}
): { total: number; unresolvedTokens: string[] } => {
  if (!action.damageFormula) return { total: 0, unresolvedTokens: [] };
  const formula = parseDamageFormula(action.damageFormula, { defaultSourceType: 'manual' });
  const rng = options.rng ?? Math.random;
  const unresolved = new Set(formula.unresolvedTokens ?? []);
  let total = 0;
  for (const component of formula.components) {
    const sign = component.operation === 'subtract' ? -1 : 1;
    if (component.kind === 'dice' && component.dice) {
      const count = component.dice.count * (options.critical && component.criticalBehavior !== 'notDoubled' ? 2 : 1);
      for (let index = 0; index < count; index += 1) total += sign * rollDie(component.dice.sides, rng);
    } else if (component.kind === 'flat') {
      total += sign * (component.value ?? 0);
    } else {
      unresolved.add(component.label ?? component.variableKey ?? component.kind);
    }
  }
  return { total: Math.max(0, Math.floor(total)), unresolvedTokens: Array.from(unresolved) };
};

export const rangeFeetFromText = (value?: string): { normal?: number; long?: number } => {
  if (!value) return {};
  const numbers = value.match(/\d+/g)?.map(Number) ?? [];
  return { normal: numbers[0], long: numbers[1] };
};

export const statBlockActionMaximumRange = (action: TacticalTargetStatBlockAction): { normal: number; long: number } => {
  if (action.range) {
    const parsed = rangeFeetFromText(action.range);
    const normal = parsed.normal ?? 5;
    return { normal, long: parsed.long ?? normal };
  }
  if (action.reach) {
    const parsed = rangeFeetFromText(action.reach);
    const normal = parsed.normal ?? 5;
    return { normal, long: normal };
  }
  return { normal: action.attackType === 'ranged' ? 30 : 5, long: action.attackType === 'ranged' ? 30 : 5 };
};
