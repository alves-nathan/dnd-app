import type { CharacterChoiceItem } from '../catalog/characterChoiceTypes';
import type { CatalogFilterState, CatalogSnapshot } from '../catalog/types';
import { buildCharacterCompatibilityReport } from '../characters/characterCompatibility';
import type { PortableRestoreDataCheckpoint, PortableRestoreSession } from './portableRestoreSession';

export const PORTABLE_RESTORE_VERIFICATION_SCHEMA = 'dnd-portable-restore-verification.v1' as const;
export const PORTABLE_RESTORE_RECEIPT_SCHEMA = 'dnd-portable-restore-integrity-receipt.v1' as const;
export const PORTABLE_RESTORE_EVIDENCE_SCHEMA = 'dnd-portable-restore-evidence.v1' as const;

export type PortableRestoreVerificationStatus = 'passed' | 'warning' | 'failed';
export type PortableRestoreVerificationSeverity = 'info' | 'warning' | 'error';

export interface PortableRestoreVerificationIssue {
  id: string;
  severity: PortableRestoreVerificationSeverity;
  code:
    | 'RESTORE_EFFECTIVE_FINGERPRINT_MISMATCH'
    | 'RESTORE_CATALOG_FILTER_MISMATCH'
    | 'RESTORE_CATALOG_COMMIT_MISSING'
    | 'RESTORE_DUPLICATE_CHARACTER_ID'
    | 'RESTORE_ORPHAN_PROGRESSION_DRAFT'
    | 'RESTORE_ORPHAN_REMEDIATION_PLAN'
    | 'RESTORE_PLAN_KEY_MISMATCH'
    | 'RESTORE_RECOVERY_REFERENCE_ORPHANED'
    | 'RESTORE_QUARANTINE_PRESENT'
    | 'RESTORE_CHARACTER_COMPATIBILITY_BLOCKED'
    | 'RESTORE_CHARACTER_COMPATIBILITY_REVIEW'
    | 'RESTORE_CATALOG_CONTEXT_UNAVAILABLE';
  message: string;
  characterId?: string;
  referenceId?: string;
}

