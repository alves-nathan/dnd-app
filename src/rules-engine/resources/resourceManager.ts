import {
  Character,
  CharacterCompanion,
  CharacterCompanionResource,
  CharacterCompanionTransaction,
  ResourceAvailabilityResult,
  ResourceCost,
  ResourcePool,
  ResourceTransaction,
  RestApplicationResult,
  RestType,
  RuleValidationIssue,
  TurnRotation
} from '../../types';
import { createId } from '../../utils/id';
import { turnActivationResourceCosts } from '../turns/turnFeatureActivations';

const issue = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({
  severity,
  code,
  message
});

const clampResource = (resource: ResourcePool, current: number): ResourcePool => ({
  ...resource,
  current: Math.max(0, Math.min(resource.max, current))
});

const makeTransaction = (params: {
  characterId: string;
  resource: ResourcePool;
  before: number;
  after: number;
  reason: string;
  restType?: RestType;
}): ResourceTransaction => ({
  id: createId('resTx'),
  characterId: params.characterId,
  resourceId: params.resource.id,
  resourceName: params.resource.name,
  amount: params.after - params.before,
  before: params.before,
  after: params.after,
  reason: params.reason,
  restType: params.restType,
  createdAt: new Date().toISOString()
});

export const normalizeResource = (resource: ResourcePool): ResourcePool => ({
  ...resource,
  max: Math.max(0, Math.floor(Number(resource.max) || 0)),
  current: Math.max(0, Math.min(Math.floor(Number(resource.current) || 0), Math.max(0, Math.floor(Number(resource.max) || 0))))
});

const companionResourceAsPool = (resource: CharacterCompanionResource, companion: CharacterCompanion): ResourcePool => ({
  id: resource.id,
  name: `${companion.name} · ${resource.name}`,
  max: resource.max,
  current: resource.current,
  recharge: resource.recharge,
  notes: `Recurso do companion ${companion.name}.`
});

const findCompanionResource = (
  character: Character,
  resourceId: string
): { companion: CharacterCompanion; resource: CharacterCompanionResource } | undefined => {
  for (const companion of character.companions ?? []) {
    const resource = companion.resources.find((entry) => entry.id === resourceId);
    if (resource) return { companion, resource };
  }
  return undefined;
};

const allResourcePools = (character: Character): ResourcePool[] => [
  ...character.resources,
  ...(character.companions ?? []).flatMap((companion) =>
    companion.resources.map((resource) => companionResourceAsPool(resource, companion))
  )
];

export const findResource = (character: Character, resourceId: string): ResourcePool | undefined =>
  character.resources.find((resource) => resource.id === resourceId)
  ?? (() => {
    const found = findCompanionResource(character, resourceId);
    return found ? companionResourceAsPool(found.resource, found.companion) : undefined;
  })();

const makeCompanionTransaction = (params: {
  companion: CharacterCompanion;
  resource: CharacterCompanionResource;
  before: number;
  after: number;
  reason: string;
}): CharacterCompanionTransaction => ({
  id: createId('companionTx'),
  companionId: params.companion.id,
  action: params.after < params.before ? 'resourceSpent' : 'resourceRecovered',
  label: `${params.resource.name} · ${params.reason}`,
  amount: Math.abs(params.after - params.before),
  before: params.before,
  after: params.after,
  createdAt: new Date().toISOString()
});

export const costsFromRotation = (rotation: TurnRotation): ResourceCost[] => {
  const costs: ResourceCost[] = [...turnActivationResourceCosts(rotation)];

  for (const turnAction of rotation.actions) {
    costs.push(...(turnAction.action.consumes ?? []));
    const activeConditionIds = new Set(turnAction.enabledConditionIds ?? []);
    const conditions = (turnAction.action.damage?.components ?? [])
      .map((component) => component.condition)
      .filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

    for (const condition of conditions) {
      const enabled = condition.defaultEnabled || activeConditionIds.has(condition.id);
      if (!enabled || !condition.requiresResourceId) continue;
      costs.push({
        resourceId: condition.requiresResourceId,
        amount: 1,
        label: condition.label,
        oncePerTurnKey: condition.oncePerTurnKey
      });
    }
  }

  return costs;
};

