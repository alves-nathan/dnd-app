import { sha256Hex } from './catalogBundleDigest';
import { stableStringify } from './utils';
import {
  catalogPublicKeyFingerprint,
  verifyP256Signature,
  verifySignedCatalogEnvelope,
  type CatalogTrustRegistry,
  type CatalogTrustVerification,
  type CatalogTrustedPublisher
} from './catalogTrust';
import type { CatalogRemoteManifestVerification, CatalogTransparencyLog } from './catalogTransparency';

export const CATALOG_DISTRIBUTION_MANIFEST_SCHEMA = 'dnd-catalog-distribution-manifest.v1' as const;
export const CATALOG_MIRROR_STATUS_SCHEMA = 'dnd-catalog-mirror-status.v1' as const;
export const CATALOG_DOWNLOAD_SESSION_SCHEMA = 'dnd-catalog-download-session.v1' as const;
export const CATALOG_DOWNLOAD_EVIDENCE_SCHEMA = 'dnd-catalog-download-evidence.v1' as const;

export type CatalogNetworkKind = 'wifi' | 'ethernet' | 'cellular' | 'unknown' | 'offline';
export type CatalogDownloadMode = 'manual' | 'assisted';

export interface CatalogNetworkSnapshot {
  kind: CatalogNetworkKind;
  isRoaming?: boolean;
  isMetered?: boolean;
  observedAt: string;
}

export interface CatalogNetworkPolicy {
  mode: CatalogDownloadMode;
  allowCellular: boolean;
  allowRoaming: boolean;
  allowUnknownNetwork: boolean;
  maxAssistedBundleBytes: number;
  verifyCachedBundleOnRead: boolean;
}

export const DEFAULT_CATALOG_NETWORK_POLICY: CatalogNetworkPolicy = {
  mode: 'manual',
  allowCellular: false,
  allowRoaming: false,
  allowUnknownNetwork: false,
  maxAssistedBundleBytes: 16 * 1024 * 1024,
  verifyCachedBundleOnRead: true
};

export interface CatalogDistributionChunkDescriptor {
  index: number;
  characterOffset: number;
  characterLength: number;
  byteLength: number;
  checksum: string;
}

export interface CatalogDistributionMirror {
  mirrorId: string;
  label: string;
  priority: number;
  statusUrl: string;
  chunkUrlTemplate: string;
  region?: string;
}

export interface SignedCatalogDistributionManifest {
  schemaVersion: typeof CATALOG_DISTRIBUTION_MANIFEST_SCHEMA;
  publisherId: string;
  keyId: string;
  issuedAt: string;
  expiresAt?: string;
  sequence: number;
  previousBundleChecksum?: string;
  catalogChecksum: string;
  bundleChecksum: string;
  catalogVersion: string;
  snapshotId: string;
  bundleByteLength: number;
  bundleCharacterLength: number;
  chunks: CatalogDistributionChunkDescriptor[];
  mirrors: CatalogDistributionMirror[];
  signature: string;
}

export interface CatalogDistributionManifestVerification {
  publisherId: string;
  keyId: string;
  keyFingerprint: string;
  sequence: number;
  catalogChecksum: string;
  bundleChecksum: string;
  catalogVersion: string;
  snapshotId: string;
  bundleByteLength: number;
  chunkCount: number;
  mirrorCount: number;
}

export interface CatalogMirrorStatusDocument {
  schemaVersion: typeof CATALOG_MIRROR_STATUS_SCHEMA;
  mirrorId: string;
  publisherId: string;
  sequence: number;
  catalogChecksum: string;
  bundleChecksum: string;
  bundleByteLength: number;
  chunkCount: number;
  observedAt: string;
}

export type CatalogMirrorObservationStatus = 'available' | 'unavailable' | 'stale' | 'conflicting';
export interface CatalogMirrorObservation {
  mirrorId: string;
  checkedAt: string;
  status: CatalogMirrorObservationStatus;
  latencyMs?: number;
  issue?: string;
  remoteSequence?: number;
  remoteCatalogChecksum?: string;
  remoteBundleChecksum?: string;
}