export interface PortableRestorePostVerification {
  schemaVersion: typeof PORTABLE_RESTORE_VERIFICATION_SCHEMA;
  verifiedAt: string;
  status: PortableRestoreVerificationStatus;
  expectedFingerprint: string;
  effectiveFingerprint: string;
  catalogFilterFingerprint: string;
  expectedCatalogFilterFingerprint: string;
  counts: {
    characters: number;
    remediationPlans: number;
    progressionDrafts: number;
    compatibilityBlockedCharacters: number;
    compatibilityReviewCharacters: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  issues: PortableRestoreVerificationIssue[];
  requiresAcknowledgement: boolean;
  acknowledgedAt?: string;
  canClose: boolean;
}

export interface PortableRestoreIntegrityReceipt {
  schemaVersion: typeof PORTABLE_RESTORE_RECEIPT_SCHEMA;
  receiptId: string;
  sessionId: string;
  createdAt: string;
  sourceName?: string;
  sourceChecksum?: string;
  backupSchemaVersion: string;
  beforeFingerprint: string;
  projectedFingerprint: string;
  effectiveFingerprint: string;
  catalogHistoryEntryId?: string;
  verificationStatus: PortableRestoreVerificationStatus;
  verificationAcknowledgedAt?: string;
  issueDigest: Array<{ code: string; severity: PortableRestoreVerificationSeverity; count: number }>;
  counts: PortableRestorePostVerification['counts'];
  checksum: string;
}


export interface PortableRestoreEvidenceBundle {
  schemaVersion: typeof PORTABLE_RESTORE_EVIDENCE_SCHEMA;
  exportedAt: string;
  sessionId: string;
  source: PortableRestoreSession['source'];
  status: PortableRestoreSession['status'];
  beforeFingerprint: string;
  projectedFingerprint: string;
  catalogHistoryEntryId?: string;
  conflicts: PortableRestoreSession['conflicts'];
  acknowledgedConflictIds: string[];
  verification: PortableRestorePostVerification;
  receipt: PortableRestoreIntegrityReceipt;
  events: PortableRestoreSession['events'];
  checksum: string;
}

export interface VerifyPortableRestoreParams {
  session: PortableRestoreSession;
  effective: PortableRestoreDataCheckpoint;
  snapshot?: CatalogSnapshot;
  filterState?: CatalogFilterState;
  choices?: readonly CharacterChoiceItem[];
  now?: () => Date;
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

export const portableRestoreEffectiveStateFingerprint = (checkpoint: PortableRestoreDataCheckpoint): string => fingerprint({
  characterStore: checkpoint.characterStore,
  scenarios: checkpoint.scenarios,
  buildPresets: checkpoint.buildPresets,
  buildHistorySnapshots: checkpoint.buildHistorySnapshots,
  catalogFilterState: checkpoint.catalog.filterState
});

export const portableRestoreCatalogFilterFingerprint = (filterState: CatalogFilterState): string => fingerprint(filterState);

const issue = (
  code: PortableRestoreVerificationIssue['code'],
  severity: PortableRestoreVerificationSeverity,
  message: string,
  extras: Pick<PortableRestoreVerificationIssue, 'characterId' | 'referenceId'> = {}
): PortableRestoreVerificationIssue => ({
  id: `${code}:${extras.characterId ?? extras.referenceId ?? message}`,
  code,
  severity,
  message,
  ...extras
});

const uniqueStrings = (values: readonly string[]): string[] => Array.from(new Set(values));

export const verifyPortableRestoreIntegrity = (params: VerifyPortableRestoreParams): PortableRestorePostVerification => {
  const verifiedAt = (params.now ?? (() => new Date()))().toISOString();
  const issues: PortableRestoreVerificationIssue[] = [];
  const expectedFingerprint = portableRestoreEffectiveStateFingerprint(params.session.projected);
  const effectiveFingerprint = portableRestoreEffectiveStateFingerprint(params.effective);
  const expectedCatalogFilterFingerprint = portableRestoreCatalogFilterFingerprint(params.session.projected.catalog.filterState);
  const catalogFilterFingerprint = portableRestoreCatalogFilterFingerprint(params.effective.catalog.filterState);

  if (effectiveFingerprint !== expectedFingerprint) {
    issues.push(issue('RESTORE_EFFECTIVE_FINGERPRINT_MISMATCH', 'error', 'O estado efetivo diverge do estado projetado da sessão. O encerramento foi bloqueado.'));
  }
  if (catalogFilterFingerprint !== expectedCatalogFilterFingerprint) {
    issues.push(issue('RESTORE_CATALOG_FILTER_MISMATCH', 'error', 'Os filtros efetivos do catálogo divergem da configuração projetada.'));
  }
  if (params.session.catalogAudit && (!params.session.catalogHistoryEntryId || !params.effective.catalog.history.some((entry) => entry.id === params.session.catalogHistoryEntryId))) {
    issues.push(issue('RESTORE_CATALOG_COMMIT_MISSING', 'error', 'O commit do catálogo vinculado à sessão não foi encontrado no histórico efetivo.'));
  }

  const characters = params.effective.characterStore.characters;
  const characterIds = characters.map((character) => character.id);
  const characterIdSet = new Set(characterIds);
  const duplicateCharacterIds = uniqueStrings(characterIds.filter((id, index) => characterIds.indexOf(id) !== index));
  duplicateCharacterIds.forEach((characterId) => issues.push(issue('RESTORE_DUPLICATE_CHARACTER_ID', 'error', `O personagem ${characterId} aparece mais de uma vez no checkpoint efetivo.`, { characterId })));

  Object.keys(params.effective.characterStore.progressionDrafts).filter((id) => !characterIdSet.has(id)).forEach((characterId) => {
    issues.push(issue('RESTORE_ORPHAN_PROGRESSION_DRAFT', 'error', `Existe um draft de progressão sem personagem correspondente: ${characterId}.`, { characterId }));
  });

  for (const [key, plan] of Object.entries(params.effective.characterStore.compatibilityRemediationPlans)) {
    if (!characterIdSet.has(plan.characterId)) {
      issues.push(issue('RESTORE_ORPHAN_REMEDIATION_PLAN', 'error', `O plano ${plan.id} referencia um personagem inexistente.`, { characterId: plan.characterId, referenceId: plan.id }));
    }
    if (key !== plan.characterId) {
      issues.push(issue('RESTORE_PLAN_KEY_MISMATCH', 'error', `O plano ${plan.id} está armazenado sob a chave ${key}, mas pertence a ${plan.characterId}.`, { characterId: plan.characterId, referenceId: plan.id }));
    }
  }

  const recoveryIds = uniqueStrings([
    ...params.effective.characterStore.progressionRecovery.recoverableCharacterIds,
    ...params.effective.characterStore.progressionRecovery.conflictedCharacterIds,
    ...params.effective.characterStore.compatibilityRemediationRecovery.pendingAcknowledgementCharacterIds,
    ...params.effective.characterStore.compatibilityRemediationRecovery.conflictedCharacterIds,
    ...params.effective.characterStore.compatibilityRemediationRecovery.staleCatalogCharacterIds
  ]);
  recoveryIds.filter((id) => !characterIdSet.has(id)).forEach((characterId) => {
    issues.push(issue('RESTORE_RECOVERY_REFERENCE_ORPHANED', 'error', `A recuperação transacional referencia um personagem inexistente: ${characterId}.`, { characterId }));
  });

  const quarantineCount = Object.keys(params.effective.characterStore.compatibilityRemediationQuarantine).length;
  if (quarantineCount) {
    issues.push(issue('RESTORE_QUARANTINE_PRESENT', 'warning', `${quarantineCount} registro(s) de remediação permanecem em quarentena para revisão manual.`));
  }

  let compatibilityBlockedCharacters = 0;
  let compatibilityReviewCharacters = 0;
  if (!params.snapshot || !params.filterState || !params.choices) {
    issues.push(issue('RESTORE_CATALOG_CONTEXT_UNAVAILABLE', 'error', 'O catálogo ou a ponte de escolhas não estavam disponíveis para validar as fichas restauradas.'));
  } else {
    for (const character of characters) {
      const report = buildCharacterCompatibilityReport({
        character,
        snapshot: params.snapshot,
        filterState: params.filterState,
        choices: params.choices,
        now: () => new Date(verifiedAt)
      });
      if (report.status === 'blocked') {
        compatibilityBlockedCharacters += 1;
        issues.push(issue('RESTORE_CHARACTER_COMPATIBILITY_BLOCKED', 'error', `${character.name}: ${report.blockingIssueCount} incompatibilidade(s) bloqueante(s) após a restauração.`, { characterId: character.id }));
      } else if (report.status === 'review') {
        compatibilityReviewCharacters += 1;
        issues.push(issue('RESTORE_CHARACTER_COMPATIBILITY_REVIEW', 'warning', `${character.name}: ${report.warningCount} aviso(s) exigem revisão após a restauração.`, { characterId: character.id }));
      }
    }
  }

  const errors = issues.filter((entry) => entry.severity === 'error').length;
  const warnings = issues.filter((entry) => entry.severity === 'warning').length;
  const infos = issues.filter((entry) => entry.severity === 'info').length;
  const status: PortableRestoreVerificationStatus = errors ? 'failed' : warnings ? 'warning' : 'passed';
  return {
    schemaVersion: PORTABLE_RESTORE_VERIFICATION_SCHEMA,
    verifiedAt,
    status,
    expectedFingerprint,
    effectiveFingerprint,
    catalogFilterFingerprint,
    expectedCatalogFilterFingerprint,
    counts: {
      characters: characters.length,
      remediationPlans: Object.keys(params.effective.characterStore.compatibilityRemediationPlans).length,
      progressionDrafts: Object.keys(params.effective.characterStore.progressionDrafts).length,
      compatibilityBlockedCharacters,
      compatibilityReviewCharacters,
      errors,
      warnings,
      infos
    },
    issues,
    requiresAcknowledgement: warnings > 0 && errors === 0,
    canClose: errors === 0 && warnings === 0
  };
};

const receiptPayload = (receipt: Omit<PortableRestoreIntegrityReceipt, 'checksum'>): unknown => receipt;

export const createPortableRestoreIntegrityReceipt = (
  session: PortableRestoreSession,
  verification: PortableRestorePostVerification,
  now: () => Date = () => new Date()
): PortableRestoreIntegrityReceipt => {
  const createdAt = now().toISOString();
  const digestMap = new Map<string, { code: string; severity: PortableRestoreVerificationSeverity; count: number }>();
  for (const entry of verification.issues) {
    const key = `${entry.severity}:${entry.code}`;
    const current = digestMap.get(key) ?? { code: entry.code, severity: entry.severity, count: 0 };
    current.count += 1;
    digestMap.set(key, current);
  }
  const base: Omit<PortableRestoreIntegrityReceipt, 'checksum'> = {
    schemaVersion: PORTABLE_RESTORE_RECEIPT_SCHEMA,
    receiptId: `restore-receipt-${session.id}-${createdAt.replace(/[^0-9]/g, '').slice(0, 17)}`,
    sessionId: session.id,
    createdAt,
    sourceName: session.source.name,
    sourceChecksum: session.source.checksum,
    backupSchemaVersion: session.source.backupSchemaVersion,
    beforeFingerprint: session.beforeFingerprint,
    projectedFingerprint: session.projectedFingerprint,
    effectiveFingerprint: verification.effectiveFingerprint,
    catalogHistoryEntryId: session.catalogHistoryEntryId,
    verificationStatus: verification.status,
    verificationAcknowledgedAt: verification.acknowledgedAt,
    issueDigest: Array.from(digestMap.values()).sort((a, b) => `${a.severity}:${a.code}`.localeCompare(`${b.severity}:${b.code}`)),
    counts: verification.counts
  };
  return { ...base, checksum: fingerprint(receiptPayload(base)) };
};

export const validatePortableRestoreIntegrityReceipt = (receipt: PortableRestoreIntegrityReceipt): boolean => {
  const { checksum, ...base } = receipt;
  return receipt.schemaVersion === PORTABLE_RESTORE_RECEIPT_SCHEMA && checksum === fingerprint(receiptPayload(base));
};

export const portableRestoreReceiptToJson = (receipt: PortableRestoreIntegrityReceipt): string => `${JSON.stringify(receipt, null, 2)}\n`;


export const createPortableRestoreEvidenceBundle = (
  session: PortableRestoreSession,
  now: () => Date = () => new Date()
): PortableRestoreEvidenceBundle | undefined => {
  if (!session.postRestoreVerification || !session.integrityReceipt || !validatePortableRestoreIntegrityReceipt(session.integrityReceipt)) return undefined;
  const base: Omit<PortableRestoreEvidenceBundle, 'checksum'> = {
    schemaVersion: PORTABLE_RESTORE_EVIDENCE_SCHEMA,
    exportedAt: now().toISOString(),
    sessionId: session.id,
    source: JSON.parse(JSON.stringify(session.source)) as PortableRestoreSession['source'],
    status: session.status,
    beforeFingerprint: session.beforeFingerprint,
    projectedFingerprint: session.projectedFingerprint,
    catalogHistoryEntryId: session.catalogHistoryEntryId,
    conflicts: JSON.parse(JSON.stringify(session.conflicts)) as PortableRestoreSession['conflicts'],
    acknowledgedConflictIds: [...session.acknowledgedConflictIds].sort(),
    verification: JSON.parse(JSON.stringify(session.postRestoreVerification)) as PortableRestorePostVerification,
    receipt: JSON.parse(JSON.stringify(session.integrityReceipt)) as PortableRestoreIntegrityReceipt,
    events: JSON.parse(JSON.stringify(session.events)) as PortableRestoreSession['events']
  };
  return { ...base, checksum: fingerprint(base) };
};

export const validatePortableRestoreEvidenceBundle = (bundle: PortableRestoreEvidenceBundle): boolean => {
  const { checksum, ...base } = bundle;
  return bundle.schemaVersion === PORTABLE_RESTORE_EVIDENCE_SCHEMA
    && validatePortableRestoreIntegrityReceipt(bundle.receipt)
    && checksum === fingerprint(base);
};

export const portableRestoreEvidenceToJson = (bundle: PortableRestoreEvidenceBundle): string => `${JSON.stringify(bundle, null, 2)}
`;
