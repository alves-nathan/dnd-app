export type BetaNativePlatform = 'android' | 'ios';
export type BetaNativeEvidenceStatus = 'blocked' | 'needsReview' | 'ready';
export type BetaNativeEvidenceIssueSeverity = 'error' | 'warning';

export interface BetaNativeArtifactReference {
  location: string;
  sha256: string;
  capturedAt: string;
}

export interface BetaNativeEvidenceV3 {
  schemaVersion: 'dnd-combat-beta-native-evidence.v3';
  platform: BetaNativePlatform;
  generatedAt: string;
  device: string;
  appVersion: string;
  buildProfile: 'beta-candidate';
  buildId: string;
  gitSha: string;
  binarySha256: string;
  platformBuildNumber: string;
  testRunId: string;
  e2ePassed: boolean;
  nativeBenchmarkPassed: boolean;
  accessibilityAuditPassed: boolean;
  backupRestorePassed: boolean;
  dataSafetyRehearsalPassed: boolean;
  artifacts: {
    maestro: BetaNativeArtifactReference;
    performance: BetaNativeArtifactReference;
    accessibility: BetaNativeArtifactReference;
    backupRestore: BetaNativeArtifactReference;
    dataSafety: BetaNativeArtifactReference;
  };
  metrics?: {
    coldStartMs?: number;
    phbImportMs?: number;
    sqliteHydrationMs?: number;
    peakMemoryMb?: number;
    droppedFramesPercent?: number;
  };
  notes?: string;
}

export interface BetaNativeEvidenceValidationIssue {
  severity: BetaNativeEvidenceIssueSeverity;
  code: string;
  message: string;
}

export interface BetaNativeEvidenceValidationOptions {
  expectedPlatform?: BetaNativePlatform;
  expectedAppVersion?: string;
  expectedBuildProfile?: 'beta-candidate';
  expectedGitSha?: string;
  now?: string;
  maxAgeDays?: number;
}

export interface BetaNativeEvidenceValidationResult {
  status: BetaNativeEvidenceStatus;
  promotionReady: boolean;
  evidence?: BetaNativeEvidenceV3;
  issues: BetaNativeEvidenceValidationIssue[];
}

const requiredChecks: Array<keyof Pick<
  BetaNativeEvidenceV3,
  | 'e2ePassed'
  | 'nativeBenchmarkPassed'
  | 'accessibilityAuditPassed'
  | 'backupRestorePassed'
  | 'dataSafetyRehearsalPassed'
>> = [
  'e2ePassed',
  'nativeBenchmarkPassed',
  'accessibilityAuditPassed',
  'backupRestorePassed',
  'dataSafetyRehearsalPassed'
];

const requiredArtifactKeys: Array<keyof BetaNativeEvidenceV3['artifacts']> = [
  'maestro',
  'performance',
  'accessibility',
  'backupRestore',
  'dataSafety'
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value.trim());

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

