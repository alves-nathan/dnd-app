import { parseImportPack, type ParseImportPackResult } from './parseImportPack';
import {
  buildCompendiumImportV2Preview,
  type BuildImportPreviewOptions,
  type CompendiumImportV2Preview,
  type ExistingCompendiumPreviewItem,
  type ImportPreviewIssue
} from './importPreview';

export interface ParseAndPreviewImportPackResult {
  parse: ParseImportPackResult;
  preview?: CompendiumImportV2Preview;
}

const normalizationIssuesAsPreview = (parse: ParseImportPackResult): ImportPreviewIssue[] => parse.normalizationIssues.map((issue) => ({
  severity: issue.severity,
  code: issue.code,
  message: issue.message,
  path: issue.path
}));

/**
 * Version-aware parse + canonical preview with existing-catalog context.
 * Semantic validation is intentionally deferred from parseImportPack here so
 * incremental packs can resolve references against the installed catalog.
 */
export const parseAndPreviewImportPack = (
  input: string | unknown,
  existingItems: ExistingCompendiumPreviewItem[] = [],
  options: BuildImportPreviewOptions = {}
): ParseAndPreviewImportPackResult => {
  const parse = parseImportPack(input, { validateSemantics: false });
  if (!parse.ok || !parse.data) return { parse };

  const basePreview = buildCompendiumImportV2Preview(parse.data, existingItems, options);
  const normalizationIssues = normalizationIssuesAsPreview(parse);
  const issues = [...normalizationIssues, ...basePreview.issues];
  const errors = issues.filter((entry) => entry.severity === 'error');
  const warnings = issues.filter((entry) => entry.severity === 'warning');
  const infos = issues.filter((entry) => entry.severity === 'info');

  return {
    parse,
    preview: {
      ...basePreview,
      valid: basePreview.valid && errors.length === 0,
      issues,
      errors,
      warnings,
      infos
    }
  };
};

export const parseIssuesAsPreviewIssues = (parse: ParseImportPackResult): ImportPreviewIssue[] => parse.issues.map((issue) => ({
  severity: issue.severity,
  code: issue.code,
  message: issue.message
}));
