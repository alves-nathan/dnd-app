import { sha256Hex } from './catalogBundleDigest';
import {
  catalogRolloutAggregateReportChecksum,
  validateCatalogReleaseQuorumDecision,
  verifySignedCatalogReleaseApproval,
  verifySignedCatalogRolloutAggregateReport,
  type CatalogReleaseDecisionAction,
  type CatalogReleaseQuorumDecision,
  type SignedCatalogReleaseApproval,
  type SignedCatalogRolloutAggregateReport,
  type SignedCatalogRolloutAggregationPolicy
} from './catalogRolloutAggregation';
import type { CatalogReleaseChannel, SignedCatalogPublication } from './catalogPublication';
import {
  catalogPublicKeyFingerprint,
  verifyP256Signature,
  type CatalogTrustRegistry,
  type CatalogTrustedPublisher
} from './catalogTrust';
import { stableStringify } from './utils';

export const CATALOG_OPERATIONAL_AUTHORIZATION_SCHEMA = 'dnd-catalog-operational-authorization.v1' as const;
export const CATALOG_EXECUTOR_CONFIRMATION_SCHEMA = 'dnd-catalog-executor-confirmation.v1' as const;
export const CATALOG_OPERATIONAL_EXECUTION_RECEIPT_SCHEMA = 'dnd-catalog-operational-execution-receipt.v1' as const;

export type CatalogOperationalAction = Exclude<CatalogReleaseDecisionAction, 'hold'>;
export type CatalogOperationalExecutionStatus = 'succeeded' | 'failed';

export interface CatalogOperationalExecutor {
  executorId: string;
  publisherId: string;
  keyId: string;
}

export interface SignedCatalogOperationalAuthorization {
  schemaVersion: typeof CATALOG_OPERATIONAL_AUTHORIZATION_SCHEMA;
  authorizationId: string;
  issuedAt: string;
  expiresAt: string;
  publisherId: string;
  keyId: string;
  publicationId: string;
  aggregateReportChecksum: string;
  quorumDecisionChecksum: string;
  action: CatalogOperationalAction;
  targetRolloutPercent?: number;
  targetChannel?: CatalogReleaseChannel;
  rollbackTargetSessionId?: string;
  executor: CatalogOperationalExecutor;
  nonce: string;
  maximumUses: 1;
  humanConfirmationRequired: true;
  automaticExecution: false;
  signature: string;
}

export interface SignedCatalogExecutorConfirmation {
  schemaVersion: typeof CATALOG_EXECUTOR_CONFIRMATION_SCHEMA;
  confirmationId: string;
  issuedAt: string;
  expiresAt: string;
  executorId: string;
  publisherId: string;
  keyId: string;
  authorizationChecksum: string;
  quorumDecisionChecksum: string;
  publicationId: string;
  action: CatalogOperationalAction;
  nonce: string;
  signature: string;
}

export interface CatalogOperationalExecutionResult {
  kind: 'rolloutOverride' | 'channelPromotion' | 'catalogRollback';
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  transactionId?: string;
}

