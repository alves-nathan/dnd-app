import { sha256Hex } from './catalogBundleDigest';
import {
  catalogExecutorConfirmationChecksum,
  catalogOperationalAuthorizationChecksum,
  validateCatalogOperationalExecutionReceipt,
  verifySignedCatalogExecutorConfirmation,
  verifySignedCatalogOperationalAuthorization,
  type CatalogOperationalExecutionReceipt,
  type SignedCatalogExecutorConfirmation,
  type SignedCatalogOperationalAuthorization
} from './catalogOperationalAuthorization';
import {
  validateCatalogOperationalEvidence,
  validateCatalogOperationalJournalArchive,
  validateCatalogOperationalJournalArchiveChain,
  validateCatalogOperationalJournalChain,
  type CatalogOperationalEvidence,
  type CatalogOperationalJournalArchive,
  type CatalogOperationalJournalEntry
} from './catalogOperationalJournal';
import {
  catalogRolloutAggregateReportChecksum,
  validateCatalogReleaseQuorumDecision,
  verifySignedCatalogRolloutAggregationPolicy,
  type CatalogReleaseQuorumDecision,
  type SignedCatalogReleaseApproval,
  type SignedCatalogRolloutAggregateReport,
  type SignedCatalogRolloutAggregationPolicy
} from './catalogRolloutAggregation';
import { verifySignedCatalogPublication, type SignedCatalogPublication } from './catalogPublication';
import {
  catalogPublicKeyFingerprint,
  verifyP256Signature,
  type CatalogTrustRegistry,
  type CatalogTrustedPublisher
} from './catalogTrust';
import { stableStringify } from './utils';

export const CATALOG_OPERATIONAL_AUDIT_PACKAGE_SCHEMA = 'dnd-catalog-operational-audit-package.v1' as const;
export const CATALOG_OPERATIONAL_AUDIT_REPORT_SCHEMA = 'dnd-catalog-operational-audit-report.v1' as const;
export const CATALOG_OPERATIONAL_AUDIT_RETENTION_POLICY_SCHEMA = 'dnd-catalog-operational-audit-retention-policy.v1' as const;

export type CatalogOperationalAuditStatus = 'approved' | 'warning' | 'rejected';
export type CatalogOperationalAuditComparisonStatus = 'identical' | 'leftAhead' | 'rightAhead' | 'forked' | 'unrelated';

export interface CatalogOperationalAuditSource {
  deviceIdHash: string;
  appVersion: string;
  platform?: string;
  label?: string;
}

export interface CatalogOperationalAuditPackage {
  schemaVersion: typeof CATALOG_OPERATIONAL_AUDIT_PACKAGE_SCHEMA;
  packageId: string;
  generatedAt: string;
  source: CatalogOperationalAuditSource;
  archives: CatalogOperationalJournalArchive[];
  activeJournal: CatalogOperationalJournalEntry[];
  receipts: CatalogOperationalExecutionReceipt[];
  evidence: CatalogOperationalEvidence[];
  authorizations: SignedCatalogOperationalAuthorization[];
  executorConfirmations: SignedCatalogExecutorConfirmation[];
  aggregationPolicies: SignedCatalogRolloutAggregationPolicy[];
  aggregateReports: SignedCatalogRolloutAggregateReport[];
  releaseApprovals: SignedCatalogReleaseApproval[];
  quorumDecisions: CatalogReleaseQuorumDecision[];
  publications: SignedCatalogPublication[];
  trustRegistry?: CatalogTrustRegistry;
  checksum: string;
}

export interface CatalogOperationalAuditFinding {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  sequence?: number;
  receiptId?: string;
  documentId?: string;
}

export interface CatalogOperationalAuditVerification {
  status: CatalogOperationalAuditStatus;
  packageId?: string;
  packageChecksum?: string;
  generatedAt: string;
  findings: CatalogOperationalAuditFinding[];
  counts: {
    archives: number;
    activeEntries: number;
    totalEntries: number;
    receipts: number;
    evidence: number;
    authorizations: number;
    confirmations: number;
    quorumDecisions: number;
    cryptographicallyVerifiedReceipts: number;
  };
  firstSequence?: number;
  lastSequence?: number;
  headHash?: string;
}

