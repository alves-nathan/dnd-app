import type {
  ActiveEffect,
  AttackAction,
  Character,
  CharacterCompanion,
  CharacterCompanionAction,
  CharacterCompanionResource,
  CharacterCompanionTransaction,
  CharacterEldritchInvocationChoice,
  ChainMasterDamageType,
  ChainMasterMovementMode,
  RestType
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { createId } from '../utils/id';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { getAbilityModifier, getProficiencyBonus } from '../rules-engine/characters/derivedStats';
import { findEldritchInvocationById } from './eldritchInvocationRules';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const identity = (item?: StoredCompendiumItem): string => {
  if (!item) return '';
  return normalize(asString(asRecord(item.normalizedJson).engineKey) ?? item.name);
};
const isNamedInvocation = (item: StoredCompendiumItem | undefined, key: string, name: string): boolean =>
  Boolean(item && (identity(item) === normalize(key) || normalize(item.name) === normalize(name)));
const nowIso = (): string => new Date().toISOString();

export const isInvestmentOfTheChainMasterInvocation = (item?: StoredCompendiumItem): boolean =>
  isNamedInvocation(item, 'warlock.investment-of-the-chain-master', 'Investment of the Chain Master');

const numberFromFormula = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = asString(value);
  const match = text?.match(/^\s*(\d+)/);
  return match?.[1] ? Number(match[1]) : undefined;
};

const armorClass = (payload: Record<string, unknown>): number => {
  const raw = payload.armorClass;
  return asNumber(raw) ?? asNumber(asRecord(raw).value) ?? asNumber(payload.ac) ?? 10;
};

const hitPointMax = (payload: Record<string, unknown>): number => {
  const raw = payload.hitPoints;
  const record = asRecord(raw);
  return Math.max(1,
    asNumber(raw)
    ?? asNumber(record.average)
    ?? numberFromFormula(record.averageFormula)
    ?? numberFromFormula(record.formula)
    ?? 1
  );
};

const speed = (payload: Record<string, unknown>): Record<string, number> => {
  const record = asRecord(payload.speed);
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, value]) => [key, asNumber(value) ?? asNumber(asRecord(value).value)])
      .filter((entry): entry is [string, number] => entry[1] !== undefined)
  );
};

const parseUses = (value: unknown): { max: number; recharge: 'longRest' | 'manual' } | undefined => {
  const text = asString(value);
  const match = text?.match(/(\d+)\s*\/\s*(day|long\s*rest)/i);
  if (!match?.[1]) return undefined;
  return { max: Number(match[1]), recharge: 'longRest' };
};

const actionResourceId = (index: number, name: string): string =>
  `companion_action_${index}_${normalize(name).replace(/[^a-z0-9]+/g, '_')}`;

const conditionIdsFromEffects = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((entry) => {
    const record = asRecord(entry);
    return [asString(record.condition), asString(record.possibleCondition)].filter((item): item is string => Boolean(item));
  })));
};

const companionActionRows = (payload: Record<string, unknown>): Array<{ raw: unknown; actionCost: CharacterCompanionAction['actionCost'] }> => [
  ...(Array.isArray(payload.actions) ? payload.actions.map((raw) => ({ raw, actionCost: 'action' as const })) : []),
  ...(Array.isArray(payload.bonusActions) ? payload.bonusActions.map((raw) => ({ raw, actionCost: 'bonusAction' as const })) : []),
  ...(Array.isArray(payload.reactions) ? payload.reactions.map((raw) => ({ raw, actionCost: 'reaction' as const })) : [])
];

