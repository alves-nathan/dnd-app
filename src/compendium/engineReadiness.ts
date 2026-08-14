import { parseDamageFormula } from '../rules-engine/dice/parser';
import { parseEffectTemplatesFromPayload } from '../rules-engine/effects/derivedEffects';
import { canApplyCompendiumItemToCharacter } from './mapper';
import { formulaTextFromPayload, parseResourceCostsFromPayload, parseSpellScalingFromPayload } from './actionMapping';
import type { RuleSource } from '../types';
import type { CompendiumItemType, StoredCompendiumItem, StoredCompendiumPack, StoredCompendiumItemStatus } from './types';

export type EngineReadinessStatus = 'ready' | 'partial' | 'blocked' | 'notApplicable';
export type EngineReadinessSeverity = 'info' | 'warning' | 'error';
export type EngineCapability = 'applyToCharacter' | 'buildAction' | 'calculateDamage' | 'createEffect' | 'consumeResource' | 'consumeSpellSlot' | 'conditionReference' | 'searchOnly';
export type CompatibilitySuiteStatus = 'pass' | 'warning' | 'fail';

export interface EngineReadinessIssue {
  severity: EngineReadinessSeverity;
  code: string;
  message: string;
  suggestedAction?: 'map' | 'review' | 'source' | 'disable' | 'importTemplate';
}

export interface EngineReadinessItem {
  item: StoredCompendiumItem;
  source?: RuleSource;
  pack?: StoredCompendiumPack;
  enabledSource: boolean;
  status: EngineReadinessStatus;
  readinessScore: number;
  capabilities: EngineCapability[];
  issueCounts: {
    info: number;
    warning: number;
    error: number;
  };
  canApplyToCharacter: boolean;
  canBuildAction: boolean;
  canCalculateDamage: boolean;
  canCreateEffect: boolean;
  canConsumeResource: boolean;
  canConsumeSpellSlot: boolean;
  issues: EngineReadinessIssue[];
}

export interface EngineReadinessSummary {
  totalItems: number;
  validatedItems: number;
  readyItems: number;
  partialItems: number;
  blockedItems: number;
  notApplicableItems: number;
  activeSourceItems: number;
  actionItems: number;
  damageItems: number;
  effectItems: number;
  resourceItems: number;
  spellSlotItems: number;
  unresolvedDamageItems: number;
  readinessAverage: number;
}

export interface CompatibilitySuiteCase {
  id: string;
  title: string;
  status: CompatibilitySuiteStatus;
  passed: number;
  total: number;
  message: string;
}

export interface EngineReadinessFilters {
  query?: string;
  types?: CompendiumItemType[];
  statuses?: StoredCompendiumItemStatus[];
  sourceIds?: string[];
  onlyEnabledSources?: boolean;
  onlyValidated?: boolean;
}

export interface BuildEngineReadinessReportInput {
  items: StoredCompendiumItem[];
  sources: RuleSource[];
  packs: StoredCompendiumPack[];
  enabledSourceIds: string[];
  filters?: EngineReadinessFilters;
}

