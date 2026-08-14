import type { CatalogConfigurationHistoryEntry } from '../catalog/catalogConfigurationHistory';
import type { PortableRestoreDataCheckpoint, PortableRestoreSession } from './portableRestoreSession';
import {
  PORTABLE_RESTORE_EVIDENCE_SCHEMA,
  PORTABLE_RESTORE_RECEIPT_SCHEMA,
  createPortableRestoreEvidenceBundle,
  portableRestoreEffectiveStateFingerprint,
  validatePortableRestoreEvidenceBundle,
  validatePortableRestoreIntegrityReceipt,
  type PortableRestoreEvidenceBundle,
  type PortableRestoreIntegrityReceipt
} from './portableRestoreVerification';

export const PORTABLE_RESTORE_EVIDENCE_RECORD_SCHEMA = 'dnd-portable-restore-evidence-record.v1' as const;
export const PORTABLE_RESTORE_EVIDENCE_ARCHIVE_SCHEMA = 'dnd-portable-restore-evidence-archive.v1' as const;
export const DEFAULT_PORTABLE_RESTORE_REVALIDATION_INTERVAL_HOURS = 24;
export const DEFAULT_PORTABLE_RESTORE_CHECKPOINT_RETENTION = 5;

export type PortableRestoreEvidenceSource = 'local' | 'imported';
export type PortableRestoreEvidenceValidationStatus = 'valid' | 'invalid';
export type PortableRestoreEvidenceComparisonStatus = 'current' | 'changed' | 'invalid' | 'unavailable';

export interface PortableRestoreEvidenceComparison {
  status: PortableRestoreEvidenceComparisonStatus;
  comparedAt: string;
  expectedFingerprint: string;
  currentFingerprint?: string;
  catalogHistoryEntryId?: string;
  catalogHistoryEntryPresent?: boolean;
  characterCountDelta?: number;
  remediationPlanCountDelta?: number;
  progressionDraftCountDelta?: number;
  messages: string[];
}

export interface PortableRestoreHistoricalEvidenceRecord {
  schemaVersion: typeof PORTABLE_RESTORE_EVIDENCE_RECORD_SCHEMA;
  recordId: string;
  source: PortableRestoreEvidenceSource;
  addedAt: string;
  importedAt?: string;
  sessionId: string;
  sourceName?: string;
  sourceChecksum?: string;
  closedAt?: string;
  localCheckpointAvailable: boolean;
  receipt: PortableRestoreIntegrityReceipt;
  evidence?: PortableRestoreEvidenceBundle;
  validationStatus: PortableRestoreEvidenceValidationStatus;
  validationMessages: string[];
  comparison?: PortableRestoreEvidenceComparison;
}

export interface PortableRestoreEvidenceArchive {
  schemaVersion: typeof PORTABLE_RESTORE_EVIDENCE_ARCHIVE_SCHEMA;
  exportedAt: string;
  records: PortableRestoreHistoricalEvidenceRecord[];
  checksum: string;
}

export interface PortableRestoreEvidenceImportResult {
  ok: boolean;
  records: PortableRestoreHistoricalEvidenceRecord[];
  issues: string[];
  ignoredDuplicateRecordIds: string[];
}

export interface PortableRestoreEvidenceCleanupPlan {
  recommendedCheckpointSessionIds: string[];
  invalidEvidenceRecordIds: string[];
  importedEvidenceRecordIds: string[];
  retainedCheckpointCount: number;
  evidenceRecordCount: number;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((output, key) => {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) output[key] = canonicalize(entry);
    return output;
  }, {});
};

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const fingerprint = (value: unknown): string => fnv1a32(JSON.stringify(canonicalize(value)));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const safeDate = (value: string | undefined): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

const evidenceRecordPayload = (
  record: Omit<PortableRestoreHistoricalEvidenceRecord, 'comparison'>
): Omit<PortableRestoreHistoricalEvidenceRecord, 'comparison'> => record;

