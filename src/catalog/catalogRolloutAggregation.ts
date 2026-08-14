import { sha256Hex } from './catalogBundleDigest';
import {
  type CatalogReleaseChannel,
  type SignedCatalogPublication
} from './catalogPublication';
import {
  type CatalogRolloutCohortSummary,
  type CatalogRolloutHealthEvidence,
  type CatalogRolloutHealthStatus,
  type CatalogRolloutMetricSummary,
  type CatalogRolloutRecommendation,
  type CatalogRolloutHealthThresholds,
  validateCatalogRolloutHealthEvidence
} from './catalogRolloutHealth';
import {
  catalogPublicKeyFingerprint,
  verifyP256Signature,
  type CatalogTrustRegistry,
  type CatalogTrustedPublisher
} from './catalogTrust';
import { stableStringify } from './utils';

export const CATALOG_ROLLOUT_HEALTH_SUBMISSION_SCHEMA = 'dnd-catalog-rollout-health-submission.v1' as const;
export const CATALOG_ROLLOUT_AGGREGATION_POLICY_SCHEMA = 'dnd-catalog-rollout-aggregation-policy.v1' as const;
export const CATALOG_ROLLOUT_AGGREGATE_REPORT_SCHEMA = 'dnd-catalog-rollout-aggregate-report.v1' as const;
export const CATALOG_RELEASE_APPROVAL_SCHEMA = 'dnd-catalog-release-approval.v1' as const;
export const CATALOG_RELEASE_QUORUM_DECISION_SCHEMA = 'dnd-catalog-release-quorum-decision.v1' as const;

export type CatalogReleaseDecisionAction = 'hold' | 'expand' | 'promote' | 'pause' | 'rollback';
export type CatalogReleaseApprovalVote = 'approve' | 'reject';
export type CatalogReleaseQuorumStatus = 'pending' | 'approved' | 'rejected';

export interface CatalogRolloutHealthSubmission {
  schemaVersion: typeof CATALOG_ROLLOUT_HEALTH_SUBMISSION_SCHEMA;
  submissionId: string;
  submittedAt: string;
  contributorToken: string;
  evidence: CatalogRolloutHealthEvidence;
  checksum: string;
}

export interface CatalogRolloutAggregationApprover {
  approverId: string;
  publisherId: string;
  keyId: string;
}

export interface SignedCatalogRolloutAggregationPolicy {
  schemaVersion: typeof CATALOG_ROLLOUT_AGGREGATION_POLICY_SCHEMA;
  aggregationPolicyId: string;
  publisherId: string;
  keyId: string;
  publicationId: string;
  channel: CatalogReleaseChannel;
  issuedAt: string;
  expiresAt?: string;
  revision: number;
  minimumUniqueContributors: number;
  minimumCohortContributors: number;
  maximumEvidenceAgeHours: number;
  healthPolicyId: string;
  healthPolicyRevision: number;
  healthThresholds: CatalogRolloutHealthThresholds;
  quorum: {
    minimumApprovals: number;
    approvers: CatalogRolloutAggregationApprover[];
  };
  signature: string;
}

export interface CatalogRolloutAggregateCohortSummary {
  band: CatalogRolloutCohortSummary['band'];
  contributorCount: number;
  samples: number;
  suppressed: boolean;
  successRate?: number;
  failureRate?: number;
  rollbackRate?: number;
}

export interface SignedCatalogRolloutAggregateReport {
  schemaVersion: typeof CATALOG_ROLLOUT_AGGREGATE_REPORT_SCHEMA;
  reportId: string;
  generatedAt: string;
  publisherId: string;
  keyId: string;
  publicationId: string;
  channel: CatalogReleaseChannel;
  catalogVersion: string;
  snapshotId: string;
  aggregationPolicyId: string;
  aggregationPolicyRevision: number;
  uniqueContributors: number;
  acceptedSubmissions: number;
  duplicateSubmissions: number;
  rejectedSubmissions: number;
  windowStartedAt: string;
  windowEndedAt: string;
  metrics: CatalogRolloutMetricSummary;
  cohorts: CatalogRolloutAggregateCohortSummary[];
  status: CatalogRolloutHealthStatus;
  recommendation: CatalogRolloutRecommendation;
  findings: string[];
  sourceEvidenceChecksums: string[];
  signature: string;
}

