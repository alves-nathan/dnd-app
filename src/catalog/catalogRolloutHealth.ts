import { sha256Hex } from './catalogBundleDigest';
import {
  catalogPublicKeyFingerprint,
  verifyP256Signature,
  type CatalogTrustRegistry,
  type CatalogTrustedPublisher
} from './catalogTrust';
import {
  type CatalogReleaseChannel,
  type SignedCatalogPublication
} from './catalogPublication';
import { stableStringify } from './utils';

export const CATALOG_ROLLOUT_HEALTH_POLICY_SCHEMA = 'dnd-catalog-rollout-health-policy.v1' as const;
export const CATALOG_ROLLOUT_HEALTH_EVIDENCE_SCHEMA = 'dnd-catalog-rollout-health-evidence.v1' as const;
export const CATALOG_ROLLOUT_DIRECTIVE_SCHEMA = 'dnd-catalog-rollout-directive.v1' as const;

export type CatalogRolloutSignalType =
  | 'eligibilityObserved'
  | 'downloadStarted'
  | 'downloadSucceeded'
  | 'downloadFailed'
  | 'integrityFailed'
  | 'previewOpened'
  | 'commitSucceeded'
  | 'commitFailed'
  | 'rollbackCompleted';

export type CatalogRolloutHealthStatus = 'insufficient' | 'healthy' | 'watch' | 'unhealthy';
export type CatalogRolloutRecommendation = 'hold' | 'expand' | 'promote' | 'pause' | 'rollback';
export type CatalogRolloutDirectiveAction = 'expand' | 'reduce' | 'promote' | 'pause' | 'rollback';

export interface CatalogRolloutHealthThresholds {
  minimumSampleSize: number;
  minimumSuccessRate: number;
  maximumFailureRate: number;
  maximumRollbackRate: number;
  maximumIntegrityFailureRate: number;
  maximumP95DurationMs: number;
}

export interface SignedCatalogRolloutHealthPolicy {
  schemaVersion: typeof CATALOG_ROLLOUT_HEALTH_POLICY_SCHEMA;
  policyId: string;
  publisherId: string;
  keyId: string;
  publicationId: string;
  channel: CatalogReleaseChannel;
  issuedAt: string;
  expiresAt?: string;
  revision: number;
  thresholds: CatalogRolloutHealthThresholds;
  signature: string;
}

export interface CatalogRolloutSignal {
  id: string;
  publicationId: string;
  publisherId: string;
  channel: CatalogReleaseChannel;
  type: CatalogRolloutSignalType;
  occurredAt: string;
  durationMs?: number;
  cohortScore?: number;
  issueCode?: string;
}

export interface CatalogRolloutMetricSummary {
  eligibleObservations: number;
  downloadAttempts: number;
  downloadSuccesses: number;
  downloadFailures: number;
  integrityFailures: number;
  previews: number;
  commitAttempts: number;
  commitSuccesses: number;
  commitFailures: number;
  rollbacks: number;
  adoptionRate: number;
  successRate: number;
  failureRate: number;
  rollbackRate: number;
  integrityFailureRate: number;
  p95DurationMs: number;
}

export interface CatalogRolloutCohortSummary {
  band: '0-24' | '25-49' | '50-74' | '75-99' | 'unknown';
  samples: number;
  successRate: number;
  failureRate: number;
  rollbackRate: number;
}

export interface CatalogRolloutHealthEvidence {
  schemaVersion: typeof CATALOG_ROLLOUT_HEALTH_EVIDENCE_SCHEMA;
  evidenceId: string;
  generatedAt: string;
  optInConfirmed: true;
  publicationId: string;
  publisherId: string;
  channel: CatalogReleaseChannel;
  catalogVersion: string;
  snapshotId: string;
  declaredRolloutPercent: number;
  effectiveRolloutPercent: number;
  windowStartedAt: string;
  windowEndedAt: string;
  policyId: string;
  policyRevision: number;
  metrics: CatalogRolloutMetricSummary;
  cohorts: CatalogRolloutCohortSummary[];
  status: CatalogRolloutHealthStatus;
  recommendation: CatalogRolloutRecommendation;
  findings: string[];
  checksum: string;
}