export interface CatalogOperationalAuditComparison {
  status: CatalogOperationalAuditComparisonStatus;
  commonEntries: number;
  leftEntries: number;
  rightEntries: number;
  firstDivergentSequence?: number;
  leftHeadHash?: string;
  rightHeadHash?: string;
  issues: string[];
}

export interface SignedCatalogOperationalAuditReport {
  schemaVersion: typeof CATALOG_OPERATIONAL_AUDIT_REPORT_SCHEMA;
  reportId: string;
  generatedAt: string;
  publisherId: string;
  keyId: string;
  packageId: string;
  packageChecksum: string;
  auditStatus: CatalogOperationalAuditStatus;
  findingCodes: string[];
  firstSequence?: number;
  lastSequence?: number;
  headHash?: string;
  auditorStatement: string;
  signature: string;
}

export interface CatalogOperationalAuditRetentionPolicy {
  schemaVersion: typeof CATALOG_OPERATIONAL_AUDIT_RETENTION_POLICY_SCHEMA;
  policyId: string;
  minimumRetentionDays: number;
  activeEntryLimit: number;
  archiveEntryTarget: number;
  retainEvidence: true;
  requireVerifiedExportBeforeDeletion: true;
}

export interface CatalogOperationalAuditRetentionPlan {
  policyId: string;
  generatedAt: string;
  activeEntries: number;
  archiveRecommended: boolean;
  recommendedArchiveCount: number;
  evidenceEligibleForDeletion: 0;
  warnings: string[];
}

const ZERO_HASH = '0'.repeat(64);
const hex64 = /^[a-f0-9]{64}$/i;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const checksumWithout = <T extends object>(value: T, key: keyof T): string => {
  const payload = { ...value } as Record<string, unknown>;
  delete payload[String(key)];
  return sha256Hex(stableStringify(payload));
};

const auditPackageChecksum = (value: Omit<CatalogOperationalAuditPackage, 'checksum'>): string => sha256Hex(stableStringify(value));
export const catalogOperationalAuditPackageChecksum = (value: CatalogOperationalAuditPackage): string => checksumWithout(value, 'checksum');

export const createCatalogOperationalAuditPackage = (params: Omit<CatalogOperationalAuditPackage, 'schemaVersion' | 'packageId' | 'generatedAt' | 'checksum'> & { now?: () => Date }): CatalogOperationalAuditPackage => {
  const generatedAt = (params.now ?? (() => new Date()))().toISOString();
  const payload: Omit<CatalogOperationalAuditPackage, 'checksum'> = {
    schemaVersion: CATALOG_OPERATIONAL_AUDIT_PACKAGE_SCHEMA,
    packageId: `catalog-operational-audit-${sha256Hex(`${params.source.deviceIdHash}:${generatedAt}`).slice(0, 16)}`,
    generatedAt,
    source: clone(params.source),
    archives: clone(params.archives),
    activeJournal: clone(params.activeJournal),
    receipts: clone(params.receipts),
    evidence: clone(params.evidence),
    authorizations: clone(params.authorizations),
    executorConfirmations: clone(params.executorConfirmations),
    aggregationPolicies: clone(params.aggregationPolicies),
    aggregateReports: clone(params.aggregateReports),
    releaseApprovals: clone(params.releaseApprovals),
    quorumDecisions: clone(params.quorumDecisions),
    publications: clone(params.publications),
    ...(params.trustRegistry ? { trustRegistry: clone(params.trustRegistry) } : {})
  };
  return { ...payload, checksum: auditPackageChecksum(payload) };
};

const flattenEntries = (value: Pick<CatalogOperationalAuditPackage, 'archives' | 'activeJournal'>): CatalogOperationalJournalEntry[] => [
  ...value.archives.slice().sort((a, b) => a.firstSequence - b.firstSequence).flatMap((archive) => archive.entries),
  ...value.activeJournal
];

