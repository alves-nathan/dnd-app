import { Character, CombatState, RuleValidationIssue, RuleValidationResult, TurnRotation } from '../../types';
import { checkRotationSpellSlots, spellSlotCostsFromTurnAction } from '../resources/spellSlotManager';
import { getActiveConcentrationEffect, validateActiveEffectConflicts } from '../effects/activeEffects';
import { gazeCastingOriginIssues } from '../../characters/warlockSpecializedInvocations';
import { checkRotationAmmunition } from '../../characters/ammunitionRules';
import { validateEquipmentLoadout } from '../../characters/equipmentLoadoutRules';
import { turnActionAttackCount, validateRotationInteractionEconomy } from '../../characters/interactionEconomyRules';
import { checkRotationThrownWeapons } from './tacticalCombat';
import { resolveTurnFeatureActivations, turnExtraActionAllowance, turnHasMagicRestrictedExtraAction } from './turnFeatureActivations';

const actionCostLabels: Record<string, string> = {
  action: 'ação',
  bonusAction: 'ação bônus',
  reaction: 'reação',
  movement: 'movimento'
};

export const validateTurnRotation = (rotation: TurnRotation, character: Character, combatState?: CombatState): RuleValidationResult => {
  const activationResolution = resolveTurnFeatureActivations(rotation);
  const resolvedRotation = activationResolution.rotation;
  const issues: RuleValidationIssue[] = [...activationResolution.issues];
  const limitedCosts = new Set(['action', 'bonusAction', 'reaction']);
  const usage = new Map<string, string[]>();
  const oncePerTurn = new Set<string>();
  const resourceCurrent = new Map([
    ...character.resources.map((resource) => [resource.id, resource.current] as const),
    ...(character.companions ?? []).flatMap((companion) =>
      companion.resources.map((resource) => [resource.id, resource.current] as const)
    )
  ]);
  let concentrationAction: string | undefined = getActiveConcentrationEffect(character)?.name ?? combatState?.concentratingOn;
  const activeConditionIds = new Set(combatState?.activeConditionIds ?? []);
  let companionAttackReplacement = 0;
  let ownAttackCount = 0;
  let weaponAttackActionUsed = false;
  issues.push(...validateEquipmentLoadout(character));
  issues.push(...validateRotationInteractionEconomy(resolvedRotation, character));
  if (combatState) issues.push(...validateActiveEffectConflicts(character, combatState));

  for (const activation of resolvedRotation.activations ?? []) {
    const activationCost = activation.actionCost;
    if (activationCost && limitedCosts.has(activationCost)) {
      const items = usage.get(activationCost) ?? [];
      items.push(activation.name);
      usage.set(activationCost, items);
    }
    for (const costItem of activation.consumes ?? []) {
      const current = resourceCurrent.get(costItem.resourceId);
      if (current === undefined) {
        issues.push({
          severity: 'error',
          code: 'RESOURCE_NOT_FOUND',
          message: `Recurso não cadastrado para ${activation.name}: ${costItem.label ?? costItem.resourceId}.`
        });
      } else if (current < costItem.amount) {
        issues.push({
          severity: 'error',
          code: 'RESOURCE_UNAVAILABLE',
          message: `Recurso insuficiente para ${activation.name}: ${costItem.label ?? costItem.resourceId}.`
        });
      }
      if (current !== undefined) resourceCurrent.set(costItem.resourceId, current - costItem.amount);
      if (costItem.oncePerTurnKey) {
        if (oncePerTurn.has(costItem.oncePerTurnKey)) {
          issues.push({ severity: 'error', code: 'ONCE_PER_TURN_CONFLICT', message: `O recurso "${costItem.label ?? costItem.oncePerTurnKey}" foi usado mais de uma vez no turno.` });
        }
        oncePerTurn.add(costItem.oncePerTurnKey);
      }
    }
  }

  for (const turnAction of resolvedRotation.actions) {
    const cost = turnAction.actionCost;
    if (turnAction.action.type === 'attack' && turnAction.action.weaponId && turnAction.actionCost === 'action' && !turnAction.action.tags?.includes('pact-familiar')) weaponAttackActionUsed = true;
    if (turnAction.action.type === 'attack') {
      if (turnAction.action.tags?.includes('pact-familiar')) companionAttackReplacement += Math.max(0, turnAction.action.replacesOwnAttackCount ?? 0);
      else ownAttackCount += turnActionAttackCount(turnAction);
      const masteryKey = turnAction.action.mastery?.oncePerTurnKey;
      if (masteryKey) {
        if (oncePerTurn.has(masteryKey)) issues.push({
          severity: 'error',
          code: 'WEAPON_MASTERY_ONCE_PER_TURN',
          message: `${turnAction.action.mastery?.label} só pode ser usado uma vez por turno.`
        });
        oncePerTurn.add(masteryKey);
      }
    }
    if (turnAction.action.type === 'spell' && turnAction.spellOrigin === 'gazeTarget') {
      issues.push(...gazeCastingOriginIssues(character, 'gazeTarget'));
      if (!turnAction.action.gazeCastingOriginAvailable) {
        issues.push({ severity: 'error', code: 'GAZE_CASTING_ORIGIN_UNAVAILABLE', message: `A magia "${turnAction.name}" não pode usar a criatura conectada como origem neste momento.` });
      }
    }
    if (turnAction.action.requiresReview) {
      issues.push({
        severity: 'warning',
        code: 'ACTION_SOURCE_REQUIRES_REVIEW',
        message: `Ação "${turnAction.name}" vem de regra importada ou ambígua que ainda precisa de revisão.`
      });
    }
    if (limitedCosts.has(cost)) {
      const isWeaponAttackPart = cost === 'action' && turnAction.action.type === 'attack' && Boolean(turnAction.action.weaponId) && !turnAction.action.tags?.includes('pact-familiar');
      if (!isWeaponAttackPart) {
        const items = usage.get(cost) ?? [];
        items.push(turnAction.name);
        usage.set(cost, items);
      }
    }

    if (turnAction.action.type === 'spell' && turnAction.action.concentration) {
      if (concentrationAction && concentrationAction !== turnAction.name) {
        issues.push({
          severity: 'error',
          code: 'CONCENTRATION_CONFLICT',
          message: `Conflito de concentração entre "${concentrationAction}" e "${turnAction.name}".`
        });
      }
      concentrationAction = turnAction.name;
    }

    const conditionCosts = (turnAction.action.damage?.components ?? [])
      .map((component) => component.condition)
      .filter((condition): condition is NonNullable<typeof condition> => Boolean(condition))
      .filter((condition) => !condition.defaultEnabled && ((turnAction.enabledConditionIds ?? []).includes(condition.id) || activeConditionIds.has(condition.id)));

    for (const condition of conditionCosts) {
      if (condition.requiresConcentration) {
        if (concentrationAction && concentrationAction !== condition.label) {
          issues.push({
            severity: 'error',
            code: 'CONCENTRATION_CONFLICT',
            message: `Conflito de concentração entre "${concentrationAction}" e condição "${condition.label}" em "${turnAction.name}".`
          });
        }
        concentrationAction = condition.label;
      }
      if (condition.oncePerTurnKey) {
        if (oncePerTurn.has(condition.oncePerTurnKey)) {
          issues.push({
            severity: 'error',
            code: 'ONCE_PER_TURN_CONFLICT',
            message: `A condição "${condition.label}" foi usada mais de uma vez no turno.`
          });
        }
        oncePerTurn.add(condition.oncePerTurnKey);
      }
      if (condition.requiresResourceId) {
        const current = resourceCurrent.get(condition.requiresResourceId);
        if (current === undefined) {
          issues.push({
            severity: 'error',
            code: 'RESOURCE_NOT_FOUND',
            message: `Condição "${condition.label}" exige um recurso não cadastrado: ${condition.requiresResourceId}.`
          });
        } else if (current < 1) {
          issues.push({
            severity: 'error',
            code: 'CONDITIONAL_RESOURCE_UNAVAILABLE',
            message: `Condição "${condition.label}" exige recurso indisponível.`
          });
        }
      }
    }

    for (const costItem of turnAction.action.consumes ?? []) {
      const current = resourceCurrent.get(costItem.resourceId);
      if (current === undefined) {
        issues.push({
          severity: 'error',
          code: 'RESOURCE_NOT_FOUND',
          message: `Recurso não cadastrado para ${turnAction.name}: ${costItem.label ?? costItem.resourceId}.`
        });
      } else if (current < costItem.amount) {
        issues.push({
          severity: 'error',
          code: 'RESOURCE_UNAVAILABLE',
          message: `Recurso insuficiente para ${turnAction.name}: ${costItem.label ?? costItem.resourceId}.`
        });
      }
      if (current !== undefined) resourceCurrent.set(costItem.resourceId, current - costItem.amount);
      if (costItem.oncePerTurnKey) {
        if (oncePerTurn.has(costItem.oncePerTurnKey)) {
          issues.push({
            severity: 'error',
            code: 'ONCE_PER_TURN_CONFLICT',
            message: `O recurso "${costItem.label ?? costItem.oncePerTurnKey}" foi usado mais de uma vez no turno.`
          });
        }
        oncePerTurn.add(costItem.oncePerTurnKey);
      }
    }
  }


  if (weaponAttackActionUsed) {
    const items = usage.get('action') ?? [];
    items.push('Ação de Ataque');
    usage.set('action', items);
  }

  if (companionAttackReplacement > ownAttackCount) {
    issues.push({
      severity: 'error',
      code: 'PACT_FAMILIAR_ATTACK_REPLACEMENT_MISSING',
      message: 'O ataque do Pact Familiar exige abrir mão de um ataque próprio, mas a rotação não contém ataques suficientes para substituir.'
    });
  }

  const oneWithShadowsEffectId = character.buildChoices?.oneWithShadows?.activeEffectId;
  if (oneWithShadowsEffectId && character.activeEffects.some((effect) => effect.id === oneWithShadowsEffectId && effect.status === 'active')) {
    const breaker = resolvedRotation.actions.find((entry) => entry.action.type === 'attack' || entry.action.type === 'spell');
    if (breaker) issues.push({ severity: 'info', code: 'ONE_WITH_SHADOWS_ENDS_AFTER_ACTION', message: `One with Shadows termina após "${breaker.name}" por ser ataque ou conjuração.` });
  }

  const extraActions = turnExtraActionAllowance(resolvedRotation);
  for (const [cost, items] of usage.entries()) {
    const allowed = cost === 'action' ? 1 + extraActions : 1;
    if (items.length > allowed) {
      issues.push({
        severity: 'error',
        code: 'ACTION_ECONOMY_CONFLICT',
        message: `Rotação usa ${items.length} ${actionCostLabels[cost] ?? cost}(ões), mas possui ${allowed} disponível(is): ${items.join(', ')}.`
      });
    }
  }

  if (turnHasMagicRestrictedExtraAction(resolvedRotation)) {
    const magicActions = resolvedRotation.actions.filter((entry) => entry.actionCost === 'action' && entry.action.type === 'spell');
    if (magicActions.length > 1) {
      issues.push({
        severity: 'error',
        code: 'ACTION_SURGE_MAGIC_ACTION_RESTRICTION',
        message: `Action Surge não pode fornecer a Magic action adicional. A rotação contém ${magicActions.length} magias com custo de Ação: ${magicActions.map((entry) => entry.name).join(', ')}.`
      });
    }
  }

  const quickenedActivations = (resolvedRotation.activations ?? []).filter((activation) => activation.modifier === 'quickenedSpell' && activation.targetActionId);
  for (const activation of quickenedActivations) {
    const otherLevelledSpells = resolvedRotation.actions.filter((entry) =>
      entry.action.type === 'spell'
      && entry.action.id !== activation.targetActionId
      && entry.id !== activation.targetActionId
      && (entry.action.spellLevel ?? 0) >= 1
    );
    if (otherLevelledSpells.length) {
      issues.push({
        severity: 'error',
        code: 'METAMAGIC_QUICKENED_LEVELLED_SPELL_CONFLICT',
        message: `Quickened Spell não pode ser combinado no mesmo turno com outra magia de nível 1+: ${otherLevelledSpells.map((entry) => entry.name).join(', ')}.`
      });
    }
  }

  const spellSlotCastCount = resolvedRotation.actions.reduce((count, entry) =>
    entry.action.type === 'spell' ? count + spellSlotCostsFromTurnAction(entry).reduce((sum, cost) => sum + cost.amount, 0) : count
  , 0);
  if (spellSlotCastCount > 1) {
    issues.push({
      severity: 'error',
      code: 'SPELL_SLOT_CAST_LIMIT_PER_TURN',
      message: `As regras 2024 permitem gastar apenas um spell slot para conjurar magia no mesmo turno; esta rotação tenta gastar ${spellSlotCastCount}.`
    });
  }

  const spellSlotAvailability = checkRotationSpellSlots(resolvedRotation, character);
  issues.push(...spellSlotAvailability.issues);
  issues.push(...checkRotationAmmunition(resolvedRotation, character).issues);
  issues.push(...checkRotationThrownWeapons(resolvedRotation, character).issues);

  if (!rotation.actions.length) {
    issues.push({ severity: 'warning', code: 'EMPTY_ROTATION', message: 'Rotação não possui ações.' });
  }

  return { ok: issues.every((issue) => issue.severity !== 'error'), issues };
};
