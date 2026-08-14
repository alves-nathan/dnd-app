import type { AbilityScore, ActionCost, RuleSource } from '../types';
import {
  ABILITY_SCORES,
  ACTION_COSTS,
  CURRENCY_UNITS,
  DAMAGE_TYPES,
  SKILLS,
  type AbilityReference,
  type ActionTimingDetail,
  type CastingTimeDefinition,
  type CompendiumEntityKind,
  type CompendiumImportItem,
  type CompendiumImportSource,
  type CurrencyValue,
  type DamageType,
  type DamageTypeReference,
  type EquipmentOptionDefinition,
  type ResourceDefinition,
  type ResourceScaling,
  type SkillName,
  type TargetDefinition
} from './importDomain';
import { IMPORT_TEMPLATE_VERSION_V2 } from './importVersions';

export interface ImportNormalizationIssue {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
  originalValue?: unknown;
  normalizedValue?: unknown;
}

export interface NormalizationResult<T> {
  value: T;
  issues: ImportNormalizationIssue[];
}

export interface CanonicalImportPackShape {
  templateVersion: typeof IMPORT_TEMPLATE_VERSION_V2;
  id: string;
  source: CompendiumImportSource;
  metadata?: Record<string, unknown>;
  items: CompendiumImportItem[];
  [extension: string]: unknown;
}

const abilitySet = new Set<string>(ABILITY_SCORES);
const actionCostSet = new Set<string>(ACTION_COSTS);
const damageTypeSet = new Set<string>(DAMAGE_TYPES);
const currencyUnitSet = new Set<string>(CURRENCY_UNITS);

const normalizedSkillIndex = new Map<string, SkillName>(
  SKILLS.map((skill) => [skill.toLowerCase().replace(/[^a-z0-9]/g, ''), skill])
);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length ? value.trim() : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const issue = (
  severity: ImportNormalizationIssue['severity'],
  code: string,
  message: string,
  path?: string,
  originalValue?: unknown,
  normalizedValue?: unknown
): ImportNormalizationIssue => ({ severity, code, message, path, originalValue, normalizedValue });

const canonicalKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const titleFromSlug = (value: string): string =>
  value
    .replace(/^phb-\d{4}-/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();

export const normalizeAbilityScore = (value: unknown): AbilityScore | undefined => {
  const text = asString(value)?.toUpperCase();
  return text && abilitySet.has(text) ? text as AbilityScore : undefined;
};

export const normalizeAbilityReference = (
  value: unknown,
  path = 'ability'
): NormalizationResult<AbilityReference | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const direct = normalizeAbilityScore(value);
  if (direct) return { value: direct, issues };

  const record = asRecord(value);
  if (record) {
    const kind = asString(record.kind);
    if (kind === 'choice' && Array.isArray(record.options)) {
      const options = record.options.map(normalizeAbilityScore).filter((entry): entry is AbilityScore => Boolean(entry));
      if (options.length) return { value: { ...record, kind: 'choice', options } as AbilityReference, issues };
    }
    if (kind === 'spellcasting') return { value: { ...record, kind: 'spellcasting' } as AbilityReference, issues };
    if (kind === 'sameAsAttack') return { value: { ...record, kind: 'sameAsAttack' } as AbilityReference, issues };
    if (kind === 'variable') return { value: { ...record, kind: 'variable' } as AbilityReference, issues };
  }

  const text = asString(value);
  if (!text) return { value: undefined, issues };
  const key = canonicalKey(text);

  if (key === 'strordex' || key === 'strdex') {
    const normalized: AbilityReference = { kind: 'choice', options: ['STR', 'DEX'], label: text };
    issues.push(issue('info', 'IMPORT_NORMALIZED_ABILITY_CHOICE', `Normalized ${text} to an explicit STR/DEX choice.`, path, value, normalized));
    return { value: normalized, issues };
  }
  if (key === 'spellcastingability') {
    const normalized: AbilityReference = { kind: 'spellcasting', label: text };
    issues.push(issue('info', 'IMPORT_NORMALIZED_SPELLCASTING_ABILITY', `Normalized ${text} to spellcasting ability.`, path, value, normalized));
    return { value: normalized, issues };
  }
  if (key === 'sameasattackability' || key === 'sameasattack') {
    const normalized: AbilityReference = { kind: 'sameAsAttack', label: text };
    issues.push(issue('info', 'IMPORT_NORMALIZED_SAME_ATTACK_ABILITY', `Normalized ${text} to same-as-attack ability.`, path, value, normalized));
    return { value: normalized, issues };
  }

  const splitOptions = text
    .split(/[\/|,]|\bor\b/i)
    .map((entry) => normalizeAbilityScore(entry))
    .filter((entry): entry is AbilityScore => Boolean(entry));
  if (splitOptions.length >= 2) {
    const normalized: AbilityReference = { kind: 'choice', options: Array.from(new Set(splitOptions)), label: text };
    issues.push(issue('warning', 'IMPORT_NORMALIZED_AMBIGUOUS_ABILITY_CHOICE', `Normalized composite ability value "${text}" as a choice.`, path, value, normalized));
    return { value: normalized, issues };
  }

  const normalized: AbilityReference = { kind: 'variable', key: text, label: text };
  issues.push(issue('warning', 'IMPORT_PRESERVED_VARIABLE_ABILITY', `Preserved non-canonical ability value "${text}" as a variable reference.`, path, value, normalized));
  return { value: normalized, issues };
};

const actionAliasMap: Record<string, { actionCost: ActionCost; subtype?: ActionTimingDetail['subtype']; trigger?: string }> = {
  action: { actionCost: 'action' },
  bonusaction: { actionCost: 'bonusAction' },
  reaction: { actionCost: 'reaction' },
  movement: { actionCost: 'movement' },
  move: { actionCost: 'movement' },
  free: { actionCost: 'free' },
  freeaction: { actionCost: 'free' },
  special: { actionCost: 'special' },
  passive: { actionCost: 'free', subtype: 'passive' },
  magicaction: { actionCost: 'action', subtype: 'magicAction' },
  attackaction: { actionCost: 'action', subtype: 'attackAction' },
  helpaction: { actionCost: 'action', subtype: 'helpAction' },
  utilize: { actionCost: 'action', subtype: 'utilize' },
  attackreplacement: { actionCost: 'special', subtype: 'attackReplacement' },
  finishlongrest: { actionCost: 'special', subtype: 'finishLongRest', trigger: 'finishLongRest' },
  none: { actionCost: 'free', subtype: 'passive' },
  storedspellcastingtime: { actionCost: 'special', subtype: 'other' },
  freeonceoncasterturn: { actionCost: 'free', subtype: 'triggered', trigger: 'onceOnCasterTurn' },
  samebonusaction: { actionCost: 'bonusAction', subtype: 'triggered', trigger: 'sameBonusAction' }
};

export const normalizeActionCost = (
  value: unknown,
  path = 'actionCost'
): NormalizationResult<{ actionCost?: ActionCost; detail?: ActionTimingDetail }> => {
  const issues: ImportNormalizationIssue[] = [];
  const text = asString(value);
  if (!text) return { value: {}, issues };
  if (actionCostSet.has(text)) return { value: { actionCost: text as ActionCost }, issues };

  const alias = actionAliasMap[canonicalKey(text)];
  if (alias) {
    const detail: ActionTimingDetail | undefined = alias.subtype || alias.trigger
      ? { actionCost: alias.actionCost, subtype: alias.subtype, trigger: alias.trigger, original: text }
      : undefined;
    issues.push(issue(
      alias.subtype ? 'info' : 'warning',
      'IMPORT_NORMALIZED_ACTION_COST_ALIAS',
      `Normalized action cost "${text}" to "${alias.actionCost}"${alias.subtype ? ` (${alias.subtype})` : ''}.`,
      path,
      value,
      alias.actionCost
    ));
    return { value: { actionCost: alias.actionCost, detail }, issues };
  }

  const lower = text.toLowerCase();
  let actionCost: ActionCost = 'special';
  if (lower.includes('bonus')) actionCost = 'bonusAction';
  else if (lower.includes('reaction')) actionCost = 'reaction';
  else if (lower.includes('action')) actionCost = 'action';
  else if (lower.includes('free')) actionCost = 'free';

  const detail: ActionTimingDetail = {
    actionCost,
    subtype: 'triggered',
    trigger: text,
    original: text
  };
  issues.push(issue('warning', 'IMPORT_NORMALIZED_ACTION_COST_TRIGGER', `Normalized non-canonical action timing "${text}" while preserving its trigger.`, path, value, actionCost));
  return { value: { actionCost, detail }, issues };
};