export interface EngineReadinessReport {
  items: EngineReadinessItem[];
  summary: EngineReadinessSummary;
  suites: CompatibilitySuiteCase[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const issue = (severity: EngineReadinessSeverity, code: string, message: string, suggestedAction?: EngineReadinessIssue['suggestedAction']): EngineReadinessIssue => ({
  severity,
  code,
  message,
  suggestedAction
});

const hasValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
};

const containsAny = (payload: Record<string, unknown>, keys: string[]): boolean => keys.some((key) => hasValue(payload[key]));

const hasEffectHook = (payload: Record<string, unknown>): boolean =>
  containsAny(payload, [
    'effectTemplates',
    'activeEffectTemplates',
    'effects',
    'activeEffects',
    'effect',
    'activeEffect',
    'effectName',
    'effectKind',
    'effectConditionIds',
    'conditionIds',
    'activeConditionIds'
  ]) || payload.effectConcentration !== undefined || payload.concentration === true || payload.requiresConcentration === true;

const hasResourceHook = (payload: Record<string, unknown>): boolean =>
  parseResourceCostsFromPayload(payload).length > 0 || containsAny(payload, ['resource', 'resourcePool', 'uses', 'consumes', 'resourceCosts', 'resourcesConsumed']);

const hasGrantedActionHook = (payload: Record<string, unknown>): boolean =>
  asArray(payload.grantsActions).length > 0 || asArray(payload.actions).length > 0 || asArray(payload.actionOptions).length > 0 || Boolean(payload.grantedActionName && payload.grantedActionType);

const parseDamageIssues = (formulaText: string | undefined, defaultSourceType: 'weapon' | 'spell' | 'classFeature' | 'magicItem' | 'manual'): { canCalculateDamage: boolean; unresolved: string[]; issues: EngineReadinessIssue[] } => {
  if (!formulaText) return { canCalculateDamage: false, unresolved: [], issues: [] };
  const parsed = parseDamageFormula(formulaText, { defaultSourceType });

  /*
   * O parser aceita variáveis customizadas para que fórmulas autorais
   * possam ser armazenadas. Porém, sem um valor/mapeamento conhecido,
   * a pré-engine não deve considerar o cálculo totalmente resolvido.
   */
  const unresolved = Array.from(
    new Set([
      ...(parsed.unresolvedTokens ?? []),
      ...parsed.components
        .filter((component) => component.kind === 'customVariable')
        .map((component) => component.variableKey)
        .filter((token): token is string => Boolean(token))
    ])
  );

  return {
    canCalculateDamage: true,
    unresolved,
    issues: unresolved.length
      ? [issue('warning', 'ENGINE_DAMAGE_UNRESOLVED_TOKENS', `Fórmula de dano possui tokens não resolvidos: ${unresolved.join(', ')}.`, 'map')]
      : []
  };
};

const evaluateCommon = (item: StoredCompendiumItem, source: RuleSource | undefined, enabledSource: boolean): EngineReadinessIssue[] => {
  const issues: EngineReadinessIssue[] = [];
  if (item.status !== 'validated') {
    if (item.type === 'creatureStatBlock') {
      issues.push(
        issue(
          'warning',
          'ENGINE_REFERENCE_ITEM_NOT_VALIDATED',
          `Stat block está como ${item.status}; permanece disponível somente para consulta e referências até revisão.`,
          'review'
        )
      );
    } else {
      issues.push(
        issue(
          'error',
          'ENGINE_ITEM_NOT_VALIDATED',
          `Item está como ${item.status}; a engine só deve consumir itens validados.`,
          'review'
        )
      );
    }
  }
  if (!enabledSource) {
    issues.push(issue('error', 'ENGINE_SOURCE_DISABLED', 'A fonte do item está desativada no compêndio local.', 'source'));
  }
  if (source?.status === 'disabled' || item.rawJson.source.status === 'disabled') {
    issues.push(issue('error', 'ENGINE_SOURCE_STATUS_DISABLED', 'A própria fonte está marcada como disabled.', 'source'));
  }
  if ((source?.status ?? item.rawJson.source.status) === 'needsReview') {
    issues.push(issue('warning', 'ENGINE_SOURCE_NEEDS_REVIEW', 'A fonte ainda está marcada como needsReview.', 'source'));
  }
  const confidence = source?.confidence ?? item.rawJson.source.confidence;
  if (confidence === 'ambiguous' || confidence === 'importedNeedsReview') {
    issues.push(issue('warning', 'ENGINE_SOURCE_CONFIDENCE_REVIEW', `Confiança da fonte: ${confidence}.`, 'review'));
  }
  const normalized = asRecord(item.normalizedJson);
  if (!hasValue(normalized.id) || !hasValue(normalized.name) || !hasValue(normalized.type)) {
    issues.push(issue('error', 'ENGINE_NORMALIZED_IDENTITY_MISSING', 'normalizedJson precisa conter id, name e type para ser interoperável.', 'map'));
  }
  return issues;
};

const evaluateWeapon = (item: StoredCompendiumItem, payload: Record<string, unknown>): Pick<EngineReadinessItem, 'capabilities' | 'canApplyToCharacter' | 'canBuildAction' | 'canCalculateDamage' | 'canCreateEffect' | 'canConsumeResource' | 'canConsumeSpellSlot'> & { issues: EngineReadinessIssue[]; unresolvedDamage: boolean } => {
  const formula = formulaTextFromPayload(payload);
  const damage = parseDamageIssues(formula, 'weapon');
  const issues = [...damage.issues];
  if (!formula) issues.push(issue('error', 'ENGINE_WEAPON_DAMAGE_REQUIRED', `Arma "${item.name}" precisa de damageFormula/damage/formula para gerar ataque calculável.`, 'map'));
  if (!hasValue(payload.actionCost)) issues.push(issue('warning', 'ENGINE_WEAPON_ACTION_COST_DEFAULTED', 'actionCost ausente; a UI pode assumir action, mas isso deve ser revisado.', 'map'));
  if (!hasValue(payload.attackAbility) && !hasValue(payload.damageAbility) && !hasValue(payload.ability)) issues.push(issue('warning', 'ENGINE_WEAPON_ABILITY_MISSING', 'attackAbility/damageAbility ausente; bônus de ataque/dano podem ficar manuais.', 'map'));
  const capabilities: EngineCapability[] = ['applyToCharacter'];
  if (formula) capabilities.push('buildAction', 'calculateDamage');
  if (hasResourceHook(payload)) capabilities.push('consumeResource');
  return {
    capabilities,
    canApplyToCharacter: true,
    canBuildAction: Boolean(formula),
    canCalculateDamage: damage.canCalculateDamage,
    canCreateEffect: false,
    canConsumeResource: hasResourceHook(payload),
    canConsumeSpellSlot: false,
    issues,
    unresolvedDamage: damage.unresolved.length > 0
  };
};

const evaluateSpell = (item: StoredCompendiumItem, payload: Record<string, unknown>): Pick<EngineReadinessItem, 'capabilities' | 'canApplyToCharacter' | 'canBuildAction' | 'canCalculateDamage' | 'canCreateEffect' | 'canConsumeResource' | 'canConsumeSpellSlot'> & { issues: EngineReadinessIssue[]; unresolvedDamage: boolean } => {
  const formula = formulaTextFromPayload(payload);
  const damage = parseDamageIssues(formula, 'spell');
  const issues = [...damage.issues];
  const level = asNumber(payload.level);
  const effectTemplates = parseEffectTemplatesFromPayload(payload, { idPrefix: `readiness_spell_${item.id}`, name: item.name, kind: 'spell', sourceType: 'spell', source: item.rawJson.source });
  if (level === undefined || level < 0 || level > 9) issues.push(issue('error', 'ENGINE_SPELL_LEVEL_INVALID', 'Magia precisa de level numérico entre 0 e 9.', 'map'));
  if (!hasValue(payload.castingTime) && !hasValue(payload.actionCost)) issues.push(issue('warning', 'ENGINE_SPELL_CASTING_TIME_MISSING', 'castingTime/actionCost ausente; rotação pode ficar ambígua.', 'map'));
  if (!formula && !payload.saveAbility && !effectTemplates.length) issues.push(issue('warning', 'ENGINE_SPELL_HAS_NO_OFFENSIVE_OR_EFFECT_HOOK', 'Magia não possui dano, save ou efeito ativo mapeado.', 'map'));
  const scaling = parseSpellScalingFromPayload(payload);
  if (payload.scalingKind && payload.scalingKind !== 'none' && !scaling?.steps?.length && !scaling?.dicePerStep) {
    issues.push(issue('warning', 'ENGINE_SPELL_SCALING_INCOMPLETE', 'Scaling declarado sem steps/dicePerStep; upcasting/cantrip scaling exigirá revisão.', 'map'));
  }
  const capabilities: EngineCapability[] = ['applyToCharacter'];
  if (level !== undefined && level >= 0 && level <= 9) capabilities.push('buildAction');
  if (formula) capabilities.push('calculateDamage');
  if (effectTemplates.length) capabilities.push('createEffect');
  if (hasResourceHook(payload)) capabilities.push('consumeResource');
  if ((level ?? 0) > 0) capabilities.push('consumeSpellSlot');
  return {
    capabilities,
    canApplyToCharacter: true,
    canBuildAction: level !== undefined && level >= 0 && level <= 9,
    canCalculateDamage: damage.canCalculateDamage,
    canCreateEffect: effectTemplates.length > 0,
    canConsumeResource: hasResourceHook(payload),
    canConsumeSpellSlot: (level ?? 0) > 0,
    issues,
    unresolvedDamage: damage.unresolved.length > 0
  };
};

const evaluateFeature = (item: StoredCompendiumItem, payload: Record<string, unknown>): Pick<EngineReadinessItem, 'capabilities' | 'canApplyToCharacter' | 'canBuildAction' | 'canCalculateDamage' | 'canCreateEffect' | 'canConsumeResource' | 'canConsumeSpellSlot'> & { issues: EngineReadinessIssue[]; unresolvedDamage: boolean } => {
  const formula = formulaTextFromPayload(payload);
  const damage = parseDamageIssues(formula, 'classFeature');
  const effectTemplates = parseEffectTemplatesFromPayload(payload, { idPrefix: `readiness_feature_${item.id}`, name: item.name, kind: 'feature', sourceType: 'classFeature', source: item.rawJson.source });
  const grantsAction = hasGrantedActionHook(payload) || Boolean(formula && hasValue(payload.grantedActionName));
  const issues = [...damage.issues];
  if (!hasValue(payload.summary) && !grantsAction && !effectTemplates.length && !hasResourceHook(payload)) {
    issues.push(issue('warning', 'ENGINE_FEATURE_NO_MECHANICAL_HOOK', 'Feature não tem resumo, ação, dano, efeito ou recurso mapeado.', 'map'));
  }
  if (formula && !hasValue(payload.sourceType)) issues.push(issue('warning', 'ENGINE_FEATURE_DAMAGE_SOURCE_TYPE_MISSING', 'Feature com dano deveria declarar sourceType.', 'map'));
  const capabilities: EngineCapability[] = ['applyToCharacter'];
  if (grantsAction) capabilities.push('buildAction');
  if (formula) capabilities.push('calculateDamage');
  if (effectTemplates.length) capabilities.push('createEffect');
  if (hasResourceHook(payload)) capabilities.push('consumeResource');
  return {
    capabilities,
    canApplyToCharacter: true,
    canBuildAction: grantsAction,
    canCalculateDamage: damage.canCalculateDamage,
    canCreateEffect: effectTemplates.length > 0,
    canConsumeResource: hasResourceHook(payload),
    canConsumeSpellSlot: false,
    issues,
    unresolvedDamage: damage.unresolved.length > 0
  };
};

const evaluateArmor = (item: StoredCompendiumItem, payload: Record<string, unknown>): Pick<EngineReadinessItem, 'capabilities' | 'canApplyToCharacter' | 'canBuildAction' | 'canCalculateDamage' | 'canCreateEffect' | 'canConsumeResource' | 'canConsumeSpellSlot'> & { issues: EngineReadinessIssue[]; unresolvedDamage: boolean } => {
  const baseAC = asNumber(payload.baseAC) ?? asNumber(payload.ac);
  return {
    capabilities: ['applyToCharacter'],
    canApplyToCharacter: true,
    canBuildAction: false,
    canCalculateDamage: false,
    canCreateEffect: false,
    canConsumeResource: false,
    canConsumeSpellSlot: false,
    issues: baseAC === undefined ? [issue('error', 'ENGINE_ARMOR_BASE_AC_REQUIRED', `Armadura "${item.name}" precisa de baseAC/ac para cálculo de CA.`, 'map')] : [],
    unresolvedDamage: false
  };
};

const evaluateMagicItem = (item: StoredCompendiumItem, payload: Record<string, unknown>): Pick<EngineReadinessItem, 'capabilities' | 'canApplyToCharacter' | 'canBuildAction' | 'canCalculateDamage' | 'canCreateEffect' | 'canConsumeResource' | 'canConsumeSpellSlot'> & { issues: EngineReadinessIssue[]; unresolvedDamage: boolean } => {
  const effectTemplates = parseEffectTemplatesFromPayload(payload, { idPrefix: `readiness_item_${item.id}`, name: item.name, kind: 'item', sourceType: 'magicItem', source: item.rawJson.source });
  const capabilities: EngineCapability[] = ['applyToCharacter'];
  if (effectTemplates.length) capabilities.push('createEffect');
  if (hasResourceHook(payload)) capabilities.push('consumeResource');
  return {
    capabilities,
    canApplyToCharacter: true,
    canBuildAction: false,
    canCalculateDamage: false,
    canCreateEffect: effectTemplates.length > 0,
    canConsumeResource: hasResourceHook(payload),
    canConsumeSpellSlot: false,
    issues: !effectTemplates.length && !hasValue(payload.summary) ? [issue('warning', 'ENGINE_MAGIC_ITEM_SEARCH_ONLY', 'Item mágico aplicável, mas sem efeito mecânico mapeado para engine.', 'map')] : [],
    unresolvedDamage: false
  };
};

const evaluateSimpleApplicable = (item: StoredCompendiumItem, payload: Record<string, unknown>): Pick<EngineReadinessItem, 'capabilities' | 'canApplyToCharacter' | 'canBuildAction' | 'canCalculateDamage' | 'canCreateEffect' | 'canConsumeResource' | 'canConsumeSpellSlot'> & { issues: EngineReadinessIssue[]; unresolvedDamage: boolean } => {
  const issues: EngineReadinessIssue[] = [];
  if (item.type === 'class' && asNumber(payload.level) === undefined) issues.push(issue('error', 'ENGINE_CLASS_LEVEL_REQUIRED', 'Classe precisa de level para progressão/multiclass.', 'map'));
  if (item.type === 'equipment' && asNumber(payload.quantity) === undefined) issues.push(issue('warning', 'ENGINE_EQUIPMENT_QUANTITY_DEFAULTED', 'quantity ausente; mapper aplicará quantidade 1.', 'map'));
  return {
    capabilities: ['applyToCharacter'],
    canApplyToCharacter: true,
    canBuildAction: false,
    canCalculateDamage: false,
    canCreateEffect: false,
    canConsumeResource: false,
    canConsumeSpellSlot: false,
    issues,
    unresolvedDamage: false
  };
};

const evaluateCondition = (item: StoredCompendiumItem, payload: Record<string, unknown>): Pick<EngineReadinessItem, 'capabilities' | 'canApplyToCharacter' | 'canBuildAction' | 'canCalculateDamage' | 'canCreateEffect' | 'canConsumeResource' | 'canConsumeSpellSlot'> & { issues: EngineReadinessIssue[]; unresolvedDamage: boolean } => ({
  capabilities: ['conditionReference', 'searchOnly'],
  canApplyToCharacter: false,
  canBuildAction: false,
  canCalculateDamage: false,
  canCreateEffect: false,
  canConsumeResource: false,
  canConsumeSpellSlot: false,
  issues: hasValue(payload.summary) || hasValue(item.summary) ? [] : [issue('warning', 'ENGINE_CONDITION_SUMMARY_MISSING', `Condição "${item.name}" deveria ter resumo mecânico para consulta/referência.`, 'map')],
  unresolvedDamage: false
});

const evaluateCreatureStatBlock = (
  item: StoredCompendiumItem,
  payload: Record<string, unknown>
): Pick<
  EngineReadinessItem,
  | 'capabilities'
  | 'canApplyToCharacter'
  | 'canBuildAction'
  | 'canCalculateDamage'
  | 'canCreateEffect'
  | 'canConsumeResource'
  | 'canConsumeSpellSlot'
> & {
  issues: EngineReadinessIssue[];
  unresolvedDamage: boolean;
} => {
  const issues: EngineReadinessIssue[] = [
    issue(
      'info',
      'ENGINE_CREATURE_STAT_BLOCK_REFERENCE_ONLY',
      `Stat block "${item.name}" foi preservado para consulta, summons, formas e futura integração de combate.`,
      'map'
    )
  ];

  if (!hasValue(payload.creatureType)) {
    issues.push(
      issue(
        'warning',
        'ENGINE_CREATURE_TYPE_MISSING',
        'Stat block sem creatureType.',
        'map'
      )
    );
  }

  if (!hasValue(payload.armorClass)) {
    issues.push(
      issue(
        'warning',
        'ENGINE_CREATURE_ARMOR_CLASS_MISSING',
        'Stat block sem armorClass.',
        'map'
      )
    );
  }

  if (!hasValue(payload.hitPoints)) {
    issues.push(
      issue(
        'warning',
        'ENGINE_CREATURE_HIT_POINTS_MISSING',
        'Stat block sem hitPoints.',
        'map'
      )
    );
  }

  if (!Array.isArray(payload.actions)) {
    issues.push(
      issue(
        'warning',
        'ENGINE_CREATURE_ACTIONS_MISSING',
        'Stat block sem lista de actions estruturada.',
        'map'
      )
    );
  }

  return {
    capabilities: ['searchOnly'],
    canApplyToCharacter: false,
    canBuildAction: false,
    canCalculateDamage: false,
    canCreateEffect: false,
    canConsumeResource: false,
    canConsumeSpellSlot: false,
    issues,
    unresolvedDamage: false
  };
};

const evaluateType = (item: StoredCompendiumItem): Pick<EngineReadinessItem, 'capabilities' | 'canApplyToCharacter' | 'canBuildAction' | 'canCalculateDamage' | 'canCreateEffect' | 'canConsumeResource' | 'canConsumeSpellSlot'> & { issues: EngineReadinessIssue[]; unresolvedDamage: boolean } => {
  const payload = asRecord(item.normalizedJson);
  switch (item.type) {
    case 'weapon':
      return evaluateWeapon(item, payload);
    case 'spell':
      return evaluateSpell(item, payload);
    case 'feature':
      return evaluateFeature(item, payload);
    case 'armor':
      return evaluateArmor(item, payload);
    case 'magicItem':
      return evaluateMagicItem(item, payload);
    case 'creatureStatBlock':
      return evaluateCreatureStatBlock(item, payload);
    case 'condition':
      return evaluateCondition(item, payload);
    case 'class':
    case 'subclass':
    case 'species':
    case 'background':
    case 'feat':
    case 'equipment':
      return evaluateSimpleApplicable(item, payload);
    default:
      return {
        capabilities: ['searchOnly'],
        canApplyToCharacter: false,
        canBuildAction: false,
        canCalculateDamage: false,
        canCreateEffect: false,
        canConsumeResource: false,
        canConsumeSpellSlot: false,
        issues: [issue('warning', 'ENGINE_TYPE_NOT_SUPPORTED', `Tipo ${item.type} não tem integração profunda com a engine.`, 'map')],
        unresolvedDamage: false
      };
  }
};

const scoreFromIssues = (issues: EngineReadinessIssue[]): number => {
  const penalty = issues.reduce((sum, current) => sum + (current.severity === 'error' ? 40 : current.severity === 'warning' ? 12 : 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
};

const statusFrom = (item: StoredCompendiumItem, capabilities: EngineCapability[], issues: EngineReadinessIssue[]): EngineReadinessStatus => {
  if (
    capabilities.includes('searchOnly') &&
    !capabilities.includes('applyToCharacter') &&
    (item.type === 'condition' || item.type === 'creatureStatBlock')
  ) {
    return issues.some((entry) => entry.severity === 'error')
      ? 'blocked'
      : 'notApplicable';
  }
  if (issues.some((entry) => entry.severity === 'error')) return 'blocked';
  if (issues.some((entry) => entry.severity === 'warning')) return 'partial';
  return 'ready';
};

export const buildEngineReadinessForItem = (item: StoredCompendiumItem, options: { source?: RuleSource; pack?: StoredCompendiumPack; enabledSource?: boolean } = {}): EngineReadinessItem => {
  const enabledSource = options.enabledSource ?? true;
  const common = evaluateCommon(item, options.source, enabledSource);
  const type = evaluateType(item);
  const canApply = canApplyCompendiumItemToCharacter(item) && type.canApplyToCharacter;
  const capabilities = unique(type.capabilities.filter((capability) => capability !== 'applyToCharacter' || canApply));
  const issues = [...common, ...type.issues];
  const status = statusFrom(item, capabilities, issues);
  const readinessScore = scoreFromIssues(issues);
  return {
    item,
    source: options.source,
    pack: options.pack,
    enabledSource,
    status,
    readinessScore,
    capabilities,
    issueCounts: {
      info: issues.filter((entry) => entry.severity === 'info').length,
      warning: issues.filter((entry) => entry.severity === 'warning').length,
      error: issues.filter((entry) => entry.severity === 'error').length
    },
    canApplyToCharacter: canApply,
    canBuildAction: type.canBuildAction,
    canCalculateDamage: type.canCalculateDamage,
    canCreateEffect: type.canCreateEffect,
    canConsumeResource: type.canConsumeResource,
    canConsumeSpellSlot: type.canConsumeSpellSlot,
    issues
  };
};

const normalizeQuery = (query?: string): string[] =>
  (query ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const matchesQuery = (row: EngineReadinessItem, terms: string[]): boolean => {
  if (!terms.length) return true;
  const haystack = [
    row.item.name,
    row.item.summary ?? '',
    row.item.type,
    row.item.status,
    row.source?.book ?? '',
    row.source?.notes ?? '',
    row.pack?.name ?? '',
    row.capabilities.join(' '),
    row.status,
    JSON.stringify(row.item.normalizedJson ?? {})
  ]
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
};

const createSummary = (rows: EngineReadinessItem[]): EngineReadinessSummary => ({
  totalItems: rows.length,
  validatedItems: rows.filter((row) => row.item.status === 'validated').length,
  readyItems: rows.filter((row) => row.status === 'ready').length,
  partialItems: rows.filter((row) => row.status === 'partial').length,
  blockedItems: rows.filter((row) => row.status === 'blocked').length,
  notApplicableItems: rows.filter((row) => row.status === 'notApplicable').length,
  activeSourceItems: rows.filter((row) => row.enabledSource).length,
  actionItems: rows.filter((row) => row.canBuildAction).length,
  damageItems: rows.filter((row) => row.canCalculateDamage).length,
  effectItems: rows.filter((row) => row.canCreateEffect).length,
  resourceItems: rows.filter((row) => row.canConsumeResource).length,
  spellSlotItems: rows.filter((row) => row.canConsumeSpellSlot).length,
  unresolvedDamageItems: rows.filter((row) => row.issues.some((entry) => entry.code === 'ENGINE_DAMAGE_UNRESOLVED_TOKENS')).length,
  readinessAverage: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.readinessScore, 0) / rows.length) : 100
});

const suite = (id: string, title: string, passed: number, total: number, warningMessage: string, failMessage: string): CompatibilitySuiteCase => {
  const status: CompatibilitySuiteStatus = total === 0 || passed === 0 ? 'fail' : passed < total ? 'warning' : 'pass';
  const message = status === 'pass' ? `${passed}/${total} OK.` : status === 'warning' ? `${passed}/${total} OK. ${warningMessage}` : failMessage;
  return { id, title, status, passed, total, message };
};

export const buildCompatibilitySuites = (rows: EngineReadinessItem[]): CompatibilitySuiteCase[] => {
  const validated = rows.filter((row) => row.item.status === 'validated');
  const appliable = validated.filter((row) => row.capabilities.includes('applyToCharacter'));
  const actionCandidates = validated.filter((row) => ['weapon', 'spell', 'feature'].includes(row.item.type));
  const damageCandidates = validated.filter((row) => ['weapon', 'spell', 'feature'].includes(row.item.type));
  const effectCandidates = validated.filter((row) => ['spell', 'feature', 'magicItem'].includes(row.item.type));
  const resourceCandidates = validated.filter((row) => row.canConsumeResource || row.item.type === 'feature');
  const slotCandidates = validated.filter((row) => row.item.type === 'spell' && asNumber(asRecord(row.item.normalizedJson).level) !== 0);

  return [
    suite('validated-active-source', 'Itens validados com fonte ativa', validated.filter((row) => row.enabledSource && row.issueCounts.error === 0).length, validated.length, 'Há itens validados bloqueados por fonte/erro.', 'Nenhum item validado pronto para fonte ativa.'),
    suite('apply-to-character', 'Aplicação à ficha', appliable.filter((row) => row.issueCounts.error === 0).length, appliable.length, 'Alguns itens aplicáveis ainda têm bloqueios.', 'Nenhum item validado aplicável à ficha.'),
    suite('build-actions', 'Geração de ações', actionCandidates.filter((row) => row.canBuildAction && row.issueCounts.error === 0).length, actionCandidates.length, 'Algumas armas/magias/features não geram ação confiável.', 'Nenhum candidato de ação consegue gerar ação para a engine.'),
    suite('damage-resolution', 'Resolução de dano', damageCandidates.filter((row) => row.canCalculateDamage && !row.issues.some((entry) => entry.code === 'ENGINE_DAMAGE_UNRESOLVED_TOKENS') && row.issueCounts.error === 0).length, damageCandidates.length, 'Algumas fórmulas têm tokens não resolvidos ou bloqueios.', 'Nenhum candidato de dano está calculável.'),
    suite('derived-effects', 'Efeitos ativos derivados', effectCandidates.filter((row) => row.canCreateEffect && row.issueCounts.error === 0).length, Math.max(effectCandidates.length, 1), 'Nem todas as magias/features/itens possuem efeito derivado mapeado.', 'Nenhum efeito derivado disponível.'),
    suite('resources', 'Recursos consumíveis', resourceCandidates.filter((row) => row.canConsumeResource && row.issueCounts.error === 0).length, Math.max(resourceCandidates.length, 1), 'Há features sem recurso consumível mapeado; isso pode ser esperado.', 'Nenhum recurso consumível detectado.'),
    suite('spell-slots', 'Spell slots estruturados', slotCandidates.filter((row) => row.canConsumeSpellSlot && row.issueCounts.error === 0).length, Math.max(slotCandidates.length, 1), 'Algumas magias com slot estão incompletas.', 'Nenhuma magia com slot válida detectada.')
  ];
};

export const buildEngineReadinessReport = ({ items, sources, packs, enabledSourceIds, filters = {} }: BuildEngineReadinessReportInput): EngineReadinessReport => {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const packMap = new Map(packs.map((pack) => [pack.id, pack]));
  const enabledSet = new Set(enabledSourceIds);
  const terms = normalizeQuery(filters.query);
  const typeSet = filters.types?.length ? new Set(filters.types) : undefined;
  const statusSet = filters.statuses?.length ? new Set(filters.statuses) : undefined;
  const sourceSet = filters.sourceIds?.length ? new Set(filters.sourceIds) : undefined;

  const rows = items
    .filter((item) => (typeSet ? typeSet.has(item.type) : true))
    .filter((item) => (statusSet ? statusSet.has(item.status) : true))
    .filter((item) => (sourceSet ? sourceSet.has(item.sourceId) : true))
    .filter((item) => (filters.onlyEnabledSources ? enabledSet.has(item.sourceId) : true))
    .filter((item) => (filters.onlyValidated ? item.status === 'validated' : true))
    .map((item) => buildEngineReadinessForItem(item, { source: sourceMap.get(item.sourceId), pack: packMap.get(item.packId), enabledSource: enabledSet.has(item.sourceId) }))
    .filter((row) => matchesQuery(row, terms))
    .sort((left, right) => {
      const statusWeight = { blocked: 0, partial: 1, ready: 2, notApplicable: 3 } satisfies Record<EngineReadinessStatus, number>;
      if (statusWeight[left.status] !== statusWeight[right.status]) return statusWeight[left.status] - statusWeight[right.status];
      if (left.issueCounts.error !== right.issueCounts.error) return right.issueCounts.error - left.issueCounts.error;
      if (left.issueCounts.warning !== right.issueCounts.warning) return right.issueCounts.warning - left.issueCounts.warning;
      return left.item.name.localeCompare(right.item.name);
    });

  return { items: rows, summary: createSummary(rows), suites: buildCompatibilitySuites(rows) };
};

export const engineReadinessReportToMarkdown = (report: EngineReadinessReport): string => {
  const lines: string[] = [];
  lines.push('# Relatório de prontidão pré-engine');
  lines.push('');
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Resumo');
  lines.push(`- Itens avaliados: ${report.summary.totalItems}`);
  lines.push(`- Validados: ${report.summary.validatedItems}`);
  lines.push(`- Prontos: ${report.summary.readyItems}`);
  lines.push(`- Parciais: ${report.summary.partialItems}`);
  lines.push(`- Bloqueados: ${report.summary.blockedItems}`);
  lines.push(`- Score médio: ${report.summary.readinessAverage}%`);
  lines.push(`- Ações: ${report.summary.actionItems}`);
  lines.push(`- Dano calculável: ${report.summary.damageItems}`);
  lines.push(`- Efeitos derivados: ${report.summary.effectItems}`);
  lines.push(`- Recursos: ${report.summary.resourceItems}`);
  lines.push(`- Spell slots: ${report.summary.spellSlotItems}`);
  lines.push('');
  lines.push('## Suites de compatibilidade');
  for (const test of report.suites) {
    lines.push(`- ${test.status.toUpperCase()} · ${test.title}: ${test.message}`);
  }
  lines.push('');
  lines.push('## Itens com problemas');
  const problemRows = report.items.filter((row) => row.issueCounts.error || row.issueCounts.warning).slice(0, 80);
  if (!problemRows.length) lines.push('Nenhum problema nos itens avaliados.');
  for (const row of problemRows) {
    lines.push(`### ${row.item.name} (${row.item.type})`);
    lines.push(`Status: ${row.status} · Score: ${row.readinessScore}% · Fonte: ${row.source?.book ?? row.item.sourceId}`);
    for (const problem of row.issues) {
      lines.push(`- ${problem.severity.toUpperCase()} ${problem.code}: ${problem.message}`);
    }
    lines.push('');
  }
  return lines.join('\n');
};
