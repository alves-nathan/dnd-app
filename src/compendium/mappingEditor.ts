import type { CompendiumItemType, StoredCompendiumItem } from './types';
import type { ActionCost, AbilityScore, DamageSourceType, RuleValidationIssue } from '../types';
import { parseDamageFormula } from '../rules-engine/dice/parser';

export type MappingFieldKind = 'text' | 'number' | 'boolean' | 'csv' | 'select' | 'textarea';

export interface MappingFieldDefinition {
  key: string;
  label: string;
  kind: MappingFieldKind;
  required?: boolean;
  placeholder?: string;
  helper?: string;
  options?: string[];
}

export interface MappingEditorDefinition {
  type: CompendiumItemType;
  title: string;
  description: string;
  fields: MappingFieldDefinition[];
}

export interface MappingDraft {
  values: Record<string, string>;
}

export interface MappingPatchResult {
  normalizedJson: Record<string, unknown>;
  issues: RuleValidationIssue[];
}

const abilityOptions: AbilityScore[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const actionCostOptions: ActionCost[] = ['action', 'bonusAction', 'reaction', 'movement', 'free', 'special'];
const damageSourceTypeOptions: DamageSourceType[] = ['weapon', 'abilityModifier', 'spell', 'classFeature', 'speciesFeature', 'feat', 'magicItem', 'condition', 'buff', 'debuff', 'manual'];

const commonDamageFields: MappingFieldDefinition[] = [
  { key: 'damageFormula', label: 'Fórmula de dano', kind: 'text', placeholder: '1d8 + STR', helper: 'Use tokens suportados pela engine: dados, STR/DEX/CON/INT/WIS/CHA e PB.' },
  { key: 'extraDamage', label: 'Dano adicional simples', kind: 'text', placeholder: '1d6', helper: 'Opcional. Útil para efeitos condicionais simples; regras complexas devem ficar em damageComponents.' }
];

const commonEffectFields: MappingFieldDefinition[] = [
  { key: 'effectName', label: 'Nome do efeito ativo derivado', kind: 'text', placeholder: "Hex, Hunter's Mark, Aura..." },
  { key: 'effectKind', label: 'Tipo do efeito ativo', kind: 'select', options: ['', 'buff', 'debuff', 'condition', 'spell', 'feature', 'item', 'manual'] },
  { key: 'effectConditionIds', label: 'IDs de condição ativados pelo efeito', kind: 'csv', placeholder: 'hex, hunters-mark' },
  { key: 'effectConcentration', label: 'Efeito exige concentração?', kind: 'boolean' },
  { key: 'effectDurationUnit', label: 'Unidade de duração do efeito', kind: 'select', options: ['', 'turn', 'round', 'minute', 'hour', 'manual'] },
  { key: 'effectDurationRemaining', label: 'Duração restante padrão', kind: 'number', placeholder: '10' },
  { key: 'effectEndsOnShortRest', label: 'Termina no descanso curto?', kind: 'boolean' },
  { key: 'effectEndsOnLongRest', label: 'Termina no descanso longo?', kind: 'boolean' },
  { key: 'effectNotes', label: 'Notas do efeito ativo', kind: 'textarea', placeholder: 'Explique o que este efeito ativa na engine.' }
];

export const mappingDefinitions: Record<string, MappingEditorDefinition> = {
  weapon: {
    type: 'weapon',
    title: 'Mapeamento visual de arma',
    description: 'Campos usados para gerar ataques de arma e calcular dano. Não preencha uma regra se ela não estiver clara na fonte.',
    fields: [
      { key: 'weaponType', label: 'Tipo de arma', kind: 'select', options: ['melee', 'ranged', 'thrown', 'finesse', 'manual'], required: true },
      { key: 'actionCost', label: 'Custo de ação', kind: 'select', options: actionCostOptions, placeholder: 'action' },
      { key: 'attackAbility', label: 'Atributo de ataque', kind: 'select', options: abilityOptions },
      { key: 'damageAbility', label: 'Atributo de dano', kind: 'select', options: abilityOptions },
      { key: 'attacksCount', label: 'Quantidade de ataques da ação', kind: 'number', placeholder: '1' },
      { key: 'magicBonus', label: 'Bônus mágico fixo', kind: 'number', placeholder: '0' },
      { key: 'mastery', label: 'Weapon mastery', kind: 'text', placeholder: 'Nick, Sap, Vex...' },
      { key: 'properties', label: 'Propriedades', kind: 'csv', placeholder: 'light, finesse, thrown' },
      ...commonDamageFields
    ]
  },
  spell: {
    type: 'spell',
    title: 'Mapeamento visual de magia',
    description: 'Campos usados para gerar ações mágicas, scaling e cálculo de dano por alvo/alvos.',
    fields: [
      { key: 'level', label: 'Nível da magia', kind: 'number', placeholder: '0 para cantrip', required: true },
      { key: 'school', label: 'Escola', kind: 'text', placeholder: 'Evocation, Necromancy...' },
      { key: 'castingTime', label: 'Tempo/custo de conjuração', kind: 'select', options: actionCostOptions, placeholder: 'action' },
      { key: 'range', label: 'Alcance', kind: 'text', placeholder: '60 ft, Self, Touch...' },
      { key: 'requiresAttackRoll', label: 'Exige rolagem de ataque?', kind: 'boolean' },
      { key: 'saveAbility', label: 'Atributo do save', kind: 'select', options: ['', ...abilityOptions] },
      { key: 'targets', label: 'Quantidade padrão de alvos', kind: 'number', placeholder: '1' },
      { key: 'concentration', label: 'Exige concentração?', kind: 'boolean' },
      { key: 'scalingKind', label: 'Tipo de scaling', kind: 'select', options: ['none', 'slotLevel', 'characterLevel', 'custom'], placeholder: 'none' },
      { key: 'scalingNotes', label: 'Notas de scaling', kind: 'textarea', placeholder: 'Explique qualquer scaling que ainda exige revisão.' },
      ...commonDamageFields,
      ...commonEffectFields
    ]
  },
  feature: {
    type: 'feature',
    title: 'Mapeamento visual de feature',
    description: 'Use para transformar features importadas em ações, dano condicional, recursos ou alertas para a engine.',
    fields: [
      { key: 'summary', label: 'Resumo mecânico', kind: 'textarea', placeholder: 'Descreva apenas a parte mecânica necessária para cálculo.' },
      { key: 'sourceType', label: 'Fonte de dano', kind: 'select', options: damageSourceTypeOptions, placeholder: 'classFeature' },
      { key: 'actionCost', label: 'Custo de ação concedida', kind: 'select', options: ['', ...actionCostOptions] },
      { key: 'requiresConcentration', label: 'Exige concentração?', kind: 'boolean' },
      { key: 'oncePerTurnKey', label: 'Chave uma vez por turno', kind: 'text', placeholder: 'sneak-attack, divine-smite...' },
      { key: 'grantedActionName', label: 'Nome da ação concedida', kind: 'text', placeholder: 'Ataque especial, Smite manual...' },
      { key: 'grantedActionType', label: 'Tipo da ação concedida', kind: 'select', options: ['', 'attack', 'spell'] },
      ...commonDamageFields,
      ...commonEffectFields
    ]
  },
  armor: {
    type: 'armor',
    title: 'Mapeamento visual de armadura',
    description: 'Campos mínimos para cálculo de CA.',
    fields: [
      { key: 'baseAC', label: 'CA base', kind: 'number', required: true, placeholder: '10, 11, 12...' },
      { key: 'dexCap', label: 'Limite de DEX', kind: 'number', placeholder: '2, sem valor para ilimitado' }
    ]
  },
  class: {
    type: 'class',
    title: 'Mapeamento visual de classe',
    description: 'Campos mínimos para progressão manual e validação de multiclass.',
    fields: [
      { key: 'level', label: 'Nível a aplicar', kind: 'number', required: true, placeholder: '1' },
      { key: 'hitDie', label: 'Dado de vida', kind: 'number', placeholder: '6, 8, 10, 12' }
    ]
  },
  subclass: {
    type: 'subclass',
    title: 'Mapeamento visual de subclasse',
    description: 'Campos mínimos para associar uma subclasse a uma classe existente ou manual.',
    fields: [
      { key: 'classId', label: 'ID/nome da classe base', kind: 'text', placeholder: 'fighter, wizard...' }
    ]
  },
  species: {
    type: 'species',
    title: 'Mapeamento visual de espécie',
    description: 'No MVP, espécie é aplicada como entidade simples. Features podem ser importadas separadamente.',
    fields: [{ key: 'summary', label: 'Resumo', kind: 'textarea' }]
  },
  background: {
    type: 'background',
    title: 'Mapeamento visual de background',
    description: 'No MVP, background é aplicado como entidade simples. Feats/features podem ser importados separadamente.',
    fields: [{ key: 'summary', label: 'Resumo', kind: 'textarea' }]
  },
  feat: {
    type: 'feat',
    title: 'Mapeamento visual de talento',
    description: 'No MVP, feat é aplicado como entidade simples. Ações/features podem ser importadas como itens separados.',
    fields: [{ key: 'summary', label: 'Resumo mecânico', kind: 'textarea' }]
  },
  equipment: {
    type: 'equipment',
    title: 'Mapeamento visual de equipamento',
    description: 'Campos mínimos para inventário.',
    fields: [{ key: 'quantity', label: 'Quantidade', kind: 'number', placeholder: '1' }]
  },
  magicItem: {
    type: 'magicItem',
    title: 'Mapeamento visual de item mágico',
    description: 'Campos mínimos para inventário e features futuras.',
    fields: [
      { key: 'quantity', label: 'Quantidade', kind: 'number', placeholder: '1' },
      { key: 'attunement', label: 'Requer attunement?', kind: 'boolean' },
      ...commonEffectFields
    ]
  },
  creatureStatBlock: {
    type: 'creatureStatBlock',
    title: 'Mapeamento de stat block de criatura',
    description:
      'Stat blocks são preservados para consulta, summons, Wild Shape e formas. Nesta fase não são aplicados diretamente à ficha.',
    fields: [
      {
        key: 'summary',
        label: 'Resumo mecânico',
        kind: 'textarea'
      },
      {
        key: 'size',
        label: 'Tamanho',
        kind: 'text',
        placeholder: 'Tiny, Small, Medium...'
      },
      {
        key: 'creatureType',
        label: 'Tipo de criatura',
        kind: 'text',
        placeholder: 'Beast, Celestial, Undead...'
      },
      {
        key: 'challenge',
        label: 'Challenge Rating',
        kind: 'text',
        placeholder: '0, 1/4, 1, 5...'
      },
      {
        key: 'engineKey',
        label: 'Chave da engine',
        kind: 'text',
        placeholder: 'creature.wolf'
      }
    ]
  },
  condition: {
    type: 'condition',
    title: 'Mapeamento visual de condição',
    description: 'Condições ainda não são aplicadas à ficha no MVP, mas podem ser revisadas e pesquisadas.',
    fields: [{ key: 'summary', label: 'Resumo mecânico', kind: 'textarea' }]
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toDraftValue = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

const parseBoolean = (value: string): boolean | undefined => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['true', 'sim', 'yes', '1', 'y', 's'].includes(normalized)) return true;
  if (['false', 'não', 'nao', 'no', '0', 'n'].includes(normalized)) return false;
  return undefined;
};

const parseNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseCsv = (value: string): string[] | undefined => {
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return entries.length ? entries : undefined;
};

const issue = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({ severity, code, message });

export const getMappingDefinitionForItem = (item: StoredCompendiumItem): MappingEditorDefinition => mappingDefinitions[item.type] ?? mappingDefinitions.condition;

export const createMappingDraftFromItem = (item: StoredCompendiumItem): MappingDraft => {
  const definition = getMappingDefinitionForItem(item);
  const normalized = isRecord(item.normalizedJson) ? item.normalizedJson : {};
  const rawPayload = isRecord(item.rawJson.payload) ? item.rawJson.payload : {};
  const values = definition.fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.key] = toDraftValue(normalized[field.key] ?? rawPayload[field.key]);
    return acc;
  }, {});
  return { values };
};

