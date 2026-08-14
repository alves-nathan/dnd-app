import {
  DEFAULT_CATALOG_NETWORK_POLICY,
  applyCatalogDownloadChunk,
  assertCatalogNetworkPolicy,
  assessCatalogMirrorStatus,
  createCatalogDownloadSession,
  finalizeCatalogDownload,
  rankCatalogMirrors,
  validateCatalogDownloadEvidence,
  verifySignedCatalogDistributionManifest,
  type SignedCatalogDistributionManifest
} from '../catalog/catalogDistribution';
import { createCatalogDownloadCacheRepository } from '../storage/catalogDownloadCacheRepository';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';
import { catalogCanonicalChecksum, catalogPublicKeyFingerprint, catalogSignaturePayload, CATALOG_SIGNATURE_ALGORITHM, SIGNED_CATALOG_BUNDLE_SCHEMA } from '../catalog/catalogTrust';
import { sha256Hex } from '../catalog/catalogBundleDigest';
import { stableStringify } from '../catalog/utils';

// Runtime harness covers real P-256 signatures. These unit tests focus on deterministic state transitions.
describe('catalog distribution', () => {
  it('rejects network policy violations', () => {
    expect(() => assertCatalogNetworkPolicy({ policy: DEFAULT_CATALOG_NETWORK_POLICY, network: { kind: 'cellular', observedAt: new Date().toISOString() }, bundleByteLength: 100, automatic: false })).toThrow('dados móveis');
    expect(() => assertCatalogNetworkPolicy({ policy: DEFAULT_CATALOG_NETWORK_POLICY, network: { kind: 'cellular', observedAt: new Date().toISOString() }, bundleByteLength: 100, automatic: false, manualOverride: true })).not.toThrow();
  });

  it('persists resumable chunks without materializing partial bundles', async () => {
    const storage = createMemoryKeyValueStorage();
    const repository = createCatalogDownloadCacheRepository(storage, () => new Date('2026-08-04T18:00:00.000Z'));
    const manifest = { publisherId: 'publisher', sequence: 1, bundleChecksum: 'a'.repeat(64), chunks: [{ index: 0 }, { index: 1 }] } as unknown as SignedCatalogDistributionManifest;
    const session = { ...createCatalogDownloadSession({ ...manifest, schemaVersion: 'dnd-catalog-distribution-manifest.v1', keyId: 'key', issuedAt: '2026-08-04T17:00:00.000Z', catalogChecksum: 'b'.repeat(64), catalogVersion: '1', snapshotId: 'snapshot', bundleByteLength: 2, bundleCharacterLength: 2, mirrors: [], signature: '' } as SignedCatalogDistributionManifest), completedChunkIndexes: [0] };
    await repository.saveSession(session, manifest);
    await repository.writeChunk(session.id, 0, 'a');
    const loaded = await repository.loadSession(session.id);
    expect(loaded?.session.completedChunkIndexes).toEqual([0]);
    await expect(repository.assemble(session.id, 2)).rejects.toThrow('incompleto');
  });
});