export type CatalogDownloadStatus = 'prepared' | 'downloading' | 'paused' | 'downloaded' | 'verified' | 'failed' | 'cancelled';
export interface CatalogDownloadSession {
  schemaVersion: typeof CATALOG_DOWNLOAD_SESSION_SCHEMA;
  id: string;
  publisherId: string;
  sequence: number;
  manifestChecksum: string;
  bundleChecksum: string;
  status: CatalogDownloadStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  selectedMirrorId?: string;
  usedMirrorIds: string[];
  completedChunkIndexes: number[];
  downloadedBytes: number;
  resumeCount: number;
  attempts: number;
  network?: CatalogNetworkSnapshot;
  lastError?: string;
}

export interface CatalogDownloadEvidence {
  schemaVersion: typeof CATALOG_DOWNLOAD_EVIDENCE_SCHEMA;
  evidenceId: string;
  sessionId: string;
  publisherId: string;
  sequence: number;
  catalogVersion: string;
  snapshotId: string;
  catalogChecksum: string;
  bundleChecksum: string;
  manifestChecksum: string;
  startedAt: string;
  completedAt: string;
  downloadedBytes: number;
  chunkCount: number;
  resumeCount: number;
  usedMirrorIds: string[];
  networkKinds: CatalogNetworkKind[];
  verifiedOffline: boolean;
  checksum: string;
}

export interface CatalogMirrorTransport {
  probe: (mirror: CatalogDistributionMirror, manifest: SignedCatalogDistributionManifest) => Promise<{ status: CatalogMirrorStatusDocument; latencyMs: number }>;
  fetchChunk: (mirror: CatalogDistributionMirror, manifest: SignedCatalogDistributionManifest, chunk: CatalogDistributionChunkDescriptor) => Promise<string>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const manifestPayload = (manifest: SignedCatalogDistributionManifest): string => stableStringify({ ...manifest, signature: undefined });
const activeOrHistoricalKey = (publisher: CatalogTrustedPublisher, keyId: string) => publisher.keys.find((key) => key.keyId === keyId && key.status !== 'revoked');

export const utf8ByteLength = (value: string): number => {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { length += 4; index += 1; }
    else length += 3;
  }
  return length;
};

export const catalogDistributionManifestChecksum = (manifest: SignedCatalogDistributionManifest): string => sha256Hex(stableStringify(manifest));

const assertHttpsUrl = (value: string, label: string): void => {
  let parsed: URL;
  try { parsed = new URL(value.replaceAll('{index}', '0').replaceAll('{bundleChecksum}', 'bundle').replaceAll('{sequence}', '1')); }
  catch { throw new Error(`${label} contém uma URL inválida.`); }
  if (parsed.protocol !== 'https:') throw new Error(`${label} precisa usar HTTPS.`);
};

const validateChunkLayout = (manifest: SignedCatalogDistributionManifest): void => {
  if (!manifest.chunks.length) throw new Error('O manifesto de distribuição não possui blocos.');
  let offset = 0;
  let bytes = 0;
  manifest.chunks.forEach((chunk, index) => {
    if (chunk.index !== index) throw new Error('Os blocos do manifesto não possuem índices contíguos.');
    if (chunk.characterOffset !== offset || chunk.characterLength <= 0 || chunk.byteLength <= 0) throw new Error(`O bloco ${index} possui limites inválidos.`);
    if (!/^[a-f0-9]{64}$/i.test(chunk.checksum)) throw new Error(`O checksum do bloco ${index} é inválido.`);
    offset += chunk.characterLength;
    bytes += chunk.byteLength;
  });
  if (offset !== manifest.bundleCharacterLength || bytes !== manifest.bundleByteLength) throw new Error('As somas dos blocos divergem do tamanho total do bundle.');
};

