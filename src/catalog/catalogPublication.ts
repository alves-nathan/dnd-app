import { sha256Hex } from './catalogBundleDigest';
import { stableStringify } from './utils';
import {
  catalogPublicKeyFingerprint,
  verifyP256Signature,
  type CatalogTrustRegistry,
  type CatalogTrustedPublisher
} from './catalogTrust';
import {
  catalogDistributionManifestChecksum,
  type SignedCatalogDistributionManifest
} from './catalogDistribution';

export const CATALOG_PUBLICATION_SCHEMA = 'dnd-catalog-publication.v1' as const;
export const CATALOG_PUBLICATION_CONTROL_SCHEMA = 'dnd-catalog-publication-control.v1' as const;
export const CATALOG_ELIGIBILITY_EVIDENCE_SCHEMA = 'dnd-catalog-publication-eligibility.v1' as const;

export type CatalogReleaseChannel = 'stable' | 'beta' | 'preview';
export type CatalogPublicationControlAction = 'pause' | 'resume' | 'withdraw';
export type CatalogPublicationRuntimeStatus = 'active' | 'paused' | 'withdrawn';
export type CatalogChannelMigrationDirection = 'same' | 'safer' | 'riskier' | 'lateral';
export type CatalogEligibilityReason =
  | 'eligible'
  | 'channelMismatch'
  | 'appTooOld'
  | 'appTooNew'
  | 'outsideRollout'
  | 'paused'
  | 'withdrawn'
  | 'expired'
  | 'distributionMismatch';

export interface CatalogReleaseNotes {
  locale: string;
  title: string;
  summary: string;
  items: string[];
  checksum: string;
}

export interface SignedCatalogPublication {
  schemaVersion: typeof CATALOG_PUBLICATION_SCHEMA;
  publicationId: string;
  publisherId: string;
  keyId: string;
  issuedAt: string;
  expiresAt?: string;
  channel: CatalogReleaseChannel;
  sequence: number;
  distributionManifestChecksum: string;
  catalogChecksum: string;
  bundleChecksum: string;
  catalogVersion: string;
  snapshotId: string;
  minAppVersion: string;
  maxAppVersion?: string;
  rolloutPercent: number;
  cohortSalt: string;
  releaseNotes: CatalogReleaseNotes;
  signature: string;
}

export interface SignedCatalogPublicationControl {
  schemaVersion: typeof CATALOG_PUBLICATION_CONTROL_SCHEMA;
  controlId: string;
  publicationId: string;
  publisherId: string;
  keyId: string;
  issuedAt: string;
  revision: number;
  action: CatalogPublicationControlAction;
  reason: string;
  signature: string;
}

export interface CatalogPublicationVerification {
  publicationId: string;
  publisherId: string;
  keyId: string;
  keyFingerprint: string;
  channel: CatalogReleaseChannel;
  sequence: number;
  catalogVersion: string;
  snapshotId: string;
  rolloutPercent: number;
  distributionManifestChecksum: string;
}

export interface CatalogPublicationControlVerification {
  controlId: string;
  publicationId: string;
  publisherId: string;
  revision: number;
  action: CatalogPublicationControlAction;
}

export interface CatalogChannelMigrationAssessment {
  from: CatalogReleaseChannel;
  to: CatalogReleaseChannel;
  direction: CatalogChannelMigrationDirection;
  requiresConfirmation: boolean;
  explanation: string;
}