const trustedKey = (registry: CatalogTrustRegistry, publisherId: string, keyId: string): CatalogTrustedPublisher['keys'][number] => {
  const publisher = registry.publishers.find((entry) => entry.publisherId === publisherId && entry.status === 'trusted');
  if (!publisher) throw new Error('O relatório foi assinado por publicador não confiável.');
  const key = publisher.keys.find((entry) => entry.keyId === keyId && entry.status !== 'revoked');
  if (!key || key.fingerprint !== catalogPublicKeyFingerprint(key.publicJwk)) throw new Error('A chave do auditor não é confiável.');
  return key;
};

const addFinding = (findings: CatalogOperationalAuditFinding[], code: string, severity: CatalogOperationalAuditFinding['severity'], message: string, extra?: Partial<CatalogOperationalAuditFinding>): void => {
  findings.push({ code, severity, message, ...extra });
};

const validateSegments = (candidate: CatalogOperationalAuditPackage, findings: CatalogOperationalAuditFinding[]): { firstSequence?: number; lastSequence?: number; headHash?: string } => {
  const archives = candidate.archives.slice().sort((a, b) => a.firstSequence - b.firstSequence);
  if (!validateCatalogOperationalJournalArchiveChain(archives)) addFinding(findings, 'AUDIT_ARCHIVE_CHAIN_INVALID', 'error', 'A cadeia de arquivos do diário é inválida.');
  let expectedSequence = 1;
  let expectedPreviousHash = ZERO_HASH;
  for (const archive of archives) {
    if (!validateCatalogOperationalJournalArchive(archive)) addFinding(findings, 'AUDIT_ARCHIVE_INVALID', 'error', `O arquivo ${archive.archiveId} é inválido.`, { documentId: archive.archiveId });
    if (archive.firstSequence < expectedSequence) addFinding(findings, 'AUDIT_SEGMENT_OVERLAP', 'error', `O arquivo ${archive.archiveId} sobrepõe sequências anteriores.`, { sequence: archive.firstSequence, documentId: archive.archiveId });
    if (archive.firstSequence > expectedSequence) addFinding(findings, 'AUDIT_SEGMENT_MISSING', 'error', `Há um segmento ausente antes da sequência ${archive.firstSequence}.`, { sequence: expectedSequence, documentId: archive.archiveId });
    if (archive.basePreviousHash !== expectedPreviousHash) addFinding(findings, 'AUDIT_SEGMENT_ANCHOR_MISMATCH', 'error', `A âncora do arquivo ${archive.archiveId} não continua o segmento anterior.`, { documentId: archive.archiveId });
    expectedSequence = archive.lastSequence + 1;
    expectedPreviousHash = archive.headHash;
  }
  if (candidate.activeJournal.length) {
    const first = candidate.activeJournal[0];
    if (first.sequence < expectedSequence) addFinding(findings, 'AUDIT_ACTIVE_OVERLAP', 'error', 'O diário ativo sobrepõe um arquivo histórico.', { sequence: first.sequence });
    if (first.sequence > expectedSequence) addFinding(findings, 'AUDIT_ACTIVE_SEGMENT_MISSING', 'error', 'Há um segmento ausente entre os arquivos e o diário ativo.', { sequence: expectedSequence });
    if (first.previousHash !== expectedPreviousHash) addFinding(findings, 'AUDIT_ACTIVE_ANCHOR_MISMATCH', 'error', 'O diário ativo não continua o head do último arquivo.');
  }
  if (!validateCatalogOperationalJournalChain(candidate.activeJournal, expectedPreviousHash, expectedSequence - 1)) addFinding(findings, 'AUDIT_ACTIVE_CHAIN_INVALID', 'error', 'A cadeia ativa do diário é inválida.');
  const entries = flattenEntries(candidate);
  return {
    ...(entries[0] ? { firstSequence: entries[0].sequence } : {}),
    ...(entries[entries.length - 1] ? { lastSequence: entries[entries.length - 1].sequence, headHash: entries[entries.length - 1].hash } : { headHash: expectedPreviousHash })
  };
};