export interface CatalogOperationalExecutionReceipt {
  schemaVersion: typeof CATALOG_OPERATIONAL_EXECUTION_RECEIPT_SCHEMA;
  receiptId: string;
  authorizationId: string;
  authorizationChecksum: string;
  executorConfirmationChecksum: string;
  quorumDecisionChecksum: string;
  aggregateReportChecksum: string;
  publicationId: string;
  action: CatalogOperationalAction;
  targetRolloutPercent?: number;
  targetChannel?: CatalogReleaseChannel;
  rollbackTargetSessionId?: string;
  executor: CatalogOperationalExecutor;
  nonce: string;
  useIndex: 1;
  humanConfirmedAt: string;
  startedAt: string;
  completedAt: string;
  status: CatalogOperationalExecutionStatus;
  result?: CatalogOperationalExecutionResult;
  issue?: string;
  automaticExecution: false;
  checksum: string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hex64 = /^[a-f0-9]{64}$/i;
const noncePattern = /^[A-Za-z0-9_-]{16,128}$/;
const activeOrHistoricalKey = (publisher: CatalogTrustedPublisher, keyId: string) => publisher.keys.find((key) => key.keyId === keyId && key.status !== 'revoked');

const assertIsoDate = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} é inválida.`);
  return parsed;
};

const trustedKey = (registry: CatalogTrustRegistry, publisherId: string, keyId: string) => {
  const publisher = registry.publishers.find((entry) => entry.publisherId === publisherId && entry.status === 'trusted');
  if (!publisher) throw new Error('O documento operacional foi assinado por um publicador não confiável.');
  const key = activeOrHistoricalKey(publisher, keyId);
  if (!key || key.fingerprint !== catalogPublicKeyFingerprint(key.publicJwk)) throw new Error('A chave operacional não é confiável.');
  return { publisher, key };
};

const identity = (value: { publisherId: string; keyId: string }): string => `${value.publisherId}:${value.keyId}`;
const assertKeyWindow = (key: CatalogTrustedPublisher['keys'][number], issuedAt: number, label: string): void => {
  if (key.validFrom && issuedAt < Date.parse(key.validFrom)) throw new Error(`${label} antecede a validade da chave.`);
  if (key.validUntil && issuedAt > Date.parse(key.validUntil)) throw new Error(`${label} foi emitida depois da expiração da chave.`);
  if (key.retiredAt && issuedAt > Date.parse(key.retiredAt)) throw new Error(`${label} foi emitida depois da retirada da chave.`);
};

export const catalogOperationalAuthorizationPayload = (authorization: SignedCatalogOperationalAuthorization): string => stableStringify({ ...authorization, signature: undefined });
export const catalogOperationalAuthorizationChecksum = (authorization: SignedCatalogOperationalAuthorization): string => sha256Hex(stableStringify(authorization));
export const catalogExecutorConfirmationPayload = (confirmation: SignedCatalogExecutorConfirmation): string => stableStringify({ ...confirmation, signature: undefined });
export const catalogExecutorConfirmationChecksum = (confirmation: SignedCatalogExecutorConfirmation): string => sha256Hex(stableStringify(confirmation));

export const verifySignedCatalogOperationalAuthorization = (params: {
  authorization: SignedCatalogOperationalAuthorization;
  registry: CatalogTrustRegistry;
  decision: CatalogReleaseQuorumDecision;
  report: SignedCatalogRolloutAggregateReport;
  policy: SignedCatalogRolloutAggregationPolicy;
  approvals: readonly SignedCatalogReleaseApproval[];
  publication: SignedCatalogPublication;
  now?: () => Date;
}): SignedCatalogOperationalAuthorization => {
  const { authorization, registry, decision, report, policy, approvals, publication } = params;
  if (authorization.schemaVersion !== CATALOG_OPERATIONAL_AUTHORIZATION_SCHEMA) throw new Error('Autorização operacional incompatível.');
  if (!validateCatalogReleaseQuorumDecision(decision) || decision.status !== 'approved') throw new Error('A autorização exige uma decisão de quórum íntegra e aprovada.');
  verifySignedCatalogRolloutAggregateReport({ report, registry, policy, publication, now: params.now });
  if (decision.automaticExecution !== false || authorization.automaticExecution !== false) throw new Error('Execução automática não é permitida.');
  if (authorization.maximumUses !== 1 || authorization.humanConfirmationRequired !== true) throw new Error('A autorização precisa ser de uso único e exigir confirmação humana.');
  if (!authorization.authorizationId?.trim() || !noncePattern.test(authorization.nonce)) throw new Error('O identificador ou nonce da autorização é inválido.');
  const decisionChecksum = decision.checksum;
  const reportChecksum = catalogRolloutAggregateReportChecksum(report);
  if (authorization.publicationId !== publication.publicationId || decision.publicationId !== publication.publicationId || report.publicationId !== publication.publicationId) throw new Error('A autorização não corresponde à publicação.');
  if (authorization.aggregateReportChecksum !== reportChecksum || decision.aggregateReportChecksum !== reportChecksum) throw new Error('A autorização não corresponde ao relatório consolidado.');
  if (authorization.quorumDecisionChecksum !== decisionChecksum) throw new Error('A autorização não corresponde à decisão de quórum.');
  if (authorization.action !== decision.action || authorization.targetRolloutPercent !== decision.targetRolloutPercent || authorization.targetChannel !== decision.targetChannel) throw new Error('A ação autorizada diverge da decisão aprovada.');
  if (authorization.action === 'expand' && (authorization.targetRolloutPercent === undefined || authorization.targetRolloutPercent < 0 || authorization.targetRolloutPercent > 100)) throw new Error('A expansão exige um rollout alvo válido.');
  if (authorization.action === 'promote' && !authorization.targetChannel) throw new Error('A promoção exige um canal alvo.');
  if (authorization.action === 'rollback' && !authorization.rollbackTargetSessionId?.trim()) throw new Error('O rollback exige a sessão transacional alvo.');
  const now = (params.now ?? (() => new Date()))().getTime();
  const issuedAt = assertIsoDate(authorization.issuedAt, 'A emissão da autorização');
  const expiresAt = assertIsoDate(authorization.expiresAt, 'A expiração da autorização');
  if (issuedAt > now + 300000) throw new Error('A autorização foi emitida no futuro.');
  if (expiresAt <= issuedAt || now > expiresAt) throw new Error('A autorização operacional expirou.');
  const authorizer = trustedKey(registry, authorization.publisherId, authorization.keyId);
  const executor = trustedKey(registry, authorization.executor.publisherId, authorization.executor.keyId);
  if (!authorization.executor.executorId?.trim()) throw new Error('O executor não foi identificado.');
  if (identity(authorization) === identity(authorization.executor)) throw new Error('A autoridade operacional e o executor precisam usar chaves distintas.');
  if (!verifyP256Signature(catalogOperationalAuthorizationPayload(authorization), authorization.signature, authorizer.key.publicJwk)) throw new Error('A assinatura da autorização operacional é inválida.');
  const decisionApprovals = approvals.filter((approval) => decision.approvalIds.includes(approval.approvalId));
  if (decisionApprovals.length !== decision.approvalCount) throw new Error('As aprovações que formaram o quórum não estão completas.');
  for (const approval of decisionApprovals) {
    verifySignedCatalogReleaseApproval({ approval, registry, policy, report, now: params.now });
    if (identity(approval) === identity(authorization.executor)) throw new Error('O executor não pode usar uma chave que participou da aprovação do quórum.');
  }
  assertKeyWindow(authorizer.key, issuedAt, 'A autorização');
  assertKeyWindow(executor.key, issuedAt, 'A autorização para o executor');
  return clone(authorization);
};

export const verifySignedCatalogExecutorConfirmation = (params: {
  confirmation: SignedCatalogExecutorConfirmation;
  authorization: SignedCatalogOperationalAuthorization;
  registry: CatalogTrustRegistry;
  now?: () => Date;
}): SignedCatalogExecutorConfirmation => {
  const { confirmation, authorization, registry } = params;
  if (confirmation.schemaVersion !== CATALOG_EXECUTOR_CONFIRMATION_SCHEMA) throw new Error('Confirmação do executor incompatível.');
  if (!confirmation.confirmationId?.trim() || confirmation.authorizationChecksum !== catalogOperationalAuthorizationChecksum(authorization)) throw new Error('A confirmação não corresponde à autorização operacional.');
  if (confirmation.quorumDecisionChecksum !== authorization.quorumDecisionChecksum || confirmation.publicationId !== authorization.publicationId || confirmation.action !== authorization.action || confirmation.nonce !== authorization.nonce) throw new Error('A confirmação diverge do escopo autorizado.');
  if (confirmation.executorId !== authorization.executor.executorId || identity(confirmation) !== identity(authorization.executor)) throw new Error('A confirmação foi emitida por outro executor.');
  const now = (params.now ?? (() => new Date()))().getTime();
  const issuedAt = assertIsoDate(confirmation.issuedAt, 'A emissão da confirmação');
  const expiresAt = assertIsoDate(confirmation.expiresAt, 'A expiração da confirmação');
  if (issuedAt < Date.parse(authorization.issuedAt) || issuedAt > Date.parse(authorization.expiresAt)) throw new Error('A confirmação foi emitida fora da janela da autorização.');
  if (expiresAt <= issuedAt || now > expiresAt || expiresAt > Date.parse(authorization.expiresAt)) throw new Error('A confirmação do executor expirou ou excede a autorização.');
  const { key } = trustedKey(registry, confirmation.publisherId, confirmation.keyId);
  assertKeyWindow(key, issuedAt, 'A confirmação do executor');
  if (!verifyP256Signature(catalogExecutorConfirmationPayload(confirmation), confirmation.signature, key.publicJwk)) throw new Error('A assinatura da confirmação do executor é inválida.');
  return clone(confirmation);
};

export const assertCatalogOperationalAuthorizationUnused = (authorization: SignedCatalogOperationalAuthorization, receipts: readonly CatalogOperationalExecutionReceipt[]): void => {
  const checksum = catalogOperationalAuthorizationChecksum(authorization);
  if (receipts.some((receipt) => receipt.authorizationChecksum === checksum || receipt.nonce === authorization.nonce)) throw new Error('Esta autorização operacional já foi consumida.');
};

const executionReceiptChecksum = (receipt: Omit<CatalogOperationalExecutionReceipt, 'checksum'>): string => sha256Hex(stableStringify(receipt));

export const createCatalogOperationalExecutionReceipt = (params: {
  authorization: SignedCatalogOperationalAuthorization;
  confirmation: SignedCatalogExecutorConfirmation;
  humanConfirmedAt: string;
  startedAt: string;
  completedAt: string;
  status: CatalogOperationalExecutionStatus;
  result?: CatalogOperationalExecutionResult;
  issue?: string;
}): CatalogOperationalExecutionReceipt => {
  const payload: Omit<CatalogOperationalExecutionReceipt, 'checksum'> = {
    schemaVersion: CATALOG_OPERATIONAL_EXECUTION_RECEIPT_SCHEMA,
    receiptId: `catalog-operation-${params.authorization.authorizationId}-${sha256Hex(`${params.startedAt}:${params.authorization.nonce}`).slice(0, 12)}`,
    authorizationId: params.authorization.authorizationId,
    authorizationChecksum: catalogOperationalAuthorizationChecksum(params.authorization),
    executorConfirmationChecksum: catalogExecutorConfirmationChecksum(params.confirmation),
    quorumDecisionChecksum: params.authorization.quorumDecisionChecksum,
    aggregateReportChecksum: params.authorization.aggregateReportChecksum,
    publicationId: params.authorization.publicationId,
    action: params.authorization.action,
    ...(params.authorization.targetRolloutPercent !== undefined ? { targetRolloutPercent: params.authorization.targetRolloutPercent } : {}),
    ...(params.authorization.targetChannel ? { targetChannel: params.authorization.targetChannel } : {}),
    ...(params.authorization.rollbackTargetSessionId ? { rollbackTargetSessionId: params.authorization.rollbackTargetSessionId } : {}),
    executor: clone(params.authorization.executor),
    nonce: params.authorization.nonce,
    useIndex: 1,
    humanConfirmedAt: params.humanConfirmedAt,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    status: params.status,
    ...(params.result ? { result: clone(params.result) } : {}),
    ...(params.issue ? { issue: params.issue } : {}),
    automaticExecution: false
  };
  return { ...payload, checksum: executionReceiptChecksum(payload) };
};

export const validateCatalogOperationalExecutionReceipt = (receipt: CatalogOperationalExecutionReceipt): boolean => {
  if (receipt.schemaVersion !== CATALOG_OPERATIONAL_EXECUTION_RECEIPT_SCHEMA || receipt.useIndex !== 1 || receipt.automaticExecution !== false || !hex64.test(receipt.checksum)) return false;
  const { checksum, ...payload } = receipt;
  return checksum.toLowerCase() === executionReceiptChecksum(payload).toLowerCase();
};

export const parseSignedCatalogOperationalAuthorization = (raw: string): SignedCatalogOperationalAuthorization => JSON.parse(raw) as SignedCatalogOperationalAuthorization;
export const parseSignedCatalogExecutorConfirmation = (raw: string): SignedCatalogExecutorConfirmation => JSON.parse(raw) as SignedCatalogExecutorConfirmation;