export const checkResourceAvailability = (
  character: Character,
  costs: ResourceCost[],
  overrides: Record<string, number> = {}
): ResourceAvailabilityResult => {
  const issues: RuleValidationIssue[] = [];
  const remaining: Record<string, number> = Object.fromEntries(
    allResourcePools(character).map((resource) => [resource.id, overrides[resource.id] ?? resource.current])
  );
  const seenOncePerTurn = new Set<string>();

  for (const cost of costs) {
    const resource = findResource(character, cost.resourceId);
    if (!resource) {
      issues.push(issue('error', 'RESOURCE_NOT_FOUND', `Recurso não cadastrado: ${cost.label ?? cost.resourceId}.`));
      continue;
    }

    const available = remaining[resource.id] ?? 0;
    if (available < cost.amount) {
      issues.push(
        issue(
          'error',
          'RESOURCE_UNAVAILABLE',
          `Recurso insuficiente: ${resource.name} exige ${cost.amount}, disponível ${available}.`
        )
      );
    }
    remaining[resource.id] = available - cost.amount;

    if (cost.oncePerTurnKey) {
      if (seenOncePerTurn.has(cost.oncePerTurnKey)) {
        issues.push(issue('error', 'ONCE_PER_TURN_CONFLICT', `Uso repetido no mesmo turno: ${cost.label ?? cost.oncePerTurnKey}.`));
      }
      seenOncePerTurn.add(cost.oncePerTurnKey);
    }
  }

  return { ok: issues.every((item) => item.severity !== 'error'), remaining, issues, costs };
};

export const checkRotationResources = (
  rotation: TurnRotation,
  character: Character,
  overrides: Record<string, number> = {}
): ResourceAvailabilityResult => checkResourceAvailability(character, costsFromRotation(rotation), overrides);

export const spendResources = (params: {
  character: Character;
  costs: ResourceCost[];
  reason?: string;
  allowPartial?: boolean;
}): RestApplicationResult => {
  const availability = checkResourceAvailability(params.character, params.costs);
  if (!availability.ok && !params.allowPartial) {
    return { character: params.character, transactions: [], issues: availability.issues };
  }

  const transactions: ResourceTransaction[] = [];
  const byResource = new Map<string, number>();
  for (const cost of params.costs) byResource.set(cost.resourceId, (byResource.get(cost.resourceId) ?? 0) + cost.amount);

  const reason = params.reason ?? 'Consumo manual de recurso';
  const resources = params.character.resources.map((resource) => {
    const amount = byResource.get(resource.id) ?? 0;
    if (!amount) return resource;
    const before = resource.current;
    const after = Math.max(0, before - amount);
    transactions.push(makeTransaction({
      characterId: params.character.id,
      resource,
      before,
      after,
      reason
    }));
    return clampResource(resource, after);
  });

  const companions = (params.character.companions ?? []).map((companion) => {
    const companionTransactions: CharacterCompanionTransaction[] = [];
    const companionResources = companion.resources.map((resource) => {
      const amount = byResource.get(resource.id) ?? 0;
      if (!amount) return resource;
      const before = resource.current;
      const after = Math.max(0, before - amount);
      const pool = companionResourceAsPool(resource, companion);
      transactions.push(makeTransaction({
        characterId: params.character.id,
        resource: pool,
        before,
        after,
        reason
      }));
      companionTransactions.push(makeCompanionTransaction({ companion, resource, before, after, reason }));
      return { ...resource, current: after };
    });
    if (!companionTransactions.length) return companion;
    return {
      ...companion,
      resources: companionResources,
      transactions: [...companion.transactions, ...companionTransactions],
      updatedAt: new Date().toISOString()
    };
  });

  return {
    character: {
      ...params.character,
      resources,
      companions,
      resourceTransactions: [...(params.character.resourceTransactions ?? []), ...transactions]
    },
    transactions,
    issues: availability.issues
  };
};

export const spendRotationResources = (character: Character, rotation: TurnRotation): RestApplicationResult =>
  spendResources({ character, costs: costsFromRotation(rotation), reason: `Rotação: ${rotation.name}` });

