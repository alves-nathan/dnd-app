import { mappingDefinitions } from './mappingEditor';
import type { CompendiumItemType, StoredCompendiumItem, StoredCompendiumItemStatus, StoredCompendiumPack } from './types';
import type { RuleSource, RuleValidationIssue } from '../types';

export type ReviewChecklistSeverity = 'pass' | 'warning' | 'error';
export type ReviewQueueGroupBy = 'source' | 'pack' | 'type' | 'status';

export interface ReviewChecklistEntry {
  id: string;
  label: string;
  severity: ReviewChecklistSeverity;
  message: string;
  details?: string;
  suggestedAction?: 'map' | 'details' | 'source' | 'ignore';
}

export interface ReviewQueueItem {
  item: StoredCompendiumItem;
  source?: RuleSource;
  pack?: StoredCompendiumPack;
  checklist: ReviewChecklistEntry[];
  blockingCount: number;
  warningCount: number;
  passedCount: number;
  completionPercent: number;
  canApprove: boolean;
}

export interface ReviewQueueGroup {
  id: string;
  title: string;
  subtitle: string;
  items: ReviewQueueItem[];
  blockingCount: number;
  warningCount: number;
  approvableCount: number;
}

export interface ReviewQueueSummary {
  totalItems: number;
  blockingItems: number;
  warningItems: number;
  approvableItems: number;
  needsReviewItems: number;
  draftItems: number;
  disabledItems: number;
  validatedItems: number;
}

export interface ReviewQueueFilters {
  query?: string;
  groupBy?: ReviewQueueGroupBy;
  types?: CompendiumItemType[];
  sourceIds?: string[];
  packIds?: string[];
  statuses?: StoredCompendiumItemStatus[];
  onlyEnabledSources?: boolean;
  enabledSourceIds?: string[];
}

export interface BuildReviewQueueInput {
  items: StoredCompendiumItem[];
  sources: RuleSource[];
  packs: StoredCompendiumPack[];
  filters?: ReviewQueueFilters;
}

export interface ReviewQueueResult {
  items: ReviewQueueItem[];
  groups: ReviewQueueGroup[];
  summary: ReviewQueueSummary;
}

const reviewDefaultStatuses: StoredCompendiumItemStatus[] = ['needsReview', 'draft'];

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
};

const getPath = (value: unknown, path: string): unknown => {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, value);
};

const entry = (
  id: string,
  label: string,
  severity: ReviewChecklistSeverity,
  message: string,
  details?: string,
  suggestedAction?: ReviewChecklistEntry['suggestedAction']
): ReviewChecklistEntry => ({ id, label, severity, message, details, suggestedAction });

const pass = (id: string, label: string, message: string, details?: string): ReviewChecklistEntry => entry(id, label, 'pass', message, details);
const warning = (id: string, label: string, message: string, details?: string, suggestedAction?: ReviewChecklistEntry['suggestedAction']): ReviewChecklistEntry => entry(id, label, 'warning', message, details, suggestedAction);
const error = (id: string, label: string, message: string, details?: string, suggestedAction?: ReviewChecklistEntry['suggestedAction']): ReviewChecklistEntry => entry(id, label, 'error', message, details, suggestedAction);

const hasAny = (normalized: Record<string, unknown>, keys: string[]): boolean => keys.some((key) => hasValue(getPath(normalized, key)));