export const buildNormalizedJsonFromMappingDraft = (item: StoredCompendiumItem, draft: MappingDraft): MappingPatchResult => {
  const definition = getMappingDefinitionForItem(item);
  const normalized: Record<string, unknown> = { ...(isRecord(item.normalizedJson) ? item.normalizedJson : {}) };
  const issues: RuleValidationIssue[] = [];

  for (const field of definition.fields) {
    const raw = draft.values[field.key] ?? '';
    const trimmed = raw.trim();

    if (field.required && !trimmed) {
      issues.push(issue('error', `MAPPING_REQUIRED_${field.key.toUpperCase()}`, `Campo obrigatório ausente: ${field.label}.`));
      continue;
    }

    if (!trimmed) {
      delete normalized[field.key];
      continue;
    }

    if (field.kind === 'number') {
      const value = parseNumber(trimmed);
      if (value === undefined) issues.push(issue('error', `MAPPING_NUMBER_${field.key.toUpperCase()}`, `Campo "${field.label}" precisa ser numérico.`));
      else normalized[field.key] = value;
      continue;
    }

    if (field.kind === 'boolean') {
      const value = parseBoolean(trimmed);
      if (value === undefined) issues.push(issue('error', `MAPPING_BOOLEAN_${field.key.toUpperCase()}`, `Campo "${field.label}" precisa ser true/false ou sim/não.`));
      else normalized[field.key] = value;
      continue;
    }

    if (field.kind === 'csv') {
      normalized[field.key] = parseCsv(trimmed) ?? [];
      continue;
    }

    if (field.kind === 'select') {
      if (field.options?.length && !field.options.includes(trimmed)) {
        issues.push(issue('error', `MAPPING_OPTION_${field.key.toUpperCase()}`, `Campo "${field.label}" precisa ser um destes valores: ${field.options.filter(Boolean).join(', ')}.`));
      } else {
        normalized[field.key] = trimmed;
      }
      continue;
    }

    normalized[field.key] = trimmed;
  }

  const formula = typeof normalized.damageFormula === 'string' ? normalized.damageFormula : undefined;
  if (formula) {
    const parsed = parseDamageFormula(formula, { defaultSourceType: item.type === 'spell' ? 'spell' : item.type === 'feature' ? 'classFeature' : 'weapon' });
    if (parsed.unresolvedTokens?.length) {
      issues.push(issue('warning', 'MAPPING_DAMAGE_UNRESOLVED_TOKENS', `Fórmula de dano possui tokens não resolvidos: ${parsed.unresolvedTokens.join(', ')}.`));
    }
    normalized.damageComponents = parsed.components;
  }

  if (item.type === 'spell' && normalized.scalingKind && normalized.scalingKind !== 'none') {
    normalized.scaling = {
      kind: normalized.scalingKind,
      requiresReview: Boolean(normalized.scalingNotes)
    };
  }

  if (item.type === 'feature' && normalized.grantedActionName && normalized.grantedActionType) {
    normalized.grantsActions = [
      {
        id: `${item.importItemId}-mapped-action`,
        type: normalized.grantedActionType,
        name: normalized.grantedActionName,
        actionCost: normalized.actionCost || 'special',
        damageFormula: normalized.damageFormula,
        sourceType: normalized.sourceType || 'classFeature',
        oncePerTurnKey: normalized.oncePerTurnKey
      }
    ];
  }

  const hasEffectMapping = Boolean(
    normalized.effectName ||
    normalized.effectKind ||
    normalized.effectConcentration !== undefined ||
    normalized.effectConditionIds ||
    normalized.effectDurationUnit ||
    normalized.effectDurationRemaining !== undefined ||
    normalized.effectNotes
  );

  if ((item.type === 'spell' || item.type === 'feature' || item.type === 'magicItem') && hasEffectMapping) {
    normalized.effectTemplates = [
      {
        id: `${item.importItemId}-effect-template`,
        name: normalized.effectName || item.name,
        kind: normalized.effectKind || (item.type === 'spell' ? 'spell' : item.type === 'magicItem' ? 'item' : 'feature'),
        sourceType: item.type === 'spell' ? 'spell' : item.type === 'magicItem' ? 'magicItem' : normalized.sourceType || 'classFeature',
        concentration: normalized.effectConcentration ?? normalized.concentration ?? normalized.requiresConcentration,
        conditionIds: normalized.effectConditionIds || [],
        duration: {
          unit: normalized.effectDurationUnit || 'manual',
          remaining: normalized.effectDurationRemaining,
          expiresOn: normalized.effectDurationUnit ? 'turnStart' : 'manual'
        },
        endsOnShortRest: normalized.effectEndsOnShortRest,
        endsOnLongRest: normalized.effectEndsOnLongRest ?? true,
        notes: normalized.effectNotes
      }
    ];
  }

  return { normalizedJson: normalized, issues };
};
