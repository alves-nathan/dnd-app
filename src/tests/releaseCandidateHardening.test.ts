import {
  migrateBuildPresetPersistenceState,
  migrateCatalogDistributionPersistenceState,
  migrateCatalogUpdateSessionPersistenceState
} from '../releaseCandidate/persistenceMigrations';
import { summarizeReleaseCandidateChecks } from '../releaseCandidate/releaseCandidateHardening';

describe('APP-29 release candidate hardening', () => {
  it('preserves presets and sanitizes empty installs', () => {
    expect(migrateBuildPresetPersistenceState(undefined)).toEqual({ presets: [] });
    expect(migrateBuildPresetPersistenceState({ presets: [{ id: 'p1' }] }).presets).toHaveLength(1);
  });

  it('does not resume unsafe v1 catalog update sessions', () => {
    const migrated = migrateCatalogUpdateSessionPersistenceState({ activeSession: { id: 'old' }, history: [{ id: 'receipt' }] }, 1);
    expect(migrated.activeSession).toBeUndefined();
    expect(migrated.history).toHaveLength(1);
  });

  it('preserves compatible distribution state', () => {
    const migrated = migrateCatalogDistributionPersistenceState({ manifests: { official: { sequence: 1 } }, sessions: {}, observations: {}, cachedBundles: {}, evidence: [], events: [], policy: {} });
    expect(migrated.manifests.official).toBeDefined();
  });

  it('keeps the release candidate blocked while APP-28 is blocked', () => {
    const summary = summarizeReleaseCandidateChecks({ 'app28-integral-gate': 'BLOCKED' });
    expect(summary.status).toBe('BLOCKED');
  });
});