export const verifyCatalogOperationalAuditPackage = (candidate: CatalogOperationalAuditPackage): CatalogOperationalAuditVerification => {
  const findings: CatalogOperationalAuditFinding[] = [];
  if (candidate.schemaVersion !== CATALOG_OPERATIONAL_AUDIT_PACKAGE_SCHEMA) addFinding(findings, 'AUDIT_SCHEMA_INVALID', 'error', 'O pacote de auditoria usa um schema incompatível.');
  if (!candidate.packageId?.trim() || !hex64.test(candidate.checksum)) addFinding(findings, 'AUDIT_ID_OR_CHECKSUM_INVALID', 'error', 'O identificador ou checksum do pacote é inválido.');
  if (candidate.checksum?.toLowerCase() !== catalogOperationalAuditPackageChecksum(candidate).toLowerCase()) addFinding(findings, 'AUDIT_PACKAGE_TAMPERED', 'error', 'O checksum do pacote não corresponde ao conteúdo.');
  if (!hex64.test(candidate.source?.deviceIdHash ?? '')) addFinding(findings, 'AUDIT_DEVICE_HASH_INVALID', 'error', 'O hash do dispositivo de origem é inválido.');
  if (!Number.isFinite(Date.parse(candidate.generatedAt))) addFinding(findings, 'AUDIT_GENERATED_AT_INVALID', 'error', 'A data de geração do pacote é inválida.');

  const sequence = validateSegments(candidate, findings);
  const allEntries = flattenEntries(candidate);
  const entriesBySequence = new Map(allEntries.map((entry) => [entry.sequence, entry]));
  if (entriesBySequence.size !== allEntries.length) addFinding(findings, 'AUDIT_DUPLICATE_SEQUENCE', 'error', 'O diário contém sequências duplicadas.');

  const authorizationByChecksum = new Map(candidate.authorizations.map((entry) => [catalogOperationalAuthorizationChecksum(entry).toLowerCase(), entry]));
  const confirmationByChecksum = new Map(candidate.executorConfirmations.map((entry) => [catalogExecutorConfirmationChecksum(entry).toLowerCase(), entry]));
  const reportByChecksum = new Map(candidate.aggregateReports.map((entry) => [catalogRolloutAggregateReportChecksum(entry).toLowerCase(), entry]));
  const decisionByChecksum = new Map(candidate.quorumDecisions.map((entry) => [entry.checksum.toLowerCase(), entry]));
  const receiptById = new Map<string, CatalogOperationalExecutionReceipt>();
  const usedNonces = new Set<string>();
  let cryptographicallyVerifiedReceipts = 0;

  for (const receipt of candidate.receipts) {
    if (receiptById.has(receipt.receiptId)) addFinding(findings, 'AUDIT_DUPLICATE_RECEIPT', 'error', `O recibo ${receipt.receiptId} aparece mais de uma vez.`, { receiptId: receipt.receiptId });
    receiptById.set(receipt.receiptId, receipt);
    if (!validateCatalogOperationalExecutionReceipt(receipt)) addFinding(findings, 'AUDIT_RECEIPT_INVALID', 'error', `O recibo ${receipt.receiptId} é inválido.`, { receiptId: receipt.receiptId });
    if (usedNonces.has(receipt.nonce)) addFinding(findings, 'AUDIT_NONCE_REPLAY', 'error', `O nonce do recibo ${receipt.receiptId} já foi utilizado.`, { receiptId: receipt.receiptId });
    usedNonces.add(receipt.nonce);

    const authorization = authorizationByChecksum.get(receipt.authorizationChecksum.toLowerCase());
    const confirmation = confirmationByChecksum.get(receipt.executorConfirmationChecksum.toLowerCase());
    const decision = decisionByChecksum.get(receipt.quorumDecisionChecksum.toLowerCase());
    const report = reportByChecksum.get(receipt.aggregateReportChecksum.toLowerCase());
    if (!authorization) addFinding(findings, 'AUDIT_AUTHORIZATION_MISSING', 'error', `A autorização do recibo ${receipt.receiptId} está ausente.`, { receiptId: receipt.receiptId });
    if (!confirmation) addFinding(findings, 'AUDIT_EXECUTOR_CONFIRMATION_MISSING', 'error', `A confirmação do executor do recibo ${receipt.receiptId} está ausente.`, { receiptId: receipt.receiptId });
    if (!decision || !validateCatalogReleaseQuorumDecision(decision) || decision.status !== 'approved') addFinding(findings, 'AUDIT_QUORUM_DECISION_INVALID', 'error', `A decisão de quórum do recibo ${receipt.receiptId} está ausente ou não foi aprovada.`, { receiptId: receipt.receiptId });
    if (!report) addFinding(findings, 'AUDIT_AGGREGATE_REPORT_MISSING', 'error', `O relatório consolidado do recibo ${receipt.receiptId} está ausente.`, { receiptId: receipt.receiptId });
    if (authorization && (authorization.authorizationId !== receipt.authorizationId || authorization.quorumDecisionChecksum !== receipt.quorumDecisionChecksum || authorization.aggregateReportChecksum !== receipt.aggregateReportChecksum || authorization.publicationId !== receipt.publicationId || authorization.action !== receipt.action || authorization.nonce !== receipt.nonce)) addFinding(findings, 'AUDIT_AUTHORIZATION_LINK_MISMATCH', 'error', `O recibo ${receipt.receiptId} diverge da autorização operacional.`, { receiptId: receipt.receiptId });
    if (confirmation && authorization && (confirmation.authorizationChecksum !== receipt.authorizationChecksum || confirmation.quorumDecisionChecksum !== receipt.quorumDecisionChecksum || confirmation.publicationId !== receipt.publicationId || confirmation.action !== receipt.action || confirmation.nonce !== receipt.nonce || confirmation.executorId !== receipt.executor.executorId)) addFinding(findings, 'AUDIT_EXECUTOR_LINK_MISMATCH', 'error', `O recibo ${receipt.receiptId} diverge da confirmação do executor.`, { receiptId: receipt.receiptId });
    if (decision && authorization && (decision.action !== authorization.action || decision.targetRolloutPercent !== authorization.targetRolloutPercent || decision.targetChannel !== authorization.targetChannel)) addFinding(findings, 'AUDIT_QUORUM_SCOPE_MISMATCH', 'error', `A decisão de quórum do recibo ${receipt.receiptId} possui outro escopo.`, { receiptId: receipt.receiptId });

    if (candidate.trustRegistry && authorization && confirmation && decision && report) {
      const publication = candidate.publications.find((entry) => entry.publicationId === receipt.publicationId);
      const policy = candidate.aggregationPolicies.find((entry) => entry.aggregationPolicyId === report.aggregationPolicyId && entry.revision === report.aggregationPolicyRevision);
      const approvals = candidate.releaseApprovals.filter((entry) => decision.approvalIds.includes(entry.approvalId));
      if (!publication) addFinding(findings, 'AUDIT_PUBLICATION_MISSING', 'error', `A publicação do recibo ${receipt.receiptId} está ausente.`, { receiptId: receipt.receiptId });
      if (!policy) addFinding(findings, 'AUDIT_AGGREGATION_POLICY_MISSING', 'error', `A política do recibo ${receipt.receiptId} está ausente.`, { receiptId: receipt.receiptId });
      if (publication && policy) {
        try {
          const now = () => new Date(receipt.completedAt);
          verifySignedCatalogPublication({ publication, registry: candidate.trustRegistry, now });
          verifySignedCatalogRolloutAggregationPolicy({ policy, registry: candidate.trustRegistry, publication, now });
          verifySignedCatalogOperationalAuthorization({ authorization, registry: candidate.trustRegistry, decision, report, policy, approvals, publication, now });
          verifySignedCatalogExecutorConfirmation({ confirmation, authorization, registry: candidate.trustRegistry, now });
          cryptographicallyVerifiedReceipts += 1;
        } catch (error) {
          addFinding(findings, 'AUDIT_CRYPTOGRAPHIC_CHAIN_INVALID', 'error', error instanceof Error ? error.message : `A cadeia criptográfica do recibo ${receipt.receiptId} é inválida.`, { receiptId: receipt.receiptId });
        }
      }
    } else if (!candidate.trustRegistry) {
      addFinding(findings, 'AUDIT_TRUST_REGISTRY_NOT_INCLUDED', 'warning', 'O pacote não inclui o registro de confiança; os vínculos foram verificados apenas por checksum.');
    }
  }

  for (const evidence of candidate.evidence) {
    if (!validateCatalogOperationalEvidence(evidence)) addFinding(findings, 'AUDIT_EVIDENCE_INVALID', 'error', `A evidência ${evidence.evidenceId} é inválida.`, { documentId: evidence.evidenceId, receiptId: evidence.receipt.receiptId });
    const receipt = receiptById.get(evidence.receipt.receiptId);
    if (!receipt || receipt.checksum !== evidence.receipt.checksum) addFinding(findings, 'AUDIT_EVIDENCE_RECEIPT_MISSING', 'error', `A evidência ${evidence.evidenceId} não possui recibo correspondente no pacote.`, { documentId: evidence.evidenceId });
    for (const entry of evidence.journalEntries) {
      const canonical = entriesBySequence.get(entry.sequence);
      if (!canonical || canonical.hash !== entry.hash) addFinding(findings, 'AUDIT_EVIDENCE_JOURNAL_LINK_MISSING', 'error', `A evidência ${evidence.evidenceId} referencia uma entrada ausente ou divergente.`, { documentId: evidence.evidenceId, sequence: entry.sequence });
    }
    for (const archiveHead of evidence.archiveHeads) {
      const archive = candidate.archives.find((entry) => entry.archiveId === archiveHead.archiveId);
      if (!archive || archive.headHash !== archiveHead.headHash || archive.checksum !== archiveHead.checksum) addFinding(findings, 'AUDIT_EVIDENCE_ARCHIVE_LINK_MISSING', 'error', `A evidência ${evidence.evidenceId} referencia um arquivo ausente ou divergente.`, { documentId: evidence.evidenceId });
    }
  }

  const uniqueWarningCodes = new Set(findings.filter((entry) => entry.severity === 'warning').map((entry) => entry.code));
  if (uniqueWarningCodes.has('AUDIT_TRUST_REGISTRY_NOT_INCLUDED') && candidate.receipts.length === 0) findings.splice(findings.findIndex((entry) => entry.code === 'AUDIT_TRUST_REGISTRY_NOT_INCLUDED'), 1);
  const status: CatalogOperationalAuditStatus = findings.some((entry) => entry.severity === 'error') ? 'rejected' : findings.some((entry) => entry.severity === 'warning') ? 'warning' : 'approved';
  return {
    status,
    packageId: candidate.packageId,
    packageChecksum: candidate.checksum,
    generatedAt: new Date().toISOString(),
    findings,
    counts: {
      archives: candidate.archives.length,
      activeEntries: candidate.activeJournal.length,
      totalEntries: allEntries.length,
      receipts: candidate.receipts.length,
      evidence: candidate.evidence.length,
      authorizations: candidate.authorizations.length,
      confirmations: candidate.executorConfirmations.length,
      quorumDecisions: candidate.quorumDecisions.length,
      cryptographicallyVerifiedReceipts
    },
    ...sequence
  };
};

