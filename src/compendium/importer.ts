import { ZodError } from 'zod';
import { CompendiumImportInput, CompendiumItemInput, compendiumImportSchema } from './schemas';
import { RuleValidationIssue } from '../types';
import { createId } from '../utils/id';
import { CompendiumImportBuildOptions, PersistedCompendiumImport, StoredCompendiumItem, StoredCompendiumItemStatus } from './types';

export interface ImportPreview {
  ok: boolean;
  data?: CompendiumImportInput;
  issues: RuleValidationIssue[];
}

const requiresReview = (item: CompendiumItemInput): boolean => {
  if (item.source.status !== 'active') return true;
  if (item.source.confidence !== 'exact') return true;
  return false;
};

const statusForItem = (item: CompendiumItemInput): StoredCompendiumItemStatus => {
  if (item.source.status === 'disabled') return 'disabled';
  if (requiresReview(item)) return 'needsReview';
  return 'validated';
};

const reviewDecisionForStatus = (status: StoredCompendiumItemStatus) => {
  if (status === 'validated') return 'approved' as const;
  if (status === 'disabled') return 'rejected' as const;
  return 'pending' as const;
};

const collectImportIssues = (data: CompendiumImportInput): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  const seenItemIds = new Set<string>();

  if (data.source.confidence !== 'exact') {
    issues.push({
      severity: 'warning',
      code: 'SOURCE_NEEDS_REVIEW',
      message: `Fonte "${data.source.id}" importada com confiança ${data.source.confidence}. Revise antes de usar em cálculo automático.`,
      source: data.source
    });
  }

  if (!data.source.book && !data.source.notes) {
    issues.push({
      severity: 'warning',
      code: 'SOURCE_METADATA_INCOMPLETE',
      message: `Fonte "${data.source.id}" não possui livro ou nota de origem.`,
      source: data.source
    });
  }

  for (const item of data.items) {
    if (seenItemIds.has(item.id)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATED_IMPORT_ITEM_ID',
        message: `O item "${item.id}" aparece mais de uma vez no mesmo pacote.`,
        source: item.source
      });
    }
    seenItemIds.add(item.id);

    if (item.source.confidence !== 'exact') {
      issues.push({
        severity: 'warning',
        code: 'IMPORTED_ITEM_NEEDS_REVIEW',
        message: `Item "${item.name}" importado com confiança ${item.source.confidence}. Revise antes de usar.`,
        source: item.source
      });
    }
    if (!item.source.book && !item.source.notes) {
      issues.push({
        severity: 'warning',
        code: 'SOURCE_METADATA_INCOMPLETE',
        message: `Item "${item.name}" não possui livro ou nota de origem.`,
        source: item.source
      });
    }
    if (!item.payload || Object.keys(item.payload).length === 0) {
      issues.push({
        severity: 'warning',
        code: 'EMPTY_PAYLOAD',
        message: `Item "${item.name}" não possui payload normalizável. Ele será salvo, mas não deve ser usado automaticamente pela engine.`,
        source: item.source
      });
    }
  }

  return issues;
};

export const validateCompendiumJson = (input: string): ImportPreview => {
  try {
    const parsed = JSON.parse(input) as unknown;
    const data = compendiumImportSchema.parse(parsed);
    const issues = collectImportIssues(data);

    return { ok: issues.every((issue) => issue.severity !== 'error'), data, issues };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        issues: error.issues.map((issue) => ({
          severity: 'error',
          code: 'IMPORT_SCHEMA_ERROR',
          message: `${issue.path.join('.')}: ${issue.message}`
        }))
      };
    }
    return { ok: false, issues: [{ severity: 'error', code: 'IMPORT_JSON_ERROR', message: 'JSON inválido.' }] };
  }
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
};

export const createCompendiumChecksum = (payload: unknown): string => {
  const text = stableStringify(payload);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return `cmp_${(hash >>> 0).toString(16)}`;
};

const normalizeItemPayload = (item: CompendiumItemInput): Record<string, unknown> => ({
  ...item.payload,
  id: item.id,
  name: item.name,
  type: item.kind,
  sourceId: item.source.id,
  sourceStatus: item.source.status,
  sourceConfidence: item.source.confidence,
  requiresReview: requiresReview(item)
});

const tagsForItem = (item: CompendiumItemInput): string[] => {
  const tagSet = new Set<string>([item.kind, item.name.toLowerCase()]);
  if (item.source.book) tagSet.add(item.source.book.toLowerCase());
  if (item.summary) {
    item.summary
      .toLowerCase()
      .split(/[^a-z0-9À-ÿ]+/i)
      .filter((token) => token.length > 2)
      .slice(0, 20)
      .forEach((token) => tagSet.add(token));
  }
  return Array.from(tagSet);
};

export const buildPersistedCompendiumImport = (
  data: CompendiumImportInput,
  options: CompendiumImportBuildOptions = {}
): PersistedCompendiumImport => {
  const importedAt = options.importedAt ?? new Date().toISOString();
  const schemaVersion = options.schemaVersion ?? '1.0.0';
  const checksum = createCompendiumChecksum(data);
  const packId = data.id || createId('pack');

  const items: StoredCompendiumItem[] = data.items.map((item) => {
    const now = importedAt;
    const status = statusForItem(item);
    return {
      id: `${packId}:${item.id}`,
      importItemId: item.id,
      packId,
      sourceId: item.source.id,
      type: item.kind,
      name: item.name,
      summary: item.summary,
      version: item.source.version,
      rawJson: item,
      normalizedJson: normalizeItemPayload(item),
      tags: tagsForItem(item),
      status,
      reviewDecision: reviewDecisionForStatus(status),
      reviewNotes: requiresReview(item) ? 'Item requer revisão manual antes de uso em cálculo automático.' : undefined,
      createdAt: now,
      updatedAt: now
    };
  });

  return {
    source: data.source,
    pack: {
      id: packId,
      name: data.source.book ?? data.id,
      sourceId: data.source.id,
      schemaVersion,
      checksum,
      importedAt,
      itemCount: items.length
    },
    items,
    issues: collectImportIssues(data)
  };
};

export const parseAndBuildPersistedImport = (input: string): ImportPreview & { persisted?: PersistedCompendiumImport } => {
  const preview = validateCompendiumJson(input);
  if (!preview.ok || !preview.data) return preview;
  return { ...preview, persisted: buildPersistedCompendiumImport(preview.data) };
};
