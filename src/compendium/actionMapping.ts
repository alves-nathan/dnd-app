import {
  ActionCost,
  AbilityScore,
  AttackAction,
  DamageApplication,
  DamageComponent,
  DamageCondition,
  DamageFormula,
  DamageSourceType,
  ResourceCost,
  RuleValidationIssue,
  SpellAction,
  SpellScalingRule
} from '../types';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { toSpellSlotLevel } from '../rules-engine/resources/spellSlotManager';
import { createId } from '../utils/id';
import { StoredCompendiumItem } from './types';
import { normalizeTacticalAreaTemplate, spellSaveSuccessDamage } from '../rules-engine/targeting/areaTemplates';


const abilities: AbilityScore[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const abilitySet = new Set<string>(abilities);
const actionCosts: ActionCost[] = ['action', 'bonusAction', 'reaction', 'movement', 'free', 'special'];
const actionCostSet = new Set<string>(actionCosts);
const applications: DamageApplication[] = ['onHit', 'guaranteed', 'onSaveFail', 'onSaveSuccessHalf', 'conditional'];
const applicationSet = new Set<string>(applications);
const sourceTypes: DamageSourceType[] = ['weapon', 'abilityModifier', 'spell', 'classFeature', 'speciesFeature', 'feat', 'magicItem', 'condition', 'buff', 'debuff', 'manual'];
const sourceTypeSet = new Set<string>(sourceTypes);

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const asBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const asStringArray = (value: unknown): string[] | undefined => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined);


const asAbility = (value: unknown): AbilityScore | undefined => {
  const text = asString(value)?.toUpperCase();
  return text && abilitySet.has(text) ? (text as AbilityScore) : undefined;
};

const asActionCost = (value: unknown): ActionCost | undefined => {
  const text = asString(value);
  return text && actionCostSet.has(text) ? (text as ActionCost) : undefined;
};

const asApplication = (value: unknown): DamageApplication | undefined => {
  const text = asString(value);
  return text && applicationSet.has(text) ? (text as DamageApplication) : undefined;
};

const asSourceType = (value: unknown): DamageSourceType | undefined => {
  const text = asString(value);
  return text && sourceTypeSet.has(text) ? (text as DamageSourceType) : undefined;
};

export const formulaTextFromPayload = (payload: Record<string, unknown>): string | undefined => {
  const direct = asString(payload.damageFormula) ?? asString(payload.damage) ?? asString(payload.formula);
  if (direct) return direct;
  const damageRecord = asRecord(payload.damage);
  return asString(damageRecord.raw);
};

const conditionFromPayload = (payload: Record<string, unknown>): DamageCondition | undefined => {
  const condition = asRecord(payload.condition);
  const id = asString(payload.conditionId) ?? asString(condition.id);
  const label = asString(payload.conditionLabel) ?? asString(condition.label) ?? id;
  if (!id || !label) return undefined;
  return {
    id,
    label,
    defaultEnabled: asBoolean(payload.defaultEnabled) ?? asBoolean(condition.defaultEnabled),
    requiresResourceId: asString(payload.requiresResourceId) ?? asString(condition.requiresResourceId),
    oncePerTurnKey: asString(payload.oncePerTurnKey) ?? asString(condition.oncePerTurnKey),
    requiresConcentration: asBoolean(payload.requiresConcentration) ?? asBoolean(condition.requiresConcentration)
  };
};

const applyComponentMetadata = (
  formula: DamageFormula,
  payload: Record<string, unknown>,
  defaults: { sourceType: DamageSourceType; application: DamageApplication }
): DamageFormula => {
  const sourceType = asSourceType(payload.sourceType) ?? defaults.sourceType;
  const application = asApplication(payload.application) ?? defaults.application;
  const condition = conditionFromPayload(payload);
  const criticalBehavior = asString(payload.criticalBehavior);
  const validCritical = criticalBehavior === 'doubleDice' || criticalBehavior === 'notDoubled' || criticalBehavior === 'extraOnCritOnly' ? criticalBehavior : undefined;
  const labelPrefix = asString(payload.label);

  return {
    ...formula,
    components: formula.components.map((component) => ({
      ...component,
      sourceType,
      application,
      condition: condition ?? component.condition,
      criticalBehavior: validCritical ?? component.criticalBehavior,
      label: labelPrefix ? `${labelPrefix}: ${component.label ?? component.kind}` : component.label
    }))
  };
};

