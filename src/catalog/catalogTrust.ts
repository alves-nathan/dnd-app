import { sha256Hex } from './catalogBundleDigest';
import { stableStringify } from './utils';
import type { RuntimeCatalogBundle } from './types';

export const SIGNED_CATALOG_BUNDLE_SCHEMA = 'dnd-signed-catalog-bundle.v1' as const;
export const CATALOG_TRUST_REGISTRY_SCHEMA = 'dnd-catalog-trust-registry.v1' as const;
export const CATALOG_KEY_ROTATION_SCHEMA = 'dnd-catalog-key-rotation.v1' as const;
export const CATALOG_KEY_REVOCATION_SCHEMA = 'dnd-catalog-key-revocation.v1' as const;
export const CATALOG_SIGNATURE_ALGORITHM = 'ECDSA_P256_SHA256' as const;

export type CatalogPublisherKind = 'official' | 'community';
export type CatalogTrustLevel = 'pinned' | 'userApproved';
export type CatalogTrustKeyStatus = 'active' | 'retired' | 'revoked';

export interface CatalogEcPublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface CatalogTrustKey {
  keyId: string;
  algorithm: typeof CATALOG_SIGNATURE_ALGORITHM;
  publicJwk: CatalogEcPublicJwk;
  fingerprint: string;
  status: CatalogTrustKeyStatus;
  validFrom: string;
  validUntil?: string;
  predecessorKeyId?: string;
  addedAt: string;
  retiredAt?: string;
  revokedAt?: string;
  revocationReason?: string;
}

export interface CatalogAcceptedBundleAnchor {
  checksum: string;
  sequence: number;
  catalogVersion: string;
  snapshotId: string;
  keyId: string;
  acceptedAt: string;
}

export interface CatalogTrustedPublisher {
  publisherId: string;
  displayName: string;
  kind: CatalogPublisherKind;
  trustLevel: CatalogTrustLevel;
  status: 'trusted' | 'revoked';
  keys: CatalogTrustKey[];
  lastAcceptedBundle?: CatalogAcceptedBundleAnchor;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogTrustEvent {
  id: string;
  at: string;
  type: 'publisherAdded' | 'keyRotated' | 'keyRevoked' | 'publisherRevoked' | 'bundleAccepted' | 'registryRestored' | 'recoveryApplied' | 'registryImported' | 'transparencyMismatch';
  publisherId: string;
  keyId?: string;
  details?: Record<string, unknown>;
}

export interface CatalogTrustRegistry {
  schemaVersion: typeof CATALOG_TRUST_REGISTRY_SCHEMA;
  revision: number;
  publishers: CatalogTrustedPublisher[];
  events: CatalogTrustEvent[];
  updatedAt: string;
}

export interface SignedCatalogProvenance {
  publisherId: string;
  publisherName: string;
  publisherKind: CatalogPublisherKind;
  keyId: string;
  algorithm: typeof CATALOG_SIGNATURE_ALGORITHM;
  issuedAt: string;
  expiresAt?: string;
  sequence: number;
  previousBundleChecksum?: string;
  catalogChecksum: string;
  catalogVersion: string;
  snapshotId: string;
}

export interface SignedCatalogEnvelope {
  schemaVersion: typeof SIGNED_CATALOG_BUNDLE_SCHEMA;
  catalog: RuntimeCatalogBundle;
  provenance: SignedCatalogProvenance;
  signature: string;
}

export interface CatalogTrustVerification {
  status: 'trusted';
  publisherId: string;
  publisherName: string;
  publisherKind: CatalogPublisherKind;
  trustLevel: CatalogTrustLevel;
  keyId: string;
  keyFingerprint: string;
  signatureAlgorithm: typeof CATALOG_SIGNATURE_ALGORITHM;
  issuedAt: string;
  expiresAt?: string;
  sequence: number;
  previousBundleChecksum?: string;
  catalogChecksum: string;
  catalogVersion: string;
  snapshotId: string;
  signature: string;
  chainStatus: 'anchored' | 'continued';
}

export interface CatalogKeyRotationStatement {
  schemaVersion: typeof CATALOG_KEY_ROTATION_SCHEMA;
  publisherId: string;
  currentKeyId: string;
  newKey: Pick<CatalogTrustKey, 'keyId' | 'algorithm' | 'publicJwk' | 'validFrom' | 'validUntil'>;
  issuedAt: string;
  sequence: number;
  signature: string;
}

export interface CatalogKeyRevocationStatement {
  schemaVersion: typeof CATALOG_KEY_REVOCATION_SCHEMA;
  publisherId: string;
  authorizingKeyId: string;
  revokedKeyId?: string;
  revokePublisher?: boolean;
  reason: string;
  issuedAt: string;
  sequence: number;
  signature: string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const normalizedHex = (value: string): string => value.trim().toLowerCase();
const nowIso = (): string => new Date().toISOString();

const base64UrlToBytes = (value: string): Uint8Array => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '');
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Conteúdo base64url inválido.');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(output);
};

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('');
const bytesToBigInt = (bytes: Uint8Array): bigint => BigInt(`0x${bytesToHex(bytes) || '0'}`);
const mod = (value: bigint, modulus: bigint): bigint => ((value % modulus) + modulus) % modulus;
const modInverse = (value: bigint, modulus: bigint): bigint => {
  let oldR = mod(value, modulus);
  let r = modulus;
  let oldS = 1n;
  let s = 0n;
  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }
  if (oldR !== 1n) throw new Error('Não foi possível inverter o escalar da assinatura.');
  return mod(oldS, modulus);
};

