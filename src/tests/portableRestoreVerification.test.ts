import { createCharacterDataBackup } from '../backup/characterBackup';
import { preparePortableRestoreSession, type PortableRestoreDataCheckpoint } from '../backup/portableRestoreSession';
import {
  createPortableRestoreIntegrityReceipt,
  validatePortableRestoreIntegrityReceipt,
  verifyPortableRestoreIntegrity
} from '../backup/portableRestoreVerification';
import { createEmptyCharacter } from '../data/mockData';
import { emptyProgressionRecoverySummary } from '../characters/progressionRecovery';
import { emptyCompatibilityRemediationRecoverySummary } from '../characters/compatibilityRemediationRecovery';
import type { CatalogSnapshot } from '../catalog/types';

const checkpoint = (): PortableRestoreDataCheckpoint => ({
  characterStore: {
    characters: [{ ...createEmptyCharacter('Verified'), id: 'verified-character' }],
    progressionDrafts: {}, progressionRecovery: emptyProgressionRecoverySummary(),
    compatibilityRemediationPlans: {}, compatibilityRemediationRecovery: emptyCompatibilityRemediationRecoverySummary(),
    compatibilityRemediationQuarantine: {}
  },
  scenarios: [], buildPresets: [], buildHistorySnapshots: [],
  catalog: { filterState: { bookStates: {}, categoryStates: {}, entityStates: {} }, revision: 1, history: [] }
});

const snapshot = (): CatalogSnapshot => ({
  snapshotId: 'catalog-test', catalogVersion: 'test', loadedAt: '2026-08-04T00:00:00.000Z',
  manifest: {} as CatalogSnapshot['manifest'], entries: [], registry: new Map(), entryById: new Map(),
  categories: [], categoryById: new Map(), dependenciesFrom: new Map(), dependenciesTo: new Map(), aliases: new Map(),
  filterPolicy: {} as CatalogSnapshot['filterPolicy'], readinessProfile: {} as CatalogSnapshot['readinessProfile'],
  validation: { status: 'passed', checkedAt: '2026-08-04T00:00:00.000Z', checks: {}, counts: {}, issues: [] } as unknown as CatalogSnapshot['validation']
});

const committedSession = () => {
  const current = checkpoint();
  const backup = createCharacterDataBackup({ characters: [], scenarios: [], buildPresets: [], buildHistorySnapshots: [] });
  return { ...preparePortableRestoreSession({ backup, options: { mode: 'merge' }, current }).session!, status: 'committed' as const, applied: { data: true, catalog: true } };
};

describe('portable restore post verification', () => {
  it('approves an effective state equal to the projected checkpoint', () => {
    const session = committedSession();
    const result = verifyPortableRestoreIntegrity({ session, effective: session.projected, snapshot: snapshot(), filterState: session.projected.catalog.filterState, choices: [] });
    expect(result.status).toBe('passed');
    expect(result.canClose).toBe(true);
  });

  it('blocks closure when the effective state diverges', () => {
    const session = committedSession();
    const effective = checkpoint();
    effective.characterStore.characters[0].name = 'Changed after commit';
    const result = verifyPortableRestoreIntegrity({ session, effective, snapshot: snapshot(), filterState: effective.catalog.filterState, choices: [] });
    expect(result.status).toBe('failed');
    expect(result.issues.some((entry) => entry.code === 'RESTORE_EFFECTIVE_FINGERPRINT_MISMATCH')).toBe(true);
  });

  it('requires acknowledgement for quarantine warnings and creates a verifiable receipt', () => {
    const session = committedSession();
    session.projected.characterStore.compatibilityRemediationQuarantine['q1'] = { id: 'q1', quarantinedAt: '2026-08-04T00:00:00.000Z', reason: 'invalid', rawPlan: {} };
    const result = verifyPortableRestoreIntegrity({ session, effective: session.projected, snapshot: snapshot(), filterState: session.projected.catalog.filterState, choices: [] });
    expect(result.status).toBe('warning');
    const acknowledged = { ...result, acknowledgedAt: '2026-08-04T01:00:00.000Z', canClose: true };
    const receipt = createPortableRestoreIntegrityReceipt(session, acknowledged, () => new Date('2026-08-04T01:01:00.000Z'));
    expect(validatePortableRestoreIntegrityReceipt(receipt)).toBe(true);
    expect(validatePortableRestoreIntegrityReceipt({ ...receipt, sessionId: 'tampered' })).toBe(false);
  });
});