export const normalizeCastingTime = (
  value: unknown,
  path = 'castingTime'
): NormalizationResult<CastingTimeDefinition> => {
  const issues: ImportNormalizationIssue[] = [];
  const record = asRecord(value);
  if (record) {
    const kind = asString(record.kind);
    if (kind === 'duration') {
      const amount = asFiniteNumber(record.amount);
      const unitText = asString(record.unit)?.toLowerCase();
      const unit = unitText === 'minutes' ? 'minute' : unitText === 'hours' ? 'hour' : unitText === 'days' ? 'day' : unitText;
      if (amount && (unit === 'minute' || unit === 'hour' || unit === 'day')) {
        return { value: { ...record, kind: 'duration', amount, unit } as CastingTimeDefinition, issues };
      }
    }
    if (kind === 'action') {
      const normalized = normalizeActionCost(record.actionCost, `${path}.actionCost`);
      issues.push(...normalized.issues);
      if (normalized.value.actionCost) {
        return {
          value: {
            ...record,
            kind: 'action',
            actionCost: normalized.value.actionCost,
            trigger: asString(record.trigger) ?? normalized.value.detail?.trigger
          } as CastingTimeDefinition,
          issues
        };
      }
    }
    if (kind === 'special' && asString(record.label)) {
      return { value: { ...record, kind: 'special', label: asString(record.label)! } as CastingTimeDefinition, issues };
    }
  }

  const text = asString(value) ?? 'special';
  const ritualAlternative = /\bor\s+ritual\b/i.test(text);
  const withoutRitual = text.replace(/\s+or\s+ritual\s*$/i, '').trim();
  const durationMatch = /^(\d+(?:\.\d+)?)\s*(minute|minutes|hour|hours|day|days)\b/i.exec(withoutRitual);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const rawUnit = durationMatch[2].toLowerCase();
    const unit = rawUnit.startsWith('minute') ? 'minute' : rawUnit.startsWith('hour') ? 'hour' : 'day';
    const normalized: CastingTimeDefinition = { kind: 'duration', amount, unit, ritualAlternative: ritualAlternative || undefined, original: text };
    if (durationMatch[0].length !== withoutRitual.length) {
      issues.push(issue('info', 'IMPORT_CASTING_TIME_DETAIL_PRESERVED', `Preserved additional casting-time detail from "${text}".`, path, value, normalized));
    }
    return { value: normalized, issues };
  }

  const actionNormalization = normalizeActionCost(withoutRitual, path);
  issues.push(...actionNormalization.issues);
  if (actionNormalization.value.actionCost && !['special'].includes(actionNormalization.value.actionCost)) {
    return {
      value: {
        kind: 'action',
        actionCost: actionNormalization.value.actionCost,
        ritualAlternative: ritualAlternative || undefined,
        trigger: actionNormalization.value.detail?.trigger,
        original: text
      },
      issues
    };
  }

  // Common triggered spell-casting aliases are action-economy values plus a trigger.
  const lower = withoutRitual.toLowerCase();
  const triggeredActionCost: ActionCost | undefined = lower.startsWith('bonusaction')
    ? 'bonusAction'
    : lower.startsWith('reaction')
      ? 'reaction'
      : lower.startsWith('action')
        ? 'action'
        : undefined;
  if (triggeredActionCost) {
    const normalized: CastingTimeDefinition = {
      kind: 'action',
      actionCost: triggeredActionCost,
      trigger: withoutRitual,
      ritualAlternative: ritualAlternative || undefined,
      original: text
    };
    issues.push(issue('info', 'IMPORT_NORMALIZED_TRIGGERED_CASTING_TIME', `Normalized triggered casting time "${text}".`, path, value, normalized));
    return { value: normalized, issues };
  }

  const normalized: CastingTimeDefinition = {
    kind: 'special',
    actionCost: actionNormalization.value.actionCost,
    label: withoutRitual,
    ritualAlternative: ritualAlternative || undefined,
    original: text
  };
  issues.push(issue('warning', 'IMPORT_PRESERVED_SPECIAL_CASTING_TIME', `Preserved non-action casting time "${text}" as a structured special casting time.`, path, value, normalized));
  return { value: normalized, issues };
};

export const normalizeSkillName = (value: unknown, path = 'skill'): NormalizationResult<SkillName | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const text = asString(value);
  if (!text) return { value: undefined, issues };
  const canonical = normalizedSkillIndex.get(canonicalKey(text));
  if (!canonical) {
    issues.push(issue('warning', 'IMPORT_UNKNOWN_SKILL', `Unknown skill "${text}" was preserved outside the canonical skill set.`, path, value));
    return { value: undefined, issues };
  }
  if (canonical !== text) {
    issues.push(issue('info', 'IMPORT_NORMALIZED_SKILL_ALIAS', `Normalized skill "${text}" to "${canonical}".`, path, value, canonical));
  }
  return { value: canonical, issues };
};

const extractDamageTypes = (text: string): DamageType[] => {
  const lower = text.toLowerCase();
  return DAMAGE_TYPES.filter((type) => new RegExp(`\\b${type}\\b`, 'i').test(lower));
};

export const normalizeDamageTypeReference = (
  value: unknown,
  path = 'damageType'
): NormalizationResult<DamageTypeReference | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const record = asRecord(value);
  if (record) {
    const kind = asString(record.kind);
    if (kind === 'choice' && Array.isArray(record.options)) {
      const options = record.options.map((entry) => asString(entry)?.toLowerCase()).filter((entry): entry is string => Boolean(entry && damageTypeSet.has(entry))) as DamageType[];
      if (options.length) return { value: { ...record, kind: 'choice', options: Array.from(new Set(options)) } as DamageTypeReference, issues };
    }
    if (kind === 'multiple' && Array.isArray(record.types)) {
      const types = record.types.map((entry) => asString(entry)?.toLowerCase()).filter((entry): entry is string => Boolean(entry && damageTypeSet.has(entry))) as DamageType[];
      if (types.length) return { value: { ...record, kind: 'multiple', types: Array.from(new Set(types)) } as DamageTypeReference, issues };
    }
    if (kind === 'sameAs' && ['weapon', 'attack', 'trigger'].includes(asString(record.source) ?? '')) return { value: record as DamageTypeReference, issues };
    if (kind === 'variable' || kind === 'custom') return { value: record as DamageTypeReference, issues };
  }

  const text = asString(value);
  if (!text) return { value: undefined, issues };
  const lower = text.toLowerCase().trim();
  if (damageTypeSet.has(lower)) return { value: lower as DamageType, issues };

  const sameAsKey = canonicalKey(text);
  if (sameAsKey === 'sameasweapon' || sameAsKey.includes('sameasweaponorammunition')) {
    const normalized: DamageTypeReference = { kind: 'sameAs', source: 'weapon', label: text };
    return { value: normalized, issues: [issue('info', 'IMPORT_NORMALIZED_DAMAGE_SAME_AS_WEAPON', `Normalized "${text}" to same-as-weapon damage.`, path, value, normalized)] };
  }
  if (sameAsKey === 'sameasattack') {
    const normalized: DamageTypeReference = { kind: 'sameAs', source: 'attack', label: text };
    return { value: normalized, issues: [issue('info', 'IMPORT_NORMALIZED_DAMAGE_SAME_AS_ATTACK', `Normalized "${text}" to same-as-attack damage.`, path, value, normalized)] };
  }
  if (sameAsKey === 'sameastrigger') {
    const normalized: DamageTypeReference = { kind: 'sameAs', source: 'trigger', label: text };
    return { value: normalized, issues: [issue('info', 'IMPORT_NORMALIZED_DAMAGE_SAME_AS_TRIGGER', `Normalized "${text}" to same-as-trigger damage.`, path, value, normalized)] };
  }

  const types = Array.from(new Set(extractDamageTypes(text)));
  const isVariable = /chosen|choice|variable|ancestry|elemental|resistance type/i.test(text);
  if (isVariable) {
    const normalized: DamageTypeReference = { kind: 'variable', key: canonicalKey(text), options: types.length ? types : undefined, label: text };
    issues.push(issue('info', 'IMPORT_NORMALIZED_VARIABLE_DAMAGE_TYPE', `Normalized variable damage type "${text}".`, path, value, normalized));
    return { value: normalized, issues };
  }

  if (types.length >= 2 && /\+|,/.test(text) && !/\bor\b/i.test(text)) {
    const normalized: DamageTypeReference = { kind: 'multiple', types, label: text };
    issues.push(issue('info', 'IMPORT_NORMALIZED_MULTIPLE_DAMAGE_TYPES', `Normalized multi-type damage "${text}".`, path, value, normalized));
    return { value: normalized, issues };
  }
  if (types.length >= 2) {
    const normalized: DamageTypeReference = { kind: 'choice', options: types, label: text };
    issues.push(issue(/\//.test(text) ? 'warning' : 'info', 'IMPORT_NORMALIZED_DAMAGE_TYPE_CHOICE', `Normalized composite damage type "${text}" as an explicit choice.`, path, value, normalized));
    return { value: normalized, issues };
  }

  const normalized: DamageTypeReference = { kind: 'custom', value: text, label: text };
  issues.push(issue('warning', 'IMPORT_PRESERVED_CUSTOM_DAMAGE_TYPE', `Preserved unknown damage type expression "${text}" as custom.`, path, value, normalized));
  return { value: normalized, issues };
};

export const normalizeCurrencyValue = (
  value: unknown,
  path = 'cost'
): NormalizationResult<CurrencyValue | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const record = asRecord(value);
  if (record) {
    const amount = asFiniteNumber(record.amount);
    const unitText = asString(record.unit)?.toUpperCase();
    if (amount !== undefined && amount >= 0 && unitText && currencyUnitSet.has(unitText)) {
      return { value: { amount, unit: unitText as CurrencyValue['unit'] }, issues };
    }
  }

  const text = asString(value);
  if (!text) return { value: undefined, issues };
  const match = /^\s*([\d,.]+)\s*(CP|SP|EP|GP|PP)\s*$/i.exec(text);
  if (!match) {
    issues.push(issue('warning', 'IMPORT_UNPARSED_CURRENCY', `Could not normalize currency value "${text}".`, path, value));
    return { value: undefined, issues };
  }
  const amount = Number(match[1].replace(/,/g, ''));
  const unit = match[2].toUpperCase();
  if (!Number.isFinite(amount) || amount < 0 || !currencyUnitSet.has(unit)) {
    issues.push(issue('warning', 'IMPORT_UNPARSED_CURRENCY', `Could not normalize currency value "${text}".`, path, value));
    return { value: undefined, issues };
  }
  const normalized: CurrencyValue = { amount, unit: unit as CurrencyValue['unit'] };
  issues.push(issue('info', 'IMPORT_NORMALIZED_CURRENCY', `Normalized legacy currency "${text}".`, path, value, normalized));
  return { value: normalized, issues };
};