export const parseCatalogOperationalAuditPackage = (raw: string): CatalogOperationalAuditPackage => JSON.parse(raw) as CatalogOperationalAuditPackage;

export const compareCatalogOperationalAuditPackages = (left: CatalogOperationalAuditPackage, right: CatalogOperationalAuditPackage): CatalogOperationalAuditComparison => {
  const leftEntries = flattenEntries(left);
  const rightEntries = flattenEntries(right);
  const limit = Math.min(leftEntries.length, rightEntries.length);
  let commonEntries = 0;
  while (commonEntries < limit && leftEntries[commonEntries].sequence === rightEntries[commonEntries].sequence && leftEntries[commonEntries].hash === rightEntries[commonEntries].hash) commonEntries += 1;
  const leftHeadHash = leftEntries[leftEntries.length - 1]?.hash;
  const rightHeadHash = rightEntries[rightEntries.length - 1]?.hash;
  let status: CatalogOperationalAuditComparisonStatus;
  if (commonEntries === leftEntries.length && commonEntries === rightEntries.length && left.source.deviceIdHash === right.source.deviceIdHash) status = 'identical';
  else if (commonEntries === 0 && left.source.deviceIdHash !== right.source.deviceIdHash) status = 'unrelated';
  else if (commonEntries === leftEntries.length && leftEntries.length < rightEntries.length) status = 'rightAhead';
  else if (commonEntries === rightEntries.length && rightEntries.length < leftEntries.length) status = 'leftAhead';
  else status = 'forked';
  const issues: string[] = [];
  if (status === 'forked') issues.push(`Os diários divergem na sequência ${leftEntries[commonEntries]?.sequence ?? rightEntries[commonEntries]?.sequence ?? 1}.`);
  if (status === 'unrelated') issues.push('Os pacotes não compartilham uma origem ou prefixo comum verificável.');
  return {
    status,
    commonEntries,
    leftEntries: leftEntries.length,
    rightEntries: rightEntries.length,
    ...(status === 'forked' ? { firstDivergentSequence: leftEntries[commonEntries]?.sequence ?? rightEntries[commonEntries]?.sequence } : {}),
    ...(leftHeadHash ? { leftHeadHash } : {}),
    ...(rightHeadHash ? { rightHeadHash } : {}),
    issues
  };
};

