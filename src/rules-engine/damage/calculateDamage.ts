import {
  Character,
  CharacterAction,
  CombatState,
  DamageAnalysisResult,
  DamageApplication,
  DamageComponent,
  DamageFormula,
  DamageRange,
  ResourceCost,
  RuleValidationIssue
} from '../../types';
import { diceRange } from '../dice/math';
import { getAbilityModifier, getProficiencyBonus } from '../characters/derivedStats';
import { calculateHitChance } from './hitChance';
import { actionDamageTypes, describeTriggeredDamageRule, resolveCustomDamageMultiplier, resolveTriggeredDamageRules } from '../../characters/customRuleEffects';
import { resolveCustomNumericModifiers, resolveCustomRollModifiers } from '../../characters/customModifierRules';

export interface DamageContext {
  character: Character;
  combatState: CombatState;
  customVariables?: Record<string, number>;
  enabledConditionIds?: string[];
}

const signed = (value: number, component: Pick<DamageComponent, 'operation'>): number =>
  component.operation === 'subtract' ? -value : value;

const emptyRange = (): DamageRange => ({ min: 0, max: 0, average: 0 });

const addRange = (acc: DamageRange, value: DamageRange): DamageRange => ({
  min: acc.min + value.min,
  max: acc.max + value.max,
  average: acc.average + value.average
});

const scaleRange = (range: DamageRange, factor: number): DamageRange => ({
  min: range.min * factor,
  max: range.max * factor,
  average: range.average * factor
});

const addFlatToDamageRange = (range: DamageRange, amount: number): DamageRange => ({
  min: Math.max(0, range.min + amount),
  max: Math.max(0, range.max + amount),
  average: Math.max(0, range.average + amount)
});

const shouldIncludeComponent = (component: DamageComponent, context: DamageContext): boolean => {
  if (!component.condition) return true;
  if (component.condition.defaultEnabled) return true;
  const enabled = new Set([...(context.combatState.activeConditionIds ?? []), ...(context.enabledConditionIds ?? [])]);
  return enabled.has(component.condition.id);
};

const componentRange = (component: DamageComponent, context: DamageContext, critical: boolean): DamageRange => {
  if (!shouldIncludeComponent(component, context)) return emptyRange();
  if (critical && component.criticalBehavior === 'extraOnCritOnly') {
    // Included normally below for dice; static extra-on-crit components are also allowed.
  }
  if (!critical && component.criticalBehavior === 'extraOnCritOnly') return emptyRange();

  let range: DamageRange;
  switch (component.kind) {
    case 'dice': {
      if (!component.dice) return emptyRange();
      const base = diceRange(component.dice);
      const multiplier = critical && component.criticalBehavior !== 'notDoubled' ? 2 : 1;
      range = scaleRange(base, multiplier);
      break;
    }
    case 'abilityModifier': {
      const value = component.ability ? getAbilityModifier(context.character.abilities, component.ability) : 0;
      range = { min: value, max: value, average: value };
      break;
    }
    case 'proficiencyBonus': {
      const value = getProficiencyBonus(context.character);
      range = { min: value, max: value, average: value };
      break;
    }
    case 'flat': {
      const value = component.value ?? 0;
      range = { min: value, max: value, average: value };
      break;
    }
    case 'customVariable': {
      const key = component.variableKey ?? '';
      const value = context.customVariables?.[key] ?? 0;
      range = { min: value, max: value, average: value };
      break;
    }
    default:
      range = emptyRange();
  }

  return {
    min: signed(range.min, component),
    max: signed(range.max, component),
    average: signed(range.average, component)
  };
};

const emptyApplicationTotals = (): Record<DamageApplication, DamageRange> => ({
  onHit: emptyRange(),
  guaranteed: emptyRange(),
  onSaveFail: emptyRange(),
  onSaveSuccessHalf: emptyRange(),
  conditional: emptyRange()
});