const companionActions = (payload: Record<string, unknown>): CharacterCompanionAction[] =>
  companionActionRows(payload).flatMap(({ raw, actionCost: fallbackCost }, index): CharacterCompanionAction[] => {
    const record = asRecord(raw);
    const name = asString(record.name);
    if (!name) return [];
    const actionCostRaw = asString(record.actionCost) ?? fallbackCost;
    const actionCost = ['action', 'bonusAction', 'reaction', 'movement', 'free', 'special'].includes(actionCostRaw)
      ? actionCostRaw as CharacterCompanionAction['actionCost']
      : fallbackCost;
    const useDefinition = parseUses(record.uses);
    return [{
      id: asString(record.id) ?? `companion-action-${index + 1}`,
      name,
      actionCost,
      type: normalize(asString(record.type) ?? '').includes('attack') || record.attackBonus !== undefined ? 'attack' : 'utility',
      attackBonus: asNumber(record.attackBonus),
      reach: asString(record.reach),
      range: asString(record.range),
      damageFormula: asString(record.damageFormula) ?? asString(record.damage),
      damageType: asString(record.damageType),
      saveAbility: asString(record.saveAbility) as CharacterCompanionAction['saveAbility'],
      saveDC: asNumber(record.saveDc) ?? asNumber(record.saveDC),
      uses: asString(record.uses),
      resourceId: useDefinition ? actionResourceId(index, name) : undefined,
      conditionIds: conditionIdsFromEffects(record.hitEffects),
      summary: asString(record.summary) ?? asString(record.description) ?? asString(record.effect)
    }];
  });

const companionTraits = (payload: Record<string, unknown>) =>
  (Array.isArray(payload.traits) ? payload.traits : []).flatMap((raw, index) => {
    const record = asRecord(raw);
    const name = asString(record.name);
    if (!name) return [];
    return [{
      id: asString(record.id) ?? `companion-trait-${index + 1}`,
      name,
      summary: asString(record.summary) ?? asString(record.description)
    }];
  });

const companionResources = (
  actions: CharacterCompanionAction[],
  existing: CharacterCompanionResource[] = []
): CharacterCompanionResource[] => actions.flatMap((action): CharacterCompanionResource[] => {
  if (!action.resourceId) return [];
  const useDefinition = parseUses(action.uses);
  if (!useDefinition) return [];
  const previous = existing.find((resource) => resource.id === action.resourceId);
  return [{
    id: action.resourceId,
    name: action.name,
    max: useDefinition.max,
    current: Math.min(useDefinition.max, Math.max(0, previous?.current ?? useDefinition.max)),
    recharge: useDefinition.recharge,
    sourceActionId: action.id
  }];
});

const warlockSpellSaveDC = (character: Character): number =>
  8 + getProficiencyBonus(character) + getAbilityModifier(character.abilities, 'CHA');