export interface SignedCatalogRolloutDirective {
  schemaVersion: typeof CATALOG_ROLLOUT_DIRECTIVE_SCHEMA;
  directiveId: string;
  publisherId: string;
  keyId: string;
  publicationId: string;
  issuedAt: string;
  revision: number;
  action: CatalogRolloutDirectiveAction;
  fromRolloutPercent: number;
  toRolloutPercent: number;
  sourceChannel: CatalogReleaseChannel;
  targetChannel?: CatalogReleaseChannel;
  targetPublicationId?: string;
  policyId: string;
  healthEvidenceChecksum: string;
  reason: string;
  signature: string;
}

export interface CatalogRolloutDirectiveVerification {
  directiveId: string;
  publicationId: string;
  revision: number;
  action: CatalogRolloutDirectiveAction;
  effectiveRolloutPercent: number;
  targetPublicationId?: string;
}

const hex64 = /^[a-f0-9]{64}$/i;
const activeOrHistoricalKey = (publisher: CatalogTrustedPublisher, keyId: string) => publisher.keys.find((key) => key.keyId === keyId && key.status !== 'revoked');
const policyPayload = (policy: SignedCatalogRolloutHealthPolicy): string => stableStringify({ ...policy, signature: undefined });
const directivePayload = (directive: SignedCatalogRolloutDirective): string => stableStringify({ ...directive, signature: undefined });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const clampRate = (value: number): number => Math.max(0, Math.min(1, value));
const rate = (numerator: number, denominator: number): number => denominator > 0 ? numerator / denominator : 0;
const channelOrder: CatalogReleaseChannel[] = ['preview', 'beta', 'stable'];

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

