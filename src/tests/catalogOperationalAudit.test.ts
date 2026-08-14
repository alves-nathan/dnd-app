import {
  compareCatalogOperationalAuditPackages,
  createCatalogOperationalAuditPackage,
  createDefaultCatalogOperationalAuditRetentionPolicy,
  evaluateCatalogOperationalAuditRetention,
  verifyCatalogOperationalAuditPackage
} from '../catalog/catalogOperationalAudit';
import { appendCatalogOperationalJournalEntry, createCatalogOperationalJournalArchive } from '../catalog/catalogOperationalJournal';

const first = appendCatalogOperationalJournalEntry({ entries: [], at: '2026-08-04T12:00:00.000Z', type: 'authorizationAccepted', authorizationId: 'auth' });
const second = appendCatalogOperationalJournalEntry({ entries: [first], at: '2026-08-04T12:01:00.000Z', type: 'executionStarted', authorizationId: 'auth' });
const archive = createCatalogOperationalJournalArchive([first], () => new Date('2026-08-04T12:02:00.000Z'));
const base = {
  source: { deviceIdHash: 'a'.repeat(64), appVersion: '0.1.0' },
  archives: [archive], activeJournal: [second], receipts: [], evidence: [], authorizations: [], executorConfirmations: [], aggregationPolicies: [], aggregateReports: [], releaseApprovals: [], quorumDecisions: [], publications: []
};

describe('catalog operational audit', () => {
  it('detects complete, missing and forked journal segments without mutating application state', () => {
    const local = createCatalogOperationalAuditPackage({ ...base, now: () => new Date('2026-08-04T12:03:00.000Z') });
    expect(verifyCatalogOperationalAuditPackage(local).status).toBe('approved');

    const missing = createCatalogOperationalAuditPackage({ ...base, archives: [], activeJournal: [second], now: () => new Date('2026-08-04T12:04:00.000Z') });
    expect(verifyCatalogOperationalAuditPackage(missing).findings.some((entry) => entry.code === 'AUDIT_ACTIVE_SEGMENT_MISSING')).toBe(true);

    const forkedEntry = appendCatalogOperationalJournalEntry({ entries: [first], at: '2026-08-04T12:01:30.000Z', type: 'executionFailed', authorizationId: 'auth' });
    const forked = createCatalogOperationalAuditPackage({ ...base, activeJournal: [forkedEntry], now: () => new Date('2026-08-04T12:05:00.000Z') });
    expect(compareCatalogOperationalAuditPackages(local, forked).status).toBe('forked');

    const retention = evaluateCatalogOperationalAuditRetention({ auditPackage: local, policy: createDefaultCatalogOperationalAuditRetentionPolicy() });
    expect(retention.evidenceEligibleForDeletion).toBe(0);
  });
});