const checkCommonMetadata = (item: StoredCompendiumItem, source?: RuleSource): ReviewChecklistEntry[] => {
  const rawSource = item.rawJson.source;
  const effectiveSource = source ?? rawSource;
  const normalized = isRecord(item.normalizedJson) ? item.normalizedJson : {};
  const rawPayload = isRecord(item.rawJson.payload) ? item.rawJson.payload : {};
  const rows: ReviewChecklistEntry[] = [];

  rows.push(
    effectiveSource.book || effectiveSource.notes
      ? pass('source-metadata', 'Origem documentada', `Fonte com ${effectiveSource.book ? 'livro' : 'nota'} informado.`)
      : warning('source-metadata', 'Origem incompleta', 'Informe livro ou nota de origem antes de confiar na regra.', undefined, 'details')
  );

  rows.push(
    effectiveSource.confidence === 'exact'
      ? pass('source-confidence', 'Confiança da fonte', 'Fonte marcada como exact.')
      : warning('source-confidence', 'Confiança exige revisão', `Confiança atual: ${effectiveSource.confidence}.`, undefined, 'details')
  );

  rows.push(
    effectiveSource.status === 'active'
      ? pass('source-status', 'Fonte ativa', 'A fonte está ativa.')
      : effectiveSource.status === 'disabled'
        ? error('source-status', 'Fonte desativada', 'Ative ou substitua a fonte antes de aprovar o item.', undefined, 'source')
        : warning('source-status', 'Fonte precisa de revisão', 'A fonte está marcada como needsReview.', undefined, 'source')
  );

  rows.push(
    hasValue(rawPayload)
      ? pass('raw-payload', 'Payload bruto preservado', 'O conteúdo original importado foi preservado.')
      : warning('raw-payload', 'Payload bruto vazio', 'O item existe, mas não há payload bruto útil para auditar.', undefined, 'details')
  );

  rows.push(
    hasValue(normalized.id) && hasValue(normalized.name) && hasValue(normalized.type)
      ? pass('normalized-identity', 'Identidade normalizada', 'id, name e type estão presentes no normalizedJson.')
      : error('normalized-identity', 'Identidade normalizada incompleta', 'normalizedJson precisa conter id, name e type.', undefined, 'map')
  );

  return rows;
};

const checkRequiredMappingFields = (item: StoredCompendiumItem, normalized: Record<string, unknown>): ReviewChecklistEntry[] => {
  const definition = mappingDefinitions[item.type];
  if (!definition) return [];
  return definition.fields
    .filter((field) => field.required)
    .map((field) =>
      hasValue(normalized[field.key])
        ? pass(`required-${field.key}`, field.label, 'Campo obrigatório preenchido.')
        : error(`required-${field.key}`, field.label, `Campo obrigatório ausente para ${definition.title}.`, undefined, 'map')
    );
};

