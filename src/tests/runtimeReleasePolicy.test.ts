import { isE2ESeedAllowed, isInternalCandidateStage } from '../release/runtimeReleasePolicy';

describe('runtime release policy', () => {
  it('allows the destructive fixture in development', () => {
    expect(isE2ESeedAllowed({ isDevelopment: true, releaseStage: 'local', e2eSeedEnabled: false })).toBe(true);
  });

  it('allows the fixture only in an explicitly enabled beta candidate', () => {
    expect(isInternalCandidateStage('beta-candidate')).toBe(true);
    expect(isE2ESeedAllowed({ isDevelopment: false, releaseStage: 'beta-candidate', e2eSeedEnabled: true })).toBe(true);
    expect(isE2ESeedAllowed({ isDevelopment: false, releaseStage: 'beta-candidate', e2eSeedEnabled: false })).toBe(false);
  });

  it('keeps the fixture blocked in beta and production', () => {
    expect(isE2ESeedAllowed({ isDevelopment: false, releaseStage: 'beta', e2eSeedEnabled: true })).toBe(false);
    expect(isE2ESeedAllowed({ isDevelopment: false, releaseStage: 'production', e2eSeedEnabled: true })).toBe(false);
  });
});