export const calculateFormulaRange = (
  formula: DamageFormula,
  context: DamageContext,
  critical = false
): {
  total: DamageRange;
  breakdown: DamageAnalysisResult['breakdown'];
  warnings: RuleValidationIssue[];
  applicationTotals: Record<DamageApplication, DamageRange>;
} => {
  const warnings: RuleValidationIssue[] = [];
  if (formula.unresolvedTokens?.length) {
    warnings.push({
      severity: 'warning',
      code: 'DAMAGE_UNRESOLVED_TOKEN',
      message: `Fórmula possui tokens não resolvidos: ${formula.unresolvedTokens.join(', ')}`
    });
  }

  const breakdown: DamageAnalysisResult['breakdown'] = [];
  const applicationTotals = emptyApplicationTotals();
  const total = formula.components.reduce((acc, component) => {
    const value = componentRange(component, context, critical);
    applicationTotals[component.application] = addRange(applicationTotals[component.application], value);
    if (value.min || value.max || value.average) {
      breakdown.push({
        label: component.label ?? component.kind,
        min: value.min,
        max: value.max,
        average: value.average,
        sourceType: component.sourceType,
        application: component.application,
        conditionLabel: component.condition?.label
      });
    }
    return addRange(acc, value);
  }, emptyRange());

  return { total, breakdown, warnings, applicationTotals };
};

const resistanceFactor = (combatState: CombatState): number => combatState.resistanceMultiplier ?? 1;

const getAttackBonus = (action: CharacterAction, character: Character): number | undefined => {
  const ability = action.type === 'attack' ? action.attackAbility ?? 'STR' : action.spellcastingAbility;
  const base = action.attackBonusOverride !== undefined
    ? action.attackBonusOverride
    : action.type === 'attack'
      ? getAbilityModifier(character.abilities, ability ?? 'STR') + getProficiencyBonus(character) + (action.attackBonusExtra ?? 0)
      : undefined;
  if (base === undefined) return undefined;
  const custom = resolveCustomNumericModifiers(
    character,
    action.type === 'spell' ? ['attackRoll', 'spellAttackRoll'] : 'attackRoll',
    { action, ability }
  );
  return Math.floor((base + custom.add) * custom.multiplier);
};

const actionDamageFormula = (action: CharacterAction): DamageFormula | undefined =>
  action.type === 'attack' ? action.damage : action.damage;

const combineRollMode = (base: CombatState['rollMode'], imposed?: CombatState['rollMode']): CombatState['rollMode'] => {
  if (!imposed || imposed === 'normal') return base;
  if (base === 'normal') return imposed;
  if (base !== imposed) return 'normal';
  return base;
};

const coverACBonus = (cover: CombatState['cover']): number => cover === 'half' ? 2 : cover === 'threeQuarters' ? 5 : 0;

const creatureSizeRank: Record<NonNullable<CombatState['targetSize']>, number> = {
  Tiny: 0,
  Small: 1,
  Medium: 2,
  Large: 3,
  Huge: 4,
  Gargantuan: 5
};

const targetWithinMaximumSize = (
  target: CombatState['targetSize'],
  maximum: NonNullable<CombatState['targetSize']> | undefined
): boolean => !target || !maximum || creatureSizeRank[target] <= creatureSizeRank[maximum];

const actionRangeState = (action: CharacterAction, combatState: CombatState): {
  invalid: boolean;
  longRange: boolean;
  issues: RuleValidationIssue[];
} => {
  const issues: RuleValidationIssue[] = [];
  if (combatState.lineOfSight === false || combatState.cover === 'total') {
    issues.push({ severity: 'error', code: 'TARGET_NOT_VISIBLE', message: 'O alvo não pode ser atingido sem linha de visão ou através de cobertura total.' });
    return { invalid: true, longRange: false, issues };
  }
  const distance = combatState.targetDistanceFeet;
  if (distance === undefined) return { invalid: false, longRange: false, issues };
  if (action.type === 'attack') {
    const normal = action.range?.normal ?? (action.tags?.some((tag) => tag.toLowerCase() === 'reach') ? 10 : 5);
    const long = action.range?.long ?? normal;
    if (distance > long) {
      issues.push({ severity: 'error', code: 'TARGET_OUT_OF_RANGE', message: `${action.name} alcança no máximo ${long} pés, mas o alvo está a ${distance} pés.` });
      return { invalid: true, longRange: false, issues };
    }
    if (distance > normal) {
      issues.push({ severity: 'warning', code: 'TARGET_AT_LONG_RANGE', message: `${action.name} está em alcance longo (${distance} pés); a jogada de ataque tem desvantagem.` });
      return { invalid: false, longRange: true, issues };
    }
  } else if (action.range) {
    const match = action.range.match(/(\d+)\s*(?:ft|feet|foot|pes|pés)/i);
    const maximum = match?.[1] ? Number(match[1]) : undefined;
    if (maximum !== undefined && distance > maximum) {
      issues.push({ severity: 'error', code: 'TARGET_OUT_OF_RANGE', message: `${action.name} alcança ${maximum} pés, mas o alvo está a ${distance} pés.` });
      return { invalid: true, longRange: false, issues };
    }
  }
  return { invalid: false, longRange: false, issues };
};