export const verifySignedCatalogDistributionManifest = (params: {
  manifest: SignedCatalogDistributionManifest;
  registry: CatalogTrustRegistry;
  remoteManifest?: CatalogRemoteManifestVerification;
  localLog?: CatalogTransparencyLog;
  now?: () => Date;
}): CatalogDistributionManifestVerification => {
  const { manifest, registry, remoteManifest, localLog } = params;
  if (manifest.schemaVersion !== CATALOG_DISTRIBUTION_MANIFEST_SCHEMA) throw new Error('Manifesto de distribuição incompatível.');
  const publisher = registry.publishers.find((entry) => entry.publisherId === manifest.publisherId && entry.status === 'trusted');
  if (!publisher) throw new Error('O manifesto de distribuição foi assinado por um publicador não confiável.');
  const key = activeOrHistoricalKey(publisher, manifest.keyId);
  if (!key || key.fingerprint !== catalogPublicKeyFingerprint(key.publicJwk)) throw new Error('A chave do manifesto de distribuição não é confiável.');
  if (!verifyP256Signature(manifestPayload(manifest), manifest.signature, key.publicJwk)) throw new Error('A assinatura do manifesto de distribuição é inválida.');
  const now = (params.now ?? (() => new Date()))().getTime();
  const issuedAt = Date.parse(manifest.issuedAt);
  if (!Number.isFinite(issuedAt) || issuedAt > now + 300000) throw new Error('A data do manifesto de distribuição é inválida.');
  if (key.validFrom && issuedAt < Date.parse(key.validFrom)) throw new Error('O manifesto foi emitido antes da validade da chave.');
  if (key.validUntil && issuedAt > Date.parse(key.validUntil)) throw new Error('O manifesto foi emitido depois da validade da chave.');
  if (key.retiredAt && issuedAt > Date.parse(key.retiredAt)) throw new Error('O manifesto foi emitido depois da retirada da chave.');
  if (manifest.expiresAt && (!Number.isFinite(Date.parse(manifest.expiresAt)) || now > Date.parse(manifest.expiresAt))) throw new Error('O manifesto de distribuição expirou.');
  if (!Number.isInteger(manifest.sequence) || manifest.sequence < 1) throw new Error('A sequência do manifesto de distribuição é inválida.');
  const acceptedAnchor = publisher.lastAcceptedBundle;
  if (acceptedAnchor) {
    if (manifest.sequence !== acceptedAnchor.sequence + 1) throw new Error(`A sequência esperada para a distribuição é ${acceptedAnchor.sequence + 1}.`);
    if ((manifest.previousBundleChecksum ?? '').toLowerCase() !== acceptedAnchor.checksum.toLowerCase()) throw new Error('O manifesto de distribuição não estende a última âncora aceita.');
  } else if (publisher.kind === 'official' && manifest.sequence !== 1) {
    throw new Error('A primeira distribuição oficial precisa iniciar na sequência 1.');
  }
  if (!/^[a-f0-9]{64}$/i.test(manifest.catalogChecksum) || !/^[a-f0-9]{64}$/i.test(manifest.bundleChecksum)) throw new Error('O manifesto possui checksums inválidos.');
  if (!Number.isInteger(manifest.bundleByteLength) || manifest.bundleByteLength <= 0 || !Number.isInteger(manifest.bundleCharacterLength) || manifest.bundleCharacterLength <= 0) throw new Error('O tamanho do bundle é inválido.');
  validateChunkLayout(manifest);
  if (manifest.mirrors.length < 2) throw new Error('A distribuição resiliente exige pelo menos dois mirrors assinados.');
  const mirrorIds = new Set<string>();
  for (const mirror of manifest.mirrors) {
    if (!mirror.mirrorId.trim() || mirrorIds.has(mirror.mirrorId)) throw new Error('Os mirrors precisam de identificadores únicos.');
    mirrorIds.add(mirror.mirrorId);
    if (!Number.isInteger(mirror.priority) || mirror.priority < 0) throw new Error(`A prioridade do mirror ${mirror.mirrorId} é inválida.`);
    assertHttpsUrl(mirror.statusUrl, `Status do mirror ${mirror.mirrorId}`);
    assertHttpsUrl(mirror.chunkUrlTemplate, `Blocos do mirror ${mirror.mirrorId}`);
    if (!mirror.chunkUrlTemplate.includes('{index}')) throw new Error(`O mirror ${mirror.mirrorId} não possui o marcador {index}.`);
  }
  const localLatest = localLog?.entries.at(-1);
  if (localLatest) {
    if (manifest.sequence <= localLatest.sequence) throw new Error('O manifesto de distribuição não é posterior ao catálogo observado localmente.');
    if (manifest.sequence !== localLatest.sequence + 1) throw new Error('O manifesto de distribuição pula uma sequência do registro local.');
    if (manifest.previousBundleChecksum !== localLatest.catalogChecksum) throw new Error('O manifesto de distribuição não estende o checksum local observado.');
  }
  if (remoteManifest) {
    if (remoteManifest.publisherId !== manifest.publisherId) throw new Error('O manifesto remoto e o manifesto de distribuição pertencem a publicadores diferentes.');
    if (manifest.sequence !== remoteManifest.latestSequence) throw new Error('O mirror anuncia uma sequência diferente da última publicação assinada.');
    if (manifest.catalogChecksum !== remoteManifest.latestCatalogChecksum || manifest.catalogVersion !== remoteManifest.latestCatalogVersion || manifest.snapshotId !== remoteManifest.latestSnapshotId) throw new Error('O manifesto de distribuição diverge do manifesto remoto assinado.');
  }
  return {
    publisherId: manifest.publisherId,
    keyId: manifest.keyId,
    keyFingerprint: key.fingerprint,
    sequence: manifest.sequence,
    catalogChecksum: manifest.catalogChecksum,
    bundleChecksum: manifest.bundleChecksum,
    catalogVersion: manifest.catalogVersion,
    snapshotId: manifest.snapshotId,
    bundleByteLength: manifest.bundleByteLength,
    chunkCount: manifest.chunks.length,
    mirrorCount: manifest.mirrors.length
  };
};

