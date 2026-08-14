import {
  isStableReleaseVersion,
  summarizeProductionRelease
} from '../releaseDelivery/productionReleaseDelivery';

describe('APP-30 production release delivery', () => {
  it('keeps production blocked without approved gates and store receipt', () => {
    const summary = summarizeProductionRelease({
      'production-identity': 'PASS',
      'operations-handbook': 'PASS',
      'privacy-data-handling': 'PASS',
      'support-readiness': 'PASS'
    });
    expect(summary.status).toBe('BLOCKED');
  });

  it('requires stable semantic versions', () => {
    expect(isStableReleaseVersion('1.0.0')).toBe(true);
    expect(isStableReleaseVersion('1.0.0-beta.1')).toBe(false);
    expect(isStableReleaseVersion('01.0.0')).toBe(false);
  });

  it('passes only when every blocking control passes', () => {
    const ids = [
      'app28-integral-gate',
      'app29-release-candidate',
      'production-identity',
      'operations-handbook',
      'privacy-data-handling',
      'support-readiness',
      'production-build-artifact',
      'store-publication-receipt',
      'release-closure'
    ];
    const summary = summarizeProductionRelease(Object.fromEntries(ids.map((id) => [id, 'PASS'])));
    expect(summary.status).toBe('PASS');
  });
});