const checkTypeSpecificFields = (item: StoredCompendiumItem, normalized: Record<string, unknown>): ReviewChecklistEntry[] => {
  switch (item.type) {
    case 'weapon':
      return [
        hasAny(normalized, ['damageFormula', 'damageComponents'])
          ? pass('weapon-damage', 'Dano da arma', 'A arma possui fórmula ou componentes de dano.')
          : error('weapon-damage', 'Dano da arma ausente', 'Mapeie damageFormula ou damageComponents antes de aprovar.', undefined, 'map'),
        hasAny(normalized, ['attackAbility', 'damageAbility'])
          ? pass('weapon-ability', 'Atributo mecânico', 'A arma possui atributo de ataque ou dano.')
          : warning('weapon-ability', 'Atributo não definido', 'Informe attackAbility/damageAbility para automatizar bônus de ataque e dano.', undefined, 'map'),
        hasValue(normalized.actionCost)
          ? pass('weapon-action-cost', 'Economia de ação', `Custo: ${String(normalized.actionCost)}.`)
          : warning('weapon-action-cost', 'Custo de ação ausente', 'Sem actionCost, a engine pode tratar a ação como padrão/manual.', undefined, 'map')
      ];

    case 'spell': {
      const level = normalized.level;
      const hasValidLevel = typeof level === 'number' && level >= 0 && level <= 9;
      return [
        hasValidLevel
          ? pass('spell-level', 'Nível da magia', `Nível ${level}.`)
          : error('spell-level', 'Nível da magia inválido', 'Informe level entre 0 e 9.', undefined, 'map'),
        hasValue(normalized.castingTime) || hasValue(normalized.actionCost)
          ? pass('spell-casting-time', 'Tempo de conjuração', 'Tempo/custo de ação preenchido.')
          : warning('spell-casting-time', 'Tempo de conjuração ausente', 'Informe castingTime/actionCost para validar rotações.', undefined, 'map'),
        hasAny(normalized, ['damageFormula', 'damageComponents', 'saveAbility', 'effectTemplates'])
          ? pass('spell-mechanics', 'Mecânica calculável', 'Há dano, save ou efeito ativo derivado.')
          : warning('spell-mechanics', 'Mecânica não mapeada', 'Sem dano/save/efeito, a magia poderá ser cadastrada mas não contribuirá para cálculo de combate.', undefined, 'map'),
        normalized.scalingKind && normalized.scalingKind !== 'none' && !hasValue(normalized.scaling)
          ? warning('spell-scaling', 'Scaling exige revisão', 'ScalingKind foi informado, mas scaling normalizado ainda não foi gerado.', undefined, 'map')
          : pass('spell-scaling', 'Scaling', normalized.scalingKind ? `Scaling: ${String(normalized.scalingKind)}.` : 'Sem scaling declarado.')
      ];
    }

    case 'feature':
      return [
        hasAny(normalized, ['summary', 'grantsActions', 'damageFormula', 'damageComponents', 'effectTemplates', 'resource', 'resourcePool'])
          ? pass('feature-mechanics', 'Feature mapeada', 'A feature possui resumo, ação, dano, efeito ou recurso.')
          : warning('feature-mechanics', 'Feature sem mecânica', 'Mapeie ao menos resumo mecânico, ação, dano, efeito ou recurso.', undefined, 'map'),
        hasAny(normalized, ['damageFormula', 'damageComponents']) && !hasValue(normalized.sourceType)
          ? warning('feature-source-type', 'Tipo de fonte de dano', 'Feature com dano deveria declarar sourceType.', undefined, 'map')
          : pass('feature-source-type', 'Tipo de fonte', 'sourceType ausente não bloqueia esta feature.')
      ];

    case 'armor':
      return [
        typeof normalized.baseAC === 'number'
          ? pass('armor-base-ac', 'CA base', `CA base ${normalized.baseAC}.`)
          : error('armor-base-ac', 'CA base ausente', 'Informe baseAC para usar a armadura em cálculo automático.', undefined, 'map')
      ];

    case 'class':
      return [
        typeof normalized.level === 'number' && normalized.level > 0
          ? pass('class-level', 'Nível da classe', `Nível ${normalized.level}.`)
          : error('class-level', 'Nível da classe ausente', 'Informe level para validar multiclass/progressão.', undefined, 'map'),
        typeof normalized.hitDie === 'number'
          ? pass('class-hit-die', 'Dado de vida', `d${normalized.hitDie}.`)
          : warning('class-hit-die', 'Dado de vida ausente', 'Sem hitDie, PV/progressão podem exigir entrada manual.', undefined, 'map')
      ];

    case 'subclass':
      return [
        hasValue(normalized.classId)
          ? pass('subclass-class-id', 'Classe base', `Classe base: ${String(normalized.classId)}.`)
          : warning('subclass-class-id', 'Classe base ausente', 'Informe classId para evitar associação manual da subclasse.', undefined, 'map')
      ];

    case 'species':
    case 'background':
    case 'feat':
    case 'condition':
      return [
        hasValue(normalized.summary) || hasValue(item.summary)
          ? pass(`${item.type}-summary`, 'Resumo mecânico', 'Resumo presente.')
          : warning(`${item.type}-summary`, 'Resumo ausente', 'Adicione um resumo mecânico curto para facilitar revisão futura.', undefined, 'map')
      ];

    case 'magicItem':
      return [
        hasAny(normalized, ['summary', 'effectTemplates', 'quantity', 'attunement']) || hasValue(item.summary)
          ? pass('magic-item-mapping', 'Item mágico mapeado', 'Há ao menos metadados/resumo/efeito/quantidade.')
          : warning('magic-item-mapping', 'Item mágico pouco mapeado', 'Adicione resumo, efeito ou quantidade quando relevante.', undefined, 'map')
      ];

    case 'equipment':
      return [
        hasValue(normalized.quantity)
          ? pass('equipment-quantity', 'Quantidade', `Quantidade ${String(normalized.quantity)}.`)
          : warning('equipment-quantity', 'Quantidade ausente', 'Sem quantidade, o item será aplicado como unidade padrão/manual.', undefined, 'map')
      ];

    default:
      return [];
  }
};