export interface SignedCatalogReleaseApproval {
  schemaVersion: typeof CATALOG_RELEASE_APPROVAL_SCHEMA;
  approvalId: string;
  issuedAt: string;
  approverId: string;
  publisherId: string;
  keyId: string;
  publicationId: string;
  aggregateReportChecksum: string;
  action: CatalogReleaseDecisionAction;
  targetRolloutPercent?: number;
  targetChannel?: CatalogReleaseChannel;
  vote: CatalogReleaseApprovalVote;
  reason: string;
  signature: string;
}

export interface CatalogReleaseQuorumDecision {
  schemaVersion: typeof CATALOG_RELEASE_QUORUM_DECISION_SCHEMA;
  decisionId: string;
  evaluatedAt: string;
  publicationId: string;
  aggregateReportChecksum: string;
  action: CatalogReleaseDecisionAction;
  targetRolloutPercent?: number;
  targetChannel?: CatalogReleaseChannel;
  requiredApprovals: number;
  approvalCount: number;
  rejectionCount: number;
  status: CatalogReleaseQuorumStatus;
  approvalIds: string[];
  rejectionIds: string[];
  automaticExecution: false;
  checksum: string;
}

const hex64 = /^[a-f0-9]{64}$/i;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const clampRate = (value: number): number => Math.max(0, Math.min(1, value));
const ratio = (numerator: number, denominator: number): number => denominator > 0 ? numerator / denominator : 0;
const activeOrHistoricalKey = (publisher: CatalogTrustedPublisher, keyId: string) => publisher.keys.find((key) => key.keyId === keyId && key.status !== 'revoked');

