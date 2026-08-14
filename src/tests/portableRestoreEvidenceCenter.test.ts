import { createCharacterDataBackup } from '../backup/characterBackup';
import { preparePortableRestoreSession, type PortableRestoreDataCheckpoint } from '../backup/portableRestoreSession';
import {
  createPortableRestoreEvidenceBundle,
  createPortableRestoreIntegrityReceipt,
  verifyPortableRestoreIntegrity
} from '../backup/portableRestoreVerification';
import {
  comparePortableRestoreHistoricalEvidence,
  createPortableRestoreEvidenceArchive,
  createPortableRestoreHistoricalEvidenceRecord,
  parsePortableRestoreEvidenceImport,
  planPortableRestoreEvidenceCleanup,
  portableRestoreEvidenceArchiveToJson,
  validatePortableRestoreEvidenceArchive
} from '../backup/portableRestoreEvidenceCenter';
import { createEmptyCharacter } from '../data/mockData';
import { emptyProgressionRecoverySummary } from '../characters/progressionRecovery';
import { emptyCompatibilityRemediationRecoverySummary } from '../characters/compatibilityRemediationRecovery';
import type { CatalogSnapshot } from '../catalog/types';

const checkpoint = (): PortableRestoreDataCheckpoint => ({
  characterStore: {
    characters: [{ ...createEmptyCharacter('Evidence'), id: 'evidence-character' }],
    progressionDrafts: {}, progressionRecovery: emptyProgressionRecoverySummary(),
    compatibilityRemediationPlans: {}, compatibilityRemediationRecovery: emptyCompatibilityRemediationRecoverySummary(),
    compatibilityRemediationQuarantine: {}
  },
  scenarios: [], buildPresets: [], buildHistorySnapshots: [],
  catalog: { filterState: { bookStates: {}, categoryStates: {}, entityStates: {} }, revision: 1, history: [] }
});

const snapshot = (): CatalogSnapshot => ({
  snapshotId: 'catalog-app16-test', catalogVersion: 'test', loadedAt: '2026-08-04T00:00:00.000Z',
  manifest: {} as CatalogSnapshot['manifest'], entries: [], registry: new Map(), entryById: new Map(),
  categories: [], categoryById: new Map(), dependenciesFrom: new Map(), dependenciesTo: new Map(), aliases: new Map(),
  filterPolicy: {} as CatalogSnapshot['filterPolicy'], readinessProfile: {} as CatalogSnapshot['readinessProfile'],
  validation: {
    status: 'passed', checkedAt: '2026-08-04T00:00:00.000Z',
    checks: { bundleChecksum: 'notRequested', versionCoherence: true, counts: true, uniqueEntityIds: true, registryCoverage: true, categoryReferences: true, dependencyReferences: true, aliasReferences: true },
    counts: { runtimeEntries: 0, registryEntries: 0, dependencyEdges: 0, categories: 0, aliases: 0 },
    issues: []
  }
});

const verifiedSession = () => {
  const current = checkpoint();
  const backup = createCharacterDataBackup({ characters: [], scenarios: [], buildPresets: [], buildHistorySnapshots: [] });
  const prepared = preparePortableRestoreSession({ backup, options: { mode: 'merge' }, current }).session!;
  const committed = { ...prepared, status: 'committed' as const, applied: { data: true, catalog: true }, committedAt: '2026-08-04T12:00:00.000Z' };
  const verification = verifyPortableRestoreIntegrity({ session: committed, effective: committed.projected, snapshot: snapshot(), filterState: committed.projected.catalog.filterState, choices: [] });
  const receipt = createPortableRestoreIntegrityReceipt(committed, verification, () => new Date('2026-08-04T12:01:00.000Z'));
  return { ...committed, postRestoreVerification: verification, integrityReceipt: receipt, closedAt: '2026-08-04T12:02:00.000Z' };
};

describe('portable restore evidence center', () => {
  it('archives, exports and imports a verifiable evidence record', () => {
    const session = verifiedSession();
    const record = createPortableRestoreHistoricalEvidenceRecord(session, () => new Date('2026-08-04T12:03:00.000Z'))!;
    expect(record.source).toBe('local');
    expect(record.localCheckpointAvailable).toBe(true);
    const archive = createPortableRestoreEvidenceArchive([record], () => new Date('2026-08-04T12:04:00.000Z'));
    expect(validatePortableRestoreEvidenceArchive(archive)).toBe(true);
    const imported = parsePortableRestoreEvidenceImport(portableRestoreEvidenceArchiveToJson(archive), [], () => new Date('2026-08-04T12:05:00.000Z'));
    expect(imported.ok).toBe(true);
    expect(imported.records).toHaveLength(1);
    expect(imported.records[0].source).toBe('imported');
    expect(imported.records[0].localCheckpointAvailable).toBe(false);
  });

  it('detects later changes without mutating the receipt', () => {
    const session = verifiedSession();
    const record = createPortableRestoreHistoricalEvidenceRecord(session)!;
    const current = session.projected;
    const same = comparePortableRestoreHistoricalEvidence(record, current, []);
    expect(same.comparison?.status).toBe('current');
    const changed = JSON.parse(JSON.stringify(current)) as PortableRestoreDataCheckpoint;
    changed.characterStore.characters[0].name = 'Changed later';
    const comparison = comparePortableRestoreHistoricalEvidence(record, changed, []);
    expect(comparison.comparison?.status).toBe('changed');
    expect(comparison.receipt.checksum).toBe(record.receipt.checksum);
  });

  it('rejects tampered evidence and proposes controlled cleanup', () => {
    const session = verifiedSession();
    const evidence = createPortableRestoreEvidenceBundle(session)!;
    const rejected = parsePortableRestoreEvidenceImport(JSON.stringify({ ...evidence, sessionId: 'tampered' }));
    expect(rejected.ok).toBe(false);
    const record = createPortableRestoreHistoricalEvidenceRecord(session)!;
    const checkpoints = Array.from({ length: 7 }, (_, index) => ({ ...session, id: `session-${index}`, closedAt: `2026-08-0${index + 1}T12:00:00.000Z` }));
    const cleanup = planPortableRestoreEvidenceCleanup([record], checkpoints);
    expect(cleanup.recommendedCheckpointSessionIds).toHaveLength(2);
    expect(cleanup.evidenceRecordCount).toBe(1);
  });
});
