import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import {
  CATALOG_KEY_REVOCATION_SCHEMA,
  CATALOG_KEY_ROTATION_SCHEMA,
  CATALOG_SIGNATURE_ALGORITHM,
  CATALOG_TRUST_REGISTRY_SCHEMA,
  SIGNED_CATALOG_BUNDLE_SCHEMA,
  acceptVerifiedCatalogBundle,
  addCommunityPublisher,
  applyCatalogKeyRevocation,
  applyCatalogKeyRotation,
  catalogCanonicalChecksum,
  catalogPublicKeyFingerprint,
  catalogSignaturePayload,
  verifyP256Signature,
  verifySignedCatalogEnvelope,
  type CatalogEcPublicJwk,
  type CatalogKeyRevocationStatement,
  type CatalogKeyRotationStatement,
  type CatalogTrustRegistry,
  type SignedCatalogProvenance
} from '../catalog/catalogTrust';
import { stableStringify } from '../catalog/utils';
import type { RuntimeCatalogBundle } from '../catalog/types';

const keyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    publicJwk: publicKey.export({ format: 'jwk' }) as CatalogEcPublicJwk,
    privateJwk: privateKey.export({ format: 'jwk' })
  };
};
const signPayload = (payload: string, privateJwk: JsonWebKey): string => sign('sha256', Buffer.from(payload), {
  key: createPrivateKey({ key: privateJwk, format: 'jwk' }),
  dsaEncoding: 'ieee-p1363'
}).toString('base64url');
const catalog = { catalogVersion: '5.0.0' } as RuntimeCatalogBundle;
const buildRegistry = (publicJwk: CatalogEcPublicJwk): CatalogTrustRegistry => ({
  schemaVersion: CATALOG_TRUST_REGISTRY_SCHEMA,
  revision: 1,
  publishers: [{
    publisherId: 'test-official', displayName: 'Test Official', kind: 'official', trustLevel: 'pinned', status: 'trusted',
    keys: [{ keyId: 'root', algorithm: CATALOG_SIGNATURE_ALGORITHM, publicJwk, fingerprint: catalogPublicKeyFingerprint(publicJwk), status: 'active', validFrom: '2026-01-01T00:00:00.000Z', addedAt: '2026-01-01T00:00:00.000Z' }],
    lastAcceptedBundle: { checksum: 'a'.repeat(64), sequence: 0, catalogVersion: '4.9.0', snapshotId: 'old', keyId: 'root', acceptedAt: '2026-01-01T00:00:00.000Z' },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  }],
  events: [], updatedAt: '2026-01-01T00:00:00.000Z'
});
const signedEnvelope = (privateJwk: JsonWebKey, overrides: Partial<SignedCatalogProvenance> = {}) => {
  const provenance: SignedCatalogProvenance = {
    publisherId: 'test-official', publisherName: 'Test Official', publisherKind: 'official', keyId: 'root', algorithm: CATALOG_SIGNATURE_ALGORITHM,
    issuedAt: '2026-08-04T12:00:00.000Z', sequence: 1, previousBundleChecksum: 'a'.repeat(64), catalogChecksum: catalogCanonicalChecksum(catalog), catalogVersion: '5.0.0', snapshotId: 'snapshot-5', ...overrides
  };
  return JSON.stringify({ schemaVersion: SIGNED_CATALOG_BUNDLE_SCHEMA, catalog, provenance, signature: signPayload(catalogSignaturePayload(provenance), privateJwk) });
};