const P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const A = P - 3n;
const B = BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b');
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const GX = BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296');
const GY = BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5');

type AffinePoint = { x: bigint; y: bigint } | undefined;
type JacobianPoint = { x: bigint; y: bigint; z: bigint };
const infinity = (): JacobianPoint => ({ x: 0n, y: 1n, z: 0n });
const isInfinity = (point: JacobianPoint): boolean => point.z === 0n;
const jacobianDouble = (point: JacobianPoint): JacobianPoint => {
  if (isInfinity(point) || point.y === 0n) return infinity();
  const delta = mod(point.z * point.z, P);
  const gamma = mod(point.y * point.y, P);
  const beta = mod(point.x * gamma, P);
  const alpha = mod(3n * mod(point.x - delta, P) * mod(point.x + delta, P), P);
  const x = mod(alpha * alpha - 8n * beta, P);
  const z = mod((point.y + point.z) * (point.y + point.z) - gamma - delta, P);
  const y = mod(alpha * mod(4n * beta - x, P) - 8n * gamma * gamma, P);
  return { x, y, z };
};
const jacobianAddMixed = (point: JacobianPoint, other: AffinePoint): JacobianPoint => {
  if (!other) return point;
  if (isInfinity(point)) return { x: other.x, y: other.y, z: 1n };
  const z1z1 = mod(point.z * point.z, P);
  const u2 = mod(other.x * z1z1, P);
  const s2 = mod(other.y * point.z * z1z1, P);
  const h = mod(u2 - point.x, P);
  const r0 = mod(s2 - point.y, P);
  if (h === 0n) return r0 === 0n ? jacobianDouble(point) : infinity();
  const hh = mod(h * h, P);
  const i = mod(4n * hh, P);
  const j = mod(h * i, P);
  const r = mod(2n * r0, P);
  const v = mod(point.x * i, P);
  const x = mod(r * r - j - 2n * v, P);
  const y = mod(r * mod(v - x, P) - 2n * point.y * j, P);
  const z = mod((point.z + h) * (point.z + h) - z1z1 - hh, P);
  return { x, y, z };
};
const jacobianToAffine = (point: JacobianPoint): AffinePoint => {
  if (isInfinity(point)) return undefined;
  const inverse = modInverse(point.z, P);
  const inverse2 = mod(inverse * inverse, P);
  return { x: mod(point.x * inverse2, P), y: mod(point.y * inverse2 * inverse, P) };
};
const scalarMultiply = (scalar: bigint, point: AffinePoint): AffinePoint => {
  if (!point || scalar === 0n) return undefined;
  let result = infinity();
  const bits = scalar.toString(2);
  for (const bit of bits) {
    result = jacobianDouble(result);
    if (bit === '1') result = jacobianAddMixed(result, point);
  }
  return jacobianToAffine(result);
};
const affineAdd = (left: AffinePoint, right: AffinePoint): AffinePoint => {
  if (!left) return right;
  if (!right) return left;
  if (left.x === right.x) {
    if (mod(left.y + right.y, P) === 0n) return undefined;
    const slope = mod((3n * left.x * left.x + A) * modInverse(2n * left.y, P), P);
    const x = mod(slope * slope - 2n * left.x, P);
    return { x, y: mod(slope * (left.x - x) - left.y, P) };
  }
  const slope = mod((right.y - left.y) * modInverse(right.x - left.x, P), P);
  const x = mod(slope * slope - left.x - right.x, P);
  return { x, y: mod(slope * (left.x - x) - left.y, P) };
};
const isOnCurve = (point: AffinePoint): boolean => Boolean(point && point.x >= 0n && point.x < P && point.y >= 0n && point.y < P
  && mod(point.y * point.y - (point.x * point.x * point.x + A * point.x + B), P) === 0n);