const assertIsoDate = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} é inválida.`);
  return parsed;
};

const trustedKey = (registry: CatalogTrustRegistry, publisherId: string, keyId: string) => {
  const publisher = registry.publishers.find((entry) => entry.publisherId === publisherId && entry.status === 'trusted');
  if (!publisher) throw new Error('O documento foi assinado por um publicador não confiável.');
  const key = activeOrHistoricalKey(publisher, keyId);
  if (!key || key.fingerprint !== catalogPublicKeyFingerprint(key.publicJwk)) throw new Error('A chave de assinatura não é confiável.');
  return { publisher, key };
};

const assertThresholds = (thresholds: CatalogRolloutHealthThresholds): void => {
  if (!Number.isInteger(thresholds.minimumSampleSize) || thresholds.minimumSampleSize < 1) throw new Error('A amostra mínima de saúde é inválida.');
  for (const value of [thresholds.minimumSuccessRate, thresholds.maximumFailureRate, thresholds.maximumRollbackRate, thresholds.maximumIntegrityFailureRate]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Um limite de taxa está fora da faixa entre zero e um.');
  }
  if (!Number.isFinite(thresholds.maximumP95DurationMs) || thresholds.maximumP95DurationMs <= 0) throw new Error('O limite de duração p95 é inválido.');
};

export const catalogRolloutHealthSubmissionChecksum = (submission: Omit<CatalogRolloutHealthSubmission, 'checksum'>): string => sha256Hex(stableStringify(submission));

export const createCatalogRolloutHealthSubmission = (params: {
  evidence: CatalogRolloutHealthEvidence;
  contributorSecret: string;
  now?: () => Date;
}): CatalogRolloutHealthSubmission => {
  if (!validateCatalogRolloutHealthEvidence(params.evidence)) throw new Error('A evidência local de saúde é inválida.');
  if (!params.contributorSecret || params.contributorSecret.length < 24) throw new Error('O segredo local de contribuição é insuficiente.');
  const submittedAt = (params.now ?? (() => new Date()))().toISOString();
  const contributorToken = sha256Hex(`rollout-contributor-v1:${params.contributorSecret}:${params.evidence.publicationId}:${params.evidence.policyId}`);
  const payload: Omit<CatalogRolloutHealthSubmission, 'checksum'> = {
    schemaVersion: CATALOG_ROLLOUT_HEALTH_SUBMISSION_SCHEMA,
    submissionId: `rollout-submission-${params.evidence.publicationId}-${sha256Hex(`${contributorToken}:${params.evidence.checksum}`).slice(0, 16)}`,
    submittedAt,
    contributorToken,
    evidence: clone(params.evidence)
  };
  return { ...payload, checksum: catalogRolloutHealthSubmissionChecksum(payload) };
};

export const validateCatalogRolloutHealthSubmission = (submission: CatalogRolloutHealthSubmission): boolean => {
  if (submission.schemaVersion !== CATALOG_ROLLOUT_HEALTH_SUBMISSION_SCHEMA || !hex64.test(submission.contributorToken) || !hex64.test(submission.checksum)) return false;
  const { checksum, ...payload } = submission;
  return validateCatalogRolloutHealthEvidence(submission.evidence) && checksum.toLowerCase() === catalogRolloutHealthSubmissionChecksum(payload).toLowerCase();
};

export const catalogRolloutAggregationPolicyPayload = (policy: SignedCatalogRolloutAggregationPolicy): string => stableStringify({ ...policy, signature: undefined });

export const verifySignedCatalogRolloutAggregationPolicy = (params: {
  policy: SignedCatalogRolloutAggregationPolicy;
  registry: CatalogTrustRegistry;
  publication: SignedCatalogPublication;
  previousPolicies?: SignedCatalogRolloutAggregationPolicy[];
  now?: () => Date;
}): SignedCatalogRolloutAggregationPolicy => {
  const { policy, registry, publication, previousPolicies = [] } = params;
  if (policy.schemaVersion !== CATALOG_ROLLOUT_AGGREGATION_POLICY_SCHEMA) throw new Error('Política de agregação incompatível.');
  if (!policy.aggregationPolicyId?.trim() || policy.publicationId !== publication.publicationId || policy.publisherId !== publication.publisherId || policy.channel !== publication.channel) throw new Error('A política de agregação não corresponde à publicação.');
  if (!Number.isInteger(policy.revision) || policy.revision < 1) throw new Error('A revisão da política de agregação é inválida.');
  const last = [...previousPolicies].filter((entry) => entry.publicationId === policy.publicationId).sort((a, b) => b.revision - a.revision)[0];
  if (last && policy.revision !== last.revision + 1) throw new Error(`A revisão esperada da política de agregação é ${last.revision + 1}.`);
  if (!last && policy.revision !== 1) throw new Error('A primeira política de agregação precisa usar revisão 1.');
  if (!Number.isInteger(policy.minimumUniqueContributors) || policy.minimumUniqueContributors < 3) throw new Error('O anonimato mínimo exige pelo menos três contribuidores.');
  if (!Number.isInteger(policy.minimumCohortContributors) || policy.minimumCohortContributors < 3 || policy.minimumCohortContributors > policy.minimumUniqueContributors) throw new Error('O limite mínimo por coorte é inválido.');
  if (!Number.isFinite(policy.maximumEvidenceAgeHours) || policy.maximumEvidenceAgeHours <= 0) throw new Error('A idade máxima das evidências é inválida.');
  if (!policy.healthPolicyId?.trim() || !Number.isInteger(policy.healthPolicyRevision) || policy.healthPolicyRevision < 1) throw new Error('A política de saúde referenciada é inválida.');
  assertThresholds(policy.healthThresholds);
  const approvers = policy.quorum?.approvers ?? [];
  if (!Number.isInteger(policy.quorum?.minimumApprovals) || policy.quorum.minimumApprovals < 2 || policy.quorum.minimumApprovals > approvers.length) throw new Error('O quórum exige pelo menos duas aprovações independentes.');
  const uniqueApprovers = new Set(approvers.map((entry) => entry.approverId));
  const uniqueKeys = new Set(approvers.map((entry) => `${entry.publisherId}:${entry.keyId}`));
  if (uniqueApprovers.size !== approvers.length || uniqueKeys.size !== approvers.length) throw new Error('Os aprovadores do quórum precisam ser independentes.');
  for (const approver of approvers) trustedKey(registry, approver.publisherId, approver.keyId);
  const { key } = trustedKey(registry, policy.publisherId, policy.keyId);
  if (!verifyP256Signature(catalogRolloutAggregationPolicyPayload(policy), policy.signature, key.publicJwk)) throw new Error('A assinatura da política de agregação é inválida.');
  const now = (params.now ?? (() => new Date()))().getTime();
  const issuedAt = assertIsoDate(policy.issuedAt, 'A data da política de agregação');
  if (issuedAt > now + 300000) throw new Error('A política de agregação foi emitida no futuro.');
  if (policy.expiresAt && now > assertIsoDate(policy.expiresAt, 'A expiração da política de agregação')) throw new Error('A política de agregação expirou.');
  return clone(policy);
};

const sumMetrics = (evidence: CatalogRolloutHealthEvidence[]): CatalogRolloutMetricSummary => {
  const sum = (key: keyof CatalogRolloutMetricSummary) => evidence.reduce((total, entry) => total + Number(entry.metrics[key] ?? 0), 0);
  const eligibleObservations = sum('eligibleObservations');
  const downloadAttempts = sum('downloadAttempts');
  const downloadSuccesses = sum('downloadSuccesses');
  const downloadFailures = sum('downloadFailures');
  const integrityFailures = sum('integrityFailures');
  const previews = sum('previews');
  const commitAttempts = sum('commitAttempts');
  const commitSuccesses = sum('commitSuccesses');
  const commitFailures = sum('commitFailures');
  const rollbacks = sum('rollbacks');
  const durations = evidence.map((entry) => entry.metrics.p95DurationMs).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return {
    eligibleObservations,
    downloadAttempts,
    downloadSuccesses,
    downloadFailures,
    integrityFailures,
    previews,
    commitAttempts,
    commitSuccesses,
    commitFailures,
    rollbacks,
    adoptionRate: clampRate(ratio(commitSuccesses, Math.max(eligibleObservations, commitAttempts))),
    successRate: clampRate(ratio(downloadSuccesses + commitSuccesses, Math.max(downloadAttempts + commitAttempts, 1))),
    failureRate: clampRate(ratio(downloadFailures + commitFailures + integrityFailures, Math.max(downloadAttempts + commitAttempts, 1))),
    rollbackRate: clampRate(ratio(rollbacks, Math.max(commitSuccesses, 1))),
    integrityFailureRate: clampRate(ratio(integrityFailures, Math.max(downloadAttempts, 1))),
    p95DurationMs: durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] ?? 0
  };
};

const evaluateAggregateHealth = (metrics: CatalogRolloutMetricSummary, thresholds: CatalogRolloutHealthThresholds, publication: SignedCatalogPublication): { status: CatalogRolloutHealthStatus; recommendation: CatalogRolloutRecommendation; findings: string[] } => {
  const samples = metrics.downloadAttempts + metrics.commitAttempts;
  if (samples < thresholds.minimumSampleSize) return { status: 'insufficient', recommendation: 'hold', findings: [`Amostra operacional ${samples}/${thresholds.minimumSampleSize}.`] };
  const findings: string[] = [];
  if (metrics.integrityFailureRate > thresholds.maximumIntegrityFailureRate) findings.push('Falhas de integridade acima do limite consolidado.');
  if (metrics.rollbackRate > thresholds.maximumRollbackRate) findings.push('Taxa consolidada de rollback acima do limite.');
  if (metrics.failureRate > thresholds.maximumFailureRate) findings.push('Taxa consolidada de falha acima do limite.');
  if (metrics.successRate < thresholds.minimumSuccessRate) findings.push('Taxa consolidada de sucesso abaixo do mínimo.');
  if (metrics.p95DurationMs > thresholds.maximumP95DurationMs) findings.push('Duração p95 consolidada acima do limite.');
  if (metrics.integrityFailureRate > thresholds.maximumIntegrityFailureRate || metrics.rollbackRate > thresholds.maximumRollbackRate) return { status: 'unhealthy', recommendation: metrics.rollbackRate > thresholds.maximumRollbackRate ? 'rollback' : 'pause', findings };
  if (findings.length) return { status: 'watch', recommendation: 'hold', findings };
  if (publication.rolloutPercent < 100) return { status: 'healthy', recommendation: 'expand', findings: ['Todos os limites consolidados foram atendidos.'] };
  if (publication.channel !== 'stable') return { status: 'healthy', recommendation: 'promote', findings: ['A publicação consolidada está saudável e totalmente distribuída.'] };
  return { status: 'healthy', recommendation: 'hold', findings: ['A publicação estável consolidada permanece saudável.'] };
};

const aggregateCohorts = (evidence: CatalogRolloutHealthEvidence[], minimum: number): CatalogRolloutAggregateCohortSummary[] => {
  const bands: CatalogRolloutCohortSummary['band'][] = ['0-24', '25-49', '50-74', '75-99', 'unknown'];
  return bands.map((band) => {
    const entries = evidence.map((item) => item.cohorts.find((cohort) => cohort.band === band)).filter((entry): entry is CatalogRolloutCohortSummary => Boolean(entry));
    const contributorCount = entries.length;
    const samples = entries.reduce((total, entry) => total + entry.samples, 0);
    const suppressed = contributorCount < minimum;
    if (suppressed) return { band, contributorCount, samples, suppressed };
    const weighted = (key: 'successRate' | 'failureRate' | 'rollbackRate') => ratio(entries.reduce((total, entry) => total + entry[key] * entry.samples, 0), Math.max(samples, 1));
    return { band, contributorCount, samples, suppressed, successRate: weighted('successRate'), failureRate: weighted('failureRate'), rollbackRate: weighted('rollbackRate') };
  }).filter((entry) => entry.contributorCount > 0);
};

export const catalogRolloutAggregateReportPayload = (report: SignedCatalogRolloutAggregateReport): string => stableStringify({ ...report, signature: undefined });
export const catalogRolloutAggregateReportChecksum = (report: SignedCatalogRolloutAggregateReport): string => sha256Hex(stableStringify(report));

export const buildCatalogRolloutAggregateReport = (params: {
  submissions: readonly CatalogRolloutHealthSubmission[];
  policy: SignedCatalogRolloutAggregationPolicy;
  publication: SignedCatalogPublication;
  reportPublisherId: string;
  reportKeyId: string;
  now?: () => Date;
}): SignedCatalogRolloutAggregateReport => {
  if (params.policy.publicationId !== params.publication.publicationId) throw new Error('A política de agregação não corresponde à publicação.');
  const nowDate = (params.now ?? (() => new Date()))();
  const nowMs = nowDate.getTime();
  const candidates = params.submissions.filter(validateCatalogRolloutHealthSubmission);
  const structurallyRejected = params.submissions.length - candidates.length;
  const eligible = candidates.filter((entry) => {
    const evidence = entry.evidence;
    const ageHours = (nowMs - Date.parse(evidence.generatedAt)) / 3600000;
    return evidence.publicationId === params.publication.publicationId && evidence.channel === params.publication.channel && evidence.policyId === params.policy.healthPolicyId && evidence.policyRevision === params.policy.healthPolicyRevision && ageHours >= 0 && ageHours <= params.policy.maximumEvidenceAgeHours;
  });
  const latestByContributor = new Map<string, CatalogRolloutHealthSubmission>();
  for (const entry of eligible) {
    const previous = latestByContributor.get(entry.contributorToken);
    if (!previous || Date.parse(entry.evidence.generatedAt) > Date.parse(previous.evidence.generatedAt)) latestByContributor.set(entry.contributorToken, entry);
  }
  const accepted = [...latestByContributor.values()].sort((a, b) => a.contributorToken.localeCompare(b.contributorToken));
  const duplicateSubmissions = eligible.length - accepted.length;
  const rejectedSubmissions = structurallyRejected + (candidates.length - eligible.length);
  if (accepted.length < params.policy.minimumUniqueContributors) throw new Error(`Anonimato insuficiente: ${accepted.length}/${params.policy.minimumUniqueContributors} contribuidores únicos.`);
  const evidence = accepted.map((entry) => entry.evidence);
  const metrics = sumMetrics(evidence);
  const assessment = evaluateAggregateHealth(metrics, params.policy.healthThresholds, params.publication);
  return {
    schemaVersion: CATALOG_ROLLOUT_AGGREGATE_REPORT_SCHEMA,
    reportId: `rollout-aggregate-${params.publication.publicationId}-${sha256Hex(`${nowDate.toISOString()}:${accepted.map((entry) => entry.checksum).join(':')}`).slice(0, 16)}`,
    generatedAt: nowDate.toISOString(),
    publisherId: params.reportPublisherId,
    keyId: params.reportKeyId,
    publicationId: params.publication.publicationId,
    channel: params.publication.channel,
    catalogVersion: params.publication.catalogVersion,
    snapshotId: params.publication.snapshotId,
    aggregationPolicyId: params.policy.aggregationPolicyId,
    aggregationPolicyRevision: params.policy.revision,
    uniqueContributors: accepted.length,
    acceptedSubmissions: accepted.length,
    duplicateSubmissions,
    rejectedSubmissions,
    windowStartedAt: evidence.map((entry) => entry.windowStartedAt).sort()[0] ?? nowDate.toISOString(),
    windowEndedAt: evidence.map((entry) => entry.windowEndedAt).sort()[evidence.length - 1] ?? nowDate.toISOString(),
    metrics,
    cohorts: aggregateCohorts(evidence, params.policy.minimumCohortContributors),
    status: assessment.status,
    recommendation: assessment.recommendation,
    findings: assessment.findings,
    sourceEvidenceChecksums: evidence.map((entry) => entry.checksum).sort(),
    signature: ''
  };
};

export const verifySignedCatalogRolloutAggregateReport = (params: {
  report: SignedCatalogRolloutAggregateReport;
  registry: CatalogTrustRegistry;
  policy: SignedCatalogRolloutAggregationPolicy;
  publication: SignedCatalogPublication;
  now?: () => Date;
}): SignedCatalogRolloutAggregateReport => {
  const { report, registry, policy, publication } = params;
  if (report.schemaVersion !== CATALOG_ROLLOUT_AGGREGATE_REPORT_SCHEMA) throw new Error('Relatório agregado incompatível.');
  if (report.publicationId !== publication.publicationId || report.channel !== publication.channel || report.catalogVersion !== publication.catalogVersion || report.snapshotId !== publication.snapshotId) throw new Error('O relatório agregado não corresponde à publicação.');
  if (report.aggregationPolicyId !== policy.aggregationPolicyId || report.aggregationPolicyRevision !== policy.revision) throw new Error('O relatório agregado não corresponde à política.');
  if (report.publisherId !== policy.publisherId || report.keyId !== policy.keyId) throw new Error('O relatório agregado não foi assinado pela chave autorizada na política.');
  if (report.uniqueContributors < policy.minimumUniqueContributors || report.acceptedSubmissions !== report.uniqueContributors) throw new Error('O relatório não atende ao anonimato mínimo.');
  if (!Array.isArray(report.sourceEvidenceChecksums) || report.sourceEvidenceChecksums.length !== report.uniqueContributors || new Set(report.sourceEvidenceChecksums).size !== report.uniqueContributors || report.sourceEvidenceChecksums.some((entry) => !hex64.test(entry))) throw new Error('As fontes do relatório agregado são inválidas.');
  if (report.cohorts.some((entry) => entry.contributorCount < policy.minimumCohortContributors && !entry.suppressed)) throw new Error('Uma coorte pequena foi exposta sem supressão.');
  const { key } = trustedKey(registry, report.publisherId, report.keyId);
  if (!verifyP256Signature(catalogRolloutAggregateReportPayload(report), report.signature, key.publicJwk)) throw new Error('A assinatura do relatório agregado é inválida.');
  const now = (params.now ?? (() => new Date()))().getTime();
  if (assertIsoDate(report.generatedAt, 'A data do relatório agregado') > now + 300000) throw new Error('O relatório agregado foi emitido no futuro.');
  return clone(report);
};

export const catalogReleaseApprovalPayload = (approval: SignedCatalogReleaseApproval): string => stableStringify({ ...approval, signature: undefined });

export const verifySignedCatalogReleaseApproval = (params: {
  approval: SignedCatalogReleaseApproval;
  registry: CatalogTrustRegistry;
  policy: SignedCatalogRolloutAggregationPolicy;
  report: SignedCatalogRolloutAggregateReport;
  now?: () => Date;
}): SignedCatalogReleaseApproval => {
  const { approval, registry, policy, report } = params;
  if (approval.schemaVersion !== CATALOG_RELEASE_APPROVAL_SCHEMA) throw new Error('Aprovação de release incompatível.');
  if (approval.publicationId !== report.publicationId || approval.aggregateReportChecksum !== catalogRolloutAggregateReportChecksum(report)) throw new Error('A aprovação não corresponde ao relatório agregado.');
  const allowed = policy.quorum.approvers.find((entry) => entry.approverId === approval.approverId && entry.publisherId === approval.publisherId && entry.keyId === approval.keyId);
  if (!allowed) throw new Error('O aprovador não faz parte do quórum autorizado.');
  if (!['approve', 'reject'].includes(approval.vote) || !['hold', 'expand', 'promote', 'pause', 'rollback'].includes(approval.action)) throw new Error('O voto ou a ação da aprovação é inválido.');
  if (approval.targetRolloutPercent !== undefined && (!Number.isFinite(approval.targetRolloutPercent) || approval.targetRolloutPercent < 0 || approval.targetRolloutPercent > 100)) throw new Error('O rollout alvo da aprovação é inválido.');
  if (approval.action === 'promote' && !approval.targetChannel) throw new Error('A promoção precisa informar o canal alvo.');
  const { key } = trustedKey(registry, approval.publisherId, approval.keyId);
  if (!verifyP256Signature(catalogReleaseApprovalPayload(approval), approval.signature, key.publicJwk)) throw new Error('A assinatura da aprovação é inválida.');
  const now = (params.now ?? (() => new Date()))().getTime();
  if (assertIsoDate(approval.issuedAt, 'A data da aprovação') > now + 300000) throw new Error('A aprovação foi emitida no futuro.');
  return clone(approval);
};

const decisionChecksum = (decision: Omit<CatalogReleaseQuorumDecision, 'checksum'>): string => sha256Hex(stableStringify(decision));

export const createCatalogReleaseQuorumDecision = (params: {
  action: CatalogReleaseDecisionAction;
  targetRolloutPercent?: number;
  targetChannel?: CatalogReleaseChannel;
  report: SignedCatalogRolloutAggregateReport;
  policy: SignedCatalogRolloutAggregationPolicy;
  registry: CatalogTrustRegistry;
  approvals: readonly SignedCatalogReleaseApproval[];
  now?: () => Date;
}): CatalogReleaseQuorumDecision => {
  const verified = params.approvals.map((approval) => verifySignedCatalogReleaseApproval({ approval, registry: params.registry, policy: params.policy, report: params.report, now: params.now }));
  const matching = verified.filter((entry) => entry.action === params.action && entry.targetRolloutPercent === params.targetRolloutPercent && entry.targetChannel === params.targetChannel);
  const unique = new Map<string, SignedCatalogReleaseApproval>();
  for (const approval of matching) {
    const identity = `${approval.approverId}:${approval.publisherId}:${approval.keyId}`;
    if (!unique.has(identity)) unique.set(identity, approval);
  }
  const approvals = [...unique.values()].filter((entry) => entry.vote === 'approve');
  const rejections = [...unique.values()].filter((entry) => entry.vote === 'reject');
  const status: CatalogReleaseQuorumStatus = rejections.length >= params.policy.quorum.minimumApprovals
    ? 'rejected'
    : approvals.length >= params.policy.quorum.minimumApprovals
      ? 'approved'
      : 'pending';
  const evaluatedAt = (params.now ?? (() => new Date()))().toISOString();
  const payload: Omit<CatalogReleaseQuorumDecision, 'checksum'> = {
    schemaVersion: CATALOG_RELEASE_QUORUM_DECISION_SCHEMA,
    decisionId: `release-decision-${params.report.reportId}-${sha256Hex(`${params.action}:${evaluatedAt}`).slice(0, 12)}`,
    evaluatedAt,
    publicationId: params.report.publicationId,
    aggregateReportChecksum: catalogRolloutAggregateReportChecksum(params.report),
    action: params.action,
    ...(params.targetRolloutPercent !== undefined ? { targetRolloutPercent: params.targetRolloutPercent } : {}),
    ...(params.targetChannel ? { targetChannel: params.targetChannel } : {}),
    requiredApprovals: params.policy.quorum.minimumApprovals,
    approvalCount: approvals.length,
    rejectionCount: rejections.length,
    status,
    approvalIds: approvals.map((entry) => entry.approvalId).sort(),
    rejectionIds: rejections.map((entry) => entry.approvalId).sort(),
    automaticExecution: false
  };
  return { ...payload, checksum: decisionChecksum(payload) };
};

export const validateCatalogReleaseQuorumDecision = (decision: CatalogReleaseQuorumDecision): boolean => {
  if (decision.schemaVersion !== CATALOG_RELEASE_QUORUM_DECISION_SCHEMA || decision.automaticExecution !== false || !hex64.test(decision.checksum)) return false;
  const { checksum, ...payload } = decision;
  return checksum.toLowerCase() === decisionChecksum(payload).toLowerCase();
};

export const parseCatalogRolloutHealthSubmission = (raw: string): CatalogRolloutHealthSubmission => JSON.parse(raw) as CatalogRolloutHealthSubmission;
export const parseSignedCatalogRolloutAggregationPolicy = (raw: string): SignedCatalogRolloutAggregationPolicy => JSON.parse(raw) as SignedCatalogRolloutAggregationPolicy;
export const parseSignedCatalogRolloutAggregateReport = (raw: string): SignedCatalogRolloutAggregateReport => JSON.parse(raw) as SignedCatalogRolloutAggregateReport;
export const parseSignedCatalogReleaseApproval = (raw: string): SignedCatalogReleaseApproval => JSON.parse(raw) as SignedCatalogReleaseApproval;