export interface CatalogPublicationEligibilityEvidence {
  schemaVersion: typeof CATALOG_ELIGIBILITY_EVIDENCE_SCHEMA;
  evidenceId: string;
  evaluatedAt: string;
  publicationId: string;
  publisherId: string;
  channel: CatalogReleaseChannel;
  selectedChannel: CatalogReleaseChannel;
  appVersion: string;
  minAppVersion: string;
  maxAppVersion?: string;
  cohortIdHash: string;
  cohortScore: number;
  rolloutPercent: number;
  declaredRolloutPercent?: number;
  rolloutDirectiveId?: string;
  runtimeStatus: CatalogPublicationRuntimeStatus;
  eligible: boolean;
  reason: CatalogEligibilityReason;
  distributionManifestChecksum: string;
  checksum: string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const publicationPayload = (publication: SignedCatalogPublication): string => stableStringify({ ...publication, signature: undefined });
const controlPayload = (control: SignedCatalogPublicationControl): string => stableStringify({ ...control, signature: undefined });
const activeOrHistoricalKey = (publisher: CatalogTrustedPublisher, keyId: string) => publisher.keys.find((key) => key.keyId === keyId && key.status !== 'revoked');
const hex64 = /^[a-f0-9]{64}$/i;
const channelRank: Record<CatalogReleaseChannel, number> = { stable: 0, beta: 1, preview: 2 };

const assertIsoDate = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} é inválida.`);
  return parsed;
};

export const normalizeAppVersion = (value: string): [number, number, number, string] => {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/);
  if (!match) throw new Error(`Versão de aplicativo inválida: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ''];
};

export const compareAppVersions = (left: string, right: string): number => {
  const a = normalizeAppVersion(left);
  const b = normalizeAppVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return Number(a[index]) < Number(b[index]) ? -1 : 1;
  }
  if (a[3] === b[3]) return 0;
  if (!a[3]) return 1;
  if (!b[3]) return -1;
  return String(a[3]).localeCompare(String(b[3]));
};

export const catalogReleaseNotesChecksum = (notes: Omit<CatalogReleaseNotes, 'checksum'>): string => sha256Hex(stableStringify(notes));

const assertReleaseNotes = (notes: CatalogReleaseNotes): void => {
  if (!notes || typeof notes !== 'object') throw new Error('As notas de versão estão ausentes.');
  if (!notes.locale?.trim() || !notes.title?.trim() || !notes.summary?.trim()) throw new Error('As notas de versão estão incompletas.');
  if (!Array.isArray(notes.items) || !notes.items.length || notes.items.some((item) => !item.trim())) throw new Error('As notas de versão precisam conter pelo menos um item.');
  const { checksum: _checksum, ...payload } = notes;
  if (!hex64.test(notes.checksum) || notes.checksum.toLowerCase() !== catalogReleaseNotesChecksum(payload).toLowerCase()) throw new Error('O checksum das notas de versão é inválido.');
};

export const catalogPublicationChecksum = (publication: SignedCatalogPublication): string => sha256Hex(stableStringify(publication));