export const assessCatalogMirrorStatus = (
  manifest: SignedCatalogDistributionManifest,
  mirror: CatalogDistributionMirror,
  status: CatalogMirrorStatusDocument,
  latencyMs: number,
  checkedAt = new Date().toISOString()
): CatalogMirrorObservation => {
  if (status.schemaVersion !== CATALOG_MIRROR_STATUS_SCHEMA || status.mirrorId !== mirror.mirrorId || status.publisherId !== manifest.publisherId) return { mirrorId: mirror.mirrorId, checkedAt, status: 'conflicting', latencyMs, issue: 'O status retornado pertence a outro mirror ou publicador.' };
  if (status.sequence < manifest.sequence) return { mirrorId: mirror.mirrorId, checkedAt, status: 'stale', latencyMs, remoteSequence: status.sequence, remoteCatalogChecksum: status.catalogChecksum, remoteBundleChecksum: status.bundleChecksum, issue: 'O mirror está desatualizado.' };
  if (status.sequence !== manifest.sequence || status.catalogChecksum !== manifest.catalogChecksum || status.bundleChecksum !== manifest.bundleChecksum || status.bundleByteLength !== manifest.bundleByteLength || status.chunkCount !== manifest.chunks.length) return { mirrorId: mirror.mirrorId, checkedAt, status: 'conflicting', latencyMs, remoteSequence: status.sequence, remoteCatalogChecksum: status.catalogChecksum, remoteBundleChecksum: status.bundleChecksum, issue: 'O mirror diverge do manifesto assinado.' };
  return { mirrorId: mirror.mirrorId, checkedAt, status: 'available', latencyMs, remoteSequence: status.sequence, remoteCatalogChecksum: status.catalogChecksum, remoteBundleChecksum: status.bundleChecksum };
};

export const rankCatalogMirrors = (
  manifest: SignedCatalogDistributionManifest,
  observations: readonly CatalogMirrorObservation[],
  now: () => Date = () => new Date(),
  maxAgeMs = 15 * 60 * 1000
): CatalogDistributionMirror[] => {
  const byId = new Map(observations.map((entry) => [entry.mirrorId, entry]));
  const current = now().getTime();
  const usable = (mirror: CatalogDistributionMirror): boolean => {
    const observation = byId.get(mirror.mirrorId);
    if (!observation || observation.status !== 'available') return false;
    const checkedAt = Date.parse(observation.checkedAt);
    if (!Number.isFinite(checkedAt) || current - checkedAt > maxAgeMs || checkedAt > current + 300000) return false;
    return observation.remoteSequence === manifest.sequence
      && observation.remoteCatalogChecksum === manifest.catalogChecksum
      && observation.remoteBundleChecksum === manifest.bundleChecksum;
  };
  return manifest.mirrors
    .filter(usable)
    .sort((left, right) => left.priority - right.priority || (byId.get(left.mirrorId)?.latencyMs ?? Number.MAX_SAFE_INTEGER) - (byId.get(right.mirrorId)?.latencyMs ?? Number.MAX_SAFE_INTEGER) || left.mirrorId.localeCompare(right.mirrorId));
};

