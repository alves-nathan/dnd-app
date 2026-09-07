import type {
  CharacterAction,
  DamageFormula,
  DamageSourceType,
  ResourceCost,
  RuleValidationIssue,
  SpellAction,
  TurnFeatureActivation,
  TurnRotation
} from '../../types';
import { parseDamageFormula } from '../dice/parser';

const issue = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({ severity, code, message });

const doubleSpellRange = (range: string | undefined): string | undefined => {
  if (!range?.trim()) return undefined;
  if (/^touch$/i.test(range.trim())) return '30 ft';
  const match = range.match(/(\d+(?:\.\d+)?)\s*(ft|feet|foot|pes|pés)/i);
  if (!match?.[1]) return undefined;
  const doubled = Number(match[1]) * 2;
  if (!Number.isFinite(doubled)) return undefined;
  return range.replace(match[0], `${doubled} ft`);
};

const activationLabel = (activation: TurnFeatureActivation): string => activation.name || activation.id;

const isMetamagicModifier = (activation: TurnFeatureActivation): boolean =>
  activation.modifier === 'quickenedSpell'
  || activation.modifier === 'distantSpell'
  || activation.modifier === 'subtleSpell';

const combineDamageFormula = (
  base: DamageFormula,
  bonusFormula: string,
  activationId: string,
  label: string,
  sourceType: DamageSourceType = 'classFeature'
): DamageFormula => {
  const parsed = parseDamageFormula(bonusFormula, { defaultSourceType: sourceType });
  return {
    raw: [base.raw, parsed.raw].filter(Boolean).join(' + '),
    components: [
      ...base.components,
      ...parsed.components.map((component, index) => ({
        ...component,
        id: `${activationId}:damage:${index}`,
        label: component.label ?? label,
        condition: {
          id: `${activationId}:once-per-use`,
          label,
          defaultEnabled: true,
          oncePerTurnKey: activationId
        }
      }))
    ],
    unresolvedTokens: [...(base.unresolvedTokens ?? []), ...(parsed.unresolvedTokens ?? [])]
  };
};

const applyOnHitDamageBonus = (
  action: CharacterAction,
  activation: TurnFeatureActivation
): CharacterAction | undefined => {
  const bonus = activation.damageBonus;
  if (!bonus || bonus.trigger !== 'onHit') return undefined;
  const eligibleAttackRoll = action.type === 'attack' || (action.type === 'spell' && (action.attacksCount ?? 0) > 0);
  if (!eligibleAttackRoll || !action.damage) return undefined;
  const damageTypes = Array.from(new Set([...(action.damageTypes ?? []), ...(bonus.damageType ? [bonus.damageType] : [])]));
  return {
    ...action,
    damage: combineDamageFormula(action.damage, bonus.formula, activation.id, activation.name, bonus.sourceType ?? 'classFeature'),
    damageTypes,
    tags: [...(action.tags ?? []), `turn-activation:${activation.modifier ?? activation.id}`],
    ruleNotes: [
      ...(action.ruleNotes ?? []),
      `${activation.name}: ${bonus.formula}${bonus.damageType ? ` ${bonus.damageType}` : ''} adicional quando esta ação acerta e causa dano.`
    ]
  };
};

export const turnActivationResourceCosts = (rotation: TurnRotation): ResourceCost[] =>
  (rotation.activations ?? []).flatMap((activation) => activation.consumes ?? []);

export const turnExtraActionAllowance = (rotation: TurnRotation): number =>
  (rotation.activations ?? [])
    .filter((activation) => activation.kind === 'extraAction')
    .reduce((sum, activation) => sum + Math.max(0, Math.floor(activation.extraActionCount ?? 0)), 0);

export const turnHasMagicRestrictedExtraAction = (rotation: TurnRotation): boolean =>
  (rotation.activations ?? []).some((activation) =>
    activation.kind === 'extraAction' && activation.prohibitsMagicAction === true && (activation.extraActionCount ?? 0) > 0
  );

export interface ResolvedTurnFeatureActivations {
  rotation: TurnRotation;
  issues: RuleValidationIssue[];
}

/**
 * Applies deterministic turn modifiers without spending resources. Spending is
 * handled by the existing rotation resource transaction layer so analysis,
 * validation and tactical execution all see the same resolved action shape.
 */