const parseDate = (value: unknown): number | undefined => {
  if (!isNonEmptyString(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const addIssue = (
  issues: BetaNativeEvidenceValidationIssue[],
  severity: BetaNativeEvidenceIssueSeverity,
  code: string,
  message: string
): void => {
  issues.push({ severity, code, message });
};

const gitShaMatches = (actual: string, expected: string): boolean => {
  const normalizedActual = actual.trim().toLowerCase();
  const normalizedExpected = expected.trim().toLowerCase();
  return normalizedActual.startsWith(normalizedExpected) || normalizedExpected.startsWith(normalizedActual);
};

export const validateBetaNativeEvidence = (
  input: unknown,
  options: BetaNativeEvidenceValidationOptions = {}
): BetaNativeEvidenceValidationResult => {
  const issues: BetaNativeEvidenceValidationIssue[] = [];

  if (!isRecord(input)) {
    addIssue(issues, 'error', 'EVIDENCE_NOT_OBJECT', 'A evidência deve ser um objeto JSON.');
    return { status: 'blocked', promotionReady: false, issues };
  }

  if (input.schemaVersion !== 'dnd-combat-beta-native-evidence.v3') {
    addIssue(
      issues,
      'error',
      'EVIDENCE_SCHEMA_NOT_V3',
      input.schemaVersion === 'dnd-combat-beta-native-evidence.v2'
        ? 'A evidência v2 é legível como histórico, mas precisa ser recapturada no contrato v3 para promoção.'
        : 'schemaVersion deve ser dnd-combat-beta-native-evidence.v3.'
    );
    return { status: 'blocked', promotionReady: false, issues };
  }

  const evidence = input as unknown as BetaNativeEvidenceV3;

  if (evidence.platform !== 'android' && evidence.platform !== 'ios') {
    addIssue(issues, 'error', 'EVIDENCE_PLATFORM_INVALID', 'platform deve ser android ou ios.');
  }
  if (options.expectedPlatform && evidence.platform !== options.expectedPlatform) {
    addIssue(issues, 'error', 'EVIDENCE_PLATFORM_MISMATCH', `A evidência deveria ser ${options.expectedPlatform}.`);
  }

  for (const [field, value] of [
    ['device', evidence.device],
    ['appVersion', evidence.appVersion],
    ['buildId', evidence.buildId],
    ['gitSha', evidence.gitSha],
    ['platformBuildNumber', evidence.platformBuildNumber],
    ['testRunId', evidence.testRunId]
  ] as const) {
    if (!isNonEmptyString(value)) {
      addIssue(issues, 'error', `EVIDENCE_${field.toUpperCase()}_MISSING`, `${field} é obrigatório.`);
    }
  }

  if (evidence.buildProfile !== 'beta-candidate') {
    addIssue(issues, 'error', 'EVIDENCE_BUILD_PROFILE_INVALID', 'buildProfile deve ser beta-candidate.');
  }
  if (options.expectedBuildProfile && evidence.buildProfile !== options.expectedBuildProfile) {
    addIssue(issues, 'error', 'EVIDENCE_BUILD_PROFILE_MISMATCH', `buildProfile deve ser ${options.expectedBuildProfile}.`);
  }
  if (options.expectedAppVersion && evidence.appVersion !== options.expectedAppVersion) {
    addIssue(issues, 'error', 'EVIDENCE_APP_VERSION_MISMATCH', `appVersion deve ser ${options.expectedAppVersion}.`);
  }
  if (options.expectedGitSha && isNonEmptyString(evidence.gitSha) && !gitShaMatches(evidence.gitSha, options.expectedGitSha)) {
    addIssue(issues, 'error', 'EVIDENCE_GIT_SHA_MISMATCH', 'A evidência foi gerada para outro commit.');
  }
  if (!isSha256(evidence.binarySha256)) {
    addIssue(issues, 'error', 'EVIDENCE_BINARY_SHA256_INVALID', 'binarySha256 deve conter 64 caracteres hexadecimais.');
  }

  const generatedAt = parseDate(evidence.generatedAt);
  const now = parseDate(options.now ?? new Date().toISOString()) ?? Date.now();
  const maxAgeDays = options.maxAgeDays ?? 14;
  if (generatedAt === undefined) {
    addIssue(issues, 'error', 'EVIDENCE_GENERATED_AT_INVALID', 'generatedAt deve ser uma data ISO válida.');
  } else {
    if (generatedAt > now + 5 * 60 * 1000) {
      addIssue(issues, 'error', 'EVIDENCE_GENERATED_AT_FUTURE', 'generatedAt não pode estar no futuro.');
    }
    if (now - generatedAt > maxAgeDays * 24 * 60 * 60 * 1000) {
      addIssue(issues, 'error', 'EVIDENCE_STALE', `A evidência tem mais de ${maxAgeDays} dias.`);
    }
  }

  for (const check of requiredChecks) {
    if (evidence[check] !== true) {
      addIssue(issues, 'error', `EVIDENCE_${check.toUpperCase()}_NOT_PASSED`, `${check} precisa estar aprovado.`);
    }
  }

  if (!isRecord(evidence.artifacts)) {
    addIssue(issues, 'error', 'EVIDENCE_ARTIFACTS_MISSING', 'artifacts é obrigatório.');
  } else {
    for (const key of requiredArtifactKeys) {
      const artifact = evidence.artifacts[key];
      if (!isRecord(artifact)) {
        addIssue(issues, 'error', `EVIDENCE_ARTIFACT_${key.toUpperCase()}_MISSING`, `Artefato ${key} é obrigatório.`);
        continue;
      }
      if (!isNonEmptyString(artifact.location)) {
        addIssue(issues, 'error', `EVIDENCE_ARTIFACT_${key.toUpperCase()}_LOCATION_MISSING`, `${key}.location é obrigatório.`);
      }
      if (!isSha256(artifact.sha256)) {
        addIssue(issues, 'error', `EVIDENCE_ARTIFACT_${key.toUpperCase()}_SHA256_INVALID`, `${key}.sha256 deve ser SHA-256.`);
      }
      if (parseDate(artifact.capturedAt) === undefined) {
        addIssue(issues, 'error', `EVIDENCE_ARTIFACT_${key.toUpperCase()}_DATE_INVALID`, `${key}.capturedAt deve ser uma data ISO válida.`);
      }
    }
  }

  const numericMetrics = evidence.metrics ? Object.entries(evidence.metrics) : [];
  for (const [key, value] of numericMetrics) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      addIssue(issues, 'warning', `EVIDENCE_METRIC_${key.toUpperCase()}_INVALID`, `${key} deve ser um número não negativo.`);
    }
  }

  const hasErrors = issues.some((issue) => issue.severity === 'error');
  const hasWarnings = issues.some((issue) => issue.severity === 'warning');
  return {
    status: hasErrors ? 'blocked' : hasWarnings ? 'needsReview' : 'ready',
    promotionReady: !hasErrors && !hasWarnings,
    evidence,
    issues
  };
};