describe('catalog trust chain', () => {
  test('accepts a valid signature and rejects tampering', () => {
    const pair = keyPair();
    const registry = buildRegistry(pair.publicJwk);
    const valid = verifySignedCatalogEnvelope({ rawText: signedEnvelope(pair.privateJwk), registry, now: () => new Date('2026-08-04T12:01:00.000Z') });
    expect(valid.verification.status).toBe('trusted');
    expect(valid.verification.chainStatus).toBe('continued');
    expect(verifyP256Signature(catalogSignaturePayload(valid.envelope.provenance), valid.envelope.signature, pair.publicJwk)).toBe(true);
    const tampered = JSON.parse(signedEnvelope(pair.privateJwk));
    tampered.catalog.catalogVersion = '5.0.1';
    expect(() => verifySignedCatalogEnvelope({ rawText: JSON.stringify(tampered), registry })).toThrow('alterado');
  });

  test('rotates and revokes keys only with a valid authorizing signature', () => {
    const current = keyPair();
    const next = keyPair();
    const registry = buildRegistry(current.publicJwk);
    const rotationBase: Omit<CatalogKeyRotationStatement, 'signature'> = {
      schemaVersion: CATALOG_KEY_ROTATION_SCHEMA, publisherId: 'test-official', currentKeyId: 'root',
      newKey: { keyId: 'root-2', algorithm: CATALOG_SIGNATURE_ALGORITHM, publicJwk: next.publicJwk, validFrom: '2026-08-05T00:00:00.000Z' },
      issuedAt: '2026-08-04T13:00:00.000Z', sequence: 2
    };
    const rotation = { ...rotationBase, signature: signPayload(stableStringify(rotationBase), current.privateJwk) };
    const rotated = applyCatalogKeyRotation(registry, rotation, () => new Date('2026-08-04T13:01:00.000Z'));
    expect(rotated.publishers[0].keys.find((key) => key.keyId === 'root')?.status).toBe('retired');
    expect(rotated.publishers[0].keys.find((key) => key.keyId === 'root-2')?.status).toBe('active');

    const revokeBase: Omit<CatalogKeyRevocationStatement, 'signature'> = {
      schemaVersion: CATALOG_KEY_REVOCATION_SCHEMA, publisherId: 'test-official', authorizingKeyId: 'root-2', revokedKeyId: 'root-2',
      reason: 'Compromised', issuedAt: '2026-08-05T01:00:00.000Z', sequence: 3
    };
    const revocation = { ...revokeBase, signature: signPayload(stableStringify(revokeBase), next.privateJwk) };
    const revoked = applyCatalogKeyRevocation(rotated, revocation, () => new Date('2026-08-05T01:01:00.000Z'));
    expect(revoked.publishers[0].keys.find((key) => key.keyId === 'root-2')?.status).toBe('revoked');
  });

  test('requires explicit fingerprint confirmation for community publishers', () => {
    const pair = keyPair();
    const fingerprint = catalogPublicKeyFingerprint(pair.publicJwk);
    expect(() => addCommunityPublisher(buildRegistry(keyPair().publicJwk), { publisherId: 'community.test', displayName: 'Community', keyId: 'main', publicJwk: pair.publicJwk, acknowledgedFingerprint: '0'.repeat(64) })).toThrow('fingerprint');
    const added = addCommunityPublisher(buildRegistry(keyPair().publicJwk), { publisherId: 'community.test', displayName: 'Community', keyId: 'main', publicJwk: pair.publicJwk, acknowledgedFingerprint: fingerprint });
    expect(added.publishers.find((entry) => entry.publisherId === 'community.test')?.trustLevel).toBe('userApproved');
  });

  test('records accepted provenance idempotently', () => {
    const pair = keyPair();
    const registry = buildRegistry(pair.publicJwk);
    const verification = verifySignedCatalogEnvelope({ rawText: signedEnvelope(pair.privateJwk), registry, now: () => new Date('2026-08-04T12:01:00.000Z') }).verification;
    const accepted = acceptVerifiedCatalogBundle(registry, verification, '5.0.0', 'snapshot-5', '2026-08-04T12:02:00.000Z');
    expect(accepted.publishers[0].lastAcceptedBundle?.sequence).toBe(1);
    const repeated = acceptVerifiedCatalogBundle(accepted, verification, '5.0.0', 'snapshot-5', '2026-08-04T12:03:00.000Z');
    expect(repeated.revision).toBe(accepted.revision);
  });
});