const appendFormula = (base: DamageFormula, extra: DamageFormula): DamageFormula => ({
  raw: [base.raw, extra.raw].filter(Boolean).join(' + '),
  components: [...base.components, ...extra.components],
  unresolvedTokens: [...(base.unresolvedTokens ?? []), ...(extra.unresolvedTokens ?? [])].length
    ? [...(base.unresolvedTokens ?? []), ...(extra.unresolvedTokens ?? [])]
    : undefined
});

export const buildDamageFormulaFromPayload = (
  payload: Record<string, unknown>,
  options: { defaultSourceType: DamageSourceType; defaultApplication?: DamageApplication; fallbackRaw?: string } 
): DamageFormula => {
  const baseFormulaText = formulaTextFromPayload(payload) ?? options.fallbackRaw ?? '0';
  let formula = applyComponentMetadata(
    parseDamageFormula(baseFormulaText, {
      defaultSourceType: options.defaultSourceType,
      application: options.defaultApplication ?? 'onHit'
    }),
    payload,
    { sourceType: options.defaultSourceType, application: options.defaultApplication ?? 'onHit' }
  );

  const extraEntries = [
    ...asArray(payload.damageComponents),
    ...asArray(payload.extraDamage),
    ...asArray(payload.conditionalDamage)
  ];

  for (const entry of extraEntries) {
    const entryPayload = typeof entry === 'string' ? { damageFormula: entry } : asRecord(entry);
    const text = formulaTextFromPayload(entryPayload);
    if (!text) continue;
    const parsed = parseDamageFormula(text, {
      defaultSourceType: asSourceType(entryPayload.sourceType) ?? options.defaultSourceType,
      application: asApplication(entryPayload.application) ?? 'conditional'
    });
    formula = appendFormula(formula, applyComponentMetadata(parsed, entryPayload, {
      sourceType: asSourceType(entryPayload.sourceType) ?? options.defaultSourceType,
      application: asApplication(entryPayload.application) ?? 'conditional'
    }));
  }

  return formula;
};

export const parseResourceCostsFromPayload = (payload: Record<string, unknown>): ResourceCost[] => {
  const entries = [
    ...asArray(payload.consumes),
    ...asArray(payload.resourceCosts),
    ...asArray(payload.resourcesConsumed)
  ];

  return entries
    .map((entry) => {
      const record = asRecord(entry);
      const resourceId = asString(record.resourceId) ?? asString(record.id);
      if (!resourceId) return undefined;
      return {
        resourceId,
        amount: Math.max(1, asNumber(record.amount) ?? 1),
        label: asString(record.label) ?? asString(record.name),
        oncePerTurnKey: asString(record.oncePerTurnKey)
      } satisfies ResourceCost;
    })
    .filter(Boolean) as ResourceCost[];
};

const scalingFormulaFromValue = (value: unknown): DamageFormula | undefined => {
  const record = asRecord(value);
  const text = typeof value === 'string' ? value : formulaTextFromPayload(record);
  if (!text) return undefined;
  // Beam/ray counts are represented separately by attacksCount. Textual suffixes
  // such as "each" must not become unresolved dice-parser tokens.
  const normalizedText = text
    .replace(/\s+each\s*$/i, '')
    .replace(/\s+per\s+(?:beam|ray|attack|hit)\s*$/i, '')
    .trim();
  return parseDamageFormula(normalizedText, { defaultSourceType: 'spell' });
};

export const parseSpellScalingFromPayload = (payload: Record<string, unknown>): SpellScalingRule | undefined => {
  const scaling = asRecord(payload.scaling);
  if (!Object.keys(scaling).length) return undefined;
  const kind = asString(scaling.kind);
  const validKind: SpellScalingRule['kind'] | undefined =
    kind === 'characterLevelBeams'
      ? 'characterLevel'
      : kind === 'none' || kind === 'slotLevel' || kind === 'characterLevel' || kind === 'custom'
        ? kind
        : undefined;
  const stepValues = asArray(scaling.steps);
  const steps = stepValues
    .map((entry) => {
      const record = asRecord(entry);
      const formula = scalingFormulaFromValue(record.formula ?? record.damageFormula ?? record.damage);
      if (!formula) return undefined;
      return {
        minCharacterLevel: asNumber(record.minCharacterLevel) ?? asNumber(record.level),
        slotLevel: asNumber(record.slotLevel),
        formula,
        attacksCount: asNumber(record.attacksCount) ?? asNumber(record.beams)
      };
    })
    .filter(Boolean) as NonNullable<SpellScalingRule['steps']>;

  const dicePerStepRecord = asRecord(scaling.dicePerStep);
  const diceCount = asNumber(dicePerStepRecord.count);
  const diceSides = asNumber(dicePerStepRecord.sides);

  return {
    kind: validKind ?? (steps.length ? 'custom' : 'none'),
    baseLevel: asNumber(scaling.baseLevel),
    dicePerStep: diceCount && diceSides ? { count: diceCount, sides: diceSides } : undefined,
    steps: steps.length ? steps : undefined,
    requiresReview: asBoolean(scaling.requiresReview)
  };
};

