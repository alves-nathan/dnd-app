import { parseImportPack, type ParseImportPackResult } from './parseImportPack';
import { parseAndPreviewImportPack } from './parseImportPreview';
import { isV3StagingJson } from './importVersion';
import type { ExistingCompendiumPreviewItem } from './importPreview';
import { buildSemiStructuredImportDraft, summarizeSemiStructuredDraft, type SemiStructuredImportDraft, type SemiStructuredImportOptions } from './semiStructuredImport';
import type { CompendiumItemType } from './types';
import type { RuleValidationIssue } from '../types';

export type LocalImportFileKind = 'json' | 'markdown' | 'text' | 'unknown';

export interface LocalImportFileDescriptor {
  name: string;
  mimeType?: string;
  size?: number;
}

export interface LocalCompendiumFileParseOptions {
  packId?: string;
  defaultKind?: CompendiumItemType | 'auto';
  source: SemiStructuredImportOptions['source'];
  maxCandidates?: number;
  forceKind?: LocalImportFileKind | 'auto';
  /** Installed catalog context used to validate incremental V2 references. */
  existingItems?: ExistingCompendiumPreviewItem[];
}

export interface LocalCompendiumFileParseResult {
  ok: boolean;
  kind: LocalImportFileKind;
  fileName: string;
  fileExtension?: string;
  fileSize?: number;
  mimeType?: string;
  generatedJson: string;
  preview: Pick<ParseImportPackResult, 'ok' | 'data' | 'issues'>;
  semiStructuredDraft?: SemiStructuredImportDraft;
  issues: RuleValidationIssue[];
  summary: string;
  detectedItemCount: number;
}

const jsonMimeTypes = new Set(['application/json', 'text/json', 'application/vnd.dnd-combat-import+json']);
const markdownMimeTypes = new Set(['text/markdown', 'text/x-markdown', 'text/md']);
const textMimeTypes = new Set(['text/plain', 'text/csv', 'application/octet-stream']);

export const getFileExtension = (fileName: string): string | undefined => {
  const normalizedName = fileName.trim().toLowerCase();
  const index = normalizedName.lastIndexOf('.');
  if (index < 0 || index === normalizedName.length - 1) return undefined;
  return normalizedName.slice(index + 1);
};

