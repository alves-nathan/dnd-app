import {
  ActiveEffect,
  ActiveEffectDuration,
  ActiveEffectDurationUnit,
  ActiveEffectKind,
  ActiveEffectTemplate,
  ActionSourceRef,
  Character,
  DamageComponent,
  DamageSourceType,
  DerivedEffectOption,
  Feature,
  MagicItem,
  RuleSource,
  RuleValidationIssue,
  Spell
} from '../../types';
import { createId } from '../../utils/id';

const nowIso = () => new Date().toISOString();

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const asBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const uniq = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const effectKinds = new Set<ActiveEffectKind>(['buff', 'debuff', 'condition', 'spell', 'feature', 'item', 'manual']);
const sourceTypes = new Set<DamageSourceType>(['weapon', 'abilityModifier', 'spell', 'classFeature', 'speciesFeature', 'feat', 'magicItem', 'condition', 'buff', 'debuff', 'manual']);
const durationUnits = new Set<ActiveEffectDurationUnit>(['turn', 'round', 'minute', 'hour', 'manual']);

const toKind = (value: unknown, fallback: ActiveEffectKind): ActiveEffectKind => {
  const text = asString(value);
  return text && effectKinds.has(text as ActiveEffectKind) ? (text as ActiveEffectKind) : fallback;
};

const toSourceType = (value: unknown, fallback: DamageSourceType): DamageSourceType => {
  const text = asString(value);
  return text && sourceTypes.has(text as DamageSourceType) ? (text as DamageSourceType) : fallback;
};

const toDurationUnit = (value: unknown, fallback: ActiveEffectDurationUnit): ActiveEffectDurationUnit => {
  const text = asString(value);
  return text && durationUnits.has(text as ActiveEffectDurationUnit) ? (text as ActiveEffectDurationUnit) : fallback;
};

const parseConditionIds = (...values: unknown[]): string[] => {
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value === 'string') {
      ids.push(...value.split(',').map((item) => item.trim()));
      continue;
    }
    for (const item of asArray(value)) {
      if (typeof item === 'string') ids.push(item);
      else {
        const record = asRecord(item);
        const id = asString(record.id) ?? asString(record.conditionId) ?? asString(record.key);
        if (id) ids.push(id);
      }
    }
  }
  return uniq(ids);
};

const durationFromPayload = (payload: Record<string, unknown>, fallback?: Partial<ActiveEffectDuration>): ActiveEffectDuration => {
  const duration = asRecord(payload.duration ?? payload.effectDuration);
  const remaining = asNumber(duration.remaining) ?? asNumber(duration.value) ?? asNumber(payload.durationRemaining) ?? asNumber(payload.effectDurationRemaining) ?? fallback?.remaining;
  return {
    unit: toDurationUnit(duration.unit ?? payload.durationUnit ?? payload.effectDurationUnit, fallback?.unit ?? 'manual'),
    remaining: remaining === undefined ? undefined : Math.max(0, Math.floor(remaining)),
    expiresOn: asString(duration.expiresOn) === 'turnEnd' ? 'turnEnd' : asString(duration.expiresOn) === 'manual' ? 'manual' : fallback?.expiresOn ?? 'turnStart'
  };
};

const collectDamageConditionIds = (components?: DamageComponent[]): string[] =>
  uniq((components ?? []).flatMap((component) => (component.condition?.id ? [component.condition.id] : [])));