export const parseGrantedActionsFromPayload = (item: StoredCompendiumItem, parentFeatureId: string): Array<AttackAction | SpellAction> => {
  const payload = item.normalizedJson;
  const entries = [
    ...asArray(payload.grantsActions),
    ...asArray(payload.actions),
    ...asArray(payload.actionOptions)
  ];

  return entries
    .map((entry, index) => {
      const record = asRecord(entry);
      const type = asString(record.type) ?? asString(record.actionType);
      const actionName = asString(record.name) ?? `${item.name} ${index + 1}`;
      const actionCost = asActionCost(record.actionCost) ?? asActionCost(record.castingTime) ?? 'action';
      const sourceType = asSourceType(record.sourceType) ?? 'classFeature';
      const damage = buildDamageFormulaFromPayload(record, { defaultSourceType: sourceType, fallbackRaw: '0' });
      const consumes = parseResourceCostsFromPayload(record);
      const tags = asStringArray(record.tags) ?? [item.type, 'compendium', 'featureGrant'];
      const origin = {
        kind: 'featureGrant' as const,
        entityType: 'feature' as const,
        itemId: item.id,
        parentFeatureId
      };

      if (type === 'spell') {
        const targeting = asRecord(record.targeting);
        const targetRecord = asRecord(record.targets ?? targeting.targets);
        return {
          id: `feature_spell_${parentFeatureId}_${index}`,
          type: 'spell' as const,
          name: actionName,
          actionCost,
          sourceType,
          source: item.rawJson.source,
          spellLevel: asNumber(record.spellLevel) ?? asNumber(record.level),
          minimumSlotLevel: toSpellSlotLevel(asNumber(record.minimumSlotLevel) ?? asNumber(record.spellLevel) ?? asNumber(record.level)),
          castAtSlotLevel: toSpellSlotLevel(asNumber(record.castAtSlotLevel) ?? asNumber(record.slotLevel) ?? asNumber(record.spellLevel) ?? asNumber(record.level)),
          consumesSpellSlot: (asNumber(record.spellLevel) ?? asNumber(record.level) ?? 0) > 0,
          attackBonusOverride: asNumber(record.attackBonusOverride),
          saveDCOverride: asNumber(record.saveDCOverride),
          damage,
          targets: Math.max(1, asNumber(record.targets) ?? asNumber(asRecord(record.targeting).targets) ?? 1),
          area: normalizeTacticalAreaTemplate(record.area ?? targeting.area ?? targeting.areaOfEffect, asString(targetRecord.description)),
          targetDescription: asString(targetRecord.description) ?? asString(targeting.description),
          saveAbility: asAbility(record.saveAbility),
          saveSuccessDamage: spellSaveSuccessDamage(asString(record.damageOnSaveSuccess)),
          conditionIds: Array.from(new Set(asArray(record.effectTemplates).flatMap((effect) => {
            const effectRecord = asRecord(effect);
            const kind = asString(effectRecord.kind);
            if (kind && kind !== 'condition' && kind !== 'debuff') return [];
            return asStringArray(effectRecord.conditionIds) ?? [];
          }))),
          consumes,
          concentration: asBoolean(record.concentration) ?? asBoolean(record.requiresConcentration),
          tags,
          origin,
          requiresReview: item.status !== 'validated'
        } satisfies SpellAction;
      }

      return {
        id: `feature_attack_${parentFeatureId}_${index}`,
        type: 'attack' as const,
        name: actionName,
        actionCost,
        sourceType,
        source: item.rawJson.source,
        attackAbility: asAbility(record.attackAbility),
        attackBonusOverride: asNumber(record.attackBonusOverride),
        attackBonusExtra: asNumber(record.attackBonusExtra) ?? asNumber(record.magicBonus),
        damage,
        attacksCount: Math.max(1, asNumber(record.attacksCount) ?? asNumber(record.count) ?? 1),
        consumes,
        tags,
        origin,
        requiresReview: item.status !== 'validated'
      } satisfies AttackAction;
    })
    .filter((action) => action.damage.raw !== '0' || action.consumes?.length || action.tags?.includes('utility'));
};

export const issueForActionBuild = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({
  severity,
  code,
  message
});