const normalizeRecovery = (value: unknown, path: string): NormalizationResult<Pick<ResourceDefinition, 'recharge' | 'recoveryRules'>> => {
  const issues: ImportNormalizationIssue[] = [];
  const text = asString(value);
  if (!text) return { value: {}, issues };
  if (['turn', 'shortRest', 'longRest', 'day', 'manual'].includes(text)) {
    return { value: { recharge: text as ResourceDefinition['recharge'] }, issues };
  }

  const key = canonicalKey(text);
  let normalized: Pick<ResourceDefinition, 'recharge' | 'recoveryRules'>;
  switch (key) {
    case 'shortorlongrest':
      normalized = { recharge: 'shortRest', recoveryRules: [{ trigger: 'shortRest', amount: 'all' }, { trigger: 'longRest', amount: 'all' }] };
      break;
    case 'longrestandoneonshortrest':
    case 'shortrestoneandlongrestartall':
      normalized = { recharge: 'manual', recoveryRules: [{ trigger: 'shortRest', amount: 1 }, { trigger: 'longRest', amount: 'all' }] };
      break;
    case 'longrestonuse':
      normalized = { recharge: 'longRest', recoveryRules: [{ trigger: 'longRest', amount: 'all' }] };
      break;
    case 'startofyournextturn':
      normalized = { recharge: 'turn', recoveryRules: [{ trigger: 'turn', amount: 'all', condition: 'startOfYourNextTurn' }] };
      break;
    case 'rollinitiativeorfinishshortorlongrest':
      normalized = { recharge: 'manual', recoveryRules: [{ trigger: 'initiative', amount: 'all' }, { trigger: 'shortRest', amount: 'all' }, { trigger: 'longRest', amount: 'all' }] };
      break;
    default:
      if (/^\d(?:-\d)?$/.test(text)) {
        normalized = { recharge: 'manual', recoveryRules: [{ trigger: 'custom', amount: 'all', condition: `rechargeRoll:${text}` }] };
      } else if (/longrest/i.test(text)) {
        normalized = { recharge: 'manual', recoveryRules: [{ trigger: 'longRest', amount: 'all' }, { trigger: 'custom', amount: 'all', condition: text }] };
      } else {
        normalized = { recharge: 'manual', recoveryRules: [{ trigger: 'custom', amount: 'all', condition: text }] };
      }
      break;
  }
  issues.push(issue('warning', 'IMPORT_NORMALIZED_RESOURCE_RECOVERY', `Normalized legacy recovery rule "${text}" without discarding its special condition.`, path, value, normalized));
  return { value: normalized, issues };
};

const resourceScalingFromLegacyText = (value: string): ResourceScaling => {
  const text = value.trim();
  const key = canonicalKey(text);
  if (key === 'pb' || key === 'proficiencybonus') return { kind: 'proficiencyBonus' };

  const abilityMatch = /\b(STR|DEX|CON|INT|WIS|CHA)\b/i.exec(text);
  if (abilityMatch && /\bmod(?:ifier)?\b/i.test(text)) {
    const minimumMatch = /minimum\s*(?:of\s*)?(\d+)/i.exec(text) ?? /max\(\s*(\d+)\s*,/i.exec(text);
    return {
      kind: 'abilityModifier',
      formula: text,
      ability: abilityMatch[1].toUpperCase(),
      ...(minimumMatch ? { minimum: Number(minimumMatch[1]) } : {})
    } as ResourceScaling;
  }

  return { kind: 'custom', formula: text };
};

export const normalizeResourceDefinition = (
  value: unknown,
  path = 'resource',
  fallbackId?: string
): NormalizationResult<ResourceDefinition | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const record = asRecord(value);
  if (!record) return { value: undefined, issues };
  if (!Object.keys(record).length) return { value: undefined, issues };

  const explicitId = asString(record.id);
  const resourceId = explicitId ?? fallbackId;
  if (!resourceId) {
    return { value: undefined, issues: [issue('warning', 'IMPORT_INVALID_RESOURCE', 'Resource with content requires a stable id.', path, value)] };
  }

  const normalized: Record<string, unknown> = { ...record, id: resourceId };
  if (!explicitId && fallbackId) {
    issues.push(issue(
      'warning',
      'IMPORT_GENERATED_RESOURCE_ID',
      `Generated deterministic resource id ${fallbackId} so legacy resource data is preserved.`,
      `${path}.id`,
      record.id,
      fallbackId
    ));
  }

  const maxByLevel = Array.isArray(record.maxByLevel) ? record.maxByLevel : undefined;
  const maxFormula = asString(record.maxFormula);
  const directUses = record.uses;
  const maxUses = record.maxUses;
  const usesFormula = asString(record.usesFormula);
  const namedUsesFormulaEntries = Object.entries(record)
    .filter(([key, entry]) => /UsesFormula$/.test(key) && asString(entry))
    .map(([key, entry]) => [key, asString(entry)!] as const);
  const namedUsesEntries = Object.entries(record)
    .filter(([key, entry]) => /Uses$/.test(key) && !/maxUses$/i.test(key) && (asFiniteNumber(entry) !== undefined || asString(entry)))
    .map(([key, entry]) => [key, entry] as const);

  if (maxByLevel) {
    // Legacy datasets use both 20-entry arrays (index 0 = class level 1) and
    // 21-entry arrays with an explicit level-0 sentinel. D&D class progression
    // stops at 20, so a 21-entry table is unambiguously the sentinel form.
    const hasLevelZeroSentinel = maxByLevel.length === 21;
    const steps = maxByLevel
      .map((entry, index) => ({ level: hasLevelZeroSentinel ? index : index + 1, value: asFiniteNumber(entry) }))
      .filter((entry): entry is { level: number; value: number } => entry.value !== undefined && entry.level >= 1 && entry.level <= 20);
    normalized.max = { kind: 'classLevel', steps };
    delete normalized.maxByLevel;
    if (hasLevelZeroSentinel) {
      issues.push(issue('info', 'IMPORT_NORMALIZED_RESOURCE_LEVEL_ZERO_SENTINEL', `Removed the level-0 sentinel from maxByLevel for resource ${normalized.id}.`, `${path}.maxByLevel[0]`, maxByLevel[0], undefined));
    }
    issues.push(issue('info', 'IMPORT_NORMALIZED_RESOURCE_MAX_BY_LEVEL', `Promoted maxByLevel for resource ${normalized.id} to ResourceScaling.`, `${path}.maxByLevel`, maxByLevel, normalized.max));
  } else if (maxFormula) {
    normalized.max = resourceScalingFromLegacyText(maxFormula);
    delete normalized.maxFormula;
    issues.push(issue('info', 'IMPORT_NORMALIZED_RESOURCE_MAX_FORMULA', `Promoted maxFormula for resource ${normalized.id} to ResourceScaling.`, `${path}.maxFormula`, maxFormula, normalized.max));
  } else if (typeof record.max === 'string' && record.max.trim()) {
    normalized.max = resourceScalingFromLegacyText(record.max);
    issues.push(issue('info', 'IMPORT_NORMALIZED_RESOURCE_MAX_STRING', `Promoted string max for resource ${normalized.id} to ResourceScaling.`, `${path}.max`, record.max, normalized.max));
  } else if (record.max === undefined && asFiniteNumber(directUses) !== undefined) {
    normalized.max = asFiniteNumber(directUses)!;
    delete normalized.uses;
    issues.push(issue('info', 'IMPORT_NORMALIZED_RESOURCE_USES', `Promoted legacy uses for resource ${normalized.id} to max.`, `${path}.uses`, directUses, normalized.max));
  } else if (record.max === undefined && asString(directUses)) {
    normalized.max = resourceScalingFromLegacyText(asString(directUses)!);
    delete normalized.uses;
    issues.push(issue('info', 'IMPORT_NORMALIZED_RESOURCE_USES', `Promoted legacy uses for resource ${normalized.id} to ResourceScaling.`, `${path}.uses`, directUses, normalized.max));
  } else if (record.max === undefined && asFiniteNumber(maxUses) !== undefined) {
    normalized.max = asFiniteNumber(maxUses)!;
    delete normalized.maxUses;
    issues.push(issue('info', 'IMPORT_NORMALIZED_RESOURCE_MAX_USES', `Promoted legacy maxUses for resource ${normalized.id} to max.`, `${path}.maxUses`, maxUses, normalized.max));
  } else if (record.max === undefined && usesFormula) {
    normalized.max = resourceScalingFromLegacyText(usesFormula);
    delete normalized.usesFormula;
    issues.push(issue('info', 'IMPORT_NORMALIZED_RESOURCE_USES_FORMULA', `Promoted legacy usesFormula for resource ${normalized.id} to ResourceScaling.`, `${path}.usesFormula`, usesFormula, normalized.max));
  } else if (record.max === undefined && namedUsesFormulaEntries.length === 1) {
    const [key, formula] = namedUsesFormulaEntries[0];
    normalized.max = resourceScalingFromLegacyText(formula);
    issues.push(issue('info', 'IMPORT_NORMALIZED_RESOURCE_NAMED_USES_FORMULA', `Promoted ${key} for resource ${normalized.id} to ResourceScaling while preserving the named legacy field.`, `${path}.${key}`, formula, normalized.max));
  } else if (record.max === undefined && namedUsesEntries.length === 1) {
    const [key, rawUses] = namedUsesEntries[0];
    normalized.max = asFiniteNumber(rawUses) ?? resourceScalingFromLegacyText(asString(rawUses)!);
    issues.push(issue('info', 'IMPORT_NORMALIZED_RESOURCE_NAMED_USES', `Promoted ${key} for resource ${normalized.id} to max while preserving the named legacy field.`, `${path}.${key}`, rawUses, normalized.max));
  } else if (record.max === undefined && namedUsesFormulaEntries.length > 1) {
    issues.push(issue(
      'warning',
      'IMPORT_RESOURCE_MULTI_POOL_EXTENSION_PRESERVED',
      `Resource ${normalized.id} contains multiple independently named use pools; they were preserved as extension fields instead of being collapsed into one incorrect max.`,
      path,
      value,
      normalized
    ));
  }

  const namedRechargeEntries = Object.entries(record)
    .filter(([key, entry]) => /Recharge$/.test(key) && asString(entry))
    .map(([key, entry]) => [key, asString(entry)!] as const);
  const recoverySource = record.recharge ?? (namedRechargeEntries.length === 1 ? namedRechargeEntries[0][1] : undefined);
  const recoveryPath = record.recharge !== undefined ? `${path}.recharge` : namedRechargeEntries.length === 1 ? `${path}.${namedRechargeEntries[0][0]}` : `${path}.recharge`;
  const recovery = normalizeRecovery(recoverySource, recoveryPath);
  issues.push(...recovery.issues);
  if (recovery.value.recharge) normalized.recharge = recovery.value.recharge;
  if (recovery.value.recoveryRules) normalized.recoveryRules = recovery.value.recoveryRules;

  return { value: normalized as unknown as ResourceDefinition, issues };
};