const templateFromRecord = (
  record: Record<string, unknown>,
  defaults: {
    idPrefix: string;
    name: string;
    kind: ActiveEffectKind;
    sourceType: DamageSourceType;
    source?: RuleSource;
    sourceRef?: ActionSourceRef;
    fallbackConditionIds?: string[];
    fallbackConcentration?: boolean;
  },
  index = 0
): ActiveEffectTemplate => {
  const conditionIds = parseConditionIds(record.conditionIds, record.conditions, record.activeConditionIds, record.enabledConditionIds, record.effectConditionIds, defaults.fallbackConditionIds);
  return {
    id: asString(record.id) ?? `${defaults.idPrefix}_${index}`,
    name: asString(record.name) ?? asString(record.label) ?? asString(record.effectName) ?? defaults.name,
    kind: toKind(record.kind ?? record.effectKind, defaults.kind),
    sourceType: toSourceType(record.sourceType, defaults.sourceType),
    source: defaults.source,
    concentration: asBoolean(record.concentration) ?? asBoolean(record.requiresConcentration) ?? asBoolean(record.effectConcentration) ?? defaults.fallbackConcentration,
    conditionIds,
    duration: durationFromPayload(record, { unit: conditionIds.length ? 'manual' : 'manual' }),
    endsOnShortRest: asBoolean(record.endsOnShortRest) ?? asBoolean(record.shortRestEnds),
    endsOnLongRest: asBoolean(record.endsOnLongRest) ?? asBoolean(record.longRestEnds) ?? true,
    notes: asString(record.notes) ?? asString(record.summary) ?? asString(record.description),
    sourceRef: defaults.sourceRef,
    requiresReview: asBoolean(record.requiresReview)
  };
};

export const parseEffectTemplatesFromPayload = (
  payload: Record<string, unknown>,
  defaults: {
    idPrefix: string;
    name: string;
    kind: ActiveEffectKind;
    sourceType: DamageSourceType;
    source?: RuleSource;
    sourceRef?: ActionSourceRef;
    fallbackConditionIds?: string[];
    fallbackConcentration?: boolean;
  }
): ActiveEffectTemplate[] => {
  const hasDirectEffectFields = Boolean(payload.effectName || payload.effectKind || payload.effectConditionIds || payload.effectConcentration !== undefined || payload.effectDurationUnit || payload.effectDurationRemaining !== undefined);
  const explicitContainers = [
    hasDirectEffectFields ? payload : undefined,
    payload.effectTemplates,
    payload.activeEffectTemplates,
    payload.effects,
    payload.activeEffects,
    payload.effect,
    payload.activeEffect
  ];
  const records = explicitContainers.flatMap((value) => (Array.isArray(value) ? value.map(asRecord) : Object.keys(asRecord(value)).length ? [asRecord(value)] : []));
  const explicit = records.map((record, index) => templateFromRecord(record, defaults, index));
  if (explicit.length) return explicit;

  const conditionIds = parseConditionIds(payload.conditionIds, payload.conditions, payload.activeConditionIds, payload.effectConditionIds, defaults.fallbackConditionIds);
  const hasImplicitEffect = conditionIds.length > 0 || asBoolean(payload.concentration) || asBoolean(payload.requiresConcentration) || defaults.fallbackConcentration;
  if (!hasImplicitEffect) return [];

  return [templateFromRecord({}, { ...defaults, fallbackConditionIds: conditionIds, fallbackConcentration: asBoolean(payload.concentration) ?? asBoolean(payload.requiresConcentration) ?? defaults.fallbackConcentration }, 0)];
};

export const createActiveEffectFromTemplate = (template: ActiveEffectTemplate, overrides?: Partial<ActiveEffect>): ActiveEffect => ({
  id: overrides?.id ?? createId('effect'),
  name: overrides?.name ?? template.name,
  kind: overrides?.kind ?? template.kind,
  sourceType: overrides?.sourceType ?? template.sourceType,
  source: overrides?.source ?? template.source,
  status: overrides?.status ?? 'active',
  concentration: overrides?.concentration ?? template.concentration,
  conditionIds: overrides?.conditionIds ?? template.conditionIds ?? [],
  duration: overrides?.duration ?? template.duration,
  endsOnShortRest: overrides?.endsOnShortRest ?? template.endsOnShortRest,
  endsOnLongRest: overrides?.endsOnLongRest ?? template.endsOnLongRest,
  notes: overrides?.notes ?? template.notes,
  templateId: overrides?.templateId ?? template.id,
  sourceRef: overrides?.sourceRef ?? template.sourceRef,
  createdAt: overrides?.createdAt ?? nowIso()
});

