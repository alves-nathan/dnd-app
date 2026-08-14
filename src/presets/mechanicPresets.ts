import type {
  ActionCost,
  ActiveEffectDurationUnit,
  ActiveEffectKind,
  ActiveEffectTemplate,
  AttackAction,
  Character,
  DamageComponent,
  DamageFormula,
  DamageSourceType,
  Feature,
  ResourceCost,
  ResourcePool,
  RuleSource,
  RuleValidationIssue
} from '../types';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { createId } from '../utils/id';

export type MechanicPresetFieldKind = 'text' | 'number' | 'boolean' | 'select' | 'textarea';

export interface MechanicPresetField {
  key: string;
  label: string;
  kind: MechanicPresetFieldKind;
  required?: boolean;
  placeholder?: string;
  helper?: string;
  options?: string[];
  defaultValue?: string;
}

export interface MechanicPresetBlueprint {
  id: string;
  name: string;
  category: 'damage' | 'resource' | 'effect' | 'actionEconomy' | 'utility';
  description: string;
  examples: string[];
  caution: string;
  fields: MechanicPresetField[];
}

export interface MechanicPresetDraft {
  blueprintId: string;
  values: Record<string, string>;
}

export interface MechanicPresetApplicationResult {
  character: Character;
  feature?: Feature;
  resource?: ResourcePool;
  effectTemplate?: ActiveEffectTemplate;
  action?: AttackAction;
  issues: RuleValidationIssue[];
  summary: string[];
}

const sourceTypes: DamageSourceType[] = ['weapon', 'spell', 'classFeature', 'speciesFeature', 'feat', 'magicItem', 'condition', 'buff', 'debuff', 'manual'];
const actionCosts: ActionCost[] = ['action', 'bonusAction', 'reaction', 'movement', 'free', 'special'];
const effectKinds: ActiveEffectKind[] = ['buff', 'debuff', 'condition', 'spell', 'feature', 'item', 'manual'];
const durationUnits: ActiveEffectDurationUnit[] = ['turn', 'round', 'minute', 'hour', 'manual'];

const baseFields: MechanicPresetField[] = [
  { key: 'featureName', label: 'Nome da feature criada', kind: 'text', required: true, placeholder: 'Dano marcado, Burst manual, Ação extra...' },
  { key: 'summary', label: 'Resumo mecânico', kind: 'textarea', placeholder: 'Descreva a regra de forma curta, usando sua fonte legalmente obtida.' },
  { key: 'sourceType', label: 'Tipo de fonte', kind: 'select', options: sourceTypes, defaultValue: 'classFeature' }
];

const resourceFields: MechanicPresetField[] = [
  { key: 'createResource', label: 'Criar recurso limitado?', kind: 'boolean', defaultValue: 'não', helper: 'Use quando a regra tiver usos por descanso/dia/turno.' },
  { key: 'resourceName', label: 'Nome do recurso', kind: 'text', placeholder: 'Uso de feature, dado especial, carga...' },
  { key: 'resourceMax', label: 'Máximo do recurso', kind: 'number', placeholder: '1' },
  { key: 'resourceRecharge', label: 'Recarga do recurso', kind: 'select', options: ['turn', 'shortRest', 'longRest', 'day', 'manual'], defaultValue: 'longRest' },
  { key: 'resourceCost', label: 'Custo por uso', kind: 'number', placeholder: '1' }
];

const effectFields: MechanicPresetField[] = [
  { key: 'createEffect', label: 'Criar efeito ativo derivado?', kind: 'boolean', defaultValue: 'sim' },
  { key: 'effectName', label: 'Nome do efeito ativo', kind: 'text', placeholder: 'Alvo marcado, buff ativo, concentração...' },
  { key: 'effectKind', label: 'Tipo do efeito', kind: 'select', options: effectKinds, defaultValue: 'feature' },
  { key: 'conditionId', label: 'ID de condição que o efeito ativa', kind: 'text', placeholder: 'marked-target, hex-like, sneak-window' },
  { key: 'concentration', label: 'Exige concentração?', kind: 'boolean', defaultValue: 'não' },
  { key: 'durationUnit', label: 'Unidade de duração', kind: 'select', options: durationUnits, defaultValue: 'manual' },
  { key: 'durationRemaining', label: 'Duração inicial', kind: 'number', placeholder: '10' },
  { key: 'endsOnShortRest', label: 'Termina no descanso curto?', kind: 'boolean', defaultValue: 'não' },
  { key: 'endsOnLongRest', label: 'Termina no descanso longo?', kind: 'boolean', defaultValue: 'sim' }
];