export const catalogOperationalAuditReportPayload = (report: SignedCatalogOperationalAuditReport): string => stableStringify({ ...report, signature: undefined });
export const catalogOperationalAuditReportChecksum = (report: SignedCatalogOperationalAuditReport): string => sha256Hex(stableStringify(report));

export const buildCatalogOperationalAuditReport = (params: {
  verification: CatalogOperationalAuditVerification;
  publisherId: string;
  keyId: string;
  auditorStatement: string;
  now?: () => Date;
}): SignedCatalogOperationalAuditReport => {
  if (!params.verification.packageId || !params.verification.packageChecksum) throw new Error('A verificação não identifica o pacote auditado.');
  const generatedAt = (params.now ?? (() => new Date()))().toISOString();
  return {
    schemaVersion: CATALOG_OPERATIONAL_AUDIT_REPORT_SCHEMA,
    reportId: `catalog-operational-audit-report-${sha256Hex(`${params.verification.packageChecksum}:${generatedAt}`).slice(0, 16)}`,
    generatedAt,
    publisherId: params.publisherId,
    keyId: params.keyId,
    packageId: params.verification.packageId,
    packageChecksum: params.verification.packageChecksum,
    auditStatus: params.verification.status,
    findingCodes: [...new Set(params.verification.findings.map((entry) => entry.code))].sort(),
    ...(params.verification.firstSequence !== undefined ? { firstSequence: params.verification.firstSequence } : {}),
    ...(params.verification.lastSequence !== undefined ? { lastSequence: params.verification.lastSequence } : {}),
    ...(params.verification.headHash ? { headHash: params.verification.headHash } : {}),
    auditorStatement: params.auditorStatement.trim(),
    signature: ''
  };
};