const normalizeScalingDefinition = (value: unknown, path: string): NormalizationResult<Record<string, unknown> | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const record = asRecord(value);
  if (!record) return { value: undefined, issues };
  if (!Object.keys(record).length) return { value: { kind: 'none' }, issues };
  const originalKind = asString(record.kind);
  const key = originalKind ? canonicalKey(originalKind) : '';
  let kind: 'none' | 'slotLevel' | 'characterLevel' | 'classLevel' | 'custom' = 'custom';
  if (key === 'none') kind = 'none';
  else if (key === 'slotlevel' || key === 'slotlevelduration' || key === 'slotlevelbonus' || key === 'slottier') kind = 'slotLevel';
  else if (key === 'characterlevel' || key === 'characterlevelbeams' || key === 'characterlevelconditionaldice' || key === 'characterlevelextradamage') kind = 'characterLevel';
  else if (key === 'classlevel' || /level$/.test(key) && !key.startsWith('character') && !key.startsWith('slot')) kind = 'classLevel';
  else if (!key && (record.baseSlot !== undefined || record.baseLevel !== undefined)) kind = 'slotLevel';

  const normalized: Record<string, unknown> = { ...record, kind };
  if (record.baseSlot !== undefined && record.baseLevel === undefined) normalized.baseLevel = record.baseSlot;
  if (originalKind && originalKind !== kind) normalized.subtype = originalKind;
  if ('tiers' in record && !('steps' in record) && Array.isArray(record.tiers)) normalized.steps = record.tiers;
  if (originalKind !== kind) {
    issues.push(issue(
      originalKind ? 'info' : 'warning',
      'IMPORT_NORMALIZED_SCALING_KIND',
      `Normalized scaling kind "${originalKind ?? '(missing)'}" to "${kind}" while preserving the original subtype.`,
      `${path}.kind`,
      originalKind,
      kind
    ));
  }
  return { value: normalized, issues };
};

export const normalizeEquipmentOption = (
  value: unknown,
  path = 'equipmentOption'
): NormalizationResult<EquipmentOptionDefinition> => {
  const issues: ImportNormalizationIssue[] = [];
  if (Array.isArray(value)) {
    const items: string[] = [];
    const currency: CurrencyValue[] = [];
    const legacyEntries: Array<Record<string, unknown>> = [];
    value.forEach((entry, index) => {
      const currencyResult = normalizeCurrencyValue(entry, `${path}[${index}]`);
      if (currencyResult.value) {
        currency.push(currencyResult.value);
        issues.push(...currencyResult.issues);
      } else if (typeof entry === 'string') {
        items.push(entry);
      } else {
        const entryRecord = asRecord(entry);
        if (entryRecord) {
          legacyEntries.push({ ...entryRecord });
          if (Array.isArray(entryRecord.items)) {
            items.push(...entryRecord.items.filter((nested): nested is string => typeof nested === 'string' && Boolean(nested.trim())));
          }
        }
        issues.push(issue(
          'warning',
          'IMPORT_UNSUPPORTED_EQUIPMENT_OPTION_ENTRY',
          'Preserved structured legacy equipment entry as an extension because V2 cannot represent the nested choice losslessly.',
          `${path}[${index}]`,
          entry,
          entryRecord ? { legacyEntry: entryRecord } : undefined
        ));
      }
    });
    return {
      value: {
        items,
        ...(currency.length ? { currency } : {}),
        ...(legacyEntries.length ? { legacyEntries, requiresStructuredChoiceResolution: true } : {})
      },
      issues
    };
  }

  const record = asRecord(value) ?? {};
  const normalized: EquipmentOptionDefinition = { ...record };
  if (Array.isArray(record.items)) normalized.items = record.items.filter((entry): entry is string => typeof entry === 'string');
  if (Array.isArray(record.itemIds)) normalized.itemIds = record.itemIds.filter((entry): entry is string => typeof entry === 'string');
  if (Array.isArray(record.currency)) {
    const currency: CurrencyValue[] = [];
    record.currency.forEach((entry, index) => {
      const result = normalizeCurrencyValue(entry, `${path}.currency[${index}]`);
      issues.push(...result.issues);
      if (result.value) currency.push(result.value);
    });
    normalized.currency = currency;
  } else if (record.currency !== undefined) {
    // EquipmentOptionDefinition reserves `currency` for CurrencyValue[]. Some
    // V1 packs use it as the unit paired with a dice/formula amount. Keep the
    // formula untouched and move only the incompatible unit to an extension.
    const unit = asString(record.currency);
    if (unit) {
      delete normalized.currency;
      normalized.currencyUnit = unit;
      issues.push(issue(
        'info',
        'IMPORT_PRESERVED_EQUIPMENT_CURRENCY_UNIT_EXTENSION',
        'Moved legacy scalar equipment currency to currencyUnit so the V2 option remains schema-valid without losing the original unit.',
        `${path}.currency`,
        record.currency,
        unit
      ));
    } else {
      delete normalized.currency;
      normalized.legacyCurrency = record.currency;
      issues.push(issue(
        'warning',
        'IMPORT_PRESERVED_EQUIPMENT_CURRENCY_EXTENSION',
        'Moved an unsupported legacy equipment currency shape to an extension.',
        `${path}.currency`,
        record.currency,
        record.currency
      ));
    }
  }
  return { value: normalized, issues };
};

const normalizeEquipmentOptionsRecord = (
  value: unknown,
  path: string
): NormalizationResult<Record<string, EquipmentOptionDefinition> | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const record = asRecord(value);
  if (!record) return { value: undefined, issues };
  const normalized: Record<string, EquipmentOptionDefinition> = {};
  for (const [key, option] of Object.entries(record)) {
    const result = normalizeEquipmentOption(option, `${path}.${key}`);
    normalized[key] = result.value;
    issues.push(...result.issues);
  }
  return { value: normalized, issues };
};

const normalizeActionBearingRecord = (
  value: unknown,
  path: string,
  fallbackName?: string
): NormalizationResult<Record<string, unknown> | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const record = asRecord(value);
  if (!record) return { value: undefined, issues };
  const normalized: Record<string, unknown> = { ...record };
  const action = normalizeActionCost(record.actionCost, `${path}.actionCost`);
  issues.push(...action.issues);
  if (action.value.actionCost) normalized.actionCost = action.value.actionCost;
  if (action.value.detail) normalized.actionTiming = action.value.detail;
  const damage = normalizeDamageTypeReference(record.damageType, `${path}.damageType`);
  issues.push(...damage.issues);
  if (damage.value) normalized.damageType = damage.value;
  else if ('damageType' in normalized && !asString(record.damageType)) delete normalized.damageType;
  const save = normalizeAbilityReference(record.saveAbility, `${path}.saveAbility`);
  issues.push(...save.issues);
  if (save.value) normalized.saveAbility = save.value;
  else if ('saveAbility' in normalized && !asString(record.saveAbility)) delete normalized.saveAbility;
  if (!asString(record.name) && fallbackName) normalized.name = fallbackName;
  return { value: normalized, issues };
};