export const inferLocalImportFileKind = (file: LocalImportFileDescriptor, text?: string): LocalImportFileKind => {
  const extension = getFileExtension(file.name);
  const mimeType = file.mimeType?.toLowerCase();

  if (extension === 'json' || (mimeType && jsonMimeTypes.has(mimeType))) return 'json';
  if (extension === 'md' || extension === 'markdown' || (mimeType && markdownMimeTypes.has(mimeType))) return 'markdown';
  if (extension === 'txt' || extension === 'csv' || (mimeType && textMimeTypes.has(mimeType))) return 'text';

  const trimmed = text?.trim();
  if (trimmed?.startsWith('{') || trimmed?.startsWith('[')) return 'json';
  if (/^#{1,6}\s+\S/m.test(trimmed ?? '')) return 'markdown';
  return 'unknown';
};

const issue = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({ severity, code, message });

const parseVersionAwarePreview = (
  text: string,
  existingItems?: ExistingCompendiumPreviewItem[]
): Pick<ParseImportPackResult, 'ok' | 'data' | 'issues'> => {
  if (!existingItems?.length) return parseImportPack(text);
  const result = parseAndPreviewImportPack(text, existingItems);
  return {
    ok: result.parse.ok && Boolean(result.preview?.valid),
    data: result.parse.data,
    issues: result.preview?.issues ?? result.parse.issues
  };
};

const buildJsonParseResult = (file: LocalImportFileDescriptor, text: string, kind: LocalImportFileKind, existingItems?: ExistingCompendiumPreviewItem[]): LocalCompendiumFileParseResult => {
  const preview = parseVersionAwarePreview(text, existingItems);
  return {
    ok: preview.ok,
    kind,
    fileName: file.name,
    fileExtension: getFileExtension(file.name),
    fileSize: file.size,
    mimeType: file.mimeType,
    generatedJson: text,
    preview,
    issues: preview.issues,
    summary: preview.data ? `${preview.data.items.length} item(ns) detectado(s) em JSON estruturado.` : 'Arquivo JSON inválido ou fora do schema de importação.',
    detectedItemCount: preview.data?.items.length ?? 0
  };
};

const buildSemiStructuredParseResult = (
  file: LocalImportFileDescriptor,
  text: string,
  options: LocalCompendiumFileParseOptions,
  kind: LocalImportFileKind
): LocalCompendiumFileParseResult => {
  const draft = buildSemiStructuredImportDraft(text, {
    packId: options.packId,
    defaultKind: options.defaultKind ?? 'auto',
    source: options.source,
    maxCandidates: options.maxCandidates ?? 100
  });
  const preview = parseVersionAwarePreview(draft.generatedJson, options.existingItems);
  const issues = [
    issue('warning', 'LOCAL_FILE_SEMI_STRUCTURED_REVIEW_REQUIRED', 'Arquivo Markdown/texto convertido para JSON de rascunho. Revise e valide manualmente cada item antes de usar na engine.'),
    ...draft.issues,
    ...preview.issues
  ];

  return {
    ok: draft.ok && preview.ok,
    kind,
    fileName: file.name,
    fileExtension: getFileExtension(file.name),
    fileSize: file.size,
    mimeType: file.mimeType,
    generatedJson: draft.generatedJson,
    preview,
    semiStructuredDraft: draft,
    issues,
    summary: summarizeSemiStructuredDraft(draft) || `${draft.candidates.length} candidato(s) detectado(s).`,
    detectedItemCount: draft.candidates.length
  };
};

export const parseLocalCompendiumFileContent = (
  file: LocalImportFileDescriptor,
  text: string,
  options: LocalCompendiumFileParseOptions
): LocalCompendiumFileParseResult => {
  // Structured V3 cannot fall through into text/Markdown conversion even
  // when its extension or a user-selected forced kind says otherwise.
  if (isV3StagingJson(text)) {
    const issues = [issue('error', 'IMPORT_V3_STAGING_ONLY', 'Import V3 aceita somente prévia isolada, sem persistência.')];
    return {
      ok: false, kind: 'json', fileName: file.name, fileExtension: getFileExtension(file.name),
      fileSize: file.size, mimeType: file.mimeType, generatedJson: '',
      preview: { ok: false, issues }, issues, summary: 'Import V3 reservado à prévia isolada.', detectedItemCount: 0
    };
  }
  const forcedKind = options.forceKind && options.forceKind !== 'auto' ? options.forceKind : undefined;
  const inferredKind = forcedKind ?? inferLocalImportFileKind(file, text);
  const trimmed = text.trim();

  if (!trimmed) {
    const emptyPreview: Pick<ParseImportPackResult, 'ok' | 'data' | 'issues'> = { ok: false, issues: [issue('error', 'LOCAL_FILE_EMPTY', 'O arquivo selecionado está vazio.')] };
    return {
      ok: false,
      kind: inferredKind,
      fileName: file.name,
      fileExtension: getFileExtension(file.name),
      fileSize: file.size,
      mimeType: file.mimeType,
      generatedJson: '',
      preview: emptyPreview,
      issues: emptyPreview.issues,
      summary: 'Arquivo vazio.',
      detectedItemCount: 0
    };
  }

  if (inferredKind === 'json') {
    return buildJsonParseResult(file, text, inferredKind, options.existingItems);
  }

  if (inferredKind === 'markdown' || inferredKind === 'text') {
    return buildSemiStructuredParseResult(file, text, options, inferredKind);
  }

  const jsonAttempt = buildJsonParseResult(file, text, 'json', options.existingItems);
  if (jsonAttempt.ok) return jsonAttempt;
  return buildSemiStructuredParseResult(file, text, options, 'unknown');
};