export const resolveTurnFeatureActivations = (rotation: TurnRotation): ResolvedTurnFeatureActivations => {
  const issues: RuleValidationIssue[] = [];
  let actions = rotation.actions.map((entry) => ({ ...entry, action: { ...entry.action } }));
  const activations = rotation.activations ?? [];
  const seenActivationIds = new Set<string>();
  const metamagicByTarget = new Map<string, TurnFeatureActivation[]>();

  for (const activation of activations) {
    if (seenActivationIds.has(activation.id)) {
      issues.push(issue('error', 'TURN_ACTIVATION_DUPLICATE', `A ativação "${activationLabel(activation)}" foi adicionada mais de uma vez à rotação.`));
      continue;
    }
    seenActivationIds.add(activation.id);

    if (activation.kind === 'extraAction') {
      if ((activation.extraActionCount ?? 0) <= 0) {
        issues.push(issue('error', 'TURN_EXTRA_ACTION_INVALID', `A ativação "${activationLabel(activation)}" não concede uma quantidade válida de ações.`));
      }
      continue;
    }

    if (!activation.targetActionId) {
      issues.push(issue('error', 'TURN_ACTIVATION_TARGET_REQUIRED', `A ativação "${activationLabel(activation)}" precisa apontar para uma ação da rotação.`));
      continue;
    }
    const targetIndex = actions.findIndex((entry) => entry.action.id === activation.targetActionId || entry.id === activation.targetActionId);
    if (targetIndex < 0) {
      issues.push(issue('error', 'TURN_ACTIVATION_TARGET_MISSING', `A ativação "${activationLabel(activation)}" aponta para uma ação que não existe mais na rotação.`));
      continue;
    }

    const target = actions[targetIndex]!;
    if (isMetamagicModifier(activation)) {
      const bucket = metamagicByTarget.get(target.id) ?? [];
      bucket.push(activation);
      metamagicByTarget.set(target.id, bucket);
    }

    if (activation.modifier === 'giantAncestryFiresBurn') {
      const modifiedAction = applyOnHitDamageBonus(target.action, activation);
      if (!modifiedAction) {
        issues.push(issue('error', 'GIANT_ANCESTRY_FIRES_BURN_INELIGIBLE', `Fire's Burn exige uma ação com jogada de ataque que cause dano; "${target.name}" não é elegível.`));
        continue;
      }
      actions[targetIndex] = { ...target, action: modifiedAction };
      continue;
    }

    if (target.action.type !== 'spell') {
      issues.push(issue('error', 'TURN_ACTION_MODIFIER_INELIGIBLE', `A ativação "${activationLabel(activation)}" só pode modificar uma magia.`));
      continue;
    }

    let spell: SpellAction = { ...target.action, ruleNotes: [...(target.action.ruleNotes ?? [])] };
    if (activation.modifier === 'quickenedSpell') {
      if (spell.actionCost !== 'action') {
        issues.push(issue('error', 'METAMAGIC_QUICKENED_INELIGIBLE', `Quickened Spell exige uma magia com casting time de Action; "${spell.name}" usa ${spell.actionCost}.`));
        continue;
      }
      spell = {
        ...spell,
        actionCost: 'bonusAction',
        tags: [...(spell.tags ?? []), 'metamagic:quickened-spell'],
        ruleNotes: [...(spell.ruleNotes ?? []), 'Quickened Spell: esta conjuração usa Bonus Action nesta rotação.']
      };
      actions[targetIndex] = { ...target, actionCost: 'bonusAction', action: spell };
      continue;
    }

    if (activation.modifier === 'distantSpell') {
      const doubledRange = doubleSpellRange(spell.range);
      if (!doubledRange) {
        issues.push(issue('error', 'METAMAGIC_DISTANT_INELIGIBLE', `Distant Spell não conseguiu resolver o alcance de "${spell.name}" (${spell.range ?? 'sem alcance'}).`));
        continue;
      }
      spell = {
        ...spell,
        range: doubledRange,
        tags: [...(spell.tags ?? []), 'metamagic:distant-spell'],
        ruleNotes: [...(spell.ruleNotes ?? []), `Distant Spell: alcance ajustado de ${target.action.range ?? '—'} para ${doubledRange}.`]
      };
      actions[targetIndex] = { ...target, action: spell };
      continue;
    }

    if (activation.modifier === 'subtleSpell') {
      if (!spell.components) {
        issues.push(issue('error', 'METAMAGIC_SUBTLE_INELIGIBLE', `"${spell.name}" não possui componentes estruturados para Subtle Spell modificar.`));
        continue;
      }
      spell = {
        ...spell,
        components: {
          ...spell.components,
          verbal: false,
          somatic: false,
          // Material com custo/consumo não está estruturado no modelo atual.
          // Mantê-lo é conservador e evita ignorar um componente obrigatório.
          material: spell.components.material
        },
        tags: [...(spell.tags ?? []), 'metamagic:subtle-spell'],
        ruleNotes: [
          ...(spell.ruleNotes ?? []),
          spell.components.material
            ? 'Subtle Spell: componentes Verbal e Somático removidos; Material foi preservado porque custo/consumo ainda não é estruturado separadamente.'
            : 'Subtle Spell: componentes Verbal e Somático removidos nesta rotação.'
        ]
      };
      actions[targetIndex] = { ...target, action: spell };
      continue;
    }

    issues.push(issue('error', 'TURN_ACTION_MODIFIER_UNSUPPORTED', `A ativação "${activationLabel(activation)}" não possui modificador executável reconhecido.`));
  }

  for (const [targetId, targetActivations] of metamagicByTarget.entries()) {
    if (targetActivations.length > 1) {
      issues.push(issue(
        'error',
        'METAMAGIC_MULTIPLE_OPTIONS',
        `A ação ${actions.find((entry) => entry.id === targetId)?.name ?? targetId} recebeu mais de uma opção de Metamagic. As opções executáveis deste gate não podem ser combinadas entre si.`
      ));
    }
  }

  return { rotation: { ...rotation, actions }, issues };
};