export const verifySignedCatalogOperationalAuditReport = (params: {
  report: SignedCatalogOperationalAuditReport;
  auditPackage: CatalogOperationalAuditPackage;
  registry: CatalogTrustRegistry;
  now?: () => Date;
}): SignedCatalogOperationalAuditReport => {
  const { report, auditPackage, registry } = params;
  if (report.schemaVersion !== CATALOG_OPERATIONAL_AUDIT_REPORT_SCHEMA || !report.reportId?.trim() || !report.auditorStatement?.trim()) throw new Error('O relatório de auditoria é incompatível ou incompleto.');
  const verification = verifyCatalogOperationalAuditPackage(auditPackage);
  if (report.packageId !== auditPackage.packageId || report.packageChecksum !== auditPackage.checksum) throw new Error('O relatório não corresponde ao pacote auditado.');
  if (report.auditStatus !== verification.status) throw new Error('O status do relatório diverge da verificação independente.');
  if (stableStringify(report.findingCodes) !== stableStringify([...new Set(verification.findings.map((entry) => entry.code))].sort())) throw new Error('Os achados do relatório divergem da verificação independente.');
  if (report.firstSequence !== verification.firstSequence || report.lastSequence !== verification.lastSequence || report.headHash !== verification.headHash) throw new Error('A âncora histórica do relatório diverge do pacote.');
  const issuedAt = Date.parse(report.generatedAt);
  const now = (params.now ?? (() => new Date()))().getTime();
  if (!Number.isFinite(issuedAt) || issuedAt > now + 300000) throw new Error('A data do relatório de auditoria é inválida.');
  const key = trustedKey(registry, report.publisherId, report.keyId);
  if (!verifyP256Signature(catalogOperationalAuditReportPayload(report), report.signature, key.publicJwk)) throw new Error('A assinatura do relatório de auditoria é inválida.');
  return clone(report);
};