const assertPercent = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${label} precisa estar entre 0 e 100%.`);
};

const assertThresholds = (thresholds: CatalogRolloutHealthThresholds): void => {
  if (!Number.isInteger(thresholds.minimumSampleSize) || thresholds.minimumSampleSize < 1) throw new Error('A amostra mínima da política é inválida.');
  for (const [label, value] of [
    ['taxa mínima de sucesso', thresholds.minimumSuccessRate],
    ['taxa máxima de falha', thresholds.maximumFailureRate],
    ['taxa máxima de rollback', thresholds.maximumRollbackRate],
    ['taxa máxima de falha de integridade', thresholds.maximumIntegrityFailureRate]
  ] as const) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`A ${label} precisa estar entre 0 e 1.`);
  if (!Number.isFinite(thresholds.maximumP95DurationMs) || thresholds.maximumP95DurationMs <= 0) throw new Error('O limite de duração p95 é inválido.');
};

export const verifySignedCatalogRolloutHealthPolicy = (params: {
  policy: SignedCatalogRolloutHealthPolicy;
  registry: CatalogTrustRegistry;
  publication: SignedCatalogPublication;
  previousPolicies?: SignedCatalogRolloutHealthPolicy[];
  now?: () => Date;
}): SignedCatalogRolloutHealthPolicy => {
  const { policy, registry, publication, previousPolicies = [] } = params;
  if (policy.schemaVersion !== CATALOG_ROLLOUT_HEALTH_POLICY_SCHEMA) throw new Error('Política de saúde do rollout incompatível.');
  if (!policy.policyId?.trim() || policy.publicationId !== publication.publicationId || policy.publisherId !== publication.publisherId || policy.channel !== publication.channel) throw new Error('A política não corresponde à publicação.');
  if (!Number.isInteger(policy.revision) || policy.revision < 1) throw new Error('A revisão da política é inválida.');
  const last = [...previousPolicies].filter((entry) => entry.publicationId === policy.publicationId).sort((a, b) => b.revision - a.revision)[0];
  if (last && policy.revision !== last.revision + 1) throw new Error(`A revisão esperada da política é ${last.revision + 1}.`);
  if (!last && policy.revision !== 1) throw new Error('A primeira política precisa usar a revisão 1.');
  assertThresholds(policy.thresholds);
  const { key } = trustedKey(registry, policy.publisherId, policy.keyId);
  if (!verifyP256Signature(policyPayload(policy), policy.signature, key.publicJwk)) throw new Error('A assinatura da política de saúde é inválida.');
  const now = (params.now ?? (() => new Date()))().getTime();
  const issuedAt = assertIsoDate(policy.issuedAt, 'A data da política');
  if (issuedAt > now + 300000) throw new Error('A política foi emitida no futuro.');
  if (policy.expiresAt && now > assertIsoDate(policy.expiresAt, 'A expiração da política')) throw new Error('A política de saúde expirou.');
  if (key.validFrom && issuedAt < Date.parse(key.validFrom)) throw new Error('A política foi emitida antes da validade da chave.');
  if (key.validUntil && issuedAt > Date.parse(key.validUntil)) throw new Error('A política foi emitida depois da validade da chave.');
  if (key.retiredAt && issuedAt > Date.parse(key.retiredAt)) throw new Error('A política foi emitida depois da retirada da chave.');
  return clone(policy);
};

const percentile95 = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

const summarizeSignals = (signals: readonly CatalogRolloutSignal[]): CatalogRolloutMetricSummary => {
  const count = (type: CatalogRolloutSignalType) => signals.filter((entry) => entry.type === type).length;
  const eligibleObservations = count('eligibilityObserved');
  const downloadAttempts = count('downloadStarted');
  const downloadSuccesses = count('downloadSucceeded');
  const downloadFailures = count('downloadFailed');
  const integrityFailures = count('integrityFailed');
  const previews = count('previewOpened');
  const commitSuccesses = count('commitSucceeded');
  const commitFailures = count('commitFailed');
  const commitAttempts = commitSuccesses + commitFailures;
  const rollbacks = count('rollbackCompleted');
  const attemptTotal = downloadAttempts + commitAttempts;
  const successTotal = downloadSuccesses + commitSuccesses;
  const failureTotal = downloadFailures + commitFailures;
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
    adoptionRate: clampRate(rate(commitSuccesses, Math.max(eligibleObservations, commitAttempts))),
    successRate: clampRate(rate(successTotal, Math.max(attemptTotal, successTotal + failureTotal))),
    failureRate: clampRate(rate(failureTotal, Math.max(attemptTotal, successTotal + failureTotal))),
    rollbackRate: clampRate(rate(rollbacks, Math.max(commitSuccesses, 1))),
    integrityFailureRate: clampRate(rate(integrityFailures, Math.max(downloadAttempts, 1))),
    p95DurationMs: percentile95(signals.map((entry) => entry.durationMs).filter((value): value is number => Number.isFinite(value) && value! >= 0))
  };
};

const bandForScore = (score?: number): CatalogRolloutCohortSummary['band'] => {
  if (!Number.isFinite(score)) return 'unknown';
  if (score! < 2500) return '0-24';
  if (score! < 5000) return '25-49';
  if (score! < 7500) return '50-74';
  return '75-99';
};

const summarizeCohorts = (signals: readonly CatalogRolloutSignal[]): CatalogRolloutCohortSummary[] => {
  const bands: CatalogRolloutCohortSummary['band'][] = ['0-24', '25-49', '50-74', '75-99', 'unknown'];
  return bands.map((band) => {
    const entries = signals.filter((entry) => bandForScore(entry.cohortScore) === band);
    const metrics = summarizeSignals(entries);
    return { band, samples: entries.length, successRate: metrics.successRate, failureRate: metrics.failureRate, rollbackRate: metrics.rollbackRate };
  }).filter((entry) => entry.samples > 0);
};

export const catalogRolloutHealthEvidenceChecksum = (evidence: Omit<CatalogRolloutHealthEvidence, 'checksum'>): string => sha256Hex(stableStringify(evidence));

export const validateCatalogRolloutHealthEvidence = (evidence: CatalogRolloutHealthEvidence): boolean => {
  const { checksum, ...payload } = evidence;
  return evidence.schemaVersion === CATALOG_ROLLOUT_HEALTH_EVIDENCE_SCHEMA && hex64.test(checksum) && checksum.toLowerCase() === catalogRolloutHealthEvidenceChecksum(payload).toLowerCase();
};

const evaluateHealth = (metrics: CatalogRolloutMetricSummary, thresholds: CatalogRolloutHealthThresholds, publication: SignedCatalogPublication): { status: CatalogRolloutHealthStatus; recommendation: CatalogRolloutRecommendation; findings: string[] } => {
  const samples = metrics.downloadAttempts + metrics.commitAttempts;
  const findings: string[] = [];
  if (samples < thresholds.minimumSampleSize) return { status: 'insufficient', recommendation: 'hold', findings: [`Amostra ${samples}/${thresholds.minimumSampleSize}.`] };
  if (metrics.integrityFailureRate > thresholds.maximumIntegrityFailureRate) findings.push('Falhas de integridade acima do limite.');
  if (metrics.rollbackRate > thresholds.maximumRollbackRate) findings.push('Taxa de rollback acima do limite.');
  if (metrics.failureRate > thresholds.maximumFailureRate) findings.push('Taxa de falha acima do limite.');
  if (metrics.successRate < thresholds.minimumSuccessRate) findings.push('Taxa de sucesso abaixo do mínimo.');
  if (metrics.p95DurationMs > thresholds.maximumP95DurationMs) findings.push('Duração p95 acima do limite.');
  const severe = metrics.integrityFailureRate > thresholds.maximumIntegrityFailureRate || metrics.rollbackRate > thresholds.maximumRollbackRate;
  if (severe) return { status: 'unhealthy', recommendation: metrics.rollbackRate > thresholds.maximumRollbackRate ? 'rollback' : 'pause', findings };
  if (findings.length) return { status: 'watch', recommendation: 'hold', findings };
  if (publication.rolloutPercent < 100) return { status: 'healthy', recommendation: 'expand', findings: ['Todos os limites assinados foram atendidos.'] };
  if (publication.channel !== 'stable') return { status: 'healthy', recommendation: 'promote', findings: ['Publicação saudável e com rollout completo.'] };
  return { status: 'healthy', recommendation: 'hold', findings: ['Publicação estável e saudável.'] };
};

export const createCatalogRolloutHealthEvidence = (params: {
  publication: SignedCatalogPublication;
  policy: SignedCatalogRolloutHealthPolicy;
  signals: readonly CatalogRolloutSignal[];
  effectiveRolloutPercent?: number;
  optInConfirmed: boolean;
  now?: () => Date;
}): CatalogRolloutHealthEvidence => {
  if (!params.optInConfirmed) throw new Error('O compartilhamento de métricas precisa de opt-in explícito.');
  if (params.policy.publicationId !== params.publication.publicationId) throw new Error('A política não corresponde à publicação avaliada.');
  const signals = params.signals.filter((entry) => entry.publicationId === params.publication.publicationId);
  const now = params.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const started = signals.map((entry) => entry.occurredAt).sort()[0] ?? generatedAt;
  const metrics = summarizeSignals(signals);
  const assessment = evaluateHealth(metrics, params.policy.thresholds, params.publication);
  const effectiveRolloutPercent = params.effectiveRolloutPercent ?? params.publication.rolloutPercent;
  assertPercent(effectiveRolloutPercent, 'O rollout efetivo');
  const payload: Omit<CatalogRolloutHealthEvidence, 'checksum'> = {
    schemaVersion: CATALOG_ROLLOUT_HEALTH_EVIDENCE_SCHEMA,
    evidenceId: `rollout-health-${params.publication.publicationId}-${sha256Hex(`${generatedAt}:${signals.length}`).slice(0, 12)}`,
    generatedAt,
    optInConfirmed: true,
    publicationId: params.publication.publicationId,
    publisherId: params.publication.publisherId,
    channel: params.publication.channel,
    catalogVersion: params.publication.catalogVersion,
    snapshotId: params.publication.snapshotId,
    declaredRolloutPercent: params.publication.rolloutPercent,
    effectiveRolloutPercent,
    windowStartedAt: started,
    windowEndedAt: generatedAt,
    policyId: params.policy.policyId,
    policyRevision: params.policy.revision,
    metrics,
    cohorts: summarizeCohorts(signals),
    status: assessment.status,
    recommendation: assessment.recommendation,
    findings: assessment.findings
  };
  return { ...payload, checksum: catalogRolloutHealthEvidenceChecksum(payload) };
};

export const resolveEffectiveCatalogRollout = (
  publication: SignedCatalogPublication,
  directives: readonly SignedCatalogRolloutDirective[]
): { rolloutPercent: number; directiveId?: string; action?: CatalogRolloutDirectiveAction } => {
  const latest = [...directives].filter((entry) => entry.publicationId === publication.publicationId).sort((a, b) => b.revision - a.revision)[0];
  if (!latest) return { rolloutPercent: publication.rolloutPercent };
  return { rolloutPercent: latest.toRolloutPercent, directiveId: latest.directiveId, action: latest.action };
};

const expectedPromotionTarget = (source: CatalogReleaseChannel): CatalogReleaseChannel | undefined => {
  const index = channelOrder.indexOf(source);
  return index >= 0 && index < channelOrder.length - 1 ? channelOrder[index + 1] : undefined;
};

export const verifySignedCatalogRolloutDirective = (params: {
  directive: SignedCatalogRolloutDirective;
  registry: CatalogTrustRegistry;
  publication: SignedCatalogPublication;
  targetPublication?: SignedCatalogPublication;
  policy: SignedCatalogRolloutHealthPolicy;
  evidence: CatalogRolloutHealthEvidence;
  previousDirectives?: SignedCatalogRolloutDirective[];
  now?: () => Date;
}): CatalogRolloutDirectiveVerification => {
  const { directive, registry, publication, targetPublication, policy, evidence, previousDirectives = [] } = params;
  if (directive.schemaVersion !== CATALOG_ROLLOUT_DIRECTIVE_SCHEMA) throw new Error('Diretriz de rollout incompatível.');
  if (!directive.directiveId?.trim() || directive.publicationId !== publication.publicationId || directive.publisherId !== publication.publisherId || directive.sourceChannel !== publication.channel) throw new Error('A diretriz não corresponde à publicação.');
  if (!['expand', 'reduce', 'promote', 'pause', 'rollback'].includes(directive.action)) throw new Error('A ação da diretriz é inválida.');
  if (!Number.isInteger(directive.revision) || directive.revision < 1) throw new Error('A revisão da diretriz é inválida.');
  const previous = [...previousDirectives].filter((entry) => entry.publicationId === publication.publicationId).sort((a, b) => b.revision - a.revision)[0];
  if (previous && directive.revision !== previous.revision + 1) throw new Error(`A revisão esperada da diretriz é ${previous.revision + 1}.`);
  if (!previous && directive.revision !== 1) throw new Error('A primeira diretriz precisa usar a revisão 1.');
  const effectiveBefore = previous?.toRolloutPercent ?? publication.rolloutPercent;
  assertPercent(directive.fromRolloutPercent, 'O rollout anterior');
  assertPercent(directive.toRolloutPercent, 'O rollout alvo');
  if (directive.fromRolloutPercent !== effectiveBefore) throw new Error(`A diretriz esperava rollout ${effectiveBefore}%.`);
  if (!directive.reason?.trim()) throw new Error('A diretriz precisa informar um motivo.');
  if (directive.policyId !== policy.policyId || policy.publicationId !== publication.publicationId) throw new Error('A diretriz não corresponde à política de saúde vigente.');
  if (!validateCatalogRolloutHealthEvidence(evidence) || directive.healthEvidenceChecksum.toLowerCase() !== evidence.checksum.toLowerCase()) throw new Error('A evidência de saúde da diretriz é inválida.');
  if (evidence.publicationId !== publication.publicationId || evidence.policyId !== policy.policyId) throw new Error('A evidência não corresponde à publicação ou política.');
  if (directive.action === 'expand' && !(directive.toRolloutPercent > effectiveBefore && evidence.status === 'healthy')) throw new Error('A expansão exige evidência saudável e percentual maior.');
  if (directive.action === 'reduce' && !(directive.toRolloutPercent < effectiveBefore)) throw new Error('A redução precisa diminuir o rollout.');
  if (directive.action === 'pause' && directive.toRolloutPercent !== 0) throw new Error('Uma pausa precisa reduzir o rollout efetivo a 0%.');
  if (directive.action === 'rollback' && (directive.toRolloutPercent !== 0 || evidence.status !== 'unhealthy')) throw new Error('Rollback operacional exige evidência não saudável e rollout 0%.');
  if (directive.action === 'promote') {
    const expectedTarget = expectedPromotionTarget(publication.channel);
    if (!expectedTarget || directive.targetChannel !== expectedTarget) throw new Error('A promoção precisa seguir preview → beta → stable.');
    if (!targetPublication || targetPublication.publicationId !== directive.targetPublicationId || targetPublication.channel !== directive.targetChannel) throw new Error('A publicação-alvo da promoção não foi validada.');
    if (targetPublication.catalogChecksum !== publication.catalogChecksum || targetPublication.bundleChecksum !== publication.bundleChecksum || targetPublication.snapshotId !== publication.snapshotId) throw new Error('A promoção precisa preservar catálogo, bundle e snapshot.');
    if (evidence.status !== 'healthy' || effectiveBefore !== 100) throw new Error('A promoção exige saúde aprovada e rollout completo.');
    if (directive.toRolloutPercent !== effectiveBefore) throw new Error('A promoção não altera o rollout da publicação de origem.');
  } else if (directive.targetChannel || directive.targetPublicationId) throw new Error('Somente promoções podem informar publicação-alvo.');
  const { key } = trustedKey(registry, directive.publisherId, directive.keyId);
  if (!verifyP256Signature(directivePayload(directive), directive.signature, key.publicJwk)) throw new Error('A assinatura da diretriz é inválida.');
  const now = (params.now ?? (() => new Date()))().getTime();
  const issuedAt = assertIsoDate(directive.issuedAt, 'A data da diretriz');
  if (issuedAt > now + 300000 || issuedAt < Date.parse(evidence.generatedAt)) throw new Error('A data da diretriz é incompatível com a evidência.');
  if (key.validFrom && issuedAt < Date.parse(key.validFrom)) throw new Error('A diretriz foi emitida antes da validade da chave.');
  if (key.validUntil && issuedAt > Date.parse(key.validUntil)) throw new Error('A diretriz foi emitida depois da validade da chave.');
  if (key.retiredAt && issuedAt > Date.parse(key.retiredAt)) throw new Error('A diretriz foi emitida depois da retirada da chave.');
  return {
    directiveId: directive.directiveId,
    publicationId: directive.publicationId,
    revision: directive.revision,
    action: directive.action,
    effectiveRolloutPercent: directive.toRolloutPercent,
    ...(directive.targetPublicationId ? { targetPublicationId: directive.targetPublicationId } : {})
  };
};

export const parseSignedCatalogRolloutHealthPolicy = (rawText: string): SignedCatalogRolloutHealthPolicy => clone(JSON.parse(rawText) as SignedCatalogRolloutHealthPolicy);
export const parseSignedCatalogRolloutDirective = (rawText: string): SignedCatalogRolloutDirective => clone(JSON.parse(rawText) as SignedCatalogRolloutDirective);
