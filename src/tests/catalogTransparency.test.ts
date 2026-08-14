import {
  appendCatalogTransparencyEntry,
  applyCatalogTrustRecovery,
  compareCatalogTransparencyLogs,
  computeCatalogTransparencyRoot,
  createCatalogConsistencyProof,
  createCatalogInclusionProof,
  createCatalogTransparencyLog,
  createPortableCatalogTrustDocument,
  parsePortableCatalogTrustDocument,
  validateCatalogRecoveryStatement,
  verifyCatalogConsistencyProof,
  verifyCatalogInclusionProof
} from '../catalog/catalogTransparency';
import type { CatalogRecoveryPolicy, CatalogRecoveryStatement } from '../catalog/catalogTransparency';
import type { CatalogTrustRegistry, CatalogTrustVerification } from '../catalog/catalogTrust';

const verification = (sequence: number, checksum: string, previous?: string): CatalogTrustVerification => ({
  status: 'trusted', publisherId: 'publisher', publisherName: 'Publisher', publisherKind: 'official', trustLevel: 'pinned', keyId: 'key', keyFingerprint: 'a'.repeat(64), signatureAlgorithm: 'ECDSA_P256_SHA256', issuedAt: '2026-08-04T12:00:00.000Z', sequence, ...(previous ? { previousBundleChecksum: previous } : {}), catalogChecksum: checksum, catalogVersion: `1.0.${sequence}`, snapshotId: `snapshot-${sequence}`, signature: 'signature', chainStatus: sequence === 1 ? 'anchored' : 'continued'
});

describe('catalog transparency', () => {
  test('creates inclusion and consistency proofs for append-only history', () => {
    const first = appendCatalogTransparencyEntry(createCatalogTransparencyLog('publisher'), verification(1, '1'.repeat(64))).log;
    const second = appendCatalogTransparencyEntry(first, verification(2, '2'.repeat(64), '1'.repeat(64))).log;
    const proof = createCatalogInclusionProof(second, 0);
    expect(verifyCatalogInclusionProof(proof)).toBe(true);
    expect(verifyCatalogInclusionProof({ ...proof, rootHash: '0'.repeat(64) })).toBe(false);
    const consistency = createCatalogConsistencyProof(first, second);
    expect(verifyCatalogConsistencyProof(consistency)).toBe(true);
    expect(compareCatalogTransparencyLogs(first, second)).toBe('remoteAhead');
    expect(computeCatalogTransparencyRoot(second.entries.map((entry) => entry.leafHash))).toBe(second.treeRoot);
  });

  test('portable trust rejects tampering', () => {
    const registry = { schemaVersion: 'dnd-catalog-trust-registry.v1', revision: 1, publishers: [], events: [], updatedAt: '2026-08-04T12:00:00.000Z' } as CatalogTrustRegistry;
    const document = createPortableCatalogTrustDocument(registry, [], []);
    expect(parsePortableCatalogTrustDocument(JSON.stringify(document)).checksum).toBe(document.checksum);
    expect(() => parsePortableCatalogTrustDocument(JSON.stringify({ ...document, exportedAt: 'changed' }))).toThrow();
  });

  test('recovery requires quorum', () => {
    const policy = { schemaVersion: 'dnd-catalog-recovery-policy.v1', publisherId: 'publisher', threshold: 2, approvers: [], updatedAt: '2026-08-04T12:00:00.000Z' } as CatalogRecoveryPolicy;
    const statement = { schemaVersion: 'dnd-catalog-recovery-statement.v1', publisherId: 'publisher', action: 'restorePublisher', issuedAt: '2026-08-04T12:00:00.000Z', nonce: 'nonce', approvals: [] } as CatalogRecoveryStatement;
    expect(() => validateCatalogRecoveryStatement(policy, statement, () => new Date('2026-08-04T12:01:00.000Z'))).toThrow();
    expect(applyCatalogTrustRecovery).toBeDefined();
  });
});