export const assertCatalogNetworkPolicy = (params: {
  policy: CatalogNetworkPolicy;
  network: CatalogNetworkSnapshot;
  bundleByteLength: number;
  automatic: boolean;
  manualOverride?: boolean;
}): void => {
  const { policy, network, automatic, manualOverride } = params;
  if (network.kind === 'offline') throw new Error('Não existe conexão disponível para baixar o catálogo.');
  if (automatic && policy.mode !== 'assisted') throw new Error('Downloads automáticos estão desativados pela política de rede.');
  if (automatic && params.bundleByteLength > policy.maxAssistedBundleBytes) throw new Error('O bundle excede o limite configurado para download assistido.');
  if (network.kind === 'cellular' && !policy.allowCellular && !manualOverride) throw new Error('A política de rede bloqueia downloads por dados móveis.');
  if (network.isRoaming && !policy.allowRoaming && !manualOverride) throw new Error('A política de rede bloqueia downloads em roaming.');
  if (network.kind === 'unknown' && !policy.allowUnknownNetwork && !manualOverride) throw new Error('A rede atual não pôde ser classificada e exige confirmação manual.');
};

export const createCatalogDownloadSession = (manifest: SignedCatalogDistributionManifest, now: () => Date = () => new Date()): CatalogDownloadSession => {
  const at = now().toISOString();
  return {
    schemaVersion: CATALOG_DOWNLOAD_SESSION_SCHEMA,
    id: `catalog-download-${manifest.publisherId}-${manifest.sequence}-${manifest.bundleChecksum.slice(0, 12)}`,
    publisherId: manifest.publisherId,
    sequence: manifest.sequence,
    manifestChecksum: catalogDistributionManifestChecksum(manifest),
    bundleChecksum: manifest.bundleChecksum,
    status: 'prepared',
    createdAt: at,
    updatedAt: at,
    usedMirrorIds: [],
    completedChunkIndexes: [],
    downloadedBytes: 0,
    resumeCount: 0,
    attempts: 0
  };
};

export const applyCatalogDownloadChunk = (params: {
  session: CatalogDownloadSession;
  manifest: SignedCatalogDistributionManifest;
  chunk: CatalogDistributionChunkDescriptor;
  content: string;
  mirrorId: string;
  now?: () => Date;
}): CatalogDownloadSession => {
  const { session, manifest, chunk, content, mirrorId } = params;
  if (session.manifestChecksum !== catalogDistributionManifestChecksum(manifest) || session.bundleChecksum !== manifest.bundleChecksum) throw new Error('A sessão não corresponde ao manifesto atual.');
  if (manifest.chunks[chunk.index]?.checksum !== chunk.checksum) throw new Error('O bloco solicitado não pertence ao manifesto atual.');
  if (content.length !== chunk.characterLength || utf8ByteLength(content) !== chunk.byteLength) throw new Error(`O tamanho do bloco ${chunk.index} diverge do manifesto.`);
  if (sha256Hex(content) !== chunk.checksum) throw new Error(`O checksum do bloco ${chunk.index} é inválido.`);
  const completed = new Set(session.completedChunkIndexes);
  const alreadyCompleted = completed.has(chunk.index);
  completed.add(chunk.index);
  const now = params.now ?? (() => new Date());
  return {
    ...session,
    status: 'downloading',
    updatedAt: now().toISOString(),
    selectedMirrorId: mirrorId,
    usedMirrorIds: session.usedMirrorIds.includes(mirrorId) ? session.usedMirrorIds : [...session.usedMirrorIds, mirrorId],
    completedChunkIndexes: [...completed].sort((a, b) => a - b),
    downloadedBytes: alreadyCompleted ? session.downloadedBytes : session.downloadedBytes + chunk.byteLength,
    attempts: session.attempts + 1,
    lastError: undefined
  };
};