export const verifyP256Signature = (message: string, signature: string, publicJwk: CatalogEcPublicJwk): boolean => {
  try {
    if (publicJwk.kty !== 'EC' || publicJwk.crv !== 'P-256') return false;
    const signatureBytes = base64UrlToBytes(signature);
    if (signatureBytes.length !== 64) return false;
    const r = bytesToBigInt(signatureBytes.slice(0, 32));
    const s = bytesToBigInt(signatureBytes.slice(32));
    if (r <= 0n || r >= N || s <= 0n || s >= N) return false;
    const publicPoint: AffinePoint = { x: bytesToBigInt(base64UrlToBytes(publicJwk.x)), y: bytesToBigInt(base64UrlToBytes(publicJwk.y)) };
    if (!isOnCurve(publicPoint)) return false;
    const z = BigInt(`0x${sha256Hex(message)}`);
    const w = modInverse(s, N);
    const u1 = mod(z * w, N);
    const u2 = mod(r * w, N);
    const point = affineAdd(scalarMultiply(u1, { x: GX, y: GY }), scalarMultiply(u2, publicPoint));
    return Boolean(point && mod(point.x, N) === r);
  } catch {
    return false;
  }
};

export const catalogPublicKeyFingerprint = (publicJwk: CatalogEcPublicJwk): string => sha256Hex(stableStringify({
  crv: publicJwk.crv,
  kty: publicJwk.kty,
  x: publicJwk.x,
  y: publicJwk.y
}));

export const catalogCanonicalChecksum = (catalog: RuntimeCatalogBundle): string => sha256Hex(stableStringify(catalog));
export const catalogSignaturePayload = (provenance: SignedCatalogProvenance): string => stableStringify({
  schemaVersion: SIGNED_CATALOG_BUNDLE_SCHEMA,
  provenance
});