export const analyzeActionDamage = (params: {
  action: CharacterAction;
  character: Character;
  combatState: CombatState;
  repeat?: number;
  enabledConditionIds?: string[];
  customVariables?: Record<string, number>;
}): DamageAnalysisResult => {
  const { action, character, combatState } = params;
  const formula = actionDamageFormula(action);
  const resources: ResourceCost[] = action.consumes ?? [];
  const rangeState = actionRangeState(action, combatState);
  const warnings: RuleValidationIssue[] = [...rangeState.issues];
  const ammunitionConsumed = action.type === 'attack' && action.ammunitionType
    ? [{ type: action.ammunitionType, amount: Math.max(1, action.ammunitionPerAttack ?? 1) * Math.max(1, action.attacksCount ?? 1) * Math.max(1, params.repeat ?? 1), label: action.ammunitionType }]
    : [];
  const masteryEffects: string[] = action.type === 'attack' && action.mastery ? [action.mastery.description] : [];
  const attacksCount = (action.type === 'attack' ? action.attacksCount : action.attacksCount ?? 1) * (params.repeat ?? 1);
  const targetCount = Math.max(1, action.type === 'spell' ? action.targets ?? combatState.targetCount : combatState.targetCount);

  if (!formula) {
    return {
      id: action.id,
      name: action.name,
      actionCost: action.actionCost,
      sourceType: action.sourceType,
      formula: '-',
      attacksCount,
      perHit: emptyRange(),
      critical: emptyRange(),
      perTarget: emptyRange(),
      total: emptyRange(),
      guaranteed: emptyRange(),
      hitDependent: emptyRange(),
      conditioned: emptyRange(),
      saveDependent: emptyRange(),
      targetCount,
      resourcesConsumed: resources,
      spellSlotsConsumed: [],
      ammunitionConsumed,
      masteryEffects,
      warnings: [{ severity: 'warning', code: 'NO_DAMAGE_FORMULA', message: 'Ação sem fórmula de dano cadastrada.' }],
      breakdown: []
    };
  }

  const context: DamageContext = {
    character,
    combatState,
    enabledConditionIds: params.enabledConditionIds,
    customVariables: params.customVariables
  };

  const oncePerTurnComponents = formula.components.filter((component) => Boolean(component.condition?.oncePerTurnKey));
  const repeatableComponents = formula.components.filter((component) => !component.condition?.oncePerTurnKey);
  const repeatableFormula: DamageFormula = { ...formula, components: repeatableComponents };
  const oncePerTurnFormula: DamageFormula = { ...formula, components: oncePerTurnComponents };
  const normal = calculateFormulaRange(repeatableFormula, context, false);
  const critical = calculateFormulaRange(repeatableFormula, context, true);
  const onceNormal = calculateFormulaRange(oncePerTurnFormula, context, false);
  const onceCritical = calculateFormulaRange(oncePerTurnFormula, context, true);
  warnings.push(...normal.warnings, ...critical.warnings, ...onceNormal.warnings, ...onceCritical.warnings);

  const factor = resistanceFactor(combatState);
  const customMultiplier = resolveCustomDamageMultiplier(character, action);
  const structuredDamage = resolveCustomNumericModifiers(
    character,
    action.type === 'spell' ? ['damageDealt', 'spellDamage'] : 'damageDealt',
    { action }
  );
  const effectiveDamageFactor = factor * customMultiplier.multiplier * structuredDamage.multiplier;
  if (customMultiplier.multiplier !== 1) {
    const labels = customMultiplier.rules.map(({ binding, rule }) => rule.label ?? binding.ownerName).join(', ');
    warnings.push({
      severity: 'info',
      code: 'CUSTOM_DAMAGE_MULTIPLIER_APPLIED',
      message: `${labels}: multiplicador de dano ×${customMultiplier.multiplier} aplicado a ${actionDamageTypes(action).join(', ') || 'este dano'}.`
    });
    if (actionDamageTypes(action).length > 1) {
      warnings.push({
        severity: 'warning',
        code: 'CUSTOM_DAMAGE_MULTIPLIER_MIXED_TYPES',
        message: 'A ação possui mais de um tipo de dano; o multiplicador personalizado foi aplicado à fórmula inteira e deve ser revisado se apenas parte dela usar o tipo configurado.'
      });
    }
  }
  if (structuredDamage.add !== 0 || structuredDamage.multiplier !== 1) {
    warnings.push({
      severity: 'info',
      code: 'CUSTOM_STRUCTURED_DAMAGE_MODIFIER_APPLIED',
      message: `Modificador estruturado: ${structuredDamage.add >= 0 ? '+' : ''}${structuredDamage.add} e ×${structuredDamage.multiplier} aplicados ao dano.`
    });
  }
  for (const { binding, rule } of resolveTriggeredDamageRules(character, action)) {
    warnings.push({
      severity: 'info',
      code: 'CUSTOM_TRIGGERED_DAMAGE_RULE',
      message: describeTriggeredDamageRule(rule, binding.ownerName)
    });
  }

  const perHit = addFlatToDamageRange(scaleRange(normal.total, effectiveDamageFactor), structuredDamage.add);
  const critRange = addFlatToDamageRange(scaleRange(critical.total, effectiveDamageFactor), structuredDamage.add);
  const oncePerTurn = scaleRange(onceNormal.total, effectiveDamageFactor);
  const oncePerTurnCritical = scaleRange(onceCritical.total, effectiveDamageFactor);
  const perTarget = scaleRange(perHit, attacksCount);
  let total = addRange(scaleRange(perTarget, targetCount), oncePerTurn);

  const bucketScale = (application: DamageApplication): DamageRange => addRange(
    scaleRange(scaleRange(normal.applicationTotals[application], effectiveDamageFactor), attacksCount * targetCount),
    scaleRange(onceNormal.applicationTotals[application], effectiveDamageFactor)
  );
  const guaranteed = bucketScale('guaranteed');
  const hitDependent = bucketScale('onHit');
  let conditioned = bucketScale('conditional');
  const saveDependent = addRange(bucketScale('onSaveFail'), bucketScale('onSaveSuccessHalf'));

  let weightedAverage: number | undefined;
  let hitChanceResult: DamageAnalysisResult['hitChance'];
  const attackBonus = getAttackBonus(action, character);

  const effectiveTargetAC = combatState.targetAC === undefined ? undefined : combatState.targetAC + coverACBonus(combatState.cover);
  const customAttackRoll = resolveCustomRollModifiers(
    character,
    action.type === 'spell' ? ['attackRoll', 'spellAttackRoll'] : 'attackRoll',
    { action, ability: action.type === 'attack' ? action.attackAbility ?? 'STR' : action.spellcastingAbility }
  );
  const rangeRollMode = combineRollMode(combatState.rollMode, rangeState.longRange ? 'disadvantage' : undefined);
  const effectiveRollMode = combineRollMode(rangeRollMode, customAttackRoll.rollMode);
  if (effectiveTargetAC !== undefined && attackBonus !== undefined && !rangeState.invalid) {
    hitChanceResult = calculateHitChance({
      attackBonus,
      targetAC: effectiveTargetAC,
      rollMode: effectiveRollMode,
      critRange: combatState.critRange,
      criticalGuaranteed: combatState.criticalGuaranteed
    });
    const attempts = attacksCount * targetCount;
    const repeatedWeighted =
      (hitChanceResult.normalHitChance * perHit.average + hitChanceResult.critChance * critRange.average) * attempts;
    const atLeastOneHit = 1 - Math.pow(1 - hitChanceResult.hitChance, attempts);
    const atLeastOneCrit = 1 - Math.pow(1 - hitChanceResult.critChance, attempts);
    const onceWeighted = atLeastOneHit * oncePerTurn.average
      + atLeastOneCrit * Math.max(0, oncePerTurnCritical.average - oncePerTurn.average);
    weightedAverage = repeatedWeighted + onceWeighted;
  }

  if (rangeState.invalid) weightedAverage = 0;

  if (action.type === 'attack' && action.mastery?.property === 'graze' && hitChanceResult) {
    const ability = action.attackAbility ?? 'STR';
    const grazeDamage = Math.max(0, getAbilityModifier(character.abilities, ability));
    const attempts = attacksCount * targetCount;
    const grazeAverage = (1 - hitChanceResult.hitChance) * grazeDamage * attempts;
    weightedAverage = (weightedAverage ?? 0) + grazeAverage;
    conditioned = addRange(conditioned, { min: grazeDamage, max: grazeDamage, average: grazeAverage });
    masteryEffects.push(`Graze acrescenta média ${grazeAverage.toFixed(2)} em erros.`);
  }

  if (action.type === 'attack' && action.mastery?.property === 'cleave' && combatState.adjacentSecondaryTarget) {
    const noAbilityFormula: DamageFormula = {
      ...formula,
      components: formula.components.filter((component) => component.kind !== 'abilityModifier')
    };
    const cleave = scaleRange(calculateFormulaRange(noAbilityFormula, context, false).total, effectiveDamageFactor);
    total = addRange(total, cleave);
    conditioned = addRange(conditioned, cleave);
    if (hitChanceResult) weightedAverage = (weightedAverage ?? 0) + hitChanceResult.hitChance * cleave.average;
    masteryEffects.push('Cleave incluiu um ataque secundário contra alvo adjacente.');
  }

  if (action.type === 'attack' && action.mastery?.property === 'push') {
    if (targetWithinMaximumSize(combatState.targetSize, action.mastery.maxTargetSize)) {
      masteryEffects.push(`Push pode mover o alvo em ${action.mastery.forcedMovementFt ?? 10} pés.`);
    } else {
      warnings.push({
        severity: 'warning',
        code: 'WEAPON_MASTERY_TARGET_TOO_LARGE',
        message: `Push não afeta um alvo ${combatState.targetSize}; o limite é ${action.mastery.maxTargetSize}.`
      });
      masteryEffects.push('Push indisponível para o tamanho atual do alvo.');
    }
  }
  if (action.type === 'attack' && action.mastery?.property === 'slow') masteryEffects.push('Slow reduz a Speed do alvo em 10 pés.');
  if (action.type === 'attack' && action.mastery?.property === 'sap') masteryEffects.push('Sap impõe desvantagem no próximo ataque do alvo.');
  if (action.type === 'attack' && action.mastery?.property === 'vex') masteryEffects.push('Vex concede vantagem no próximo ataque contra o mesmo alvo.');
  if (action.type === 'attack' && action.mastery?.property === 'topple') masteryEffects.push(`Topple exige salvaguarda de CON CD ${action.mastery.saveDC ?? '?'}.`);

  return {
    id: action.id,
    name: action.name,
    actionCost: action.actionCost,
    sourceType: action.sourceType,
    formula: customMultiplier.multiplier !== 1 ? `${formula.raw} × ${customMultiplier.multiplier}` : formula.raw,
    attacksCount,
    perHit,
    critical: critRange,
    perTarget,
    total,
    guaranteed,
    hitDependent,
    conditioned,
    saveDependent,
    weightedAverage,
    hitChance: hitChanceResult,
    targetCount,
    resourcesConsumed: resources,
    spellSlotsConsumed: [],
    ammunitionConsumed,
    masteryEffects,
    warnings,
    breakdown: [...normal.breakdown, ...onceNormal.breakdown]
  };
};
