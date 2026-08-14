import {
  buildCatalogRolloutAggregateReport,
  createCatalogReleaseQuorumDecision,
  createCatalogRolloutHealthSubmission,
  validateCatalogReleaseQuorumDecision,
  validateCatalogRolloutHealthSubmission,
  type SignedCatalogRolloutAggregationPolicy
} from '../catalog/catalogRolloutAggregation';
import { createCatalogRolloutHealthEvidence, type CatalogRolloutSignal, type SignedCatalogRolloutHealthPolicy } from '../catalog/catalogRolloutHealth';
import type { SignedCatalogPublication } from '../catalog/catalogPublication';

const publication: SignedCatalogPublication = {
  schemaVersion: 'dnd-catalog-publication.v1', publicationId: 'app23-preview', publisherId: 'test', keyId: 'root', issuedAt: '2026-08-04T12:00:00.000Z', channel: 'preview', sequence: 1,
  distributionManifestChecksum: 'a'.repeat(64), catalogChecksum: 'b'.repeat(64), bundleChecksum: 'c'.repeat(64), catalogVersion: '5.0.0', snapshotId: 'snapshot-5', minAppVersion: '0.1.0', rolloutPercent: 25, cohortSalt: 'app23-rollout-salt',
  releaseNotes: { locale: 'pt-BR', title: 'Teste', summary: 'Resumo', items: ['Item'], checksum: 'd'.repeat(64) }, signature: 'signature'
};
const healthPolicy: SignedCatalogRolloutHealthPolicy = {
  schemaVersion: 'dnd-catalog-rollout-health-policy.v1', policyId: 'health-1', publisherId: 'test', keyId: 'root', publicationId: publication.publicationId, channel: 'preview', issuedAt: '2026-08-04T12:01:00.000Z', revision: 1,
  thresholds: { minimumSampleSize: 2, minimumSuccessRate: 0.8, maximumFailureRate: 0.2, maximumRollbackRate: 0.1, maximumIntegrityFailureRate: 0, maximumP95DurationMs: 10000 }, signature: 'signature'
};
const aggregationPolicy: SignedCatalogRolloutAggregationPolicy = {
  schemaVersion: 'dnd-catalog-rollout-aggregation-policy.v1', aggregationPolicyId: 'aggregation-1', publisherId: 'test', keyId: 'root', publicationId: publication.publicationId, channel: 'preview', issuedAt: '2026-08-04T12:02:00.000Z', revision: 1,
  minimumUniqueContributors: 3, minimumCohortContributors: 3, maximumEvidenceAgeHours: 24, healthPolicyId: healthPolicy.policyId, healthPolicyRevision: 1, healthThresholds: healthPolicy.thresholds,
  quorum: { minimumApprovals: 2, approvers: [{ approverId: 'a', publisherId: 'test', keyId: 'a' }, { approverId: 'b', publisherId: 'test', keyId: 'b' }] }, signature: 'signature'
};
const evidenceFor = (index: number) => {
  const signals: CatalogRolloutSignal[] = [
    { id: `start-${index}`, publicationId: publication.publicationId, publisherId: 'test', channel: 'preview', type: 'downloadStarted', occurredAt: '2026-08-04T12:10:00.000Z', cohortScore: index * 3000 },
    { id: `download-${index}`, publicationId: publication.publicationId, publisherId: 'test', channel: 'preview', type: 'downloadSucceeded', occurredAt: '2026-08-04T12:10:01.000Z', durationMs: 1000, cohortScore: index * 3000 },
    { id: `commit-${index}`, publicationId: publication.publicationId, publisherId: 'test', channel: 'preview', type: 'commitSucceeded', occurredAt: '2026-08-04T12:10:02.000Z', durationMs: 1500, cohortScore: index * 3000 }
  ];
  return createCatalogRolloutHealthEvidence({ publication, policy: healthPolicy, signals, optInConfirmed: true, now: () => new Date(`2026-08-04T12:${20 + index}:00.000Z`) });
};

describe('catalog rollout aggregation', () => {
  it('creates opaque deduplicated submissions', () => {
    const evidence = evidenceFor(1);
    const first = createCatalogRolloutHealthSubmission({ evidence, contributorSecret: 'a'.repeat(32), now: () => new Date('2026-08-04T13:00:00.000Z') });
    const second = createCatalogRolloutHealthSubmission({ evidence, contributorSecret: 'a'.repeat(32), now: () => new Date('2026-08-04T13:01:00.000Z') });
    expect(first.contributorToken).toBe(second.contributorToken);
    expect(first.contributorToken).not.toContain('a'.repeat(32));
    expect(validateCatalogRolloutHealthSubmission(first)).toBe(true);
    expect(validateCatalogRolloutHealthSubmission({ ...first, contributorToken: 'f'.repeat(64) })).toBe(false);
  });

  it('suppresses cohorts below the anonymity threshold', () => {
    const submissions = [0, 1, 2].map((index) => createCatalogRolloutHealthSubmission({ evidence: evidenceFor(index), contributorSecret: String(index).repeat(32), now: () => new Date('2026-08-04T13:00:00.000Z') }));
    const report = buildCatalogRolloutAggregateReport({ submissions, policy: aggregationPolicy, publication, reportPublisherId: 'test', reportKeyId: 'root', now: () => new Date('2026-08-04T14:00:00.000Z') });
    expect(report.uniqueContributors).toBe(3);
    expect(report.status).toBe('healthy');
    expect(report.cohorts.every((entry) => entry.suppressed)).toBe(true);
    expect(report.cohorts.every((entry) => entry.successRate === undefined)).toBe(true);
  });

  it('refuses aggregation below k anonymity', () => {
    const submissions = [0, 1].map((index) => createCatalogRolloutHealthSubmission({ evidence: evidenceFor(index), contributorSecret: String(index).repeat(32) }));
    expect(() => buildCatalogRolloutAggregateReport({ submissions, policy: aggregationPolicy, publication, reportPublisherId: 'test', reportKeyId: 'root', now: () => new Date('2026-08-04T14:00:00.000Z') })).toThrow('Anonimato insuficiente: 2/3 contribuidores únicos.');
  });

  it('keeps quorum decisions non-executing', () => {
    const report = buildCatalogRolloutAggregateReport({ submissions: [0, 1, 2].map((index) => createCatalogRolloutHealthSubmission({ evidence: evidenceFor(index), contributorSecret: String(index).repeat(32) })), policy: aggregationPolicy, publication, reportPublisherId: 'test', reportKeyId: 'root', now: () => new Date('2026-08-04T14:00:00.000Z') });
    const decision = createCatalogReleaseQuorumDecision({ action: 'expand', targetRolloutPercent: 50, report, policy: aggregationPolicy, registry: { schemaVersion: 'dnd-catalog-trust-registry.v1', revision: 1, publishers: [], events: [], updatedAt: '2026-08-04T00:00:00.000Z' }, approvals: [] });
    expect(decision.status).toBe('pending');
    expect(decision.automaticExecution).toBe(false);
    expect(validateCatalogReleaseQuorumDecision(decision)).toBe(true);
  });
});