const buildRecordId = (receipt: PortableRestoreIntegrityReceipt, source: PortableRestoreEvidenceSource): string =>
  `${source}-${receipt.receiptId}-${receipt.checksum}`;

export const createPortableRestoreHistoricalEvidenceRecord = (
  session: PortableRestoreSession,
  now: () => Date = () => new Date()
): PortableRestoreHistoricalEvidenceRecord | undefined => {
  const receipt = session.integrityReceipt;
  if (!receipt || !validatePortableRestoreIntegrityReceipt(receipt)) return undefined;
  const evidence = createPortableRestoreEvidenceBundle(session, now);
  if (!evidence || !validatePortableRestoreEvidenceBundle(evidence)) return undefined;
  return {
    schemaVersion: PORTABLE_RESTORE_EVIDENCE_RECORD_SCHEMA,
    recordId: buildRecordId(receipt, 'local'),
    source: 'local',
    addedAt: now().toISOString(),
    sessionId: session.id,
    sourceName: session.source.name,
    sourceChecksum: session.source.checksum,
    closedAt: session.closedAt ?? session.committedAt,
    localCheckpointAvailable: true,
    receipt: clone(receipt),
    evidence: clone(evidence),
    validationStatus: 'valid',
    validationMessages: []
  };
};

const normalizeImportedRecord = (
  receipt: PortableRestoreIntegrityReceipt,
  evidence: PortableRestoreEvidenceBundle | undefined,
  now: () => Date
): PortableRestoreHistoricalEvidenceRecord => {
  const validationMessages: string[] = [];
  if (!validatePortableRestoreIntegrityReceipt(receipt)) validationMessages.push('O checksum do recibo não corresponde ao conteúdo importado.');
  if (evidence && !validatePortableRestoreEvidenceBundle(evidence)) validationMessages.push('O checksum do pacote de evidências não corresponde ao conteúdo importado.');
  if (evidence && evidence.receipt.receiptId !== receipt.receiptId) validationMessages.push('O pacote e o recibo referenciam IDs diferentes.');
  if (evidence && evidence.sessionId !== receipt.sessionId) validationMessages.push('O pacote e o recibo referenciam sessões diferentes.');
  return {
    schemaVersion: PORTABLE_RESTORE_EVIDENCE_RECORD_SCHEMA,
    recordId: buildRecordId(receipt, 'imported'),
    source: 'imported',
    addedAt: now().toISOString(),
    importedAt: now().toISOString(),
    sessionId: receipt.sessionId,
    sourceName: evidence?.source.name ?? receipt.sourceName,
    sourceChecksum: evidence?.source.checksum ?? receipt.sourceChecksum,
    localCheckpointAvailable: false,
    receipt: clone(receipt),
    evidence: evidence ? clone(evidence) : undefined,
    validationStatus: validationMessages.length ? 'invalid' : 'valid',
    validationMessages
  };
};

const isReceipt = (value: unknown): value is PortableRestoreIntegrityReceipt =>
  Boolean(value && typeof value === 'object' && (value as { schemaVersion?: string }).schemaVersion === PORTABLE_RESTORE_RECEIPT_SCHEMA);

const isEvidence = (value: unknown): value is PortableRestoreEvidenceBundle =>
  Boolean(value && typeof value === 'object' && (value as { schemaVersion?: string }).schemaVersion === PORTABLE_RESTORE_EVIDENCE_SCHEMA);

const isArchive = (value: unknown): value is PortableRestoreEvidenceArchive =>
  Boolean(value && typeof value === 'object' && (value as { schemaVersion?: string }).schemaVersion === PORTABLE_RESTORE_EVIDENCE_ARCHIVE_SCHEMA);

