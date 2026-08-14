import {
  createCatalogRolloutHealthEvidence,
  resolveEffectiveCatalogRollout,
  validateCatalogRolloutHealthEvidence,
  type CatalogRolloutSignal,
  type SignedCatalogRolloutDirective,
  type SignedCatalogRolloutHealthPolicy
} from '../catalog/catalogRolloutHealth';
import type { SignedCatalogPublication } from '../catalog/catalogPublication';

const publication: SignedCatalogPublication = {
  schemaVersion: 'dnd-catalog-publication.v1', publicationId: 'preview-1', publisherId: 'test', keyId: 'root', issuedAt: '2026-08-04T12:00:00.000Z',
  channel: 'preview', sequence: 1, distributionManifestChecksum: 'a'.repeat(64), catalogChecksum: 'b'.repeat(64), bundleChecksum: 'c'.repeat(64), catalogVersion: '5.0.0', snapshotId: 'snapshot-5', minAppVersion: '0.1.0', rolloutPercent: 25, cohortSalt: 'test-rollout-salt',
  releaseNotes: { locale: 'pt-BR', title: 'Teste', summary: 'Resumo', items: ['Item'], checksum: 'd'.repeat(64) }, signature: 'signature'
};
const policy: SignedCatalogRolloutHealthPolicy = {
  schemaVersion: 'dnd-catalog-rollout-health-policy.v1', policyId: 'policy-1', publisherId: 'test', keyId: 'root', publicationId: publication.publicationId, channel: 'preview', issuedAt: '2026-08-04T12:05:00.000Z', revision: 1,
  thresholds: { minimumSampleSize: 2, minimumSuccessRate: 0.8, maximumFailureRate: 0.2, maximumRollbackRate: 0.1, maximumIntegrityFailureRate: 0, maximumP95DurationMs: 10000 }, signature: 'signature'
};
const signals: CatalogRolloutSignal[] = [
  { id: '1', publicationId: publication.publicationId, publisherId: 'test', channel: 'preview', type: 'downloadStarted', occurredAt: '2026-08-04T12:10:00.000Z', cohortScore: 1000 },
  { id: '2', publicationId: publication.publicationId, publisherId: 'test', channel: 'preview', type: 'downloadSucceeded', occurredAt: '2026-08-04T12:10:01.000Z', durationMs: 1000, cohortScore: 1000 },
  { id: '3', publicationId: publication.publicationId, publisherId: 'test', channel: 'preview', type: 'commitSucceeded', occurredAt: '2026-08-04T12:10:02.000Z', durationMs: 2000, cohortScore: 1000 }
];

describe('catalog rollout health', () => {
  it('creates opt-in tamper-evident health evidence', () => {
    const evidence = createCatalogRolloutHealthEvidence({ publication, policy, signals, optInConfirmed: true, now: () => new Date('2026-08-04T13:00:00.000Z') });
    expect(evidence.status).toBe('healthy');
    expect(evidence.recommendation).toBe('expand');
    expect(validateCatalogRolloutHealthEvidence(evidence)).toBe(true);
    expect(validateCatalogRolloutHealthEvidence({ ...evidence, effectiveRolloutPercent: 90 })).toBe(false);
  });

  it('never creates exportable evidence without opt-in', () => {
    expect(() => createCatalogRolloutHealthEvidence({ publication, policy, signals, optInConfirmed: false })).toThrow();
  });

  it('resolves the latest signed rollout directive', () => {
    const directive: SignedCatalogRolloutDirective = {
      schemaVersion: 'dnd-catalog-rollout-directive.v1', directiveId: 'expand-1', publisherId: 'test', keyId: 'root', publicationId: publication.publicationId, issuedAt: '2026-08-04T13:01:00.000Z', revision: 1, action: 'expand', fromRolloutPercent: 25, toRolloutPercent: 50, sourceChannel: 'preview', policyId: policy.policyId, healthEvidenceChecksum: 'e'.repeat(64), reason: 'Saúde aprovada', signature: 'signature'
    };
    expect(resolveEffectiveCatalogRollout(publication, [directive])).toMatchObject({ rolloutPercent: 50, directiveId: 'expand-1' });
  });
});