const normalizeEffectTemplates = (
  value: unknown,
  itemId: string,
  path: string
): NormalizationResult<Array<Record<string, unknown>> | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  if (!Array.isArray(value)) return { value: undefined, issues };
  const normalized: Array<Record<string, unknown>> = [];
  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) return;
    const id = asString(record.id) ?? `${itemId}-effect-${index + 1}`;
    const name = asString(record.name) ?? titleFromSlug(id);
    if (!asString(record.id)) issues.push(issue('warning', 'IMPORT_GENERATED_EFFECT_ID', `Generated deterministic effect id ${id}.`, `${path}[${index}].id`, record.id, id));
    if (!asString(record.name)) issues.push(issue('info', 'IMPORT_DERIVED_EFFECT_NAME', `Derived display name "${name}" from effect id ${id}.`, `${path}[${index}].name`, record.name, name));
    normalized.push({ ...record, id, name });
  });
  return { value: normalized, issues };
};

const normalizeGrantedActions = (
  value: unknown,
  itemId: string,
  path: string
): NormalizationResult<Array<Record<string, unknown>> | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  if (!Array.isArray(value)) return { value: undefined, issues };
  const normalized = value
    .map((entry, index) => {
      const record = asRecord(entry);
      if (!record) return undefined;
      const fallbackName = asString(record.name)
        ?? (asString(record.spellId) ? titleFromSlug(asString(record.spellId)!) : undefined)
        ?? (asString(record.type) ? titleFromSlug(asString(record.type)!) : `${titleFromSlug(itemId)} Action ${index + 1}`);
      const result = normalizeActionBearingRecord(record, `${path}[${index}]`, fallbackName);
      issues.push(...result.issues);
      if (!result.value) return undefined;

      if (!asString(record.name)) {
        issues.push(issue('info', 'IMPORT_DERIVED_ACTION_NAME', `Derived action display name "${fallbackName}".`, `${path}[${index}].name`, record.name, fallbackName));
      }

      const explicitType = asString(record.type) ?? asString(record.actionType);
      if (!explicitType) {
        const derivedType = asString(record.spellId)
          ? 'spell'
          : (asString(record.damageFormula) || asString(record.damageType) || record.attackBonus !== undefined || record.attackAbility !== undefined)
            ? 'attack'
            : 'utility';
        result.value.type = derivedType;
        issues.push(issue(
          'info',
          'IMPORT_DERIVED_ACTION_TYPE',
          `Derived granted action type "${derivedType}" for ${fallbackName}.`,
          `${path}[${index}].type`,
          record.type,
          derivedType
        ));
      }

      if (record.consumes !== undefined && !Array.isArray(record.consumes)) {
        result.value.legacyConsumes = record.consumes;
        delete result.value.consumes;
        issues.push(issue(
          'warning',
          'IMPORT_PRESERVED_NONCANONICAL_ACTION_CONSUMES',
          'Preserved non-canonical granted-action consumes metadata in legacyConsumes instead of emitting an invalid ResourceConsumption array.',
          `${path}[${index}].consumes`,
          record.consumes,
          { legacyConsumes: record.consumes }
        ));
      }

      return result.value;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  return { value: normalized, issues };
};

const normalizeTarget = (value: unknown, path: string): NormalizationResult<number | TargetDefinition | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const number = asFiniteNumber(value);
  if (number !== undefined && number >= 0) return { value: number, issues };
  const record = asRecord(value);
  if (record) {
    const count = asFiniteNumber(record.count);
    const description = asString(record.description);
    if (count !== undefined || description) return { value: { ...record, count, description } as TargetDefinition, issues };
  }
  const text = asString(value);
  if (!text) return { value: undefined, issues };
  const normalized: TargetDefinition = { description: text };
  issues.push(issue('info', 'IMPORT_NORMALIZED_TARGET_DESCRIPTION', `Promoted textual target "${text}" to TargetDefinition.`, path, value, normalized));
  return { value: normalized, issues };
};

const normalizeSpellComponents = (
  value: unknown,
  path: string
): NormalizationResult<string | Record<string, unknown> | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  if (value === undefined || value === null) return { value: undefined, issues };

  const text = asString(value);
  if (text) return { value: text, issues };

  const record = asRecord(value);
  if (record) return { value: { ...record }, issues };

  if (Array.isArray(value)) {
    if (value.length === 0) {
      issues.push(issue('info', 'IMPORT_DROPPED_EMPTY_SPELL_COMPONENTS', 'Removed an empty legacy spell components array.', path, value, undefined));
      return { value: undefined, issues };
    }

    const tokens = value.map(asString).filter((entry): entry is string => Boolean(entry));
    if (tokens.length === value.length) {
      const normalizedTokens = tokens.map((entry) => entry.trim().toUpperCase());
      if (normalizedTokens.every((entry) => entry === 'V' || entry === 'S' || entry === 'M')) {
        const normalized = {
          ...(normalizedTokens.includes('V') ? { verbal: true } : {}),
          ...(normalizedTokens.includes('S') ? { somatic: true } : {}),
          ...(normalizedTokens.includes('M') ? { material: true } : {})
        };
        issues.push(issue('info', 'IMPORT_NORMALIZED_SPELL_COMPONENTS_ARRAY', 'Promoted a legacy V/S/M components array to the canonical components object.', path, value, normalized));
        return { value: normalized, issues };
      }

      const normalized = tokens.join(', ');
      issues.push(issue('warning', 'IMPORT_PRESERVED_SPELL_COMPONENTS_TEXT', 'Preserved an unrecognized legacy spell components array as text for review.', path, value, normalized));
      return { value: normalized, issues };
    }
  }

  issues.push(issue('warning', 'IMPORT_DROPPED_INVALID_SPELL_COMPONENTS', 'Spell components could not be normalized and were omitted for review.', path, value, undefined));
  return { value: undefined, issues };
};

const normalizeSpellClasses = (value: unknown, path: string): NormalizationResult<string[]> => {
  const issues: ImportNormalizationIssue[] = [];
  if (Array.isArray(value)) {
    const classes = value.map(asString).filter((entry): entry is string => Boolean(entry));
    if (classes.length !== value.length) {
      issues.push(issue('warning', 'IMPORT_DROPPED_INVALID_SPELL_CLASS', 'One or more invalid spell class names were omitted.', path, value, classes));
    }
    return { value: classes, issues };
  }

  const single = asString(value);
  if (single) {
    issues.push(issue('info', 'IMPORT_NORMALIZED_SINGLE_SPELL_CLASS', `Promoted spell class "${single}" to a class list.`, path, value, [single]));
    return { value: [single], issues };
  }

  issues.push(issue('warning', 'IMPORT_SPELL_CLASSES_UNSPECIFIED', 'Spell class list was missing; preserved as an empty list for needs-review imports.', path, value, []));
  return { value: [], issues };
};

const normalizeCreatureLanguages = (
  value: unknown,
  path: string
): NormalizationResult<string | string[] | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const direct = asString(value);
  if (direct) return { value: direct, issues };
  if (Array.isArray(value)) {
    const entries = value.map(asString).filter((entry): entry is string => Boolean(entry));
    return { value: entries.length ? entries : undefined, issues };
  }

  const record = asRecord(value);
  if (!record) return { value: undefined, issues };
  const understands = Array.isArray(record.understands)
    ? record.understands.map(asString).filter((entry): entry is string => Boolean(entry))
    : [asString(record.understands)].filter((entry): entry is string => Boolean(entry));
  const speaks = Array.isArray(record.speaks)
    ? record.speaks.map(asString).filter((entry): entry is string => Boolean(entry))
    : [asString(record.speaks)].filter((entry): entry is string => Boolean(entry));
  const telepathy = asString(record.telepathy);
  const parts: string[] = [];
  if (understands.length) parts.push(`Understands ${understands.join(', ')}`);
  if (speaks.length) parts.push(`Speaks ${speaks.join(', ')}`);
  else if ('speaks' in record) parts.push('Cannot speak');
  if (telepathy) parts.push(`Telepathy ${telepathy}`);
  const normalized = parts.join('; ') || undefined;
  issues.push(issue(
    'info',
    'IMPORT_NORMALIZED_CREATURE_LANGUAGES',
    'Normalized structured creature languages to canonical display text while preserving the original structure in languageDetails.',
    path,
    value,
    normalized
  ));
  return { value: normalized, issues };
};

const normalizeCreatureArmorClass = (
  value: unknown,
  path: string
): NormalizationResult<number | Record<string, unknown> | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const numeric = asFiniteNumber(value);
  if (numeric !== undefined) return { value: numeric, issues };
  const record = asRecord(value);
  if (record) return { value: { ...record }, issues };
  const text = asString(value);
  if (!text) return { value: undefined, issues };
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const normalized = Number(text);
    issues.push(issue('info', 'IMPORT_NORMALIZED_CREATURE_ARMOR_CLASS_NUMBER', `Normalized textual creature armor class "${text}" to ${normalized}.`, path, value, normalized));
    return { value: normalized, issues };
  }
  const normalized = { formula: text, original: text };
  issues.push(issue(
    'info',
    'IMPORT_NORMALIZED_CREATURE_ARMOR_CLASS_FORMULA',
    `Promoted formula-based creature armor class "${text}" to a structured V2 value.`,
    path,
    value,
    normalized
  ));
  return { value: normalized, issues };
};

const normalizeCreatureHitPoints = (
  value: unknown,
  path: string
): NormalizationResult<number | Record<string, unknown> | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const numeric = asFiniteNumber(value);
  if (numeric !== undefined) return { value: numeric, issues };
  const record = asRecord(value);
  if (record) return { value: { ...record }, issues };
  const text = asString(value);
  if (!text) return { value: undefined, issues };
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const normalized = Number(text);
    issues.push(issue('info', 'IMPORT_NORMALIZED_CREATURE_HIT_POINTS_NUMBER', `Normalized textual creature hit points "${text}" to ${normalized}.`, path, value, normalized));
    return { value: normalized, issues };
  }
  const normalized = { formula: text, original: text };
  issues.push(issue(
    'info',
    'IMPORT_NORMALIZED_CREATURE_HIT_POINTS_FORMULA',
    `Promoted formula-based creature hit points "${text}" to a structured V2 value.`,
    path,
    value,
    normalized
  ));
  return { value: normalized, issues };
};

