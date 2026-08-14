const {
  BUILD_ARTIFACT_SCHEMA,
  createBuildArtifactManifest,
  normalizeEasBuild,
  parseJsonOutput,
  redactUrl,
  validateBuildArtifactManifest,
  validateCandidateBuild
} = require('../../scripts/lib/eas-beta-build');

const build = {
  id: 'build-1',
  status: 'FINISHED',
  platform: 'ANDROID',
  buildProfile: 'beta-candidate',
  appVersion: '0.1.0',
  appBuildVersion: '12',
  gitCommitHash: 'abcdef1234567890',
  completedAt: '2026-07-14T20:00:00.000Z',
  project: { id: '11111111-1111-4111-8111-111111111111' },
  artifacts: {
    buildUrl: 'https://example.invalid/artifacts/app.apk?token=private'
  }
};

describe('EAS Android beta candidate tooling', () => {
  it('parses JSON output even when a non-JSON prefix is present', () => {
    expect(parseJsonOutput(`warning from cli\n${JSON.stringify([build])}`)).toEqual([build]);
  });

  it('normalizes and validates a finished Android candidate build', () => {
    const normalized = normalizeEasBuild([build]);
    expect(normalized).toMatchObject({
      id: 'build-1',
      status: 'finished',
      platform: 'android',
      buildProfile: 'beta-candidate',
      appBuildVersion: '12'
    });
    expect(validateCandidateBuild(normalized)).toEqual({ valid: true, issues: [] });
  });

  it('blocks builds from the wrong profile or without an HTTPS artifact', () => {
    const normalized = normalizeEasBuild([{ ...build, buildProfile: 'production', artifacts: { buildUrl: 'http://example.invalid/app.apk' } }]);
    const result = validateCandidateBuild(normalized);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'Perfil deve ser beta-candidate; recebido: production.',
      'URL do artefato deve usar HTTPS.'
    ]));
  });

  it('creates a secret-safe artifact manifest and validates it', () => {
    const normalized = normalizeEasBuild([build]);
    const manifest = createBuildArtifactManifest({
      build: normalized,
      binaryPath: '/tmp/app.apk',
      binarySha256: 'a'.repeat(64),
      root: '/tmp'
    });
    expect(manifest.schemaVersion).toBe(BUILD_ARTIFACT_SCHEMA);
    expect(manifest.artifactSource).toBe('https://example.invalid/artifacts/app.apk');
    expect(JSON.stringify(manifest)).not.toContain('token=private');
    expect(validateBuildArtifactManifest(manifest)).toEqual({ valid: true, issues: [] });
  });

  it('redacts query strings from signed artifact URLs', () => {
    expect(redactUrl('https://example.invalid/app.apk?signature=secret')).toBe('https://example.invalid/app.apk');
  });
});