const evidenceChecksum = (evidence: Omit<CatalogDownloadEvidence, 'checksum'>): string => sha256Hex(stableStringify(evidence));
export const validateCatalogDownloadEvidence = (evidence: CatalogDownloadEvidence): boolean => {
  if (evidence.schemaVersion !== CATALOG_DOWNLOAD_EVIDENCE_SCHEMA) return false;
  const { checksum, ...base } = evidence;
  return checksum === evidenceChecksum(base);
};

export const finalizeCatalogDownload = (params: {
  session: CatalogDownloadSession;
  manifest: SignedCatalogDistributionManifest;
  rawText: string;
  registry: CatalogTrustRegistry;
  now?: () => Date;
}): { session: CatalogDownloadSession; evidence: CatalogDownloadEvidence; trustVerification: CatalogTrustVerification } => {
  const { session, manifest, rawText, registry } = params;
  if (session.completedChunkIndexes.length !== manifest.chunks.length) throw new Error('O download ainda possui blocos pendentes.');
  if (rawText.length !== manifest.bundleCharacterLength || utf8ByteLength(rawText) !== manifest.bundleByteLength) throw new Error('O tamanho materializado diverge do manifesto.');
  if (sha256Hex(rawText) !== manifest.bundleChecksum) throw new Error('O checksum do bundle materializado é inválido.');
  const trusted = verifySignedCatalogEnvelope({ rawText, registry, now: params.now });
  if (trusted.verification.publisherId !== manifest.publisherId || trusted.verification.sequence !== manifest.sequence || trusted.verification.catalogChecksum !== manifest.catalogChecksum || trusted.verification.catalogVersion !== manifest.catalogVersion || trusted.verification.snapshotId !== manifest.snapshotId) throw new Error('O envelope baixado diverge do manifesto de distribuição assinado.');
  const now = params.now ?? (() => new Date());
  const completedAt = now().toISOString();
  const nextSession: CatalogDownloadSession = { ...session, status: 'verified', updatedAt: completedAt, completedAt, downloadedBytes: manifest.bundleByteLength, lastError: undefined };
  const base: Omit<CatalogDownloadEvidence, 'checksum'> = {
    schemaVersion: CATALOG_DOWNLOAD_EVIDENCE_SCHEMA,
    evidenceId: `catalog-download-evidence-${session.id}`,
    sessionId: session.id,
    publisherId: manifest.publisherId,
    sequence: manifest.sequence,
    catalogVersion: manifest.catalogVersion,
    snapshotId: manifest.snapshotId,
    catalogChecksum: manifest.catalogChecksum,
    bundleChecksum: manifest.bundleChecksum,
    manifestChecksum: session.manifestChecksum,
    startedAt: session.startedAt ?? session.createdAt,
    completedAt,
    downloadedBytes: manifest.bundleByteLength,
    chunkCount: manifest.chunks.length,
    resumeCount: session.resumeCount,
    usedMirrorIds: [...session.usedMirrorIds],
    networkKinds: session.network ? [session.network.kind] : [],
    verifiedOffline: true
  };
  return { session: nextSession, evidence: { ...base, checksum: evidenceChecksum(base) }, trustVerification: trusted.verification };
};

export const parseSignedCatalogDistributionManifest = (rawText: string): SignedCatalogDistributionManifest => clone(JSON.parse(rawText) as SignedCatalogDistributionManifest);

const resolveTemplate = (template: string, manifest: SignedCatalogDistributionManifest, chunkIndex?: number): string => template
  .replaceAll('{publisherId}', encodeURIComponent(manifest.publisherId))
  .replaceAll('{sequence}', String(manifest.sequence))
  .replaceAll('{bundleChecksum}', manifest.bundleChecksum)
  .replaceAll('{index}', String(chunkIndex ?? 0));

export const createFetchCatalogMirrorTransport = (fetchImpl: typeof fetch = fetch, timeoutMs = 15000): CatalogMirrorTransport => ({
  probe: async (mirror, manifest) => {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(resolveTemplate(mirror.statusUrl, manifest), { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { status: await response.json() as CatalogMirrorStatusDocument, latencyMs: Date.now() - started };
    } finally { clearTimeout(timeout); }
  },
  fetchChunk: async (mirror, manifest, chunk) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(resolveTemplate(mirror.chunkUrlTemplate, manifest, chunk.index), { method: 'GET', headers: { Accept: 'text/plain' }, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally { clearTimeout(timeout); }
  }
});
