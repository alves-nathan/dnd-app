const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_CHECKS = [
  'e2ePassed',
  'nativeBenchmarkPassed',
  'accessibilityAuditPassed',
  'backupRestorePassed',
  'dataSafetyRehearsalPassed'
];

const REQUIRED_ARTIFACTS = [
  'maestro',
  'performance',
  'accessibility',
  'backupRestore',
  'dataSafety'
];

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && Boolean(value.trim());
const isSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const parseDate = (value) => {
  if (!isNonEmptyString(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const sha256File = (file) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
};

const listFiles = (directory) => {
  const result = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const entry = path.join(directory, name);
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) result.push(...listFiles(entry));
    else if (stat.isFile()) result.push(entry);
  }
  return result;
};

const sha256Path = (target) => {
  const absolute = path.resolve(target);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return sha256File(absolute);
  if (!stat.isDirectory()) throw new Error(`Tipo de artefato não suportado: ${target}`);

  const hash = crypto.createHash('sha256');
  for (const file of listFiles(absolute)) {
    hash.update(path.relative(absolute, file).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
};

const gitShaMatches = (actual, expected) => {
  const left = String(actual || '').trim().toLowerCase();
  const right = String(expected || '').trim().toLowerCase();
  return Boolean(left && right && (left.startsWith(right) || right.startsWith(left)));
};

const isRemoteLocation = (location) => /^https?:\/\//i.test(location || '');

const validateArtifact = ({ artifact, key, root, issues, verifyLocalArtifacts }) => {
  if (!isObject(artifact)) {
    issues.push({ severity: 'error', code: `ARTIFACT_${key.toUpperCase()}_MISSING`, message: `Artefato ${key} ausente.` });
    return;
  }
  if (!isNonEmptyString(artifact.location)) {
    issues.push({ severity: 'error', code: `ARTIFACT_${key.toUpperCase()}_LOCATION_MISSING`, message: `${key}.location é obrigatório.` });
  }
  if (!isSha256(artifact.sha256)) {
    issues.push({ severity: 'error', code: `ARTIFACT_${key.toUpperCase()}_SHA256_INVALID`, message: `${key}.sha256 deve ser SHA-256.` });
  }
  if (parseDate(artifact.capturedAt) === undefined) {
    issues.push({ severity: 'error', code: `ARTIFACT_${key.toUpperCase()}_DATE_INVALID`, message: `${key}.capturedAt deve ser uma data ISO válida.` });
  }

  if (!verifyLocalArtifacts || !isNonEmptyString(artifact.location) || isRemoteLocation(artifact.location)) return;
  const absolute = path.isAbsolute(artifact.location) ? artifact.location : path.join(root, artifact.location);
  if (!fs.existsSync(absolute)) {
    issues.push({ severity: 'error', code: `ARTIFACT_${key.toUpperCase()}_FILE_MISSING`, message: `Artefato local não encontrado: ${artifact.location}` });
    return;
  }
  if (isSha256(artifact.sha256)) {
    const actual = sha256Path(absolute);
    if (actual !== artifact.sha256.toLowerCase()) {
      issues.push({ severity: 'error', code: `ARTIFACT_${key.toUpperCase()}_HASH_MISMATCH`, message: `Hash divergente para ${artifact.location}.` });
    }
  }
};

const validateEvidence = (input, options = {}) => {
  const issues = [];
  const root = options.root || process.cwd();
  if (!isObject(input)) {
    return { status: 'blocked', promotionReady: false, issues: [{ severity: 'error', code: 'EVIDENCE_NOT_OBJECT', message: 'A evidência deve ser um objeto JSON.' }] };
  }
  if (input.schemaVersion !== 'dnd-combat-beta-native-evidence.v3') {
    issues.push({
      severity: 'error',
      code: 'EVIDENCE_SCHEMA_NOT_V3',
      message: input.schemaVersion === 'dnd-combat-beta-native-evidence.v2'
        ? 'Evidência v2 deve ser recapturada em v3 para promoção.'
        : 'schemaVersion deve ser dnd-combat-beta-native-evidence.v3.'
    });
    return { status: 'blocked', promotionReady: false, issues };
  }
  if (!['android', 'ios'].includes(input.platform)) issues.push({ severity: 'error', code: 'EVIDENCE_PLATFORM_INVALID', message: 'platform deve ser android ou ios.' });
  if (options.expectedPlatform && input.platform !== options.expectedPlatform) issues.push({ severity: 'error', code: 'EVIDENCE_PLATFORM_MISMATCH', message: `platform deve ser ${options.expectedPlatform}.` });
  if (input.buildProfile !== 'beta-candidate') issues.push({ severity: 'error', code: 'EVIDENCE_PROFILE_INVALID', message: 'buildProfile deve ser beta-candidate.' });
  if (options.expectedAppVersion && input.appVersion !== options.expectedAppVersion) issues.push({ severity: 'error', code: 'EVIDENCE_APP_VERSION_MISMATCH', message: `appVersion deve ser ${options.expectedAppVersion}.` });
  if (options.expectedGitSha && !gitShaMatches(input.gitSha, options.expectedGitSha)) issues.push({ severity: 'error', code: 'EVIDENCE_GIT_SHA_MISMATCH', message: 'A evidência pertence a outro commit.' });

  for (const field of ['generatedAt', 'device', 'appVersion', 'buildId', 'gitSha', 'platformBuildNumber', 'testRunId']) {
    if (!isNonEmptyString(input[field])) issues.push({ severity: 'error', code: `EVIDENCE_${field.toUpperCase()}_MISSING`, message: `${field} é obrigatório.` });
  }
  if (!isSha256(input.binarySha256)) issues.push({ severity: 'error', code: 'EVIDENCE_BINARY_SHA256_INVALID', message: 'binarySha256 deve ser SHA-256.' });

  const generatedAt = parseDate(input.generatedAt);
  const now = parseDate(options.now || new Date().toISOString()) || Date.now();
  const maxAgeDays = options.maxAgeDays ?? 14;
  if (generatedAt === undefined) issues.push({ severity: 'error', code: 'EVIDENCE_GENERATED_AT_INVALID', message: 'generatedAt inválido.' });
  else {
    if (generatedAt > now + 5 * 60 * 1000) issues.push({ severity: 'error', code: 'EVIDENCE_GENERATED_AT_FUTURE', message: 'generatedAt está no futuro.' });
    if (now - generatedAt > maxAgeDays * 86400000) issues.push({ severity: 'error', code: 'EVIDENCE_STALE', message: `Evidência com mais de ${maxAgeDays} dias.` });
  }

  for (const check of REQUIRED_CHECKS) {
    if (input[check] !== true) issues.push({ severity: 'error', code: `EVIDENCE_${check.toUpperCase()}_NOT_PASSED`, message: `${check} precisa estar aprovado.` });
  }
  if (!isObject(input.artifacts)) issues.push({ severity: 'error', code: 'EVIDENCE_ARTIFACTS_MISSING', message: 'artifacts é obrigatório.' });
  else for (const key of REQUIRED_ARTIFACTS) validateArtifact({ artifact: input.artifacts[key], key, root, issues, verifyLocalArtifacts: options.verifyLocalArtifacts !== false });

  if (isObject(input.metrics)) {
    for (const [key, value] of Object.entries(input.metrics)) {
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        issues.push({ severity: 'warning', code: `EVIDENCE_METRIC_${key.toUpperCase()}_INVALID`, message: `${key} deve ser número não negativo.` });
      }
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return {
    status: errors.length ? 'blocked' : warnings.length ? 'needsReview' : 'ready',
    promotionReady: errors.length === 0 && warnings.length === 0,
    issues,
    evidence: input
  };
};

module.exports = {
  REQUIRED_ARTIFACTS,
  REQUIRED_CHECKS,
  gitShaMatches,
  isRemoteLocation,
  sha256Path,
  validateEvidence
};