const actionFields: MechanicPresetField[] = [
  { key: 'createAction', label: 'Criar ação de dano separada?', kind: 'boolean', defaultValue: 'sim', helper: 'A ação criada entra na rotação como bloco separado. Para dano anexado a ataque existente, use o mesmo ID de condição e ative o efeito.' },
  { key: 'actionName', label: 'Nome da ação criada', kind: 'text', placeholder: 'Dano condicional, Burst, Ataque especial...' },
  { key: 'damageFormula', label: 'Fórmula de dano', kind: 'text', placeholder: '1d6, 2d8 + CHA, PB...' },
  { key: 'actionCost', label: 'Custo da ação', kind: 'select', options: actionCosts, defaultValue: 'special' },
  { key: 'attacksCount', label: 'Quantidade de aplicações', kind: 'number', defaultValue: '1' },
  { key: 'oncePerTurnKey', label: 'Chave uma vez por turno', kind: 'text', placeholder: 'sneak-like, smite-like, marked-damage' },
  { key: 'damageNeedsCondition', label: 'Dano exige condição ativa?', kind: 'boolean', defaultValue: 'sim' },
  { key: 'requiresReview', label: 'Marcar como precisa revisão?', kind: 'boolean', defaultValue: 'sim' }
];

export const mechanicPresetBlueprints: MechanicPresetBlueprint[] = [
  {
    id: 'marked-target-extra-damage',
    name: 'Marcador com dano condicional',
    category: 'damage',
    description: 'Cria uma feature com efeito ativo e uma ação de dano condicional. Use para padrões de alvo marcado, maldição, marca, juramento ou buff que adiciona dano quando uma condição está ativa.',
    examples: ['efeitos similares a marca/maldição', 'dano extra enquanto um alvo está marcado', 'buff que ativa um ID de condição'],
    caution: 'O preset não contém texto nem valores oficiais. Informe fórmula, duração, concentração e restrições conforme sua fonte.',
    fields: [...baseFields, ...effectFields, ...actionFields, ...resourceFields]
  },
  {
    id: 'once-per-turn-extra-damage',
    name: 'Dano extra uma vez por turno',
    category: 'damage',
    description: 'Cria uma feature com uma ação especial de dano extra limitada por chave once-per-turn. Útil para modelar dano que só pode ser aplicado uma vez por turno.',
    examples: ['dano furtivo manual', 'dado extra de feature', 'bônus limitado por turno'],
    caution: 'A engine valida a chave once-per-turn, mas a condição narrativa para poder usar o dano deve ser cadastrada por você.',
    fields: [...baseFields, ...actionFields.map((field) => (field.key === 'damageNeedsCondition' ? { ...field, defaultValue: 'não' } : field)), ...resourceFields]
  },
  {
    id: 'resource-burst-damage',
    name: 'Burst com recurso limitado',
    category: 'resource',
    description: 'Cria um recurso limitado e uma feature que concede ação especial consumindo esse recurso. Use para bursts, dados especiais, cargas ou usos por descanso.',
    examples: ['dano com carga', 'uso limitado por descanso', 'gasto de recurso para dano'],
    caution: 'Não define automaticamente slots de magia. Para slots, use a tela de recursos/slots e selecione slot na rotação.',
    fields: [
      ...baseFields,
      ...actionFields.map((field) => (field.key === 'damageNeedsCondition' ? { ...field, defaultValue: 'não' } : field)),
      ...resourceFields.map((field) => (field.key === 'createResource' ? { ...field, defaultValue: 'sim' } : field))
    ]
  },
  {
    id: 'extra-action-marker',
    name: 'Marcador de ação extra / economia de ação',
    category: 'actionEconomy',
    description: 'Cria um recurso e uma feature de lembrete para casos em que a ficha ganha uma ação, ação bônus, reação ou sequência especial por gasto de recurso.',
    examples: ['ação extra por descanso', 'reação especial', 'modo de turno acelerado'],
    caution: 'A engine ainda não altera automaticamente a economia de ações. Use este preset como rastreador e monte a rotação manualmente com as ações extras permitidas.',
    fields: [...baseFields, ...resourceFields.map((field) => (field.key === 'createResource' ? { ...field, defaultValue: 'sim' } : field))]
  },
  {
    id: 'persistent-buff-or-debuff',
    name: 'Buff/debuff persistente',
    category: 'effect',
    description: 'Cria uma feature com template de efeito ativo, sem dano próprio. Use para buffs, debuffs, estados, condições personalizadas e concentração persistente.',
    examples: ['buff que habilita condição', 'debuff rastreável', 'efeito de concentração sem dano direto'],
    caution: 'O efeito só impacta cálculo quando algum dano/ação usa o mesmo ID de condição, ou quando a concentração é relevante para validação.',
    fields: [...baseFields, ...effectFields]
  }
];

const issue = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({ severity, code, message });

const slugify = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'mechanic';