export const verifySignedCatalogPublication = (params: {
  publication: SignedCatalogPublication;
  registry: CatalogTrustRegistry;
  distributionManifest?: SignedCatalogDistributionManifest;
  now?: () => Date;
}): CatalogPublicationVerification => {
  const { publication, registry, distributionManifest } = params;
  if (publication.schemaVersion !== CATALOG_PUBLICATION_SCHEMA) throw new Error('Publicação do catálogo incompatível.');
  if (!publication.publicationId?.trim()) throw new Error('A publicação não possui identificador.');
  if (!['stable', 'beta', 'preview'].includes(publication.channel)) throw new Error('O canal da publicação é inválido.');
  if (!Number.isInteger(publication.sequence) || publication.sequence < 1) throw new Error('A sequência da publicação é inválida.');
  if (!Number.isFinite(publication.rolloutPercent) || publication.rolloutPercent < 0 || publication.rolloutPercent > 100) throw new Error('O rollout precisa estar entre 0 e 100%.');
  if (!publication.cohortSalt?.trim() || publication.cohortSalt.length < 8) throw new Error('O salt da coorte é insuficiente.');
  normalizeAppVersion(publication.minAppVersion);
  if (publication.maxAppVersion) {
    normalizeAppVersion(publication.maxAppVersion);
    if (compareAppVersions(publication.minAppVersion, publication.maxAppVersion) > 0) throw new Error('A versão mínima do aplicativo é maior que a máxima.');
  }
  for (const [label, checksum] of [
    ['checksum do manifesto', publication.distributionManifestChecksum],
    ['checksum do catálogo', publication.catalogChecksum],
    ['checksum do bundle', publication.bundleChecksum]
  ] as const) if (!hex64.test(checksum)) throw new Error(`O ${label} é inválido.`);
  assertReleaseNotes(publication.releaseNotes);

  const publisher = registry.publishers.find((entry) => entry.publisherId === publication.publisherId && entry.status === 'trusted');
  if (!publisher) throw new Error('A publicação foi assinada por um publicador não confiável.');
  const key = activeOrHistoricalKey(publisher, publication.keyId);
  if (!key || key.fingerprint !== catalogPublicKeyFingerprint(key.publicJwk)) throw new Error('A chave da publicação não é confiável.');
  if (!verifyP256Signature(publicationPayload(publication), publication.signature, key.publicJwk)) throw new Error('A assinatura da publicação é inválida.');

  const now = (params.now ?? (() => new Date()))().getTime();
  const issuedAt = assertIsoDate(publication.issuedAt, 'A data da publicação');
  if (issuedAt > now + 300000) throw new Error('A publicação foi emitida no futuro.');
  if (publication.expiresAt && now > assertIsoDate(publication.expiresAt, 'A expiração da publicação')) throw new Error('A publicação expirou.');
  if (key.validFrom && issuedAt < Date.parse(key.validFrom)) throw new Error('A publicação foi emitida antes da validade da chave.');
  if (key.validUntil && issuedAt > Date.parse(key.validUntil)) throw new Error('A publicação foi emitida depois da validade da chave.');
  if (key.retiredAt && issuedAt > Date.parse(key.retiredAt)) throw new Error('A publicação foi emitida depois da retirada da chave.');

  if (distributionManifest) {
    if (catalogDistributionManifestChecksum(distributionManifest).toLowerCase() !== publication.distributionManifestChecksum.toLowerCase()) throw new Error('A publicação não corresponde ao manifesto de distribuição informado.');
    if (distributionManifest.publisherId !== publication.publisherId || distributionManifest.sequence !== publication.sequence) throw new Error('A identidade ou sequência da distribuição diverge da publicação.');
    if (distributionManifest.catalogChecksum !== publication.catalogChecksum || distributionManifest.bundleChecksum !== publication.bundleChecksum) throw new Error('Os checksums da distribuição divergem da publicação.');
    if (distributionManifest.catalogVersion !== publication.catalogVersion || distributionManifest.snapshotId !== publication.snapshotId) throw new Error('A versão ou snapshot da distribuição diverge da publicação.');
  }

  return {
    publicationId: publication.publicationId,
    publisherId: publication.publisherId,
    keyId: publication.keyId,
    keyFingerprint: key.fingerprint,
    channel: publication.channel,
    sequence: publication.sequence,
    catalogVersion: publication.catalogVersion,
    snapshotId: publication.snapshotId,
    rolloutPercent: publication.rolloutPercent,
    distributionManifestChecksum: publication.distributionManifestChecksum
  };
};

