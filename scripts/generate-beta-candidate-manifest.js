#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { validateEvidence } = require('./lib/beta-native-evidence');

const root = process.cwd();
const outputDir = path.join(root, 'artifacts', 'beta-candidate');
fs.mkdirSync(outputDir, { recursive: true });

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const readOptionalJson = (relativePath) => {
  const absolute = path.join(root, relativePath);
  return fs.existsSync(absolute) ? readJson(relativePath) : undefined;
};

const pkg = readJson('package.json');
const app = readJson('app.json');
const eas = readJson('eas.json');
const localGate = readOptionalJson('artifacts/beta-candidate/local-gate.json');
const androidEvidence = readOptionalJson('artifacts/beta-evidence/android.json');
const iosEvidence = readOptionalJson('artifacts/beta-evidence/ios.json');
const projectId = app?.expo?.extra?.eas?.projectId;
const expectedGitSha = process.env.BETA_EXPECTED_GIT_SHA || androidEvidence?.gitSha || iosEvidence?.gitSha;

const validate = (platform, evidence) => evidence
  ? validateEvidence(evidence, {
      root,
      expectedPlatform: platform,
      expectedAppVersion: app?.expo?.version,
      expectedGitSha,
      maxAgeDays: Number(process.env.BETA_EVIDENCE_MAX_AGE_DAYS || 14),
      verifyLocalArtifacts: true
    })
  : undefined;
const androidValidation = validate('android', androidEvidence);
const iosValidation = validate('ios', iosEvidence);

const checks = [
  { id: 'localGate', passed: localGate?.status === 'passed', blocking: true, details: localGate ? `status=${localGate.status}` : 'local-gate.json ausente' },
  { id: 'betaProfile', passed: Boolean(eas?.build?.['beta-candidate']), blocking: true, details: 'Perfil beta-candidate em eas.json' },
  { id: 'projectId', passed: Boolean(projectId), blocking: false, details: projectId ? 'Projeto EAS vinculado' : 'extra.eas.projectId ausente' },
  {
    id: 'androidEvidence',
    passed: Boolean(androidValidation?.promotionReady),
    blocking: false,
    details: androidEvidence ? `${androidValidation?.status ?? 'invalid'} · contrato ${androidEvidence.schemaVersion ?? '-'}` : 'android.json ausente'
  },
  {
    id: 'iosEvidence',
    passed: Boolean(iosValidation?.promotionReady),
    blocking: false,
    details: iosEvidence ? `${iosValidation?.status ?? 'invalid'} · contrato ${iosEvidence.schemaVersion ?? '-'}` : 'ios.json ausente'
  }
];

const blocked = checks.some((check) => check.blocking && !check.passed);
const needsReview = checks.some((check) => !check.passed);
const manifest = {
  schemaVersion: 'dnd-combat-beta-candidate-manifest.v2',
  generatedAt: new Date().toISOString(),
  status: blocked ? 'blocked' : needsReview ? 'needsReview' : 'ready',
  app: {
    name: app?.expo?.name,
    slug: app?.expo?.slug,
    version: app?.expo?.version || pkg.version,
    androidPackage: app?.expo?.android?.package,
    androidVersionCode: app?.expo?.android?.versionCode,
    iosBundleIdentifier: app?.expo?.ios?.bundleIdentifier,
    iosBuildNumber: app?.expo?.ios?.buildNumber,
    easProjectId: projectId || null
  },
  buildProfile: 'beta-candidate',
  source: {
    gitSha: expectedGitSha || process.env.GITHUB_SHA || process.env.EAS_BUILD_GIT_COMMIT_HASH || null,
    gitRef: process.env.GITHUB_REF || null
  },
  checks,
  evidenceValidation: {
    android: androidValidation ? { status: androidValidation.status, issues: androidValidation.issues } : null,
    ios: iosValidation ? { status: iosValidation.status, issues: iosValidation.issues } : null
  },
  artifacts: {
    localGate: localGate ? 'artifacts/beta-candidate/local-gate.json' : null,
    androidEvidence: androidEvidence ? 'artifacts/beta-evidence/android.json' : null,
    iosEvidence: iosEvidence ? 'artifacts/beta-evidence/ios.json' : null
  }
};

const output = path.join(outputDir, 'manifest.json');
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Beta candidate manifest: ${manifest.status}`);
for (const check of checks) console.log(`- ${check.passed ? 'PASS' : 'PENDING'} ${check.id}: ${check.details}`);
console.log(`Arquivo: ${path.relative(root, output)}`);
if (blocked) process.exit(1);
