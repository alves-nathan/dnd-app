import { sha256Hex } from './catalogBundleDigest';
import {
  catalogOperationalAuthorizationChecksum,
  catalogExecutorConfirmationChecksum,
  validateCatalogOperationalExecutionReceipt,
  type CatalogOperationalExecutionReceipt,
  type CatalogOperationalExecutionResult
} from './catalogOperationalAuthorization';
import {
  catalogPublicKeyFingerprint,
  verifyP256Signature,
  type CatalogTrustRegistry,
  type CatalogTrustedPublisher
} from './catalogTrust';
import { stableStringify } from './utils';

export const CATALOG_OPERATIONAL_JOURNAL_ENTRY_SCHEMA = 'dnd-catalog-operational-journal-entry.v1' as const;
export const CATALOG_OPERATIONAL_RECONCILIATION_SCHEMA = 'dnd-catalog-operational-reconciliation.v1' as const;
export const CATALOG_OPERATIONAL_EVIDENCE_SCHEMA = 'dnd-catalog-operational-evidence.v1' as const;
export const CATALOG_OPERATIONAL_JOURNAL_ARCHIVE_SCHEMA = 'dnd-catalog-operational-journal-archive.v1' as const;
export const CATALOG_OPERATIONAL_RECOVERY_AUTHORIZATION_SCHEMA = 'dnd-catalog-operational-recovery-authorization.v1' as const;
export const CATALOG_OPERATIONAL_RECOVERY_CONFIRMATION_SCHEMA = 'dnd-catalog-operational-recovery-confirmation.v1' as const;

export type CatalogOperationalJournalEntryType =
  | 'authorizationAccepted'
  | 'executorConfirmed'
  | 'executionPrepared'
  | 'executionStarted'
  | 'executionSucceeded'
  | 'executionFailed'
  | 'executionInterrupted'
  | 'executionResumed'
  | 'reconciliationCompleted'
  | 'reconciliationFailed'
  | 'recoveryAuthorizationAccepted'
  | 'recoveryExecuted'
  | 'operationClosed'
  | 'checkpointArchived';

export interface CatalogOperationalJournalEntry {
  schemaVersion: typeof CATALOG_OPERATIONAL_JOURNAL_ENTRY_SCHEMA;
  entryId: string;
  sequence: number;
  previousHash: string;
  at: string;
  type: CatalogOperationalJournalEntryType;
  authorizationId?: string;
  sessionId?: string;
  receiptId?: string;
  details?: Record<string, unknown>;
  hash: string;
}

export interface CatalogOperationalJournalArchive {
  schemaVersion: typeof CATALOG_OPERATIONAL_JOURNAL_ARCHIVE_SCHEMA;
  archiveId: string;
  createdAt: string;
  firstSequence: number;
  lastSequence: number;
  basePreviousHash: string;
  headHash: string;
  entries: CatalogOperationalJournalEntry[];
  checksum: string;
}

export interface CatalogOperationalStateSnapshot {
  selectedChannel: string;
  operationalOverridesChecksum: string;
  publicationId?: string;
  effectiveRolloutPercent?: number;
  updateSessionId?: string;
  updateSessionStatus?: string;
  checksum: string;
}

