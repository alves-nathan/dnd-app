import {
  ActionCost,
  AbilityUseResourceChange,
  AbilityUseSpellSlotChange,
  AbilityUseTransaction,
  Character,
  ResourceCost,
  RuleValidationIssue,
  SpellSlotCost
} from '../../types';
import { createId } from '../../utils/id';
import {
  adjustResource,
  checkResourceAvailability,
  findResource,
  spendResources
} from '../resources/resourceManager';
import {
  adjustSpellSlot,
  checkSpellSlotAvailability,
  findSpellSlotPools,
  spendSpellSlots
} from '../resources/spellSlotManager';

export interface AbilityUseDefinition {
  id: string;
  name: string;
  sourceItemId?: string;
  sourceEntityId?: string;
  actionCost?: ActionCost;
  resourceCosts?: ResourceCost[];
  spellSlotCosts?: SpellSlotCost[];
}

export interface AbilityUseAvailability {
  ok: boolean;
  issues: RuleValidationIssue[];
}

export interface AbilityUseExecutionResult {
  character: Character;
  transaction?: AbilityUseTransaction;
  issues: RuleValidationIssue[];
}

const issue = (code: string, message: string): RuleValidationIssue => ({ severity: 'error', code, message });

export const checkAbilityUseAvailability = (
  character: Character,
  definition: AbilityUseDefinition
): AbilityUseAvailability => {
  const resource = checkResourceAvailability(character, definition.resourceCosts ?? []);
  const slots = checkSpellSlotAvailability(character, definition.spellSlotCosts ?? []);
  const issues = [...resource.issues, ...slots.issues];
  return { ok: issues.every((entry) => entry.severity !== 'error'), issues };
};

const resourceChangesFromTransactions = (
  transactions: Array<{ resourceId: string; resourceName: string; before: number; after: number }>
): AbilityUseResourceChange[] => transactions.map((transaction) => ({
  resourceId: transaction.resourceId,
  resourceName: transaction.resourceName,
  before: transaction.before,
  after: transaction.after
}));

const spellSlotChangesFromTransactions = (
  transactions: Array<{
    poolId?: string;
    poolKind?: AbilityUseSpellSlotChange['poolKind'];
    sourceClassId?: string;
    slotLevel: AbilityUseSpellSlotChange['slotLevel'];
    before: number;
    after: number;
  }>
): AbilityUseSpellSlotChange[] => transactions.map((transaction) => ({
  poolId: transaction.poolId,
  poolKind: transaction.poolKind,
  sourceClassId: transaction.sourceClassId,
  slotLevel: transaction.slotLevel,
  before: transaction.before,
  after: transaction.after
}));

export const applyAbilityUse = (
  character: Character,
  definition: AbilityUseDefinition
): AbilityUseExecutionResult => {
  const resourceCosts = definition.resourceCosts ?? [];
  const spellSlotCosts = definition.spellSlotCosts ?? [];
  if (!resourceCosts.length && !spellSlotCosts.length) {
    return {
      character,
      issues: [issue('ABILITY_USE_NO_EXECUTABLE_COST', `${definition.name} não possui custo executável declarado.`)]
    };
  }

  const availability = checkAbilityUseAvailability(character, definition);
  if (!availability.ok) return { character, issues: availability.issues };

  const reason = `Habilidade: ${definition.name}`;
  const resourceResult = spendResources({ character, costs: resourceCosts, reason });
  if (resourceResult.issues.some((entry) => entry.severity === 'error')) {
    return { character, issues: resourceResult.issues };
  }
  const slotResult = spendSpellSlots({ character: resourceResult.character, costs: spellSlotCosts, reason });
  if (slotResult.issues.some((entry) => entry.severity === 'error')) {
    // This should be unreachable after the joint preflight. Keep the operation
    // atomic by returning the original snapshot if a later subsystem rejects it.
    return { character, issues: slotResult.issues };
  }

  const transaction: AbilityUseTransaction = {
    id: createId('abilityUseTx'),
    characterId: character.id,
    abilityId: definition.id,
    abilityName: definition.name,
    sourceItemId: definition.sourceItemId,
    sourceEntityId: definition.sourceEntityId,
    actionCost: definition.actionCost,
    status: 'applied',
    resourceChanges: resourceChangesFromTransactions(resourceResult.transactions),
    spellSlotChanges: spellSlotChangesFromTransactions(slotResult.transactions),
    createdAt: new Date().toISOString()
  };

  return {
    character: {
      ...slotResult.character,
      abilityUseTransactions: [...(slotResult.character.abilityUseTransactions ?? []), transaction]
    },
    transaction,
    issues: [...resourceResult.issues, ...slotResult.issues]
  };
};

const lastAppliedAbilityUse = (character: Character): AbilityUseTransaction | undefined =>
  [...(character.abilityUseTransactions ?? [])].reverse().find((transaction) => transaction.status === 'applied');

export const undoAbilityUse = (
  character: Character,
  transactionId?: string
): AbilityUseExecutionResult => {
  const latest = lastAppliedAbilityUse(character);
  if (!latest) return { character, issues: [issue('ABILITY_UNDO_NOT_FOUND', 'Nenhum uso de habilidade pode ser desfeito.')] };
  if (transactionId && latest.id !== transactionId) {
    return { character, issues: [issue('ABILITY_UNDO_NOT_LATEST', 'Somente o uso de habilidade mais recente pode ser desfeito com segurança.')] };
  }

  for (const change of latest.resourceChanges) {
    const current = findResource(character, change.resourceId);
    if (!current || current.current !== change.after) {
      return {
        character,
        issues: [issue('ABILITY_UNDO_CONFLICT', `${latest.abilityName} não pode ser desfeito porque ${change.resourceName} foi alterado depois do uso.`)]
      };
    }
  }
  for (const change of latest.spellSlotChanges) {
    const current = findSpellSlotPools(character, change.slotLevel, {
      poolKind: change.poolKind,
      sourceClassId: change.sourceClassId
    })[0];
    if (!current || current.current !== change.after) {
      return {
        character,
        issues: [issue('ABILITY_UNDO_CONFLICT', `${latest.abilityName} não pode ser desfeito porque os slots foram alterados depois do uso.`)]
      };
    }
  }

  let next = character;
  const reason = `Desfazer habilidade: ${latest.abilityName}`;
  for (const change of latest.resourceChanges) {
    next = adjustResource({
      character: next,
      resourceId: change.resourceId,
      delta: change.before - change.after,
      reason
    }).character;
  }
  for (const change of latest.spellSlotChanges) {
    next = adjustSpellSlot({
      character: next,
      slotLevel: change.slotLevel,
      delta: change.before - change.after,
      reason,
      poolKind: change.poolKind,
      sourceClassId: change.sourceClassId
    }).character;
  }

  const undoneAt = new Date().toISOString();
  next = {
    ...next,
    abilityUseTransactions: (next.abilityUseTransactions ?? []).map((transaction) =>
      transaction.id === latest.id
        ? { ...transaction, status: 'undone' as const, undoneAt }
        : transaction
    )
  };

  return { character: next, transaction: { ...latest, status: 'undone', undoneAt }, issues: [] };
};