const toBoolean = (value: string | undefined, fallback = false): boolean => {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['true', 'sim', 's', 'yes', 'y', '1'].includes(normalized)) return true;
  if (['false', 'não', 'nao', 'n', 'no', '0'].includes(normalized)) return false;
  return fallback;
};

const toNumber = (value: string | undefined, fallback?: number): number | undefined => {
  const normalized = (value ?? '').trim().replace(',', '.');
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toActionCost = (value: string | undefined, fallback: ActionCost): ActionCost =>
  actionCosts.includes(value as ActionCost) ? (value as ActionCost) : fallback;

const toSourceType = (value: string | undefined): DamageSourceType =>
  sourceTypes.includes(value as DamageSourceType) ? (value as DamageSourceType) : 'classFeature';

const toEffectKind = (value: string | undefined): ActiveEffectKind =>
  effectKinds.includes(value as ActiveEffectKind) ? (value as ActiveEffectKind) : 'feature';

const toDurationUnit = (value: string | undefined): ActiveEffectDurationUnit =>
  durationUnits.includes(value as ActiveEffectDurationUnit) ? (value as ActiveEffectDurationUnit) : 'manual';

export const getMechanicPresetBlueprint = (blueprintId: string): MechanicPresetBlueprint | undefined =>
  mechanicPresetBlueprints.find((blueprint) => blueprint.id === blueprintId);

export const createMechanicPresetDraft = (blueprintId: string): MechanicPresetDraft => {
  const blueprint = getMechanicPresetBlueprint(blueprintId) ?? mechanicPresetBlueprints[0];
  const values = blueprint.fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.key] = field.defaultValue ?? '';
    return acc;
  }, {});
  return { blueprintId: blueprint.id, values };
};

const withConditionalComponents = (
  formula: DamageFormula,
  params: { conditionId?: string; conditionLabel?: string; damageNeedsCondition: boolean; sourceType: DamageSourceType; oncePerTurnKey?: string }
): DamageFormula => ({
  ...formula,
  components: formula.components.map<DamageComponent>((component) => ({
    ...component,
    sourceType: params.sourceType,
    application: params.damageNeedsCondition ? 'conditional' : component.application,
    condition: params.damageNeedsCondition && params.conditionId
      ? {
          id: params.conditionId,
          label: params.conditionLabel ?? params.conditionId,
          oncePerTurnKey: params.oncePerTurnKey || undefined
        }
      : component.condition
  }))
});

const manualSource = (notes?: string): RuleSource => ({
  id: createId('source'),
  status: 'needsReview',
  confidence: 'manual',
  notes: notes || 'Criado por assistente de preset mecânico configurável.'
});