export const validatePortableRestoreEvidenceArchive = (archive: PortableRestoreEvidenceArchive): boolean => {
  const { checksum, ...base } = archive;
  if (archive.schemaVersion !== PORTABLE_RESTORE_EVIDENCE_ARCHIVE_SCHEMA || checksum !== fingerprint(base)) return false;
  return archive.records.every((record) => {
    if (record.schemaVersion !== PORTABLE_RESTORE_EVIDENCE_RECORD_SCHEMA) return false;
    if (!validatePortableRestoreIntegrityReceipt(record.receipt)) return false;
    if (record.evidence && !validatePortableRestoreEvidenceBundle(record.evidence)) return false;
    return true;
  });
};

export const createPortableRestoreEvidenceArchive = (
  records: readonly PortableRestoreHistoricalEvidenceRecord[],
  now: () => Date = () => new Date()
): PortableRestoreEvidenceArchive => {
  const portableRecords = records
    .filter((record) => record.validationStatus === 'valid')
    .map(({ comparison: _comparison, ...record }) => clone(evidenceRecordPayload(record)))
    .sort((left, right) => left.addedAt.localeCompare(right.addedAt));
  const base: Omit<PortableRestoreEvidenceArchive, 'checksum'> = {
    schemaVersion: PORTABLE_RESTORE_EVIDENCE_ARCHIVE_SCHEMA,
    exportedAt: now().toISOString(),
    records: portableRecords
  };
  return { ...base, checksum: fingerprint(base) };
};

export const portableRestoreEvidenceArchiveToJson = (archive: PortableRestoreEvidenceArchive): string =>
  `${JSON.stringify(archive, null, 2)}\n`;

export const parsePortableRestoreEvidenceImport = (
  json: string,
  existingRecordIds: readonly string[] = [],
  now: () => Date = () => new Date()
): PortableRestoreEvidenceImportResult => {
  const issues: string[] = [];
  const ignoredDuplicateRecordIds: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, records: [], issues: ['O JSON de evidências não pôde ser interpretado.'], ignoredDuplicateRecordIds };
  }

  const imported: PortableRestoreHistoricalEvidenceRecord[] = [];
  if (isEvidence(parsed)) {
    imported.push(normalizeImportedRecord(parsed.receipt, parsed, now));
  } else if (isReceipt(parsed)) {
    imported.push(normalizeImportedRecord(parsed, undefined, now));
  } else if (isArchive(parsed)) {
    if (!validatePortableRestoreEvidenceArchive(parsed)) {
      return { ok: false, records: [], issues: ['O arquivo agregado de evidências está adulterado ou contém registros inválidos.'], ignoredDuplicateRecordIds };
    }
    parsed.records.forEach((record) => imported.push(normalizeImportedRecord(record.receipt, record.evidence, now)));
  } else {
    return {
      ok: false,
      records: [],
      issues: ['O JSON não é um recibo, pacote de evidências ou arquivo agregado reconhecido.'],
      ignoredDuplicateRecordIds
    };
  }

  const existing = new Set(existingRecordIds);
  const unique = new Map<string, PortableRestoreHistoricalEvidenceRecord>();
  imported.forEach((record) => {
    if (existing.has(record.recordId) || unique.has(record.recordId)) {
      ignoredDuplicateRecordIds.push(record.recordId);
      return;
    }
    unique.set(record.recordId, record);
  });
  const records = Array.from(unique.values());
  records.filter((record) => record.validationStatus === 'invalid').forEach((record) => {
    issues.push(...record.validationMessages.map((message) => `${record.sessionId}: ${message}`));
  });
  return {
    ok: records.length > 0 && records.every((record) => record.validationStatus === 'valid'),
    records,
    issues,
    ignoredDuplicateRecordIds
  };
};