export const buildReviewChecklistForItem = (item: StoredCompendiumItem, source?: RuleSource): ReviewChecklistEntry[] => {
  const normalized = isRecord(item.normalizedJson) ? item.normalizedJson : {};
  return [...checkCommonMetadata(item, source), ...checkRequiredMappingFields(item, normalized), ...checkTypeSpecificFields(item, normalized)];
};

const createReviewQueueItem = (item: StoredCompendiumItem, source?: RuleSource, pack?: StoredCompendiumPack): ReviewQueueItem => {
  const checklist = buildReviewChecklistForItem(item, source);
  const blockingCount = checklist.filter((row) => row.severity === 'error').length;
  const warningCount = checklist.filter((row) => row.severity === 'warning').length;
  const passedCount = checklist.filter((row) => row.severity === 'pass').length;
  const completionPercent = checklist.length ? Math.round((passedCount / checklist.length) * 100) : 100;
  const canApprove = blockingCount === 0 && item.status !== 'disabled';
  return { item, source, pack, checklist, blockingCount, warningCount, passedCount, completionPercent, canApprove };
};

const normalizeQuery = (query?: string): string[] =>
  (query ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const matchesQuery = (row: ReviewQueueItem, terms: string[]): boolean => {
  if (!terms.length) return true;
  const haystack = [
    row.item.name,
    row.item.summary ?? '',
    row.item.type,
    row.item.status,
    row.item.reviewNotes ?? '',
    row.source?.book ?? '',
    row.source?.notes ?? '',
    row.pack?.name ?? '',
    JSON.stringify(row.item.normalizedJson ?? {})
  ]
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
};

const groupIdForRow = (row: ReviewQueueItem, groupBy: ReviewQueueGroupBy): string => {
  if (groupBy === 'source') return row.item.sourceId;
  if (groupBy === 'pack') return row.item.packId;
  if (groupBy === 'type') return row.item.type;
  return row.item.status;
};

const groupTitleForRow = (row: ReviewQueueItem, groupBy: ReviewQueueGroupBy): string => {
  if (groupBy === 'source') return row.source?.book ?? row.item.sourceId;
  if (groupBy === 'pack') return row.pack?.name ?? row.item.packId;
  if (groupBy === 'type') return row.item.type;
  return row.item.status;
};

const groupSubtitleForRow = (row: ReviewQueueItem, groupBy: ReviewQueueGroupBy): string => {
  if (groupBy === 'source') return `${row.item.sourceId} · ${row.source?.confidence ?? row.item.rawJson.source.confidence}`;
  if (groupBy === 'pack') return `${row.pack?.itemCount ?? '?'} itens no pacote · fonte ${row.item.sourceId}`;
  if (groupBy === 'type') return 'Agrupado por tipo de conteúdo';
  return 'Agrupado por status de revisão';
};

const createSummary = (items: ReviewQueueItem[], allItems: StoredCompendiumItem[]): ReviewQueueSummary => ({
  totalItems: items.length,
  blockingItems: items.filter((row) => row.blockingCount > 0).length,
  warningItems: items.filter((row) => row.warningCount > 0).length,
  approvableItems: items.filter((row) => row.canApprove).length,
  needsReviewItems: allItems.filter((item) => item.status === 'needsReview').length,
  draftItems: allItems.filter((item) => item.status === 'draft').length,
  disabledItems: allItems.filter((item) => item.status === 'disabled').length,
  validatedItems: allItems.filter((item) => item.status === 'validated').length
});

export const buildReviewQueue = ({ items, sources, packs, filters = {} }: BuildReviewQueueInput): ReviewQueueResult => {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const packMap = new Map(packs.map((pack) => [pack.id, pack]));
  const terms = normalizeQuery(filters.query);
  const statusSet = new Set(filters.statuses?.length ? filters.statuses : reviewDefaultStatuses);
  const typeSet = filters.types?.length ? new Set(filters.types) : undefined;
  const sourceSet = filters.sourceIds?.length ? new Set(filters.sourceIds) : undefined;
  const packSet = filters.packIds?.length ? new Set(filters.packIds) : undefined;
  const enabledSet = new Set(filters.enabledSourceIds ?? []);
  const groupBy = filters.groupBy ?? 'pack';

  const reviewItems = items
    .filter((item) => statusSet.has(item.status))
    .filter((item) => (typeSet ? typeSet.has(item.type) : true))
    .filter((item) => (sourceSet ? sourceSet.has(item.sourceId) : true))
    .filter((item) => (packSet ? packSet.has(item.packId) : true))
    .filter((item) => (filters.onlyEnabledSources ? enabledSet.has(item.sourceId) : true))
    .map((item) => createReviewQueueItem(item, sourceMap.get(item.sourceId), packMap.get(item.packId)))
    .filter((row) => matchesQuery(row, terms))
    .sort((left, right) => {
      if (left.blockingCount !== right.blockingCount) return right.blockingCount - left.blockingCount;
      if (left.warningCount !== right.warningCount) return right.warningCount - left.warningCount;
      return left.item.name.localeCompare(right.item.name);
    });

  const groupsById = new Map<string, ReviewQueueGroup>();
  for (const row of reviewItems) {
    const id = groupIdForRow(row, groupBy);
    const current = groupsById.get(id);
    if (current) {
      current.items.push(row);
      current.blockingCount += row.blockingCount;
      current.warningCount += row.warningCount;
      current.approvableCount += row.canApprove ? 1 : 0;
    } else {
      groupsById.set(id, {
        id,
        title: groupTitleForRow(row, groupBy),
        subtitle: groupSubtitleForRow(row, groupBy),
        items: [row],
        blockingCount: row.blockingCount,
        warningCount: row.warningCount,
        approvableCount: row.canApprove ? 1 : 0
      });
    }
  }

  const groups = Array.from(groupsById.values()).sort((left, right) => {
    if (left.blockingCount !== right.blockingCount) return right.blockingCount - left.blockingCount;
    return left.title.localeCompare(right.title);
  });

  return { items: reviewItems, groups, summary: createSummary(reviewItems, items) };
};

export const createReviewApprovalNotes = (row: ReviewQueueItem, manualNotes?: string): string => {
  const base = `Aprovado via fila guiada: ${row.passedCount}/${row.checklist.length} critérios OK, ${row.warningCount} aviso(s), ${row.blockingCount} bloqueio(s).`;
  const warnings = row.checklist
    .filter((entry) => entry.severity === 'warning')
    .map((entry) => entry.label)
    .slice(0, 6);
  return [base, warnings.length ? `Avisos mantidos: ${warnings.join(', ')}.` : undefined, manualNotes?.trim() || undefined].filter(Boolean).join('\n');
};

export const reviewQueueToIssues = (row: ReviewQueueItem): RuleValidationIssue[] =>
  row.checklist
    .filter((entry) => entry.severity !== 'pass')
    .map((entry) => ({
      severity: entry.severity === 'error' ? 'error' : 'warning',
      code: `REVIEW_${entry.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
      message: entry.message,
      source: row.source
    }));
