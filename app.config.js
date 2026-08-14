const asBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const optionalString = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
};

module.exports = ({ config }) => {
  const releaseStage = process.env.EXPO_PUBLIC_RELEASE_STAGE || 'local';
  const buildProfile = process.env.EAS_BUILD_PROFILE || releaseStage;
  const e2eSeedEnabled = asBoolean(
    process.env.EXPO_PUBLIC_E2E_SEED_ENABLED,
    releaseStage === 'beta-candidate'
  );
  const buildId = optionalString(process.env.EAS_BUILD_ID || process.env.EXPO_PUBLIC_BUILD_ID);
  const gitSha = optionalString(process.env.EAS_BUILD_GIT_COMMIT_HASH || process.env.EXPO_PUBLIC_GIT_SHA);
  const testRunId = optionalString(process.env.EXPO_PUBLIC_TEST_RUN_ID);

  return {
    ...config,
    extra: {
      ...(config.extra || {}),
      release: {
        stage: releaseStage,
        buildProfile,
        ...(buildId ? { buildId } : {}),
        ...(gitSha ? { gitSha } : {}),
        ...(testRunId ? { testRunId } : {}),
        e2eSeedEnabled
      }
    }
  };
};
