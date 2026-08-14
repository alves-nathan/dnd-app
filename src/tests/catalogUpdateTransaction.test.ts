import { CatalogLoader } from '../catalog/catalogLoader';
import { ContentPolicyService } from '../catalog/contentPolicyService';
import { sha256Hex } from '../catalog/catalogBundleDigest';
import {
  canCommitCatalogUpdate,
  compareCatalogSnapshots,
  createCatalogUpdateReceipt,
  createCatalogUpdateSession,
  migrateCharacterCatalogSnapshots,
  projectCatalogFilterState,
  validateCatalogUpdateReceipt
} from '../catalog/catalogUpdateTransaction';
import type { RuntimeCatalogBundle } from '../catalog/types';

const minimalBundle = (version: string, name = 'Test Feature'): RuntimeCatalogBundle => ({
  schemaVersion: 'dnd-combat-runtime-bundle.v1', catalogVersion: version, generatedAt: '2026-08-04T00:00:00.000Z',
  sourcePackage: { packageId: 'test', version, ruleset: '2024', sourceBooks: ['phb-2024'], zipSha256: 'test' },
  sourceFiles: {}, sourceChecksums: {}, manifest: { packageId: 'test', version, ruleset: '2024', sourceBooks: ['phb-2024'] },
  runtimeIndex: { lotId: 'runtime', version, entryCount: 1, entries: [{ entityId: 'feature.test', kind: 'feature', displayName: name, displayContext: [], sourceBookId: 'phb-2024', sourceFile: 'test.json', categoryIds: [], status: 'published', defaultEnabled: true, manualReviewRequired: false, dependencyCounts: { outgoing: 0, incoming: 0 }, searchKey: name.toLowerCase() }] },
  entityRegistry: { id: 'registry', kind: 'registry', generatedFromVersion: version, entries: [{ entityId: 'feature.test', kind: 'feature', sourceBookId: 'phb-2024', sourceFile: 'test.json', name, status: 'published', defaultEnabled: true, manualReviewRequired: false }] },
  dependencyGraph: { id: 'graph', kind: 'graph', generatedFromVersion: version, nodeCount: 1, edgeCount: 0, edges: [] },
  aliases: { lotId: 'aliases', entities: [] }, contentCategories: { lotId: 'categories', version, entities: [] },
  contentFilterPolicy: { id: 'policy', kind: 'policy', version, precedence: [], rules: [], profiles: [{ id: 'full-official', name: 'Full official', bookStates: { 'phb-2024': true } }], status: 'published' },
  readinessProfile: {}, integrationContract: {}, runtimeOperations: {}, runtimeErrors: {}, snapshotMigrationPolicy: {}, activationPolicy: {}, selectionContracts: {}, providerCollections: {}
});

describe('catalog update transaction', () => {
  test('compares versions and preserves compatible filters', () => {
    const loader = new CatalogLoader();
    const current = loader.initializeFromBundle(minimalBundle('1.0.0'));
    const candidate = loader.initializeFromBundle(minimalBundle('1.1.0', 'Updated Feature'));
    const diff = compareCatalogSnapshots(current, candidate);
    expect(diff.changedEntityIds).toEqual(['feature.test']);
    const filter = new ContentPolicyService(current).createDefaultState();
    filter.entityStates['feature.test'] = 'enabled';
    expect(projectCatalogFilterState(filter, candidate).entityStates['feature.test']).toBe('enabled');
  });

  test('requires explicit migration and validates the receipt', () => {
    const loader = new CatalogLoader();
    const current = loader.initializeFromBundle(minimalBundle('1.0.0'));
    const candidate = loader.initializeFromBundle(minimalBundle('1.1.0', 'Updated Feature'));
    const diff = compareCatalogSnapshots(current, candidate);
    const character = { id: 'c1', name: 'Test', catalogSnapshotId: current.snapshotId };
    const session = createCatalogUpdateSession({
      candidate: { id: 'candidate', catalogVersion: candidate.catalogVersion, snapshotId: candidate.snapshotId, checksum: sha256Hex('candidate'), byteLength: 9, chunkCount: 1, stagedAt: '2026-08-04T00:00:00.000Z' },
      diff,
      impact: { characters: [], affectedCharacterIds: ['c1'], snapshotMigrationCharacterIds: ['c1'], blockingCharacterIds: [], affectedEvidenceRecordIds: [], counts: { charactersExamined: 1, charactersAffected: 1, snapshotMigrations: 1, blockingCharacters: 0, evidenceRecordsAffected: 0 } },
      projectedFilterState: new ContentPolicyService(candidate).createDefaultState(),
      checkpoint: { runtimeRef: { kind: 'bundled' }, catalog: { filterState: new ContentPolicyService(current).createDefaultState(), revision: 0, history: [] }, characters: [character], evidenceRecords: [] },
      internalFixtureBypass: true
    });
    expect(canCommitCatalogUpdate(session).ok).toBe(false);
    session.migrationCharacterIds = ['c1'];
    session.impactAcknowledged = true;
    expect(canCommitCatalogUpdate(session).ok).toBe(true);
    expect(migrateCharacterCatalogSnapshots([character], ['c1'], candidate.snapshotId)[0].catalogSnapshotId).toBe(candidate.snapshotId);
    const receipt = createCatalogUpdateReceipt(session);
    expect(validateCatalogUpdateReceipt(receipt)).toBe(true);
    expect(validateCatalogUpdateReceipt({ ...receipt, toVersion: 'tampered' })).toBe(false);
  });
});