export const verifySignedCatalogPublicationControl = (params: {
  control: SignedCatalogPublicationControl;
  publication: SignedCatalogPublication;
  registry: CatalogTrustRegistry;
  previousControls?: SignedCatalogPublicationControl[];
  now?: () => Date;
}): CatalogPublicationControlVerification => {
  const { control, publication, registry, previousControls = [] } = params;
  if (control.schemaVersion !== CATALOG_PUBLICATION_CONTROL_SCHEMA) throw new Error('Controle de publicação incompatível.');
  if (!control.controlId?.trim() || control.publicationId !== publication.publicationId || control.publisherId !== publication.publisherId) throw new Error('O controle não corresponde à publicação.');
  if (!['pause', 'resume', 'withdraw'].includes(control.action)) throw new Error('A ação do controle é inválida.');
  if (!Number.isInteger(control.revision) || control.revision < 1) throw new Error('A revisão do controle é inválida.');
  if (!control.reason?.trim()) throw new Error('O controle precisa informar um motivo.');
  const last = [...previousControls].sort((a, b) => b.revision - a.revision)[0];
  if (last) {
    if (control.revision !== last.revision + 1) throw new Error(`A revisão esperada do controle é ${last.revision + 1}.`);
    if (last.action === 'withdraw') throw new Error('Uma publicação retirada não pode receber novos controles.');
    if (last.action === 'pause' && control.action === 'pause') throw new Error('A publicação já está pausada.');
    if (last.action === 'resume' && control.action === 'resume') throw new Error('A publicação já está ativa.');
  } else if (control.revision !== 1) throw new Error('O primeiro controle precisa usar a revisão 1.');

  const publisher = registry.publishers.find((entry) => entry.publisherId === control.publisherId && entry.status === 'trusted');
  if (!publisher) throw new Error('O controle foi assinado por um publicador não confiável.');
  const key = activeOrHistoricalKey(publisher, control.keyId);
  if (!key || key.fingerprint !== catalogPublicKeyFingerprint(key.publicJwk)) throw new Error('A chave do controle não é confiável.');
  if (!verifyP256Signature(controlPayload(control), control.signature, key.publicJwk)) throw new Error('A assinatura do controle é inválida.');
  const now = (params.now ?? (() => new Date()))().getTime();
  const issuedAt = assertIsoDate(control.issuedAt, 'A data do controle');
  if (issuedAt > now + 300000 || issuedAt < Date.parse(publication.issuedAt)) throw new Error('A data do controle é incompatível com a publicação.');
  if (key.validFrom && issuedAt < Date.parse(key.validFrom)) throw new Error('O controle foi emitido antes da validade da chave.');
  if (key.validUntil && issuedAt > Date.parse(key.validUntil)) throw new Error('O controle foi emitido depois da validade da chave.');
  if (key.retiredAt && issuedAt > Date.parse(key.retiredAt)) throw new Error('O controle foi emitido depois da retirada da chave.');
  return { controlId: control.controlId, publicationId: control.publicationId, publisherId: control.publisherId, revision: control.revision, action: control.action };
};

export const resolveCatalogPublicationStatus = (controls: readonly SignedCatalogPublicationControl[]): CatalogPublicationRuntimeStatus => {
  const latest = [...controls].sort((a, b) => b.revision - a.revision)[0];
  if (!latest || latest.action === 'resume') return 'active';
  return latest.action === 'pause' ? 'paused' : 'withdrawn';
};

export const calculateCatalogCohortScore = (params: {
  cohortId: string;
  publisherId: string;
  publicationId: string;
  channel: CatalogReleaseChannel;
  cohortSalt: string;
}): number => Number.parseInt(sha256Hex(stableStringify(params)).slice(0, 8), 16) % 10000;

const eligibilityChecksum = (evidence: Omit<CatalogPublicationEligibilityEvidence, 'checksum'>): string => sha256Hex(stableStringify(evidence));

export const validateCatalogPublicationEligibilityEvidence = (evidence: CatalogPublicationEligibilityEvidence): boolean => {
  const { checksum, ...payload } = evidence;
  return evidence.schemaVersion === CATALOG_ELIGIBILITY_EVIDENCE_SCHEMA && hex64.test(checksum) && checksum.toLowerCase() === eligibilityChecksum(payload).toLowerCase();
};