const optionWarnings = (template: ActiveEffectTemplate): RuleValidationIssue[] => {
  const warnings: RuleValidationIssue[] = [];
  if (!(template.conditionIds ?? []).length && !template.concentration) {
    warnings.push({ severity: 'warning', code: 'DERIVED_EFFECT_HAS_NO_MECHANICAL_HOOK', message: `Efeito "${template.name}" não ativa condição nem concentração. Ele será rastreado, mas não muda o cálculo até ser mapeado.` });
  }
  if (template.requiresReview) {
    warnings.push({ severity: 'warning', code: 'DERIVED_EFFECT_REQUIRES_REVIEW', message: `Efeito "${template.name}" veio de conteúdo que ainda exige revisão.` });
  }
  return warnings;
};

const pushTemplateOptions = (
  options: DerivedEffectOption[],
  character: Character,
  templates: ActiveEffectTemplate[],
  sourceLabel: string
) => {
  for (const template of templates) {
    options.push({
      id: `${sourceLabel}:${template.id}`,
      label: template.name,
      sourceLabel,
      template,
      alreadyActive: (character.activeEffects ?? []).some((effect) => effect.status === 'active' && effect.templateId === template.id),
      warnings: optionWarnings(template)
    });
  }
};

const templatesFromSpell = (spell: Spell): ActiveEffectTemplate[] => {
  const fallbackConditionIds = collectDamageConditionIds(spell.damage?.components);
  const explicit = spell.effectTemplates ?? [];
  if (explicit.length) return explicit;
  if (!spell.concentration && !fallbackConditionIds.length) return [];
  return [{
    id: `spell_effect_${spell.id}`,
    name: spell.name,
    kind: 'spell',
    sourceType: 'spell',
    source: spell.source,
    concentration: spell.concentration,
    conditionIds: fallbackConditionIds,
    duration: { unit: 'manual', expiresOn: 'manual' },
    endsOnLongRest: true,
    sourceRef: { kind: 'characterEntry', entityType: 'spell', entityId: spell.id }
  }];
};

const templatesFromFeature = (feature: Feature): ActiveEffectTemplate[] => {
  const actionConditionIds = uniq((feature.grantsActions ?? []).flatMap((action) => collectDamageConditionIds(action.damage?.components)));
  const explicit = feature.effectTemplates ?? [];
  if (explicit.length) return explicit;
  if (!feature.requiresConcentration && !actionConditionIds.length) return [];
  return [{
    id: `feature_effect_${feature.id}`,
    name: feature.name,
    kind: 'feature',
    sourceType: feature.sourceType,
    source: feature.source,
    concentration: feature.requiresConcentration,
    conditionIds: actionConditionIds,
    duration: { unit: 'manual', expiresOn: 'manual' },
    endsOnLongRest: true,
    notes: feature.summary,
    sourceRef: { kind: 'characterEntry', entityType: 'feature', entityId: feature.id }
  }];
};

const templatesFromMagicItem = (item: MagicItem): ActiveEffectTemplate[] => {
  const ownTemplates = item.effectTemplates ?? [];
  const featureTemplates = (item.features ?? []).flatMap(templatesFromFeature);
  return [...ownTemplates, ...featureTemplates].map((template) => ({
    ...template,
    sourceRef: template.sourceRef ?? { kind: 'characterEntry', entityType: 'magicItem', entityId: item.id }
  }));
};

export const buildDerivedEffectOptions = (character: Character): DerivedEffectOption[] => {
  const options: DerivedEffectOption[] = [];
  for (const spell of character.spells ?? []) pushTemplateOptions(options, character, templatesFromSpell(spell), `Magia · ${spell.name}`);
  for (const feature of character.features ?? []) pushTemplateOptions(options, character, templatesFromFeature(feature), `Feature · ${feature.name}`);
  for (const feat of character.feats ?? []) for (const feature of feat.features ?? []) pushTemplateOptions(options, character, templatesFromFeature(feature), `Talento · ${feat.name}`);
  if (character.species) for (const feature of character.species.features ?? []) pushTemplateOptions(options, character, templatesFromFeature(feature), `Espécie · ${character.species.name}`);
  if (character.background) for (const feature of character.background.features ?? []) pushTemplateOptions(options, character, templatesFromFeature(feature), `Background · ${character.background.name}`);
  for (const item of character.magicItems ?? []) pushTemplateOptions(options, character, templatesFromMagicItem(item), `Item · ${item.name}`);
  return options;
};
