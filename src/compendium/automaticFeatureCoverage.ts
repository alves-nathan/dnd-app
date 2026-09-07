import type { StoredCompendiumItem } from './types';
import { parseGrantedActionsFromPayload, parseResourceCostsFromPayload } from './actionMapping';
import { collectProgressionOwnedFeatureReferences, findCompendiumItemByReference, isChoiceProgressionFeature } from './classProgression';
import { classifySpellAccessFeature } from '../characters/spellAccessFeatureClassifier';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const hasValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
};

const hasAny = (record: Record<string, unknown>, keys: readonly string[]): boolean =>
  keys.some((key) => hasValue(record[key]));


const normalizedSourceType = (item: StoredCompendiumItem): string =>
  (asString(asRecord(item.normalizedJson).sourceType) ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const isTechnicalProgressionSupportNode = (item: StoredCompendiumItem): boolean =>
  normalizedSourceType(item) === 'spelllist';

const specializedGrantedActionRuntime = (item: StoredCompendiumItem, rawActions: unknown[]): string | undefined => {
  const payload = asRecord(item.normalizedJson);
  const engineKey = (asString(payload.engineKey) ?? '').toLowerCase();
  const actionTypes = rawActions.map(asRecord).map((action) => (asString(action.type) ?? asString(action.actionType) ?? '').toLowerCase());
  if (engineKey === 'fighter.action-surge' && actionTypes.includes('extraaction')) {
    return 'turn activation runtime: extra Action with 2024 Magic-action restriction';
  }
  return undefined;
};

export type AutomaticFeatureCoverageKind =
  | 'passive'
  | 'resourcePool'
  | 'resourceConsumer'
  | 'resourceUpdater'
  | 'grantedAction'
  | 'grantedSpell'
  | 'choice'
  | 'manual';

export interface AutomaticFeatureCoverageSignal {
  kind: AutomaticFeatureCoverageKind;
  detail: string;
  runtime: 'automatic' | 'executable' | 'manual';
}

export interface AutomaticFeatureCoverageEntry {
  itemId: string;
  importItemId: string;
  name: string;
  status: StoredCompendiumItem['status'];
  classReference?: string;
  subclassReference?: string;
  signals: AutomaticFeatureCoverageSignal[];
  gaps: string[];
}

export interface AutomaticFeatureCoverageReport {
  totalProgressionReferences: number;
  progressionFeatureCount: number;
  disabledFeatureCount: number;
  coverageCounts: Record<AutomaticFeatureCoverageKind, number>;
  entries: AutomaticFeatureCoverageEntry[];
  failures: {
    missingProgressionFeatures: string[];
    uncoveredFeatures: string[];
    malformedResourceConsumers: string[];
    malformedGrantedActions: string[];
    unresolvedSpellAccessFeatures: string[];
  };
}

const resourcePoolShape = (payload: Record<string, unknown>, mechanics: Record<string, unknown>): boolean => {
  if (hasAny(payload, ['resource', 'resourcePool'])) return true;
  if ((hasValue(payload.uses) || hasValue(payload.usesFormula)) && hasValue(payload.recharge)) return true;
  if ((hasValue(mechanics.uses) || hasValue(mechanics.usesFormula) || hasValue(mechanics.usesByLevel)) && hasValue(mechanics.recharge)) return true;
  return Object.values(mechanics).some((value) => {
    const nested = asRecord(value);
    return Object.keys(nested).length > 0 &&
      (hasValue(nested.uses) || hasValue(nested.usesFormula)) &&
      hasValue(nested.recharge);
  });
};

const resourceUpdaterShape = (payload: Record<string, unknown>, mechanics: Record<string, unknown>): boolean =>
  hasAny(payload, [
    'resourceUpdates',
    'restoreResource',
    'restoreResourceIfEmpty',
    'recoverResource',
    'resourceRecovery',
    'resourceOverride',
    'minimumCurrent',
    'spellSlotToResource',
    'resourceToSpellSlot',
    'innateSorceryAlternateCost',
    'restorePactSlotsFormula',
    'restorePactSlots',
    'slotToPoints',
    'pointsToSlotCosts',
    'recoverLowerSlot'
  ]) || hasAny(mechanics, [
    'reuseCost',
    'restoreOrReplace',
    'flashOfGeniusUsesRecoveredOnShortRest'
  ]);

const passiveShape = (payload: Record<string, unknown>, mechanics: Record<string, unknown>): boolean => {
  const passiveKeys = [
    'damageFormula', 'conditionalDamage', 'healingFormula', 'attackActionAttackCount',
    'attackRollModifier', 'attackRollBonus', 'damageBonus', 'damageReductionFormula',
    'effectTemplates', 'conditionIds', 'conditionImmunities', 'resistances',
    'temporaryHitPoints', 'speedBonus', 'flySpeed', 'initiativeModifier',
    'acCalculation', 'abilityScoreIncrease', 'proficiencyGrants', 'languagesAdd',
    'weaponMasteryChoicesByLevel', 'expertiseSkillChoicesByLevel', 'senses',
    'beastShapeLimits', 'combatWildShape', 'waterBreathing', 'minimumD20Roll',
    'minimumTotalForAbilityTests', 'replaceD20Roll', 'replaceRollWith', 'turnHitIntoMiss',
    'oncePerTurnKey', 'aura', 'forcedMovement', 'teleport',
    'movementEffect', 'movement', 'range', 'area', 'duration', 'saveAbility',
    'saveDcFormula', 'requiresRage', 'requiresNoArmor', 'requiresNoShield',
    'requiresNotWearing', 'disabledByCondition', 'requiresActiveEffect', 'appliesTo',
    'grantsToAlly', 'maximumScore', 'statBlockRefs', 'revealDefenses', 'extraTurn',
    'saveModifiers', 'abilityCheckBonus', 'onlyIfNoSkillProficiency', 'allowsSpellcastingInWildShape',
    'unarmedStrikeDamageTypeOptions', 'endTurnRemoveConditions', 'shortRestExhaustionReduction',
    'savingThrowProficiencies', 'savingThrowProficienciesAdd', 'auraAddsConditionImmunity',
    'auraSizeUpgrade', 'concentrationProtection', 'spellDamageDieUpgrade', 'maxCunningStrikeEffects',
    'attacksAgainstCannotHaveAdvantage', 'unlessCondition', 'reachBonus', 'resourceDieUpgrade'
  ] as const;
  const mechanicsKeys = [
    'passiveFeature', 'passiveAdvantages', 'benefits', 'benefit', 'armorTraining',
    'weaponProficiencyGrants', 'skillChoice', 'proficiencyGrants', 'darkvisionFeet',
    'flySpeed', 'flySpeedFeet', 'canHover', 'damageResistance', 'conditionImmunities',
    'damageFormula', 'healingFormula', 'bonusFormula', 'attackCount', 'oncePerTurn',
    'onFail', 'onSaveSuccess', 'onSaveFailure', 'target', 'targets', 'range', 'rangeFeet',
    'duration', 'durationMinutes', 'durationHours', 'save', 'effects', 'effect',
    'initiative', 'maximumAttunedItems', 'maximumScore', 'newExtraDamageFormula'
  ] as const;
  return payload.requiresConcentration === true || hasAny(payload, passiveKeys) || hasAny(mechanics, mechanicsKeys);
};


const automaticPassiveShape = (payload: Record<string, unknown>): boolean =>
  payload.requiresConcentration === true ||
  hasAny(payload, ['attackActionAttackCount', 'attacksCountOverride', 'effectTemplates', 'oncePerTurnKey']);

const manualShape = (payload: Record<string, unknown>, mechanics: Record<string, unknown>): boolean => {
  const actionCost = asString(payload.actionCost);
  return Boolean(
    (actionCost && actionCost !== 'free') ||
    hasAny(payload, [
      'trigger', 'actionTiming', 'upgrades', 'utility', 'freeCast', 'freeCasts',
      'restoreResourceIfEmpty', 'spellSlotToResource', 'resourceToSpellSlot',
      'componentReduction', 'engineImpact', 'featRefs', 'grant', 'revive', 'setHp',
      'surgeRoll', 'surgeTableRef', 'hexEnhancement', 'wardHpFormula', 'combatWildShape'
    ]) ||
    hasAny(mechanics, [
      'trigger', 'invoke', 'cost', 'reuseCost', 'costKi', 'creationTiming', 'setupTiming',
      'eligibleObjects', 'eligibleObject', 'crafting', 'cheatDeath', 'magicalGuidance',
      'plansByMinimumLevel', 'models', 'forms', 'adaptations', 'combat', 'restoreOrReplace',
      'baseUse', 'levels', 'domain', 'magicAction', 'onSummon', 'levelRequirement'
    ])
  );
};

export const classifyAutomaticFeatureCoverage = (
  item: StoredCompendiumItem
): AutomaticFeatureCoverageEntry => {
  const payload = asRecord(item.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const signals: AutomaticFeatureCoverageSignal[] = [];
  const gaps: string[] = [];
  const add = (kind: AutomaticFeatureCoverageKind, detail: string, runtime: AutomaticFeatureCoverageSignal['runtime']) => {
    if (!signals.some((signal) => signal.kind === kind && signal.detail === detail)) signals.push({ kind, detail, runtime });
  };

  if (item.status === 'disabled') {
    add('manual', 'disabled in Compendium; automatic application is intentionally blocked', 'manual');
    return {
      itemId: item.id,
      importItemId: item.importItemId,
      name: item.name,
      status: item.status,
      classReference: asString(payload.classId) ?? asString(payload.ownerClassId),
      subclassReference: asString(payload.subclassId) ?? asString(payload.ownerSubclassId),
      signals,
      gaps
    };
  }

  if (resourcePoolShape(payload, mechanics)) {
    add('resourcePool', 'declarative limited-use pool is materialized by automaticFeatureApplication', 'automatic');
  }

  const rawConsumers = ['consumes', 'resourceCosts', 'resourcesConsumed']
    .flatMap((key) => asArray(payload[key]))
    .map(asRecord);
  const rawConsumerCount = rawConsumers.length;
  const fixedConsumers = rawConsumers.filter((consumer) => {
    const amount = consumer.amount;
    return amount === undefined ||
      (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) ||
      (typeof amount === 'string' && /^\d+$/.test(amount.trim()) && Number(amount) > 0);
  });
  const variableConsumers = rawConsumers.filter((consumer) => !fixedConsumers.includes(consumer));
  const malformedConsumers = rawConsumers.filter((consumer) => !asString(consumer.resourceId) && !asString(consumer.id));
  const parsedConsumers = parseResourceCostsFromPayload(payload);
  if (rawConsumerCount > 0) {
    if (fixedConsumers.length > 0 && parsedConsumers.length >= fixedConsumers.length) {
      add('resourceConsumer', 'fixed declarative resource cost is available to action/ability transaction layers', 'executable');
    }
    if (variableConsumers.length > 0) {
      add('resourceConsumer', 'variable resource consumer is preserved but requires a player-selected/manual amount', 'manual');
      add('manual', 'one or more resource costs need manual/variable resolution', 'manual');
    }
    if (malformedConsumers.length > 0 || parsedConsumers.length < fixedConsumers.length) {
      gaps.push(`RESOURCE_CONSUMER_PARSE_PARTIAL:${parsedConsumers.length}/${rawConsumerCount}`);
    }
  }

  if (resourceUpdaterShape(payload, mechanics)) {
    add('resourceUpdater', 'feature changes or restores a resource outside a simple fixed spend', 'manual');
  }

  const rawActions = [
    ...asArray(payload.grantsActions),
    ...asArray(payload.actions),
    ...asArray(payload.actionOptions)
  ];
  if (rawActions.length) {
    const parsedActions = parseGrantedActionsFromPayload(item, `coverage-${item.importItemId || item.id}`);
    const specializedRuntime = specializedGrantedActionRuntime(item, rawActions);
    if (parsedActions.length) {
      add('grantedAction', 'declarative granted action is materialized on the owned feature', 'executable');
    }
    if (parsedActions.length < rawActions.length) {
      add(
        'grantedAction',
        specializedRuntime ?? 'declarative action exists but requires a specialized/manual runtime instead of the generic attack/spell mapper',
        specializedRuntime ? 'executable' : 'manual'
      );
    }

    const malformedActionDeclarations = rawActions
      .map(asRecord)
      .filter((action) => !asString(action.type) && !asString(action.actionType));
    if (malformedActionDeclarations.length > 0) {
      gaps.push(`GRANTED_ACTION_DECLARATION_MALFORMED:${malformedActionDeclarations.length}/${rawActions.length}`);
    }
  }

  const spellcasting = asRecord(payload.spellcasting);
  if (Object.keys(spellcasting).length > 0) {
    add(
      'grantedSpell',
      'class/subclass spellcasting progression is represented by the dedicated spellcasting runtime',
      'automatic'
    );
  }

  const spellSignals = classifySpellAccessFeature(item);
  if (payload.ritualCastingFromSpellbookWithoutPreparation === true) {
    add('grantedSpell', 'ritual spellbook casting is a spell-access capability of the owned feature', 'automatic');
  }
  const unresolvedSpellSignals = spellSignals.filter((signal) => signal.kind === 'catalogReconciliationRequired');
  if (spellSignals.some((signal) => signal.kind !== 'catalogReconciliationRequired')) {
    add('grantedSpell', 'spell-access mechanic is represented by the dedicated spell-access runtime', 'automatic');
  }
  if (unresolvedSpellSignals.length) gaps.push('SPELL_ACCESS_CATALOG_RECONCILIATION_REQUIRED');

  const normalizedName = item.name.trim().toLowerCase();
  const hasStructuredChoice = hasAny(payload, [
    'choice', 'chooseSpells', 'weaponMasteryChoices', 'expertiseSkillChoices', 'languageChoices',
    'skillChoiceCount', 'masteryReplacementOptions', 'metamagicOptionsKnownByLevel', 'invocationsKnownByLevel'
  ]);
  const isSubclassMilestone = hasValue(payload.subclassLevel) && normalizedName.includes('subclass');
  if (isChoiceProgressionFeature(item) || hasStructuredChoice || isSubclassMilestone || spellSignals.some((signal) => [
    'bonusChoice', 'mysticArcanumChoice', 'spellbookBonusChoice', 'spellbookSpecialChoice'
  ].includes(signal.kind))) {
    add('choice', 'feature requires a player choice handled outside blind automatic materialization', 'automatic');
  }

  if (passiveShape(payload, mechanics)) {
    const automaticPassive = automaticPassiveShape(payload);
    add(
      'passive',
      automaticPassive
        ? 'passive mechanic has a direct character/runtime projection'
        : 'passive mechanic is preserved by the owned Compendium feature but is not fully executable yet',
      automaticPassive ? 'automatic' : 'manual'
    );
    if (!automaticPassive) add('manual', 'one or more passive mechanics remain descriptive/manual', 'manual');
  }

  if (manualShape(payload, mechanics)) {
    add('manual', 'feature contains a mechanic that still requires descriptive/manual handling', 'manual');
  }

  if (!signals.length && Object.keys(mechanics).length > 0) {
    add('manual', 'structured mechanics exist, but this shape is currently tracked descriptively/manual', 'manual');
  }

  return {
    itemId: item.id,
    importItemId: item.importItemId,
    name: item.name,
    status: item.status,
    classReference: asString(payload.classId) ?? asString(payload.ownerClassId),
    subclassReference: asString(payload.subclassId) ?? asString(payload.ownerSubclassId),
    signals,
    gaps
  };
};

export const buildAutomaticFeatureCoverageReport = (
  items: StoredCompendiumItem[]
): AutomaticFeatureCoverageReport => {
  const progressionReferences = collectProgressionOwnedFeatureReferences(items);
  const missingProgressionFeatures = Array.from(progressionReferences)
    .filter((reference) => {
      const item = findCompendiumItemByReference(items, reference);
      return !item || item.type !== 'feature';
    })
    .sort();

  const progressionFeaturesById = new Map<string, StoredCompendiumItem>();
  for (const reference of progressionReferences) {
    const item = findCompendiumItemByReference(items, reference);
    if (!item || item.type !== 'feature' || isTechnicalProgressionSupportNode(item)) continue;
    progressionFeaturesById.set(item.id, item);
  }
  const features = Array.from(progressionFeaturesById.values());
  const entries = features.map(classifyAutomaticFeatureCoverage);
  const coverageCounts = Object.fromEntries(([
    'passive', 'resourcePool', 'resourceConsumer', 'resourceUpdater',
    'grantedAction', 'grantedSpell', 'choice', 'manual'
  ] as AutomaticFeatureCoverageKind[]).map((kind) => [
    kind,
    entries.filter((entry) => entry.signals.some((signal) => signal.kind === kind)).length
  ])) as Record<AutomaticFeatureCoverageKind, number>;

  return {
    totalProgressionReferences: progressionReferences.size,
    progressionFeatureCount: features.length,
    disabledFeatureCount: features.filter((item) => item.status === 'disabled').length,
    coverageCounts,
    entries,
    failures: {
      missingProgressionFeatures,
      uncoveredFeatures: entries
        .filter((entry) => entry.status !== 'disabled' && entry.signals.length === 0)
        .map((entry) => entry.importItemId),
      malformedResourceConsumers: entries
        .filter((entry) => entry.gaps.some((gap) => gap.startsWith('RESOURCE_CONSUMER_PARSE_PARTIAL')))
        .map((entry) => entry.importItemId),
      malformedGrantedActions: entries
        .filter((entry) => entry.gaps.some((gap) => gap.startsWith('GRANTED_ACTION_DECLARATION_MALFORMED')))
        .map((entry) => entry.importItemId),
      unresolvedSpellAccessFeatures: entries
        .filter((entry) => entry.gaps.includes('SPELL_ACCESS_CATALOG_RECONCILIATION_REQUIRED'))
        .map((entry) => entry.importItemId)
    }
  };
};