export const applyMechanicPresetToCharacter = (character: Character, draft: MechanicPresetDraft): MechanicPresetApplicationResult => {
  const blueprint = getMechanicPresetBlueprint(draft.blueprintId);
  const issues: RuleValidationIssue[] = [];
  const summary: string[] = [];
  if (!blueprint) {
    return { character, issues: [issue('error', 'MECHANIC_PRESET_NOT_FOUND', `Preset ${draft.blueprintId} não encontrado.`)], summary };
  }

  const values = draft.values;
  const featureName = (values.featureName ?? '').trim() || blueprint.name;
  const sourceType = toSourceType(values.sourceType);
  const source = manualSource(values.summary);
  const conditionId = (values.conditionId ?? '').trim() || slugify(`${featureName} condition`);
  const createEffect = toBoolean(values.createEffect, blueprint.id !== 'once-per-turn-extra-damage');
  const createAction = toBoolean(values.createAction, blueprint.category === 'damage' || blueprint.category === 'resource');
  const createResource = toBoolean(values.createResource, blueprint.id === 'resource-burst-damage' || blueprint.id === 'extra-action-marker');
  const oncePerTurnKey = (values.oncePerTurnKey ?? '').trim() || undefined;
  const actionCost = toActionCost(values.actionCost, 'special');
  const attacksCount = Math.max(1, Math.floor(toNumber(values.attacksCount, 1) ?? 1));
  const requiresReview = toBoolean(values.requiresReview, true);
  const damageNeedsCondition = toBoolean(values.damageNeedsCondition, blueprint.id === 'marked-target-extra-damage');

  let resource: ResourcePool | undefined;
  let consumes: ResourceCost[] | undefined;
  if (createResource) {
    const resourceName = (values.resourceName ?? '').trim() || `${featureName} usos`;
    const max = Math.max(1, Math.floor(toNumber(values.resourceMax, 1) ?? 1));
    resource = {
      id: createId('resource'),
      name: resourceName,
      max,
      current: max,
      recharge: ['turn', 'shortRest', 'longRest', 'day', 'manual'].includes(values.resourceRecharge) ? (values.resourceRecharge as ResourcePool['recharge']) : 'longRest',
      source,
      notes: `Criado pelo preset ${blueprint.name}. Revise contra sua fonte.`
    };
    const amount = Math.max(1, Math.floor(toNumber(values.resourceCost, 1) ?? 1));
    consumes = [{ resourceId: resource.id, amount, label: resource.name, oncePerTurnKey }];
    summary.push(`Recurso criado: ${resource.name} (${resource.current}/${resource.max}, recarga ${resource.recharge}).`);
  }

  let effectTemplate: ActiveEffectTemplate | undefined;
  if (createEffect) {
    effectTemplate = {
      id: createId('effecttpl'),
      name: (values.effectName ?? '').trim() || featureName,
      kind: toEffectKind(values.effectKind),
      sourceType,
      source,
      concentration: toBoolean(values.concentration, false),
      conditionIds: conditionId ? [conditionId] : [],
      duration: {
        unit: toDurationUnit(values.durationUnit),
        remaining: toNumber(values.durationRemaining),
        expiresOn: toDurationUnit(values.durationUnit) === 'manual' ? 'manual' : 'turnStart'
      },
      endsOnShortRest: toBoolean(values.endsOnShortRest, false),
      endsOnLongRest: toBoolean(values.endsOnLongRest, true),
      notes: (values.summary ?? '').trim() || blueprint.description,
      sourceRef: { kind: 'characterEntry', entityType: 'feature' },
      requiresReview
    };
    summary.push(`Efeito derivado criado: ${effectTemplate.name}${effectTemplate.concentration ? ' (concentração)' : ''}.`);
  }

  let action: AttackAction | undefined;
  if (createAction) {
    const rawFormula = (values.damageFormula ?? '').trim();
    if (!rawFormula) {
      issues.push(issue('warning', 'MECHANIC_PRESET_DAMAGE_EMPTY', 'Ação solicitada sem fórmula de dano. A feature será criada sem ação de dano.'));
    } else {
      const parsed = parseDamageFormula(rawFormula, { defaultSourceType: sourceType, application: damageNeedsCondition ? 'conditional' : 'onHit' });
      if (parsed.unresolvedTokens?.length) {
        issues.push(issue('warning', 'MECHANIC_PRESET_DAMAGE_UNRESOLVED', `Fórmula possui tokens não resolvidos: ${parsed.unresolvedTokens.join(', ')}.`));
      }
      action = {
        id: createId('presetAction'),
        type: 'attack',
        name: (values.actionName ?? '').trim() || `${featureName} dano`,
        actionCost,
        sourceType,
        source,
        attackAbility: undefined,
        damage: withConditionalComponents(parsed, {
          conditionId,
          conditionLabel: effectTemplate?.name ?? featureName,
          damageNeedsCondition,
          sourceType,
          oncePerTurnKey
        }),
        attacksCount,
        consumes,
        tags: ['mechanic-preset', blueprint.id, ...(damageNeedsCondition ? [`condition:${conditionId}`] : []), ...(oncePerTurnKey ? [`once:${oncePerTurnKey}`] : [])],
        origin: { kind: 'featureGrant', entityType: 'feature' },
        requiresReview,
        ruleNotes: [blueprint.caution]
      };
      summary.push(`Ação criada: ${action.name} (${rawFormula}).`);
    }
  }

  if (blueprint.id === 'extra-action-marker') {
    issues.push(issue('info', 'ACTION_ECONOMY_MANUAL_ROTATION', 'Este preset rastreia recurso/economia de ação, mas você ainda deve montar a rotação manualmente com as ações extras permitidas pela regra revisada.'));
  }

  const feature: Feature = {
    id: createId('feature'),
    name: featureName,
    sourceType,
    source,
    summary: (values.summary ?? '').trim() || `${blueprint.description} ${blueprint.caution}`,
    actionCost: createAction ? actionCost : undefined,
    grantsActions: action ? [action] : [],
    resource,
    requiresConcentration: effectTemplate?.concentration,
    oncePerTurnKey,
    effectTemplates: effectTemplate ? [effectTemplate] : [],
    requiresReview
  };

  const nextCharacter: Character = {
    ...character,
    features: [...(character.features ?? []), feature],
    resources: resource ? [...(character.resources ?? []), resource] : character.resources ?? []
  };

  summary.unshift(`Feature criada: ${feature.name}.`);
  if (requiresReview) {
    issues.push(issue('warning', 'MECHANIC_PRESET_REQUIRES_REVIEW', 'Preset criado como needsReview. Revise os valores contra a fonte antes de tratar o cálculo como definitivo.'));
  }

  return { character: nextCharacter, feature, resource, effectTemplate, action, issues, summary };
};
