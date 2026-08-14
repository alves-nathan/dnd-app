import {
  assessCatalogChannelMigration,
  calculateCatalogCohortScore,
  compareAppVersions,
  evaluateCatalogPublicationEligibility,
  validateCatalogPublicationEligibilityEvidence,
  type SignedCatalogPublication
} from '../catalog/catalogPublication';

const publication: SignedCatalogPublication = {
  schemaVersion: 'dnd-catalog-publication.v1',
  publicationId: 'test-stable-1',
  publisherId: 'test',
  keyId: 'root',
  issuedAt: '2026-08-04T12:00:00.000Z',
  channel: 'stable',
  sequence: 1,
  distributionManifestChecksum: 'a'.repeat(64),
  catalogChecksum: 'b'.repeat(64),
  bundleChecksum: 'c'.repeat(64),
  catalogVersion: '4.9.0',
  snapshotId: 'snapshot-1',
  minAppVersion: '0.1.0',
  maxAppVersion: '0.2.0',
  rolloutPercent: 100,
  cohortSalt: 'test-salt-value',
  releaseNotes: { locale: 'pt-BR', title: 'Teste', summary: 'Resumo', items: ['Item'], checksum: 'd'.repeat(64) },
  signature: 'signature'
};

describe('catalog publication eligibility', () => {
  it('compares app versions and preserves explicit channel migrations', () => {
    expect(compareAppVersions('0.1.1', '0.1.0')).toBeGreaterThan(0);
    expect(assessCatalogChannelMigration('stable', 'preview')).toMatchObject({ direction: 'riskier', requiresConfirmation: true });
  });

  it('assigns deterministic cohorts', () => {
    const params = { cohortId: 'device-a', publisherId: 'test', publicationId: 'test-stable-1', channel: 'stable' as const, cohortSalt: 'test-salt-value' };
    expect(calculateCatalogCohortScore(params)).toBe(calculateCatalogCohortScore(params));
  });

  it('produces tamper-evident eligibility evidence', () => {
    const evidence = evaluateCatalogPublicationEligibility({ publication, selectedChannel: 'stable', appVersion: '0.1.0', cohortId: 'device-a', now: () => new Date('2026-08-04T13:00:00.000Z') });
    expect(evidence.eligible).toBe(true);
    expect(validateCatalogPublicationEligibilityEvidence(evidence)).toBe(true);
    expect(validateCatalogPublicationEligibilityEvidence({ ...evidence, rolloutPercent: 0 })).toBe(false);
  });
});