export const evaluateCatalogPublicationEligibility = (params: {
  publication: SignedCatalogPublication;
  controls?: SignedCatalogPublicationControl[];
  selectedChannel: CatalogReleaseChannel;
  appVersion: string;
  cohortId: string;
  distributionManifest?: SignedCatalogDistributionManifest;
  rolloutPercentOverride?: number;
  rolloutDirectiveId?: string;
  now?: () => Date;
}): CatalogPublicationEligibilityEvidence => {
  const { publication, selectedChannel, appVersion, cohortId, distributionManifest } = params;
  normalizeAppVersion(appVersion);
  const runtimeStatus = resolveCatalogPublicationStatus(params.controls ?? []);
  const effectiveRolloutPercent = params.rolloutPercentOverride ?? publication.rolloutPercent;
  if (!Number.isFinite(effectiveRolloutPercent) || effectiveRolloutPercent < 0 || effectiveRolloutPercent > 100) throw new Error('O rollout efetivo precisa estar entre 0 e 100%.');
  const cohortScore = calculateCatalogCohortScore({ cohortId, publisherId: publication.publisherId, publicationId: publication.publicationId, channel: publication.channel, cohortSalt: publication.cohortSalt });
  let reason: CatalogEligibilityReason = 'eligible';
  if (publication.channel !== selectedChannel) reason = 'channelMismatch';
  else if (runtimeStatus === 'paused') reason = 'paused';
  else if (runtimeStatus === 'withdrawn') reason = 'withdrawn';
  else if (publication.expiresAt && (params.now ?? (() => new Date()))().getTime() > Date.parse(publication.expiresAt)) reason = 'expired';
  else if (compareAppVersions(appVersion, publication.minAppVersion) < 0) reason = 'appTooOld';
  else if (publication.maxAppVersion && compareAppVersions(appVersion, publication.maxAppVersion) > 0) reason = 'appTooNew';
  else if (cohortScore >= Math.round(effectiveRolloutPercent * 100)) reason = 'outsideRollout';
  else if (distributionManifest && catalogDistributionManifestChecksum(distributionManifest).toLowerCase() !== publication.distributionManifestChecksum.toLowerCase()) reason = 'distributionMismatch';
  const payload: Omit<CatalogPublicationEligibilityEvidence, 'checksum'> = {
    schemaVersion: CATALOG_ELIGIBILITY_EVIDENCE_SCHEMA,
    evidenceId: `catalog-eligibility-${publication.publicationId}-${sha256Hex(`${cohortId}:${appVersion}:${selectedChannel}`).slice(0, 12)}`,
    evaluatedAt: (params.now ?? (() => new Date()))().toISOString(),
    publicationId: publication.publicationId,
    publisherId: publication.publisherId,
    channel: publication.channel,
    selectedChannel,
    appVersion,
    minAppVersion: publication.minAppVersion,
    ...(publication.maxAppVersion ? { maxAppVersion: publication.maxAppVersion } : {}),
    cohortIdHash: sha256Hex(cohortId),
    cohortScore,
    rolloutPercent: effectiveRolloutPercent,
    ...(effectiveRolloutPercent !== publication.rolloutPercent ? { declaredRolloutPercent: publication.rolloutPercent } : {}),
    ...(params.rolloutDirectiveId ? { rolloutDirectiveId: params.rolloutDirectiveId } : {}),
    runtimeStatus,
    eligible: reason === 'eligible',
    reason,
    distributionManifestChecksum: publication.distributionManifestChecksum
  };
  return { ...payload, checksum: eligibilityChecksum(payload) };
};

export const assessCatalogChannelMigration = (from: CatalogReleaseChannel, to: CatalogReleaseChannel): CatalogChannelMigrationAssessment => {
  if (from === to) return { from, to, direction: 'same', requiresConfirmation: false, explanation: 'O canal já está selecionado.' };
  const direction: CatalogChannelMigrationDirection = channelRank[to] > channelRank[from] ? 'riskier' : channelRank[to] < channelRank[from] ? 'safer' : 'lateral';
  return {
    from,
    to,
    direction,
    requiresConfirmation: true,
    explanation: direction === 'riskier'
      ? 'O novo canal pode receber publicações menos estabilizadas. O catálogo ativo não será alterado automaticamente.'
      : 'A mudança limita futuras publicações elegíveis. O catálogo ativo e o cache existente permanecem intactos.'
  };
};

export const findCatalogPublicationForDistribution = (
  publications: Record<string, SignedCatalogPublication>,
  manifest: SignedCatalogDistributionManifest,
  selectedChannel?: CatalogReleaseChannel
): SignedCatalogPublication | undefined => Object.values(publications)
  .filter((publication) => publication.publisherId === manifest.publisherId && publication.sequence === manifest.sequence && (!selectedChannel || publication.channel === selectedChannel))
  .find((publication) => publication.distributionManifestChecksum.toLowerCase() === catalogDistributionManifestChecksum(manifest).toLowerCase());

export const parseSignedCatalogPublication = (rawText: string): SignedCatalogPublication => clone(JSON.parse(rawText) as SignedCatalogPublication);
export const parseSignedCatalogPublicationControl = (rawText: string): SignedCatalogPublicationControl => clone(JSON.parse(rawText) as SignedCatalogPublicationControl);