export const createDefaultCatalogOperationalAuditRetentionPolicy = (): CatalogOperationalAuditRetentionPolicy => ({
  schemaVersion: CATALOG_OPERATIONAL_AUDIT_RETENTION_POLICY_SCHEMA,
  policyId: 'catalog-operational-audit-retention-default-v1',
  minimumRetentionDays: 2555,
  activeEntryLimit: 1000,
  archiveEntryTarget: 800,
  retainEvidence: true,
  requireVerifiedExportBeforeDeletion: true
});

export const evaluateCatalogOperationalAuditRetention = (params: {
  auditPackage: CatalogOperationalAuditPackage;
  policy?: CatalogOperationalAuditRetentionPolicy;
  now?: () => Date;
}): CatalogOperationalAuditRetentionPlan => {
  const policy = params.policy ?? createDefaultCatalogOperationalAuditRetentionPolicy();
  if (policy.schemaVersion !== CATALOG_OPERATIONAL_AUDIT_RETENTION_POLICY_SCHEMA || policy.minimumRetentionDays < 365 || policy.activeEntryLimit < 100 || policy.archiveEntryTarget < 1 || policy.archiveEntryTarget >= policy.activeEntryLimit || policy.retainEvidence !== true || policy.requireVerifiedExportBeforeDeletion !== true) throw new Error('A política de retenção operacional é inválida.');
  const verification = verifyCatalogOperationalAuditPackage(params.auditPackage);
  const warnings: string[] = [];
  if (verification.status === 'rejected') warnings.push('O pacote precisa ser corrigido antes de orientar retenção ou arquivamento.');
  if (params.auditPackage.activeJournal.length > policy.activeEntryLimit) warnings.push('O diário ativo ultrapassou o limite definido pela política.');
  return {
    policyId: policy.policyId,
    generatedAt: (params.now ?? (() => new Date()))().toISOString(),
    activeEntries: params.auditPackage.activeJournal.length,
    archiveRecommended: params.auditPackage.activeJournal.length > policy.activeEntryLimit,
    recommendedArchiveCount: Math.max(0, params.auditPackage.activeJournal.length - policy.archiveEntryTarget),
    evidenceEligibleForDeletion: 0,
    warnings
  };
};