export interface CatalogOperationalReconciliationIssue {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface CatalogOperationalReconciliation {
  schemaVersion: typeof CATALOG_OPERATIONAL_RECONCILIATION_SCHEMA;
  reconciliationId: string;
  receiptId: string;
  receiptChecksum: string;
  createdAt: string;
  expected: Partial<CatalogOperationalStateSnapshot>;
  actual: CatalogOperationalStateSnapshot;
  issues: CatalogOperationalReconciliationIssue[];
  status: 'passed' | 'warning' | 'failed';
  acknowledgedWarningCodes: string[];
  checksum: string;
}

export interface CatalogOperationalEvidence {
  schemaVersion: typeof CATALOG_OPERATIONAL_EVIDENCE_SCHEMA;
  evidenceId: string;
  generatedAt: string;
  closedAt: string;
  receipt: CatalogOperationalExecutionReceipt;
  reconciliation: CatalogOperationalReconciliation;
  journalEntries: CatalogOperationalJournalEntry[];
  archiveHeads: Array<{ archiveId: string; headHash: string; checksum: string }>;
  journalHeadHash: string;
  checksum: string;
}

export type CatalogOperationalRecoveryAction = 'reapplyExpected' | 'rollbackCheckpoint';

export interface CatalogOperationalRecoveryExecutor {
  executorId: string;
  publisherId: string;
  keyId: string;
}

export interface SignedCatalogOperationalRecoveryAuthorization {
  schemaVersion: typeof CATALOG_OPERATIONAL_RECOVERY_AUTHORIZATION_SCHEMA;
  authorizationId: string;
  issuedAt: string;
  expiresAt: string;
  publisherId: string;
  keyId: string;
  receiptChecksum: string;
  reconciliationChecksum: string;
  action: CatalogOperationalRecoveryAction;
  executor: CatalogOperationalRecoveryExecutor;
  nonce: string;
  maximumUses: 1;
  humanConfirmationRequired: true;
  automaticExecution: false;
  signature: string;
}

export interface SignedCatalogOperationalRecoveryConfirmation {
  schemaVersion: typeof CATALOG_OPERATIONAL_RECOVERY_CONFIRMATION_SCHEMA;
  confirmationId: string;
  issuedAt: string;
  expiresAt: string;
  executorId: string;
  publisherId: string;
  keyId: string;
  recoveryAuthorizationChecksum: string;
  receiptChecksum: string;
  action: CatalogOperationalRecoveryAction;
  nonce: string;
  signature: string;
}

const ZERO_HASH = '0'.repeat(64);
const hex64 = /^[a-f0-9]{64}$/i;
const noncePattern = /^[A-Za-z0-9_-]{16,128}$/;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const identity = (value: { publisherId: string; keyId: string }): string => `${value.publisherId}:${value.keyId}`;

const checksumWithout = <T extends object>(value: T, key: keyof T): string => {
  const copy = { ...value } as Record<string, unknown>;
  delete copy[String(key)];
  return sha256Hex(stableStringify(copy));
};

const assertIsoDate = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} é inválida.`);
  return parsed;
};

const trustedKey = (registry: CatalogTrustRegistry, publisherId: string, keyId: string) => {
  const publisher = registry.publishers.find((entry) => entry.publisherId === publisherId && entry.status === 'trusted');
  if (!publisher) throw new Error('O documento de recuperação foi assinado por um publicador não confiável.');
  const key = publisher.keys.find((entry) => entry.keyId === keyId && entry.status !== 'revoked');
  if (!key || key.fingerprint !== catalogPublicKeyFingerprint(key.publicJwk)) throw new Error('A chave de recuperação não é confiável.');
  return { publisher, key };
};

const assertKeyWindow = (key: CatalogTrustedPublisher['keys'][number], issuedAt: number, label: string): void => {
  if (key.validFrom && issuedAt < Date.parse(key.validFrom)) throw new Error(`${label} antecede a validade da chave.`);
  if (key.validUntil && issuedAt > Date.parse(key.validUntil)) throw new Error(`${label} foi emitida depois da expiração da chave.`);
  if (key.retiredAt && issuedAt > Date.parse(key.retiredAt)) throw new Error(`${label} foi emitida depois da retirada da chave.`);
};

export const catalogOperationalJournalEntryHash = (entry: Omit<CatalogOperationalJournalEntry, 'hash'>): string => sha256Hex(stableStringify(entry));

export const appendCatalogOperationalJournalEntry = (params: {
  entries: readonly CatalogOperationalJournalEntry[];
  archivedHeadHash?: string;
  archivedLastSequence?: number;
  at: string;
  type: CatalogOperationalJournalEntryType;
  authorizationId?: string;
  sessionId?: string;
  receiptId?: string;
  details?: Record<string, unknown>;
}): CatalogOperationalJournalEntry => {
  const previous = params.entries[params.entries.length - 1];
  const previousHash = previous?.hash ?? params.archivedHeadHash ?? ZERO_HASH;
  const sequence = (previous?.sequence ?? params.archivedLastSequence ?? 0) + 1;
  const payload: Omit<CatalogOperationalJournalEntry, 'hash'> = {
    schemaVersion: CATALOG_OPERATIONAL_JOURNAL_ENTRY_SCHEMA,
    entryId: `catalog-operation-journal-${sequence}-${sha256Hex(`${params.at}:${params.type}:${previousHash}`).slice(0, 12)}`,
    sequence,
    previousHash,
    at: params.at,
    type: params.type,
    ...(params.authorizationId ? { authorizationId: params.authorizationId } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.receiptId ? { receiptId: params.receiptId } : {}),
    ...(params.details ? { details: clone(params.details) } : {})
  };
  return { ...payload, hash: catalogOperationalJournalEntryHash(payload) };
};

export const validateCatalogOperationalJournalChain = (entries: readonly CatalogOperationalJournalEntry[], basePreviousHash = ZERO_HASH, baseSequence = 0): boolean => {
  let previousHash = basePreviousHash;
  let previousSequence = baseSequence;
  for (const entry of entries) {
    if (entry.schemaVersion !== CATALOG_OPERATIONAL_JOURNAL_ENTRY_SCHEMA || !hex64.test(entry.hash) || !hex64.test(entry.previousHash)) return false;
    if (entry.previousHash !== previousHash || entry.sequence !== previousSequence + 1) return false;
    const { hash, ...payload } = entry;
    if (hash.toLowerCase() !== catalogOperationalJournalEntryHash(payload).toLowerCase()) return false;
    previousHash = entry.hash;
    previousSequence = entry.sequence;
  }
  return true;
};

export const catalogOperationalStateSnapshotChecksum = (snapshot: Omit<CatalogOperationalStateSnapshot, 'checksum'>): string => sha256Hex(stableStringify(snapshot));
export const createCatalogOperationalStateSnapshot = (snapshot: Omit<CatalogOperationalStateSnapshot, 'checksum'>): CatalogOperationalStateSnapshot => ({ ...clone(snapshot), checksum: catalogOperationalStateSnapshotChecksum(snapshot) });
export const validateCatalogOperationalStateSnapshot = (snapshot: CatalogOperationalStateSnapshot): boolean => snapshot.checksum === catalogOperationalStateSnapshotChecksum({ ...snapshot, checksum: undefined } as unknown as Omit<CatalogOperationalStateSnapshot, 'checksum'>);

export const expectedCatalogOperationalState = (receipt: CatalogOperationalExecutionReceipt): Partial<CatalogOperationalStateSnapshot> => {
  if (!validateCatalogOperationalExecutionReceipt(receipt) || receipt.status !== 'succeeded' || !receipt.result) return {};
  const result = receipt.result;
  if (result.kind === 'rolloutOverride') {
    const rollout = Number((result.after ?? {}).rolloutPercent);
    return { publicationId: receipt.publicationId, ...(Number.isFinite(rollout) ? { effectiveRolloutPercent: rollout } : {}) };
  }
  if (result.kind === 'channelPromotion') return { selectedChannel: String((result.after ?? {}).selectedChannel ?? '') };
  return { updateSessionId: result.transactionId ?? receipt.rollbackTargetSessionId, updateSessionStatus: 'rolledBack' };
};

const reconciliationChecksum = (value: Omit<CatalogOperationalReconciliation, 'checksum'>): string => sha256Hex(stableStringify(value));
export const createCatalogOperationalReconciliation = (params: {
  receipt: CatalogOperationalExecutionReceipt;
  actual: CatalogOperationalStateSnapshot;
  now?: () => Date;
  acknowledgedWarningCodes?: string[];
  expectedOverride?: Partial<CatalogOperationalStateSnapshot>;
}): CatalogOperationalReconciliation => {
  if (!validateCatalogOperationalExecutionReceipt(params.receipt)) throw new Error('O recibo operacional está adulterado.');
  const expected = params.expectedOverride ? clone(params.expectedOverride) : expectedCatalogOperationalState(params.receipt);
  const issues: CatalogOperationalReconciliationIssue[] = [];
  if (expected.selectedChannel !== undefined && expected.selectedChannel !== params.actual.selectedChannel) issues.push({ code: 'OPERATIONAL_CHANNEL_DRIFT', severity: 'error', message: 'O canal efetivo diverge do resultado operacional.', expected: expected.selectedChannel, actual: params.actual.selectedChannel });
  if (expected.publicationId !== undefined && expected.publicationId !== params.actual.publicationId) issues.push({ code: 'OPERATIONAL_PUBLICATION_DRIFT', severity: 'error', message: 'A publicação efetiva diverge da autorização executada.', expected: expected.publicationId, actual: params.actual.publicationId });
  if (expected.effectiveRolloutPercent !== undefined && expected.effectiveRolloutPercent !== params.actual.effectiveRolloutPercent) issues.push({ code: 'OPERATIONAL_ROLLOUT_DRIFT', severity: 'error', message: 'O rollout efetivo foi alterado após a execução.', expected: expected.effectiveRolloutPercent, actual: params.actual.effectiveRolloutPercent });
  if (expected.updateSessionId !== undefined && expected.updateSessionId !== params.actual.updateSessionId) issues.push({ code: 'OPERATIONAL_UPDATE_SESSION_DRIFT', severity: 'error', message: 'A sessão transacional do catálogo diverge do recibo.', expected: expected.updateSessionId, actual: params.actual.updateSessionId });
  if (expected.updateSessionStatus !== undefined && expected.updateSessionStatus !== params.actual.updateSessionStatus) issues.push({ code: 'OPERATIONAL_UPDATE_STATUS_DRIFT', severity: 'error', message: 'O estado da sessão transacional diverge do rollback confirmado.', expected: expected.updateSessionStatus, actual: params.actual.updateSessionStatus });
  if (params.receipt.status === 'failed') issues.push({ code: 'OPERATIONAL_EXECUTION_FAILED', severity: 'warning', message: 'A autorização foi consumida por uma execução que falhou e requer encerramento explícito.' });
  const acknowledgedWarningCodes = [...new Set(params.acknowledgedWarningCodes ?? [])].sort();
  const unacknowledgedWarnings = issues.filter((issue) => issue.severity === 'warning' && !acknowledgedWarningCodes.includes(issue.code));
  const status = issues.some((issue) => issue.severity === 'error') ? 'failed' : unacknowledgedWarnings.length ? 'warning' : 'passed';
  const payload: Omit<CatalogOperationalReconciliation, 'checksum'> = {
    schemaVersion: CATALOG_OPERATIONAL_RECONCILIATION_SCHEMA,
    reconciliationId: `catalog-operation-reconciliation-${params.receipt.receiptId}-${sha256Hex(params.actual.checksum).slice(0, 10)}`,
    receiptId: params.receipt.receiptId,
    receiptChecksum: params.receipt.checksum,
    createdAt: (params.now ?? (() => new Date()))().toISOString(),
    expected,
    actual: clone(params.actual),
    issues,
    status,
    acknowledgedWarningCodes
  };
  return { ...payload, checksum: reconciliationChecksum(payload) };
};

export const validateCatalogOperationalReconciliation = (value: CatalogOperationalReconciliation): boolean => {
  if (value.schemaVersion !== CATALOG_OPERATIONAL_RECONCILIATION_SCHEMA || !hex64.test(value.checksum) || !validateCatalogOperationalStateSnapshot(value.actual)) return false;
  const { checksum, ...payload } = value;
  return checksum.toLowerCase() === reconciliationChecksum(payload).toLowerCase();
};

const evidenceChecksum = (value: Omit<CatalogOperationalEvidence, 'checksum'>): string => sha256Hex(stableStringify(value));
export const createCatalogOperationalEvidence = (params: {
  receipt: CatalogOperationalExecutionReceipt;
  reconciliation: CatalogOperationalReconciliation;
  journalEntries: readonly CatalogOperationalJournalEntry[];
  archives: readonly CatalogOperationalJournalArchive[];
  closedAt: string;
  now?: () => Date;
}): CatalogOperationalEvidence => {
  if (!validateCatalogOperationalExecutionReceipt(params.receipt) || !validateCatalogOperationalReconciliation(params.reconciliation)) throw new Error('O recibo ou a reconciliação não é íntegro.');
  if (params.reconciliation.receiptChecksum !== params.receipt.checksum || params.reconciliation.status === 'failed') throw new Error('A operação ainda não pode ser encerrada.');
  if (!validateCatalogOperationalJournalChain(params.journalEntries, params.archives[params.archives.length - 1]?.headHash ?? ZERO_HASH, params.archives[params.archives.length - 1]?.lastSequence ?? 0)) throw new Error('A cadeia do diário operacional está inválida.');
  const relevant = params.journalEntries.filter((entry) => entry.receiptId === params.receipt.receiptId || entry.authorizationId === params.receipt.authorizationId);
  const payload: Omit<CatalogOperationalEvidence, 'checksum'> = {
    schemaVersion: CATALOG_OPERATIONAL_EVIDENCE_SCHEMA,
    evidenceId: `catalog-operation-evidence-${params.receipt.receiptId}`,
    generatedAt: (params.now ?? (() => new Date()))().toISOString(),
    closedAt: params.closedAt,
    receipt: clone(params.receipt),
    reconciliation: clone(params.reconciliation),
    journalEntries: clone(relevant),
    archiveHeads: params.archives.map((archive) => ({ archiveId: archive.archiveId, headHash: archive.headHash, checksum: archive.checksum })),
    journalHeadHash: params.journalEntries[params.journalEntries.length - 1]?.hash ?? params.archives[params.archives.length - 1]?.headHash ?? ZERO_HASH
  };
  return { ...payload, checksum: evidenceChecksum(payload) };
};

export const validateCatalogOperationalEvidence = (value: CatalogOperationalEvidence): boolean => {
  if (value.schemaVersion !== CATALOG_OPERATIONAL_EVIDENCE_SCHEMA || !hex64.test(value.checksum) || !validateCatalogOperationalExecutionReceipt(value.receipt) || !validateCatalogOperationalReconciliation(value.reconciliation)) return false;
  const { checksum, ...payload } = value;
  return checksum.toLowerCase() === evidenceChecksum(payload).toLowerCase();
};

const archiveChecksum = (value: Omit<CatalogOperationalJournalArchive, 'checksum'>): string => sha256Hex(stableStringify(value));
export const createCatalogOperationalJournalArchive = (entries: readonly CatalogOperationalJournalEntry[], now?: () => Date): CatalogOperationalJournalArchive => {
  if (!entries.length || !validateCatalogOperationalJournalChain(entries, entries[0]?.previousHash ?? ZERO_HASH, (entries[0]?.sequence ?? 1) - 1)) throw new Error('O segmento do diário não é arquivável.');
  const payload: Omit<CatalogOperationalJournalArchive, 'checksum'> = {
    schemaVersion: CATALOG_OPERATIONAL_JOURNAL_ARCHIVE_SCHEMA,
    archiveId: `catalog-operation-archive-${entries[0]?.sequence}-${entries[entries.length - 1]?.sequence}`,
    createdAt: (now ?? (() => new Date()))().toISOString(),
    firstSequence: entries[0]!.sequence,
    lastSequence: entries[entries.length - 1]!.sequence,
    basePreviousHash: entries[0]!.previousHash,
    headHash: entries[entries.length - 1]!.hash,
    entries: clone([...entries])
  };
  return { ...payload, checksum: archiveChecksum(payload) };
};

export const validateCatalogOperationalJournalArchive = (value: CatalogOperationalJournalArchive): boolean => {
  if (value.schemaVersion !== CATALOG_OPERATIONAL_JOURNAL_ARCHIVE_SCHEMA || !hex64.test(value.checksum) || !validateCatalogOperationalJournalChain(value.entries, value.basePreviousHash, value.firstSequence - 1)) return false;
  const { checksum, ...payload } = value;
  return value.headHash === value.entries[value.entries.length - 1]?.hash && checksum.toLowerCase() === archiveChecksum(payload).toLowerCase();
};

export const validateCatalogOperationalJournalArchiveChain = (archives: readonly CatalogOperationalJournalArchive[]): boolean => {
  let previousHead = ZERO_HASH;
  let previousSequence = 0;
  for (const archive of archives) {
    if (!validateCatalogOperationalJournalArchive(archive)) return false;
    if (archive.basePreviousHash !== previousHead || archive.firstSequence !== previousSequence + 1) return false;
    previousHead = archive.headHash;
    previousSequence = archive.lastSequence;
  }
  return true;
};

export const catalogOperationalRecoveryAuthorizationPayload = (value: SignedCatalogOperationalRecoveryAuthorization): string => stableStringify({ ...value, signature: undefined });
export const catalogOperationalRecoveryAuthorizationChecksum = (value: SignedCatalogOperationalRecoveryAuthorization): string => sha256Hex(stableStringify(value));
export const catalogOperationalRecoveryConfirmationPayload = (value: SignedCatalogOperationalRecoveryConfirmation): string => stableStringify({ ...value, signature: undefined });
export const catalogOperationalRecoveryConfirmationChecksum = (value: SignedCatalogOperationalRecoveryConfirmation): string => sha256Hex(stableStringify(value));

export const verifySignedCatalogOperationalRecoveryAuthorization = (params: {
  authorization: SignedCatalogOperationalRecoveryAuthorization;
  registry: CatalogTrustRegistry;
  receipt: CatalogOperationalExecutionReceipt;
  reconciliation: CatalogOperationalReconciliation;
  now?: () => Date;
}): SignedCatalogOperationalRecoveryAuthorization => {
  const { authorization, registry, receipt, reconciliation } = params;
  if (authorization.schemaVersion !== CATALOG_OPERATIONAL_RECOVERY_AUTHORIZATION_SCHEMA || authorization.maximumUses !== 1 || authorization.humanConfirmationRequired !== true || authorization.automaticExecution !== false) throw new Error('A autorização de recuperação é incompatível.');
  if (!validateCatalogOperationalExecutionReceipt(receipt) || !validateCatalogOperationalReconciliation(reconciliation) || reconciliation.status !== 'failed') throw new Error('A recuperação exige uma divergência íntegra e bloqueante.');
  if (authorization.receiptChecksum !== receipt.checksum || authorization.reconciliationChecksum !== reconciliation.checksum) throw new Error('A autorização não corresponde ao recibo e à reconciliação atuais.');
  if (!authorization.authorizationId?.trim() || !noncePattern.test(authorization.nonce)) throw new Error('O identificador ou nonce da recuperação é inválido.');
  const issuedAt = assertIsoDate(authorization.issuedAt, 'A emissão da autorização de recuperação');
  const expiresAt = assertIsoDate(authorization.expiresAt, 'A expiração da autorização de recuperação');
  const now = (params.now ?? (() => new Date()))().getTime();
  if (issuedAt > now + 300000 || expiresAt <= issuedAt || now > expiresAt) throw new Error('A autorização de recuperação está fora da validade.');
  const authority = trustedKey(registry, authorization.publisherId, authorization.keyId);
  const executor = trustedKey(registry, authorization.executor.publisherId, authorization.executor.keyId);
  assertKeyWindow(authority.key, issuedAt, 'A autorização de recuperação');
  if (identity(authorization) === identity(authorization.executor)) throw new Error('A autoridade de recuperação e o executor precisam usar chaves distintas.');
  if (!verifyP256Signature(catalogOperationalRecoveryAuthorizationPayload(authorization), authorization.signature, authority.key.publicJwk)) throw new Error('A assinatura da autorização de recuperação é inválida.');
  if (!authorization.executor.executorId?.trim() || executor.key.keyId !== authorization.executor.keyId) throw new Error('O executor da recuperação não é confiável.');
  return clone(authorization);
};

export const verifySignedCatalogOperationalRecoveryConfirmation = (params: {
  confirmation: SignedCatalogOperationalRecoveryConfirmation;
  authorization: SignedCatalogOperationalRecoveryAuthorization;
  registry: CatalogTrustRegistry;
  now?: () => Date;
}): SignedCatalogOperationalRecoveryConfirmation => {
  const { confirmation, authorization, registry } = params;
  if (confirmation.schemaVersion !== CATALOG_OPERATIONAL_RECOVERY_CONFIRMATION_SCHEMA) throw new Error('A confirmação de recuperação é incompatível.');
  if (confirmation.recoveryAuthorizationChecksum !== catalogOperationalRecoveryAuthorizationChecksum(authorization) || confirmation.receiptChecksum !== authorization.receiptChecksum || confirmation.action !== authorization.action || confirmation.nonce !== authorization.nonce) throw new Error('A confirmação não corresponde à autorização de recuperação.');
  if (confirmation.executorId !== authorization.executor.executorId || identity(confirmation) !== identity(authorization.executor)) throw new Error('A confirmação foi assinada por outro executor.');
  const issuedAt = assertIsoDate(confirmation.issuedAt, 'A emissão da confirmação de recuperação');
  const expiresAt = assertIsoDate(confirmation.expiresAt, 'A expiração da confirmação de recuperação');
  const now = (params.now ?? (() => new Date()))().getTime();
  if (issuedAt > now + 300000 || expiresAt <= issuedAt || now > expiresAt || expiresAt > Date.parse(authorization.expiresAt)) throw new Error('A confirmação de recuperação está fora da validade.');
  const executor = trustedKey(registry, confirmation.publisherId, confirmation.keyId);
  assertKeyWindow(executor.key, issuedAt, 'A confirmação de recuperação');
  if (!verifyP256Signature(catalogOperationalRecoveryConfirmationPayload(confirmation), confirmation.signature, executor.key.publicJwk)) throw new Error('A assinatura da confirmação de recuperação é inválida.');
  return clone(confirmation);
};

export const assertCatalogOperationalRecoveryUnused = (authorization: SignedCatalogOperationalRecoveryAuthorization, usedChecksums: readonly string[], usedNonces: readonly string[]): void => {
  const checksum = catalogOperationalRecoveryAuthorizationChecksum(authorization);
  if (usedChecksums.includes(checksum) || usedNonces.includes(authorization.nonce)) throw new Error('A autorização de recuperação já foi consumida.');
};

export const parseSignedCatalogOperationalRecoveryAuthorization = (raw: string): SignedCatalogOperationalRecoveryAuthorization => JSON.parse(raw) as SignedCatalogOperationalRecoveryAuthorization;
export const parseSignedCatalogOperationalRecoveryConfirmation = (raw: string): SignedCatalogOperationalRecoveryConfirmation => JSON.parse(raw) as SignedCatalogOperationalRecoveryConfirmation;