export const adjustResource = (params: {
  character: Character;
  resourceId: string;
  delta: number;
  reason?: string;
}): RestApplicationResult => {
  const transactions: ResourceTransaction[] = [];
  let found = false;
  const resources = params.character.resources.map((resource) => {
    if (resource.id !== params.resourceId) return resource;
    found = true;
    const before = resource.current;
    const after = Math.max(0, Math.min(resource.max, before + params.delta));
    if (before !== after) {
      transactions.push(makeTransaction({
        characterId: params.character.id,
        resource,
        before,
        after,
        reason: params.reason ?? (params.delta < 0 ? 'Gasto manual' : 'Recuperação manual'),
        restType: 'manual'
      }));
    }
    return clampResource(resource, after);
  });

  let companions = params.character.companions ?? [];
  if (!found) {
    companions = companions.map((companion) => {
      const resource = companion.resources.find((entry) => entry.id === params.resourceId);
      if (!resource) return companion;
      found = true;
      const before = resource.current;
      const after = Math.max(0, Math.min(resource.max, before + params.delta));
      if (before === after) return companion;
      const pool = companionResourceAsPool(resource, companion);
      transactions.push(makeTransaction({
        characterId: params.character.id,
        resource: pool,
        before,
        after,
        reason: params.reason ?? (params.delta < 0 ? 'Gasto manual' : 'Recuperação manual'),
        restType: 'manual'
      }));
      const companionTx = makeCompanionTransaction({
        companion,
        resource,
        before,
        after,
        reason: params.reason ?? (params.delta < 0 ? 'Gasto manual' : 'Recuperação manual')
      });
      return {
        ...companion,
        resources: companion.resources.map((entry) => entry.id === params.resourceId ? { ...entry, current: after } : entry),
        transactions: [...companion.transactions, companionTx],
        updatedAt: new Date().toISOString()
      };
    });
  }

  if (!found) {
    return {
      character: params.character,
      transactions: [],
      issues: [issue('error', 'RESOURCE_NOT_FOUND', `Recurso não encontrado: ${params.resourceId}.`)]
    };
  }

  return {
    character: { ...params.character, resources, companions, resourceTransactions: [...(params.character.resourceTransactions ?? []), ...transactions] },
    transactions,
    issues: []
  };
};

const restoredByRest = (resource: ResourcePool, restType: RestType): boolean => {
  if (restType === 'turnStart') return resource.recharge === 'turn';
  if (restType === 'shortRest') return resource.recharge === 'turn' || resource.recharge === 'shortRest';
  if (restType === 'longRest') return resource.recharge === 'turn' || resource.recharge === 'shortRest' || resource.recharge === 'longRest' || resource.recharge === 'day';
  return false;
};

const resourceAfterRest = (resource: ResourcePool, restType: RestType): number | undefined => {
  const rule = (resource.recoveryRules ?? []).find((candidate) => candidate.trigger === restType);
  if (rule) return rule.amount === 'all' ? resource.max : Math.min(resource.max, resource.current + Math.max(0, rule.amount));
  return restoredByRest(resource, restType) ? resource.max : undefined;
};

export const applyRest = (character: Character, restType: RestType): RestApplicationResult => {
  const transactions: ResourceTransaction[] = [];
  const reason = restType === 'turnStart' ? 'Início do turno' : restType === 'shortRest' ? 'Descanso curto' : 'Descanso longo';
  const resources = character.resources.map((resource) => {
    const recovered = resourceAfterRest(resource, restType);
    if (recovered === undefined || recovered <= resource.current) return resource;
    const before = resource.current;
    const after = recovered;
    transactions.push(makeTransaction({
      characterId: character.id,
      resource,
      before,
      after,
      reason,
      restType
    }));
    return { ...resource, current: after };
  });

  const companions = (character.companions ?? []).map((companion) => {
    const companionTransactions: CharacterCompanionTransaction[] = [];
    const companionResources = companion.resources.map((resource) => {
      const pool = companionResourceAsPool(resource, companion);
      const recovered = resourceAfterRest(pool, restType);
      if (recovered === undefined || recovered <= resource.current) return resource;
      const before = resource.current;
      const after = recovered;
      transactions.push(makeTransaction({
        characterId: character.id,
        resource: pool,
        before,
        after,
        reason,
        restType
      }));
      companionTransactions.push(makeCompanionTransaction({ companion, resource, before, after, reason }));
      return { ...resource, current: after };
    });
    if (!companionTransactions.length) return companion;
    return {
      ...companion,
      resources: companionResources,
      transactions: [...companion.transactions, ...companionTransactions],
      updatedAt: new Date().toISOString()
    };
  });

  return {
    character: { ...character, resources, companions, resourceTransactions: [...(character.resourceTransactions ?? []), ...transactions] },
    transactions,
    issues: []
  };
};
