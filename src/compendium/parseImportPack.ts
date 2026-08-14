import { ZodError } from 'zod';
import type { RuleValidationIssue } from '../types';
import { compendiumImportSchema } from './schemas';
import { compendiumImportV2Schema, type CompendiumImportV2Input } from './importV2Schemas';
import { analyzeCompendiumImportV2Semantics, type ImportSemanticValidationResult } from './importSemanticValidation';
import { detectCompendiumImportVersion, type DetectedCompendiumImportVersion } from './importVersion';
import { migrateImportV1ToV2 } from './importV1Migration';
import { normalizeCompendiumImportPack, type ImportNormalizationIssue } from './importNormalization';
import { IMPORT_TEMPLATE_VERSION_V2, LEGACY_IMPORT_TEMPLATE_VERSION_V1 } from './importVersions';

export interface ParseImportPackOptions {
  /** Preview can defer semantic validation until existing-catalog references are available. */
  validateSemantics?: boolean;
}

export interface ParseImportPackResult {
  ok: boolean;
  detectedVersion: DetectedCompendiumImportVersion;
  data?: CompendiumImportV2Input;
  issues: RuleValidationIssue[];
  normalizationIssues: ImportNormalizationIssue[];
  semanticValidation?: ImportSemanticValidationResult;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const zodIssues = (error: ZodError, code: string): RuleValidationIssue[] => error.issues.map((entry) => ({
  severity: 'error',
  code,
  message: `${entry.path.join('.') || 'root'}: ${entry.message}`
}));

const normalizeIssuesForRuntime = (issues: ImportNormalizationIssue[]): RuleValidationIssue[] => issues.map((entry) => ({
  severity: entry.severity,
  code: entry.code,
  message: entry.path ? `${entry.path}: ${entry.message}` : entry.message
}));

const parseJson = (input: string | unknown): { value?: unknown; issues: RuleValidationIssue[] } => {
  if (typeof input !== 'string') return { value: input, issues: [] };
  try {
    return { value: JSON.parse(input) as unknown, issues: [] };
  } catch {
    return { issues: [{ severity: 'error', code: 'IMPORT_JSON_ERROR', message: 'JSON inválido.' }] };
  }
};

/**
 * Version-aware canonical import boundary.
 *
 * After this function succeeds, callers receive the same V2 structure whether
 * the file started as V1, unversioned legacy, or V2. Persistence deliberately
 * remains outside this function; preview/diff is layered on top before persistence.
 */
export const parseImportPack = (input: string | unknown, options: ParseImportPackOptions = {}): ParseImportPackResult => {
  const json = parseJson(input);
  if (json.value === undefined) {
    return { ok: false, detectedVersion: 'unknown', issues: json.issues, normalizationIssues: [] };
  }

  const detectedVersion = detectCompendiumImportVersion(json.value);
  const originalEnvelope = asRecord(json.value);
  if (detectedVersion === 'unknown') {
    return {
      ok: false,
      detectedVersion,
      issues: [{ severity: 'error', code: 'IMPORT_VERSION_UNSUPPORTED', message: 'Versão de importação desconhecida ou envelope inválido.' }],
      normalizationIssues: []
    };
  }

  let normalizedValue: unknown;
  let normalizationIssues: ImportNormalizationIssue[] = [];

  if (detectedVersion === LEGACY_IMPORT_TEMPLATE_VERSION_V1 || detectedVersion === 'legacy-unversioned') {
    const legacy = compendiumImportSchema.safeParse(json.value);
    if (!legacy.success) {
      return {
        ok: false,
        detectedVersion,
        issues: zodIssues(legacy.error, 'IMPORT_V1_SCHEMA_ERROR'),
        normalizationIssues: []
      };
    }
    const migrated = migrateImportV1ToV2(legacy.data, {
      originalEnvelope,
      detectedLegacyVersion: detectedVersion
    });
    normalizedValue = migrated.value;
    normalizationIssues = migrated.issues;
  } else if (detectedVersion === IMPORT_TEMPLATE_VERSION_V2) {
    const normalized = normalizeCompendiumImportPack(json.value);
    normalizedValue = normalized.value;
    normalizationIssues = normalized.issues;
  }

  if (!normalizedValue) {
    const runtimeNormalizationIssues = normalizeIssuesForRuntime(normalizationIssues);
    return {
      ok: false,
      detectedVersion,
      issues: runtimeNormalizationIssues.length
        ? runtimeNormalizationIssues
        : [{ severity: 'error', code: 'IMPORT_NORMALIZATION_FAILED', message: 'Falha ao normalizar o pacote para V2.' }],
      normalizationIssues
    };
  }

  const parsedV2 = compendiumImportV2Schema.safeParse(normalizedValue);
  if (!parsedV2.success) {
    return {
      ok: false,
      detectedVersion,
      issues: [...normalizeIssuesForRuntime(normalizationIssues), ...zodIssues(parsedV2.error, 'IMPORT_V2_SCHEMA_ERROR')],
      normalizationIssues
    };
  }

  const normalizationRuntimeIssues = normalizeIssuesForRuntime(normalizationIssues);
  if (options.validateSemantics === false) {
    return {
      ok: normalizationRuntimeIssues.every((entry) => entry.severity !== 'error'),
      detectedVersion,
      data: parsedV2.data,
      issues: normalizationRuntimeIssues,
      normalizationIssues
    };
  }

  const semanticValidation = analyzeCompendiumImportV2Semantics(parsedV2.data);
  const issues = [...normalizationRuntimeIssues, ...semanticValidation.issues];
  return {
    ok: issues.every((entry) => entry.severity !== 'error'),
    detectedVersion,
    data: parsedV2.data,
    issues,
    normalizationIssues,
    semanticValidation
  };
};