export const comparePortableRestoreHistoricalEvidence = (
  record: PortableRestoreHistoricalEvidenceRecord,
  current: PortableRestoreDataCheckpoint,
  catalogHistory: readonly CatalogConfigurationHistoryEntry[],
  now: () => Date = () => new Date()
): PortableRestoreHistoricalEvidenceRecord => {
  const comparedAt = now().toISOString();
  if (record.validationStatus !== 'valid' || !validatePortableRestoreIntegrityReceipt(record.receipt)) {
    return {
      ...record,
      comparison: {
        status: 'invalid',
        comparedAt,
        expectedFingerprint: record.receipt.effectiveFingerprint,
        messages: ['O recibo não é íntegro e não pode ser comparado ao estado atual.']
      }
    };
  }
  const currentFingerprint = portableRestoreEffectiveStateFingerprint(current);
  const catalogHistoryEntryPresent = record.receipt.catalogHistoryEntryId
    ? catalogHistory.some((entry) => entry.id === record.receipt.catalogHistoryEntryId)
    : undefined;
  const messages: string[] = [];
  if (currentFingerprint !== record.receipt.effectiveFingerprint) {
    messages.push('O estado local foi alterado depois da emissão deste recibo.');
  }
  if (catalogHistoryEntryPresent === false) {
    messages.push('O commit do catálogo vinculado ao recibo não está mais presente no histórico local.');
  }
  const counts = record.receipt.counts;
  const status: PortableRestoreEvidenceComparisonStatus =
    currentFingerprint === record.receipt.effectiveFingerprint && catalogHistoryEntryPresent !== false ? 'current' : 'changed';
  return {
    ...record,
    comparison: {
      status,
      comparedAt,
      expectedFingerprint: record.receipt.effectiveFingerprint,
      currentFingerprint,
      catalogHistoryEntryId: record.receipt.catalogHistoryEntryId,
      catalogHistoryEntryPresent,
      characterCountDelta: current.characterStore.characters.length - counts.characters,
      remediationPlanCountDelta: Object.keys(current.characterStore.compatibilityRemediationPlans).length - counts.remediationPlans,
      progressionDraftCountDelta: Object.keys(current.characterStore.progressionDrafts).length - counts.progressionDrafts,
      messages
    }
  };
};

export const shouldRevalidatePortableRestoreEvidence = (
  record: PortableRestoreHistoricalEvidenceRecord,
  now: () => Date = () => new Date(),
  intervalHours = DEFAULT_PORTABLE_RESTORE_REVALIDATION_INTERVAL_HOURS
): boolean => {
  if (!record.comparison) return true;
  const elapsed = now().getTime() - safeDate(record.comparison.comparedAt);
  return elapsed >= intervalHours * 60 * 60 * 1000;
};

export const revalidatePortableRestoreEvidenceHistory = (
  records: readonly PortableRestoreHistoricalEvidenceRecord[],
  current: PortableRestoreDataCheckpoint,
  catalogHistory: readonly CatalogConfigurationHistoryEntry[],
  params: { force?: boolean; now?: () => Date; intervalHours?: number } = {}
): PortableRestoreHistoricalEvidenceRecord[] => {
  const now = params.now ?? (() => new Date());
  return records.map((record) => params.force || shouldRevalidatePortableRestoreEvidence(record, now, params.intervalHours)
    ? comparePortableRestoreHistoricalEvidence(record, current, catalogHistory, now)
    : record);
};

export const planPortableRestoreEvidenceCleanup = (
  records: readonly PortableRestoreHistoricalEvidenceRecord[],
  archivedSessions: readonly PortableRestoreSession[],
  checkpointRetention = DEFAULT_PORTABLE_RESTORE_CHECKPOINT_RETENTION
): PortableRestoreEvidenceCleanupPlan => {
  const sortedCheckpoints = [...archivedSessions].sort((left, right) =>
    safeDate(right.closedAt ?? right.committedAt) - safeDate(left.closedAt ?? left.committedAt));
  return {
    recommendedCheckpointSessionIds: sortedCheckpoints.slice(checkpointRetention).map((session) => session.id),
    invalidEvidenceRecordIds: records.filter((record) => record.validationStatus === 'invalid').map((record) => record.recordId),
    importedEvidenceRecordIds: records.filter((record) => record.source === 'imported').map((record) => record.recordId),
    retainedCheckpointCount: Math.min(sortedCheckpoints.length, checkpointRetention),
    evidenceRecordCount: records.length
  };
};