const normalizeCreatureSenses = (
  value: unknown,
  path: string
): NormalizationResult<string | Record<string, unknown> | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  if (typeof value === 'string') return { value, issues };
  const record = asRecord(value);
  if (record) return { value: { ...record }, issues };
  if (!Array.isArray(value)) return { value: undefined, issues };
  const entries = value.map(asString).filter((entry): entry is string => Boolean(entry));
  if (!entries.length) return { value: undefined, issues };
  const normalized = entries.join('; ');
  issues.push(issue(
    'info',
    'IMPORT_NORMALIZED_CREATURE_SENSES_ARRAY',
    'Normalized creature senses array to canonical display text while preserving the original array in senseDetails.',
    path,
    value,
    normalized
  ));
  return { value: normalized, issues };
};

const normalizeCreatureActionRange = (
  value: unknown,
  path: string
): NormalizationResult<{ range?: string; rangeDefinition?: Record<string, unknown> }> => {
  const issues: ImportNormalizationIssue[] = [];
  const direct = asString(value);
  if (direct) return { value: { range: direct }, issues };
  const numeric = asFiniteNumber(value);
  if (numeric !== undefined && numeric >= 0) {
    const range = `${numeric} ft`;
    issues.push(issue('info', 'IMPORT_NORMALIZED_CREATURE_ACTION_RANGE', `Normalized numeric creature action range to "${range}".`, path, value, range));
    return { value: { range }, issues };
  }
  const record = asRecord(value);
  if (!record) return { value: {}, issues };
  const normal = asFiniteNumber(record.normal);
  const long = asFiniteNumber(record.long);
  const unit = asString(record.unit) ?? 'ft';
  let range: string | undefined;
  if (normal !== undefined) range = long !== undefined ? `${normal}/${long} ${unit}` : `${normal} ${unit}`;
  issues.push(issue(
    range ? 'info' : 'warning',
    range ? 'IMPORT_NORMALIZED_CREATURE_ACTION_RANGE' : 'IMPORT_PRESERVED_NONCANONICAL_CREATURE_ACTION_RANGE',
    range
      ? `Normalized structured creature action range to "${range}" while preserving the original structure in rangeDefinition.`
      : 'Preserved non-canonical creature action range in rangeDefinition because no canonical normal range could be derived.',
    path,
    value,
    range ? { range, rangeDefinition: record } : { rangeDefinition: record }
  ));
  return { value: { ...(range ? { range } : {}), rangeDefinition: { ...record } }, issues };
};

const normalizeCreatureSpeed = (value: unknown, path: string): NormalizationResult<Record<string, unknown> | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const record = asRecord(value);
  if (!record) return { value: undefined, issues };
  const normalized: Record<string, unknown> = {};
  for (const [mode, rawSpeed] of Object.entries(record)) {
    const numeric = asFiniteNumber(rawSpeed);
    if (numeric !== undefined) {
      normalized[mode] = numeric;
      continue;
    }

    // V2 is an idempotent canonical boundary. A speed already promoted to the
    // structured V2 representation must survive a second normalization pass;
    // otherwise export -> parse would silently drop conditional movement modes.
    const structuredInput = asRecord(rawSpeed);
    if (structuredInput) {
      const valueNumber = asFiniteNumber(structuredInput.value);
      const formula = asString(structuredInput.formula);
      const condition = asString(structuredInput.condition);
      const original = asString(structuredInput.original);
      if (valueNumber !== undefined || formula || condition || original) {
        normalized[mode] = {
          ...(valueNumber !== undefined ? { value: valueNumber } : {}),
          ...(formula ? { formula } : {}),
          ...(condition ? { condition } : {}),
          ...(original ? { original } : {})
        };
        continue;
      }
    }

    const text = asString(rawSpeed);
    if (!text) continue;
    const leading = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(text);
    const valueNumber = leading ? Number(leading[1]) : undefined;
    const condition = leading?.[2]?.trim() || undefined;
    const structured = valueNumber !== undefined
      ? { value: valueNumber, condition, original: text }
      : { formula: text, original: text };
    normalized[mode] = structured;
    issues.push(issue('info', 'IMPORT_NORMALIZED_CONDITIONAL_SPEED', `Promoted conditional ${mode} speed "${text}" to a structured value.`, `${path}.${mode}`, rawSpeed, structured));
  }
  return { value: normalized, issues };
};

const normalizeSource = (source: unknown, path: string): NormalizationResult<CompendiumImportSource> => {
  const issues: ImportNormalizationIssue[] = [];
  const record = asRecord(source) ?? {};
  const id = asString(record.id) ?? 'unknown-source';
  const status = asString(record.status);
  const confidence = asString(record.confidence);
  const version = asString(record.version);
  const normalized: CompendiumImportSource = {
    id,
    book: asString(record.book),
    page: asString(record.page),
    version,
    status: status === 'active' || status === 'disabled' || status === 'needsReview' ? status : 'needsReview',
    confidence: confidence === 'exact' || confidence === 'ambiguous' || confidence === 'manual' || confidence === 'importedNeedsReview' ? confidence : 'importedNeedsReview',
    importId: asString(record.importId),
    notes: asString(record.notes),
    publisher: asString(record.publisher),
    rulesEra: record.rulesEra === '2024' || record.rulesEra === 'legacy'
      ? record.rulesEra
      : version === '2024'
        ? '2024'
        : version && /^20(?:1\d|2[0-3])$/.test(version)
          ? 'legacy'
          : undefined,
    contentType: record.contentType === 'official' || record.contentType === 'third-party' || record.contentType === 'homebrew'
      ? record.contentType
      : undefined
  };
  if (!asString(record.id)) issues.push(issue('error', 'IMPORT_SOURCE_ID_MISSING', 'Source id is required.', `${path}.id`, record.id, id));
  if (!record.rulesEra && normalized.rulesEra) issues.push(issue('info', 'IMPORT_INFERRED_RULES_ERA', `Inferred rulesEra ${normalized.rulesEra} from source version ${version}.`, `${path}.rulesEra`, undefined, normalized.rulesEra));
  return { value: normalized, issues };
};

const normalizeAbilityArray = (value: unknown, path: string): NormalizationResult<AbilityScore[] | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  if (value === 'all') return { value: [...ABILITY_SCORES], issues: [issue('info', 'IMPORT_EXPANDED_ALL_ABILITIES', 'Expanded "all" to all six abilities.', path, value, ABILITY_SCORES)] };
  if (!Array.isArray(value)) return { value: undefined, issues };
  const normalized = value.map(normalizeAbilityScore).filter((entry): entry is AbilityScore => Boolean(entry));
  if (normalized.length !== value.length) issues.push(issue('warning', 'IMPORT_DROPPED_UNKNOWN_ABILITY', 'One or more unknown ability aliases could not be normalized.', path, value, normalized));
  return { value: normalized, issues };
};

const normalizeSkills = (value: unknown, path: string): NormalizationResult<string[] | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  if (!Array.isArray(value)) return { value: undefined, issues };
  const normalized = value.map((entry, index) => {
    const result = normalizeSkillName(entry, `${path}[${index}]`);
    issues.push(...result.issues);
    return result.value ?? asString(entry);
  }).filter((entry): entry is string => Boolean(entry));
  return { value: normalized, issues };
};

const normalizeResources = (value: unknown, path: string, itemId?: string): NormalizationResult<ResourceDefinition[] | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  if (!Array.isArray(value)) return { value: undefined, issues };
  const normalized = value.map((entry, index) => {
    const result = normalizeResourceDefinition(entry, `${path}[${index}]`, itemId ? `${itemId}-resource-${index + 1}` : undefined);
    issues.push(...result.issues);
    return result.value;
  }).filter((entry): entry is ResourceDefinition => Boolean(entry));
  return { value: normalized, issues };
};