export const buildPactChainCompanion = (params: {
  character: Character;
  creatureItem: StoredCompendiumItem;
  invocationItemId: string;
  variant: 'standard' | 'special';
  existing?: CharacterCompanion;
  investmentActive: boolean;
  movementMode?: ChainMasterMovementMode;
  damageType?: ChainMasterDamageType;
}): CharacterCompanion => {
  const payload = asRecord(params.creatureItem.normalizedJson);
  const maxHp = hitPointMax(payload);
  const existing = params.existing;
  const preserveCustomName = existing?.customName === true;
  const movementMode = params.investmentActive ? params.movementMode : undefined;
  const baseSpeed = speed(payload);
  const enhancedSpeed = movementMode
    ? { ...baseSpeed, [movementMode]: Math.max(40, baseSpeed[movementMode] ?? 0) }
    : baseSpeed;
  const now = nowIso();
  const actions = companionActions(payload);
  return {
    id: existing?.id ?? createId('companion'),
    name: preserveCustomName ? existing.name : params.creatureItem.name,
    customName: preserveCustomName,
    sourceCreatureItemId: params.creatureItem.id,
    grantedByInvocationItemId: params.invocationItemId,
    variant: params.variant,
    size: asString(payload.size),
    creatureType: asString(payload.creatureType),
    armorClass: armorClass(payload),
    hitPoints: {
      max: maxHp,
      current: Math.min(maxHp, Math.max(0, existing?.hitPoints.current ?? maxHp))
    },
    speed: enhancedSpeed,
    senses: asString(payload.senses),
    languages: asString(payload.languages),
    traits: companionTraits(payload),
    actions,
    resources: companionResources(actions, existing?.resources),
    activeEffects: existing?.activeEffects ?? [],
    transactions: existing?.transactions ?? [],
    initiative: 'own',
    command: params.investmentActive ? 'bonusAction' : 'forgoOneAttack',
    canAttack: true,
    investment: params.investmentActive ? {
      active: true,
      movementMode,
      movementSpeed: movementMode ? 40 : undefined,
      usesWarlockSpellSaveDC: true,
      reactionResistance: true,
      damageType: params.damageType,
      warlockSpellSaveDC: warlockSpellSaveDC(params.character)
    } : undefined,
    notes: existing?.notes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
};

export const reconcilePactChainCompanion = (
  character: Character,
  choices: CharacterEldritchInvocationChoice[],
  selectedCounts: Record<string, number>,
  items: StoredCompendiumItem[]
): Character => {
  const pactChoice = choices.find((choice) => {
    const invocation = findEldritchInvocationById(items, choice.invocationItemId);
    return isNamedInvocation(invocation, 'warlock.pact-of-the-chain', 'Pact of the Chain');
  });
  if (!pactChoice?.familiarCreatureItemId || !pactChoice.familiarVariant) {
    return { ...character, companions: (character.companions ?? []).filter((entry) => entry.grantedByInvocationItemId !== pactChoice?.invocationItemId) };
  }
  const creatureItem = items.find((item) => item.id === pactChoice.familiarCreatureItemId && item.type === 'creatureStatBlock');
  if (!creatureItem) return character;
  const investmentEntry = Object.entries(selectedCounts).find(([itemId, count]) => {
    if (count <= 0) return false;
    return isInvestmentOfTheChainMasterInvocation(findEldritchInvocationById(items, itemId));
  });
  const investmentChoice = investmentEntry
    ? choices.find((choice) => choice.invocationItemId === investmentEntry[0] && choice.instanceIndex === 0)
    : undefined;
  const existing = (character.companions ?? []).find((entry) => entry.grantedByInvocationItemId === pactChoice.invocationItemId)
    ?? (character.companions ?? [])[0];
  const companion = buildPactChainCompanion({
    character,
    creatureItem,
    invocationItemId: pactChoice.invocationItemId,
    variant: pactChoice.familiarVariant,
    existing,
    investmentActive: Boolean(investmentEntry),
    movementMode: investmentChoice?.chainMasterMovementMode,
    damageType: investmentChoice?.chainMasterDamageType
  });
  return {
    ...character,
    companions: [
      ...(character.companions ?? []).filter((entry) => entry.id !== existing?.id && entry.grantedByInvocationItemId !== pactChoice.invocationItemId),
      companion
    ]
  };
};

const physicalDamage = (value?: string): boolean => {
  const text = normalize(value ?? '');
  return text.includes('bludgeoning') || text.includes('piercing') || text.includes('slashing');
};

export const buildPactChainCompanionAttackActions = (companion: CharacterCompanion): AttackAction[] =>
  companion.actions.flatMap((action): AttackAction[] => {
    if (action.type !== 'attack' || !action.damageFormula) return [];
    const investmentDamage = companion.investment?.active && companion.investment.damageType && physicalDamage(action.damageType)
      ? companion.investment.damageType
      : undefined;
    return [{
      id: `companion_${companion.id}_${action.id}`,
      type: 'attack',
      name: `${companion.name} · ${action.name}`,
      actionCost: companion.command === 'bonusAction' ? 'bonusAction' : 'special',
      sourceType: 'classFeature',
      attackBonusOverride: action.attackBonus,
      damage: parseDamageFormula(action.damageFormula, { defaultSourceType: 'classFeature' }),
      attacksCount: 1,
      consumes: action.resourceId ? [{ resourceId: action.resourceId, amount: 1, label: `${companion.name} · ${action.name}` }] : undefined,
      tags: [
        'pact-familiar',
        companion.variant,
        `companion:${companion.id}`,
        companion.command === 'bonusAction' ? 'companion-command:bonus-action' : 'companion-command:forgo-one-attack',
        ...(companion.investment?.active ? ['investment-of-the-chain-master'] : []),
        ...(investmentDamage ? [`damage-type:${investmentDamage}`] : [])
      ],
      companionId: companion.id,
      replacesOwnAttackCount: companion.command === 'forgoOneAttack' ? 1 : undefined,
      origin: { kind: 'characterEntry', entityType: 'feature', entityId: companion.grantedByInvocationItemId },
      ruleNotes: [
        companion.command === 'bonusAction'
          ? 'Investment of the Chain Master permite comandar este ataque com uma ação bônus.'
          : 'Pact of the Chain exige abrir mão de um dos ataques do Warlock; a análise reduz automaticamente um ataque próprio na rotação.',
        ...(companion.investment?.usesWarlockSpellSaveDC ? [`Efeitos do familiar que exigem salvaguarda usam CD ${companion.investment.warlockSpellSaveDC}.`] : []),
        ...(investmentDamage ? [`O dano físico é tratado como ${investmentDamage} na simulação atual.`] : []),
        ...(action.conditionIds?.length ? [`Pode aplicar: ${action.conditionIds.join(', ')}.`] : [])
      ]
    }];
  });

const companionTransaction = (
  companion: CharacterCompanion,
  action: CharacterCompanionTransaction['action'],
  label: string,
  values: Partial<CharacterCompanionTransaction> = {}
): CharacterCompanionTransaction => ({
  id: createId('companionTx'),
  companionId: companion.id,
  action,
  label,
  amount: values.amount,
  before: values.before,
  after: values.after,
  createdAt: nowIso()
});

export const setCompanionHitPoints = (
  character: Character,
  companionId: string,
  nextCurrent: number,
  label = 'Ajuste de PV'
): Character => ({
  ...character,
  companions: (character.companions ?? []).map((companion) => {
    if (companion.id !== companionId) return companion;
    const before = companion.hitPoints.current;
    const after = Math.max(0, Math.min(companion.hitPoints.max, Math.floor(nextCurrent)));
    if (after === before) return companion;
    return {
      ...companion,
      hitPoints: { ...companion.hitPoints, current: after },
      transactions: [...companion.transactions, companionTransaction(
        companion,
        after < before ? 'damage' : 'healing',
        label,
        { amount: Math.abs(after - before), before, after }
      )],
      updatedAt: nowIso()
    };
  })
});

export const adjustCompanionResource = (
  character: Character,
  companionId: string,
  resourceId: string,
  delta: number
): Character => ({
  ...character,
  companions: (character.companions ?? []).map((companion) => {
    if (companion.id !== companionId) return companion;
    const resource = companion.resources.find((entry) => entry.id === resourceId);
    if (!resource) return companion;
    const before = resource.current;
    const after = Math.max(0, Math.min(resource.max, before + delta));
    if (after === before) return companion;
    return {
      ...companion,
      resources: companion.resources.map((entry) => entry.id === resourceId ? { ...entry, current: after } : entry),
      transactions: [...companion.transactions, companionTransaction(
        companion,
        delta < 0 ? 'resourceSpent' : 'resourceRecovered',
        resource.name,
        { amount: Math.abs(after - before), before, after }
      )],
      updatedAt: nowIso()
    };
  })
});

export const setCompanionCondition = (
  character: Character,
  companionId: string,
  conditionId: string,
  active: boolean
): Character => ({
  ...character,
  companions: (character.companions ?? []).map((companion) => {
    if (companion.id !== companionId) return companion;
    const existing = companion.activeEffects.find((effect) => effect.conditionIds?.includes(conditionId));
    if (active && existing) return companion;
    if (!active && !existing) return companion;
    const effect: ActiveEffect = {
      id: createId('companionEffect'),
      name: conditionId,
      kind: 'condition',
      sourceType: 'condition',
      status: 'active',
      conditionIds: [conditionId],
      duration: { unit: 'manual', expiresOn: 'manual' },
      createdAt: nowIso()
    };
    return {
      ...companion,
      activeEffects: active ? [...companion.activeEffects, effect] : companion.activeEffects.filter((entry) => entry.id !== existing?.id),
      transactions: [...companion.transactions, companionTransaction(companion, active ? 'conditionAdded' : 'conditionRemoved', conditionId)],
      updatedAt: nowIso()
    };
  })
});

export const restoreCompanionResourcesOnRest = (character: Character, restType: RestType): Character => {
  if (restType !== 'longRest') return character;
  return {
    ...character,
    companions: (character.companions ?? []).map((companion) => {
      const recovered = companion.resources.filter((resource) => resource.recharge === 'longRest' && resource.current < resource.max);
      if (!recovered.length) return companion;
      return {
        ...companion,
        resources: companion.resources.map((resource) => resource.recharge === 'longRest' ? { ...resource, current: resource.max } : resource),
        transactions: [
          ...companion.transactions,
          ...recovered.map((resource) => companionTransaction(companion, 'resourceRecovered', resource.name, { amount: resource.max - resource.current, before: resource.current, after: resource.max }))
        ],
        updatedAt: nowIso()
      };
    })
  };
};
