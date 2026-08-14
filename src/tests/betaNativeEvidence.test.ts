import {
  type BetaNativeEvidenceV3,
  validateBetaNativeEvidence
} from '../release/betaNativeEvidence';

const sha = 'a'.repeat(64);
const capturedAt = '2026-07-14T12:00:00.000Z';
const artifact = {
  location: 'artifacts/example.txt',
  sha256: sha,
  capturedAt
};

const buildEvidence = (): BetaNativeEvidenceV3 => ({
  schemaVersion: 'dnd-combat-beta-native-evidence.v3',
  platform: 'android',
  generatedAt: capturedAt,
  device: 'Pixel 7 · Android 16',
  appVersion: '0.1.0',
  buildProfile: 'beta-candidate',
  buildId: 'build-android-1',
  gitSha: 'abcdef1234567890',
  binarySha256: sha,
  platformBuildNumber: '10',
  testRunId: 'android-run-1',
  e2ePassed: true,
  nativeBenchmarkPassed: true,
  accessibilityAuditPassed: true,
  backupRestorePassed: true,
  dataSafetyRehearsalPassed: true,
  artifacts: {
    maestro: artifact,
    performance: artifact,
    accessibility: artifact,
    backupRestore: artifact,
    dataSafety: artifact
  },
  metrics: {
    coldStartMs: 900,
    phbImportMs: 400,
    sqliteHydrationMs: 40,
    peakMemoryMb: 220,
    droppedFramesPercent: 1.5
  }
});

describe('beta native evidence', () => {
  it('accepts fresh v3 evidence tied to the expected version and commit', () => {
    const result = validateBetaNativeEvidence(buildEvidence(), {
      expectedPlatform: 'android',
      expectedAppVersion: '0.1.0',
      expectedGitSha: 'abcdef1',
      now: '2026-07-15T12:00:00.000Z'
    });

    expect(result.status).toBe('ready');
    expect(result.promotionReady).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('blocks stale evidence and evidence from another commit', () => {
    const evidence = buildEvidence();
    const result = validateBetaNativeEvidence(evidence, {
      expectedGitSha: '9999999',
      now: '2026-08-10T12:00:00.000Z',
      maxAgeDays: 14
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['EVIDENCE_GIT_SHA_MISMATCH', 'EVIDENCE_STALE'])
    );
  });

  it('does not accept the legacy v2 contract for promotion', () => {
    const result = validateBetaNativeEvidence({
      schemaVersion: 'dnd-combat-beta-native-evidence.v2',
      platform: 'android'
    });

    expect(result.promotionReady).toBe(false);
    expect(result.issues[0]?.code).toBe('EVIDENCE_SCHEMA_NOT_V3');
  });
});