const parseDate = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} contém uma data inválida.`);
  return timestamp;
};

export const verifySignedCatalogEnvelope = (params: {
  rawText: string;
  registry: CatalogTrustRegistry;
  now?: () => Date;
}): { envelope: SignedCatalogEnvelope; catalogRawText: string; verification: CatalogTrustVerification } => {
  let envelope: SignedCatalogEnvelope;
  try {
    envelope = JSON.parse(params.rawText) as SignedCatalogEnvelope;
  } catch {
    throw new Error('O arquivo não contém um envelope de catálogo assinado válido.');
  }
  if (envelope.schemaVersion !== SIGNED_CATALOG_BUNDLE_SCHEMA || !envelope.catalog || !envelope.provenance || !envelope.signature) {
    throw new Error('Bundles sem envelope criptográfico são rejeitados.');
  }
  const provenance = envelope.provenance;
  if (provenance.algorithm !== CATALOG_SIGNATURE_ALGORITHM) throw new Error(`Algoritmo de assinatura não suportado: ${provenance.algorithm}.`);
  const publisher = params.registry.publishers.find((entry) => entry.publisherId === provenance.publisherId);
  if (!publisher || publisher.status !== 'trusted') throw new Error(`Publicador não confiável: ${provenance.publisherId}.`);
  if (publisher.kind !== provenance.publisherKind) throw new Error('O tipo do publicador diverge da política registrada.');
  if (publisher.displayName !== provenance.publisherName) throw new Error('O nome do publicador diverge do registro confiável.');
  if (publisher.kind === 'official' && publisher.trustLevel !== 'pinned') throw new Error('Publicadores oficiais precisam estar fixados pelo aplicativo.');
  if (publisher.kind === 'community' && publisher.trustLevel !== 'userApproved') throw new Error('Publicadores comunitários exigem aprovação explícita do usuário.');
  const key = publisher.keys.find((entry) => entry.keyId === provenance.keyId);
  if (!key || key.status !== 'active') throw new Error(`A chave ${provenance.keyId} não está ativa ou foi revogada.`);
  if (catalogPublicKeyFingerprint(key.publicJwk) !== key.fingerprint) throw new Error('A chave pública registrada falhou na verificação de fingerprint.');
  const now = (params.now ?? (() => new Date()))().getTime();
  const issuedAt = parseDate(provenance.issuedAt, 'issuedAt');
  if (issuedAt > now + 5 * 60 * 1000) throw new Error('A assinatura foi emitida no futuro.');
  if (key.validFrom && issuedAt < parseDate(key.validFrom, 'validFrom')) throw new Error('A assinatura antecede a validade da chave.');
  if (key.validUntil && issuedAt > parseDate(key.validUntil, 'validUntil')) throw new Error('A assinatura foi emitida após a expiração da chave.');
  if (provenance.expiresAt && now > parseDate(provenance.expiresAt, 'expiresAt')) throw new Error('A assinatura do bundle expirou.');
  const catalogChecksum = catalogCanonicalChecksum(envelope.catalog);
  if (catalogChecksum !== normalizedHex(provenance.catalogChecksum)) throw new Error('O catálogo foi alterado depois da assinatura.');
  if (envelope.catalog.catalogVersion !== provenance.catalogVersion) throw new Error('A versão declarada na assinatura diverge do catálogo.');
  if (!verifyP256Signature(catalogSignaturePayload(provenance), envelope.signature, key.publicJwk)) throw new Error('A assinatura criptográfica do catálogo é inválida.');
  const anchor = publisher.lastAcceptedBundle;
  if (anchor) {
    if (provenance.sequence !== anchor.sequence + 1) throw new Error(`A sequência esperada para ${publisher.displayName} é ${anchor.sequence + 1}.`);
    if (normalizedHex(provenance.previousBundleChecksum ?? '') !== normalizedHex(anchor.checksum)) throw new Error('A cadeia de proveniência não aponta para o último bundle aceito.');
  } else if (publisher.kind === 'official' && provenance.sequence !== 1) {
    throw new Error('O primeiro bundle oficial deve iniciar na sequência 1.');
  } else if (provenance.sequence < 1) {
    throw new Error('A sequência do bundle deve ser positiva.');
  }
  return {
    envelope,
    catalogRawText: JSON.stringify(envelope.catalog),
    verification: {
      status: 'trusted',
      publisherId: publisher.publisherId,
      publisherName: publisher.displayName,
      publisherKind: publisher.kind,
      trustLevel: publisher.trustLevel,
      keyId: key.keyId,
      keyFingerprint: key.fingerprint,
      signatureAlgorithm: provenance.algorithm,
      issuedAt: provenance.issuedAt,
      ...(provenance.expiresAt ? { expiresAt: provenance.expiresAt } : {}),
      sequence: provenance.sequence,
      ...(provenance.previousBundleChecksum ? { previousBundleChecksum: provenance.previousBundleChecksum } : {}),
      catalogChecksum,
      catalogVersion: provenance.catalogVersion,
      snapshotId: provenance.snapshotId,
      signature: envelope.signature,
      chainStatus: anchor ? 'continued' : 'anchored'
    }
  };
};

const event = (type: CatalogTrustEvent['type'], publisherId: string, details?: Record<string, unknown>, keyId?: string, at = nowIso()): CatalogTrustEvent => ({
  id: `trust-${type}-${at.replace(/[^0-9]/g, '').slice(0, 17)}-${publisherId}-${keyId ?? 'publisher'}`,
  at,
  type,
  publisherId,
  ...(keyId ? { keyId } : {}),
  ...(details ? { details } : {})
});

export const acceptVerifiedCatalogBundle = (registry: CatalogTrustRegistry, verification: CatalogTrustVerification, catalogVersion: string, snapshotId: string, at = nowIso()): CatalogTrustRegistry => {
  const next = clone(registry);
  const publisher = next.publishers.find((entry) => entry.publisherId === verification.publisherId);
  if (!publisher) throw new Error('O publicador deixou de existir antes do commit.');
  const existing = publisher.lastAcceptedBundle;
  if (existing?.checksum === verification.catalogChecksum && existing.sequence === verification.sequence) return next;
  if (existing && verification.sequence !== existing.sequence + 1) throw new Error('A cadeia de confiança mudou depois do preview.');
  publisher.lastAcceptedBundle = {
    checksum: verification.catalogChecksum,
    sequence: verification.sequence,
    catalogVersion,
    snapshotId,
    keyId: verification.keyId,
    acceptedAt: at
  };
  publisher.updatedAt = at;
  next.revision += 1;
  next.updatedAt = at;
  next.events = [...next.events, event('bundleAccepted', publisher.publisherId, { catalogVersion, snapshotId, checksum: verification.catalogChecksum, sequence: verification.sequence }, verification.keyId, at)].slice(-100);
  return next;
};

const rotationPayload = (statement: CatalogKeyRotationStatement): string => stableStringify({ ...statement, signature: undefined });
const revocationPayload = (statement: CatalogKeyRevocationStatement): string => stableStringify({ ...statement, signature: undefined });

export const applyCatalogKeyRotation = (registry: CatalogTrustRegistry, statement: CatalogKeyRotationStatement, now: () => Date = () => new Date()): CatalogTrustRegistry => {
  if (statement.schemaVersion !== CATALOG_KEY_ROTATION_SCHEMA) throw new Error('Declaração de rotação incompatível.');
  const next = clone(registry);
  const publisher = next.publishers.find((entry) => entry.publisherId === statement.publisherId);
  if (!publisher || publisher.status !== 'trusted') throw new Error('Publicador não confiável para rotação.');
  const current = publisher.keys.find((entry) => entry.keyId === statement.currentKeyId);
  if (!current || current.status !== 'active') throw new Error('A chave que autoriza a rotação não está ativa.');
  if (publisher.keys.some((entry) => entry.keyId === statement.newKey.keyId)) throw new Error('O novo keyId já existe.');
  const issuedAt = parseDate(statement.issuedAt, 'issuedAt');
  if (issuedAt > now().getTime() + 5 * 60 * 1000) throw new Error('A rotação foi emitida no futuro.');
  if (!verifyP256Signature(rotationPayload(statement), statement.signature, current.publicJwk)) throw new Error('A assinatura da rotação é inválida.');
  const fingerprint = catalogPublicKeyFingerprint(statement.newKey.publicJwk);
  current.status = 'retired';
  current.retiredAt = statement.issuedAt;
  publisher.keys.push({
    ...statement.newKey,
    fingerprint,
    status: 'active',
    predecessorKeyId: current.keyId,
    addedAt: statement.issuedAt
  });
  publisher.updatedAt = statement.issuedAt;
  next.revision += 1;
  next.updatedAt = statement.issuedAt;
  next.events = [...next.events, event('keyRotated', publisher.publisherId, { predecessorKeyId: current.keyId, sequence: statement.sequence }, statement.newKey.keyId, statement.issuedAt)].slice(-100);
  return next;
};

export const applyCatalogKeyRevocation = (registry: CatalogTrustRegistry, statement: CatalogKeyRevocationStatement, now: () => Date = () => new Date()): CatalogTrustRegistry => {
  if (statement.schemaVersion !== CATALOG_KEY_REVOCATION_SCHEMA) throw new Error('Declaração de revogação incompatível.');
  const next = clone(registry);
  const publisher = next.publishers.find((entry) => entry.publisherId === statement.publisherId);
  if (!publisher || publisher.status !== 'trusted') throw new Error('Publicador não confiável para revogação.');
  const authorizer = publisher.keys.find((entry) => entry.keyId === statement.authorizingKeyId);
  if (!authorizer || authorizer.status !== 'active') throw new Error('A chave autorizadora não está ativa.');
  if (parseDate(statement.issuedAt, 'issuedAt') > now().getTime() + 5 * 60 * 1000) throw new Error('A revogação foi emitida no futuro.');
  if (!verifyP256Signature(revocationPayload(statement), statement.signature, authorizer.publicJwk)) throw new Error('A assinatura da revogação é inválida.');
  if (statement.revokePublisher) {
    publisher.status = 'revoked';
    for (const key of publisher.keys) if (key.status === 'active') { key.status = 'revoked'; key.revokedAt = statement.issuedAt; key.revocationReason = statement.reason; }
    next.events = [...next.events, event('publisherRevoked', publisher.publisherId, { reason: statement.reason }, authorizer.keyId, statement.issuedAt)].slice(-100);
  } else {
    const target = publisher.keys.find((entry) => entry.keyId === statement.revokedKeyId);
    if (!target) throw new Error('A chave a revogar não existe.');
    if (target.status === 'revoked') throw new Error('A chave já está revogada.');
    target.status = 'revoked';
    target.revokedAt = statement.issuedAt;
    target.revocationReason = statement.reason;
    next.events = [...next.events, event('keyRevoked', publisher.publisherId, { reason: statement.reason }, target.keyId, statement.issuedAt)].slice(-100);
  }
  publisher.updatedAt = statement.issuedAt;
  next.revision += 1;
  next.updatedAt = statement.issuedAt;
  return next;
};

export const addCommunityPublisher = (registry: CatalogTrustRegistry, params: {
  publisherId: string;
  displayName: string;
  keyId: string;
  publicJwk: CatalogEcPublicJwk;
  acknowledgedFingerprint: string;
  now?: () => Date;
}): CatalogTrustRegistry => {
  if (!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(params.publisherId)) throw new Error('publisherId inválido.');
  if (registry.publishers.some((entry) => entry.publisherId === params.publisherId)) throw new Error('Esse publicador já existe.');
  const fingerprint = catalogPublicKeyFingerprint(params.publicJwk);
  if (normalizedHex(params.acknowledgedFingerprint) !== fingerprint) throw new Error('O fingerprint reconhecido não corresponde à chave pública.');
  const at = (params.now ?? (() => new Date()))().toISOString();
  const next = clone(registry);
  next.publishers.push({
    publisherId: params.publisherId,
    displayName: params.displayName.trim() || params.publisherId,
    kind: 'community',
    trustLevel: 'userApproved',
    status: 'trusted',
    keys: [{ keyId: params.keyId, algorithm: CATALOG_SIGNATURE_ALGORITHM, publicJwk: clone(params.publicJwk), fingerprint, status: 'active', validFrom: at, addedAt: at }],
    createdAt: at,
    updatedAt: at
  });
  next.publishers.sort((a, b) => a.displayName.localeCompare(b.displayName));
  next.revision += 1;
  next.updatedAt = at;
  next.events = [...next.events, event('publisherAdded', params.publisherId, { kind: 'community', fingerprint }, params.keyId, at)].slice(-100);
  return next;
};
