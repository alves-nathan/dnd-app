#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const errors = [];
const read = (relativePath) => {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    errors.push(`${relativePath}: arquivo ausente`);
    return '';
  }
  return fs.readFileSync(absolute, 'utf8');
};

const contracts = [
  ['scripts/lib/app07-release-evidence.js', [
    'computeSourceFingerprint',
    'evaluateReleaseGateEvidence',
    'validateEvidenceDigest',
    'evidenceSha256'
  ]],
  ['scripts/check-dependency-lock.js', [
    'dnd-combat-app07-dependency-lock.v1',
    'packageManager',
    'integrityEntries',
    'pacote crítico'
  ]],
  ['scripts/install-locked-dependencies.js', [
    'dnd-combat-app07-dependency-install.v1',
    'REGISTRY_PACKAGE_MISSING',
    'REGISTRY_UNREACHABLE',
    "['ci', '--no-audit', '--fund=false']"
  ]],
  ['scripts/run-app06-native-gate.js', [
    'dnd-combat-app06-native-gate.v2',
    "add('app-version'",
    "add('logcat-artifact'",
    "add('screenshot-artifact'",
    "add('junit-artifact'"
  ]],
  ['scripts/run-app07-release-gate.js', [
    'dnd-combat-app07-release-gate.v1',
    "id: 'dependency-lock'",
    "id: 'typecheck'",
    "id: 'jest'",
    "id: 'native-gate'",
    'withEvidenceDigest'
  ]],
  ['scripts/verify-app07-release-gate.js', [
    'APP07_GATE_MAX_AGE_HOURS',
    'evaluateReleaseGateEvidence',
    '[app07:release:gate:verify] PASS'
  ]],
  ['scripts/build-android-beta-candidate.js', [
    'verify-app07-release-gate.js',
    'app07-release-gate.json',
    'releaseGate'
  ]],
  ['scripts/run-beta-local-gate.js', [
    "id: 'app07.releaseGate'",
    "args: ['run', 'app07:release:gate:verify']"
  ]],
  ['scripts/run-app07-runtime-harness.js', [
    'APP-07 release evidence harness',
    'Fingerprint da codebase diverge',
    'Evidência expirada'
  ]],
  ['.npmrc', ['save-exact=true', 'package-lock=true']]
];

for (const [relativePath, snippets] of contracts) {
  const content = read(relativePath);
  for (const snippet of snippets) {
    if (content && !content.includes(snippet)) errors.push(`${relativePath}: contrato ausente (${snippet})`);
  }
}

const packageJson = JSON.parse(read('package.json') || '{}');
for (const script of [
  'dependencies:lock:check',
  'app07:dependencies:install',
  'app07:dependencies:diagnose',
  'app07:release:gate:check',
  'app07:release:gate:harness',
  'app07:smoke',
  'app07:release:gate',
  'app07:release:gate:offline',
  'app07:release:gate:verify',
  'app07:validate'
]) {
  if (!packageJson.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
}

for (const [section, dependencies] of Object.entries({
  dependencies: packageJson.dependencies || {},
  devDependencies: packageJson.devDependencies || {}
})) {
  for (const [name, version] of Object.entries(dependencies)) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) errors.push(`package.json: ${section}.${name} não está fixado (${version})`);
  }
}

if (errors.length) {
  console.error('[app07:release:gate:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('[app07:release:gate:check] PASS');
console.log('dependencyMode=exact');
console.log('buildCandidateGate=mandatory');