export const normalizeCompendiumPayload = (
  kind: CompendiumEntityKind,
  payloadValue: unknown,
  itemId: string,
  path = 'payload'
): NormalizationResult<Record<string, unknown>> => {
  const issues: ImportNormalizationIssue[] = [];
  const payload = asRecord(payloadValue) ?? {};
  const normalized: Record<string, unknown> = { ...payload };

  const normalizeActionField = () => {
    const action = normalizeActionCost(payload.actionCost, `${path}.actionCost`);
    issues.push(...action.issues);
    if (action.value.actionCost) normalized.actionCost = action.value.actionCost;
    else if ('actionCost' in normalized) delete normalized.actionCost;
    if (action.value.detail) normalized.actionTiming = action.value.detail;
  };

  const normalizeDamageField = () => {
    const damage = normalizeDamageTypeReference(payload.damageType, `${path}.damageType`);
    issues.push(...damage.issues);
    if (damage.value) normalized.damageType = damage.value;
    else if ('damageType' in normalized) delete normalized.damageType;
  };

  if (kind === 'class') {
    for (const [field, value] of [['primaryAbilities', payload.primaryAbilities], ['savingThrowProficiencies', payload.savingThrowProficiencies]] as const) {
      const result = normalizeAbilityArray(value, `${path}.${field}`);
      issues.push(...result.issues);
      if (result.value) normalized[field] = result.value;
    }
    if (asRecord(payload.spellcasting)) {
      const spellcasting = { ...asRecord(payload.spellcasting)! };
      if (spellcasting.ability !== undefined) {
        const rawAbility = spellcasting.ability;
        const ability = normalizeAbilityScore(rawAbility);
        if (ability) {
          spellcasting.ability = ability;
        } else {
          delete spellcasting.ability;
          const description = asString(rawAbility);
          if (description) spellcasting.abilityDescription = description;
          else spellcasting.abilityDetails = rawAbility;
          issues.push(issue(
            'info',
            'IMPORT_PRESERVED_VARIABLE_CLASS_SPELLCASTING_ABILITY',
            description
              ? `Preserved variable class spellcasting ability "${description}" outside the fixed six-ability field.`
              : 'Preserved non-canonical class spellcasting ability outside the fixed six-ability field.',
            `${path}.spellcasting.ability`,
            rawAbility,
            description ? { abilityDescription: description } : { abilityDetails: rawAbility }
          ));
        }
      }
      const ritualCastingDetails = asRecord(spellcasting.ritualCasting);
      if (ritualCastingDetails) {
        spellcasting.ritualCastingDetails = { ...ritualCastingDetails };
        spellcasting.ritualCasting = ritualCastingDetails.allowed === false ? false : true;
        issues.push(issue(
          'info',
          'IMPORT_PRESERVED_STRUCTURED_RITUAL_CASTING',
          'Promoted structured ritual-casting metadata to the canonical boolean field while preserving the full rule as ritualCastingDetails.',
          `${path}.spellcasting.ritualCasting`,
          ritualCastingDetails,
          { ritualCasting: spellcasting.ritualCasting, ritualCastingDetails: spellcasting.ritualCastingDetails }
        ));
      }
      normalized.spellcasting = spellcasting;
    }
    const resources = normalizeResources(payload.resources, `${path}.resources`, itemId);
    issues.push(...resources.issues);
    if (resources.value) normalized.resources = resources.value;
    const equipment = normalizeEquipmentOptionsRecord(payload.equipmentOptions, `${path}.equipmentOptions`);
    issues.push(...equipment.issues);
    if (equipment.value) normalized.equipmentOptions = equipment.value;
  }

  if (kind === 'background') {
    const abilities = normalizeAbilityArray(payload.abilityScoreOptions, `${path}.abilityScoreOptions`);
    issues.push(...abilities.issues);
    if (abilities.value) normalized.abilityScoreOptions = abilities.value;
    const skills = normalizeSkills(payload.skillProficiencies, `${path}.skillProficiencies`);
    issues.push(...skills.issues);
    if (skills.value) normalized.skillProficiencies = skills.value;
    const equipment = normalizeEquipmentOptionsRecord(payload.equipmentOptions, `${path}.equipmentOptions`);
    issues.push(...equipment.issues);
    if (equipment.value) normalized.equipmentOptions = equipment.value;
  }

  if (kind === 'feature') {
    normalizeActionField();
    normalizeDamageField();
    for (const ownerField of ['classId', 'subclassId', 'speciesId'] as const) {
      if (!(ownerField in payload)) continue;
      const ownerId = asString(payload[ownerField]);
      if (ownerId) normalized[ownerField] = ownerId;
      else {
        delete normalized[ownerField];
        issues.push(issue(
          'info',
          'IMPORT_REMOVED_EMPTY_OPTIONAL_OWNER_ID',
          `Removed empty optional ${ownerField}; an empty string is not a valid entity reference.`,
          `${path}.${ownerField}`,
          payload[ownerField]
        ));
      }
    }
    if ('levelGained' in payload) {
      const rawLevel = payload.levelGained;
      const numericLevel = asFiniteNumber(rawLevel)
        ?? (typeof rawLevel === 'string' && /^\d+$/.test(rawLevel.trim()) ? Number(rawLevel.trim()) : undefined);
      if (numericLevel !== undefined && Number.isInteger(numericLevel) && numericLevel >= 0) {
        normalized.levelGained = numericLevel;
        if (numericLevel !== rawLevel) {
          issues.push(issue(
            'info',
            'IMPORT_NORMALIZED_FEATURE_LEVEL_GAINED',
            'Normalized legacy feature levelGained to an integer.',
            `${path}.levelGained`,
            rawLevel,
            numericLevel
          ));
        }
      } else {
        delete normalized.levelGained;
        issues.push(issue(
          'info',
          'IMPORT_REMOVED_INVALID_OPTIONAL_LEVEL_GAINED',
          'Removed null/invalid optional levelGained rather than inventing a class level.',
          `${path}.levelGained`,
          rawLevel
        ));
      }
    }
    if (payload.resource !== undefined) {
      const resource = normalizeResourceDefinition(payload.resource, `${path}.resource`, `${itemId}-resource`);
      issues.push(...resource.issues);
      if (resource.value) normalized.resource = resource.value;
      else if (asRecord(payload.resource) && !Object.keys(asRecord(payload.resource)!).length) delete normalized.resource;
    }
  }

  if (kind === 'feat' && payload.abilityScoreIncrease !== undefined) {
    const rawIncrease = payload.abilityScoreIncrease;
    if (Array.isArray(rawIncrease)) {
      normalized.abilityScoreIncrease = rawIncrease;
    } else {
      const increase = asRecord(rawIncrease);
      if (!increase || !Object.keys(increase).length) {
        delete normalized.abilityScoreIncrease;
        issues.push(issue(
          'info',
          'IMPORT_REMOVED_EMPTY_FEAT_ABILITY_SCORE_INCREASE',
          'Removed an empty legacy abilityScoreIncrease object.',
          `${path}.abilityScoreIncrease`,
          rawIncrease
        ));
      } else {
        const canonical: Record<string, unknown> = { ...increase };
        const abilities = normalizeAbilityArray(
          increase.abilities ?? increase.abilityOptions,
          `${path}.abilityScoreIncrease.abilities`
        );
        issues.push(...abilities.issues);
        if (abilities.value?.length) canonical.abilities = abilities.value;
        const amount = asFiniteNumber(increase.amount);
        if (amount !== undefined) canonical.amount = amount;
        const maximum = asFiniteNumber(increase.max) ?? asFiniteNumber(increase.maximumScore);
        if (maximum !== undefined) canonical.max = maximum;
        normalized.abilityScoreIncrease = [canonical];
        issues.push(issue(
          'info',
          'IMPORT_WRAPPED_FEAT_ABILITY_SCORE_INCREASE',
          'Wrapped legacy feat abilityScoreIncrease in the canonical V2 array shape and added canonical ability/max aliases losslessly.',
          `${path}.abilityScoreIncrease`,
          rawIncrease,
          [canonical]
        ));
      }
    }
  }

  if (kind === 'weapon') {
    const weaponCategory = asString(payload.weaponCategory)?.toLowerCase();
    if (weaponCategory === 'simple' || weaponCategory === 'martial') normalized.weaponCategory = weaponCategory;
    else {
      normalized.weaponCategory = 'unknown';
      issues.push(issue('warning', 'IMPORT_WEAPON_CATEGORY_UNRESOLVED', 'Weapon category could not be resolved as simple or martial; preserved as unknown for review.', `${path}.weaponCategory`, payload.weaponCategory, 'unknown'));
    }
    const weaponType = asString(payload.weaponType);
    if (weaponType === 'melee' || weaponType === 'ranged' || weaponType === 'thrown' || weaponType === 'finesse' || weaponType === 'manual') {
      normalized.weaponType = weaponType;
    } else {
      normalized.weaponType = 'manual';
      issues.push(issue('info', 'IMPORT_DEFAULTED_WEAPON_TYPE', 'Legacy weapon without a canonical weaponType was promoted to manual.', `${path}.weaponType`, payload.weaponType, 'manual'));
    }
    normalizeActionField();
    normalizeDamageField();
    const attack = normalizeAbilityReference(payload.attackAbility, `${path}.attackAbility`);
    const damageAbility = normalizeAbilityReference(payload.damageAbility, `${path}.damageAbility`);
    issues.push(...attack.issues, ...damageAbility.issues);
    if (attack.value) normalized.attackAbility = attack.value;
    else delete normalized.attackAbility;
    if (damageAbility.value) normalized.damageAbility = damageAbility.value;
    else delete normalized.damageAbility;
    const cost = normalizeCurrencyValue(payload.cost, `${path}.cost`);
    issues.push(...cost.issues);
    if (cost.value) normalized.cost = cost.value;
    else if (payload.cost !== undefined) {
      normalized.legacyCost = payload.cost;
      delete normalized.cost;
    }
  }

  if (kind === 'armor' || kind === 'equipment' || kind === 'magicItem') {
    const cost = normalizeCurrencyValue(payload.cost, `${path}.cost`);
    issues.push(...cost.issues);
    if (cost.value) normalized.cost = cost.value;
    else if (payload.cost !== undefined) {
      normalized.legacyCost = payload.cost;
      delete normalized.cost;
    }
  }

  if (kind === 'spell') {
    const classes = normalizeSpellClasses(payload.classes, `${path}.classes`);
    issues.push(...classes.issues);
    normalized.classes = classes.value;

    const components = normalizeSpellComponents(payload.components, `${path}.components`);
    issues.push(...components.issues);
    if (components.value !== undefined) normalized.components = components.value;
    else delete normalized.components;

    const castingTime = normalizeCastingTime(payload.castingTime, `${path}.castingTime`);
    issues.push(...castingTime.issues);
    normalized.castingTime = castingTime.value;
    if (castingTime.value.ritualAlternative && payload.ritual === undefined) normalized.ritual = true;
    const save = normalizeAbilityReference(payload.saveAbility, `${path}.saveAbility`);
    issues.push(...save.issues);
    if (save.value) normalized.saveAbility = save.value;
    else delete normalized.saveAbility;
    normalizeDamageField();
    const targets = normalizeTarget(payload.targets, `${path}.targets`);
    issues.push(...targets.issues);
    if (targets.value !== undefined) normalized.targets = targets.value;
    else delete normalized.targets;
    const scaling = normalizeScalingDefinition(payload.scaling, `${path}.scaling`);
    issues.push(...scaling.issues);
    if (scaling.value) normalized.scaling = scaling.value;
  }

  if (kind === 'creatureStatBlock') {
    const armorClass = normalizeCreatureArmorClass(payload.armorClass, `${path}.armorClass`);
    issues.push(...armorClass.issues);
    if (armorClass.value !== undefined) normalized.armorClass = armorClass.value;
    else if (payload.armorClass !== undefined) delete normalized.armorClass;
    const hitPoints = normalizeCreatureHitPoints(payload.hitPoints, `${path}.hitPoints`);
    issues.push(...hitPoints.issues);
    if (hitPoints.value !== undefined) normalized.hitPoints = hitPoints.value;
    else if (payload.hitPoints !== undefined) delete normalized.hitPoints;
    const speed = normalizeCreatureSpeed(payload.speed, `${path}.speed`);
    issues.push(...speed.issues);
    if (speed.value) normalized.speed = speed.value;
    const senses = normalizeCreatureSenses(payload.senses, `${path}.senses`);
    issues.push(...senses.issues);
    if (senses.value !== undefined) normalized.senses = senses.value;
    else if (payload.senses !== undefined) delete normalized.senses;
    if (Array.isArray(payload.senses)) normalized.senseDetails = [...payload.senses];
    const languages = normalizeCreatureLanguages(payload.languages, `${path}.languages`);
    issues.push(...languages.issues);
    if (languages.value !== undefined) normalized.languages = languages.value;
    else if (payload.languages !== undefined) delete normalized.languages;
    if (asRecord(payload.languages)) normalized.languageDetails = { ...asRecord(payload.languages)! };
    if (Array.isArray(payload.resistances)) {
      const unconditional = payload.resistances.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));
      const conditional = payload.resistances.filter((entry) => typeof entry !== 'string');
      if (unconditional.length) normalized.resistances = unconditional;
      else delete normalized.resistances;
      if (conditional.length) {
        normalized.conditionalResistances = conditional;
        issues.push(issue(
          'info',
          'IMPORT_PRESERVED_CONDITIONAL_RESISTANCES',
          'Moved conditional resistance records to a V2 extension instead of flattening them into unconditional resistances.',
          `${path}.resistances`,
          payload.resistances,
          { resistances: unconditional, conditionalResistances: conditional }
        ));
      }
    }
    for (const actionGroup of ['actions', 'bonusActions', 'reactions'] as const) {
      const value = payload[actionGroup];
      if (!Array.isArray(value)) continue;
      normalized[actionGroup] = value.map((entry, index) => {
        const fallbackName = `${titleFromSlug(itemId)} ${titleFromSlug(actionGroup)} ${index + 1}`;
        const result = normalizeActionBearingRecord(entry, `${path}.${actionGroup}[${index}]`, fallbackName);
        issues.push(...result.issues);
        if (!result.value) return result.value;
        const rawAction = asRecord(entry);
        if (rawAction?.range !== undefined) {
          const range = normalizeCreatureActionRange(rawAction.range, `${path}.${actionGroup}[${index}].range`);
          issues.push(...range.issues);
          if (range.value.range) result.value.range = range.value.range;
          else delete result.value.range;
          if (range.value.rangeDefinition) result.value.rangeDefinition = range.value.rangeDefinition;
        }
        return result.value;
      }).filter(Boolean);
    }
  }

  if (['feat', 'feature', 'spell', 'equipment', 'magicItem'].includes(kind)) {
    const granted = normalizeGrantedActions(payload.grantsActions, itemId, `${path}.grantsActions`);
    issues.push(...granted.issues);
    if (granted.value) normalized.grantsActions = granted.value;
    const effects = normalizeEffectTemplates(payload.effectTemplates, itemId, `${path}.effectTemplates`);
    issues.push(...effects.issues);
    if (effects.value) normalized.effectTemplates = effects.value;
  }

  return { value: normalized, issues };
};

export interface RawCompendiumItemShape {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  summary?: unknown;
  source?: unknown;
  payload?: unknown;
  [extension: string]: unknown;
}

export const normalizeCompendiumImportItem = (
  rawItem: RawCompendiumItemShape,
  index = 0
): NormalizationResult<CompendiumImportItem | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const id = asString(rawItem.id);
  const kind = asString(rawItem.kind) as CompendiumEntityKind | undefined;
  const name = asString(rawItem.name);
  const path = `items[${index}]`;
  if (!id || !kind || !name) {
    issues.push(issue('error', 'IMPORT_ITEM_BASE_FIELDS_MISSING', 'Import item requires id, kind and name.', path, rawItem));
    return { value: undefined, issues };
  }
  if (!(['class', 'subclass', 'species', 'background', 'feat', 'weapon', 'armor', 'equipment', 'magicItem', 'spell', 'feature', 'condition', 'creatureStatBlock'] as string[]).includes(kind)) {
    issues.push(issue('error', 'IMPORT_UNKNOWN_ENTITY_KIND', `Unknown entity kind ${kind}.`, `${path}.kind`, kind));
    return { value: undefined, issues };
  }
  const source = normalizeSource(rawItem.source, `${path}.source`);
  issues.push(...source.issues);
  const payload = normalizeCompendiumPayload(kind, rawItem.payload, id, `${path}.payload`);
  issues.push(...payload.issues);

  // V1 consolidated packs carry per-item provenance in `_importMeta`. V2 keeps
  // that audit information outside gameplay payloads so migration is lossless
  // without making provenance affect the semantic content hash.
  const explicitMetadata = asRecord(rawItem.metadata);
  const legacyImportMetadata = asRecord(rawItem._importMeta);
  const metadata = explicitMetadata || legacyImportMetadata
    ? {
        ...(explicitMetadata ?? {}),
        ...(legacyImportMetadata ? { legacyImport: legacyImportMetadata } : {})
      }
    : undefined;

  return {
    value: {
      id,
      kind,
      name,
      summary: asString(rawItem.summary),
      ...(metadata ? { metadata } : {}),
      source: source.value,
      payload: payload.value
    } as CompendiumImportItem,
    issues
  };
};

const resolveSpellClassIds = (items: CompendiumImportItem[], issues: ImportNormalizationIssue[]): void => {
  const classes = new Map<string, string>();
  for (const item of items) {
    if (item.kind === 'class') classes.set(item.name.trim().toLowerCase(), item.id);
  }
  items.forEach((item, itemIndex) => {
    if (item.kind !== 'spell') return;
    const classIds: string[] = [];
    const classNames = Array.isArray(item.payload.classes) ? item.payload.classes : [];
    classNames.forEach((className, classIndex) => {
      const classId = classes.get(className.trim().toLowerCase());
      if (classId) classIds.push(classId);
      else issues.push(issue('warning', 'IMPORT_SPELL_CLASS_REFERENCE_UNRESOLVED', `Spell ${item.id} class "${className}" could not be resolved to an in-pack class id.`, `items[${itemIndex}].payload.classes[${classIndex}]`, className));
    });
    if (classIds.length) item.payload.classIds = Array.from(new Set(classIds));
  });
};

export const normalizeCompendiumImportPack = (rawPack: unknown): NormalizationResult<CanonicalImportPackShape | undefined> => {
  const issues: ImportNormalizationIssue[] = [];
  const record = asRecord(rawPack);
  if (!record) return { value: undefined, issues: [issue('error', 'IMPORT_PACK_NOT_OBJECT', 'Import pack must be an object.')] };
  const id = asString(record.id);
  if (!id) return { value: undefined, issues: [issue('error', 'IMPORT_PACK_ID_MISSING', 'Import pack id is required.', 'id', record.id)] };
  const source = normalizeSource(record.source, 'source');
  issues.push(...source.issues);
  if (!Array.isArray(record.items)) return { value: undefined, issues: [...issues, issue('error', 'IMPORT_PACK_ITEMS_MISSING', 'Import pack items must be an array.', 'items', record.items)] };

  const items: CompendiumImportItem[] = [];
  record.items.forEach((entry, index) => {
    const itemRecord = asRecord(entry);
    if (!itemRecord) {
      issues.push(issue('error', 'IMPORT_ITEM_NOT_OBJECT', `Item at index ${index} must be an object.`, `items[${index}]`, entry));
      return;
    }
    const result = normalizeCompendiumImportItem(itemRecord, index);
    issues.push(...result.issues);
    if (result.value) items.push(result.value);
  });

  resolveSpellClassIds(items, issues);

  const metadata = asRecord(record.metadata);
  const value: CanonicalImportPackShape = {
    ...record,
    templateVersion: IMPORT_TEMPLATE_VERSION_V2,
    id,
    source: source.value,
    metadata,
    items
  };
  return { value, issues };
};

/** Convenience helper used by adapters that need RuleSource-compatible issues. */
export const normalizationIssueSource = (source: CompendiumImportSource): RuleSource => source;
