#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  artifactDescriptor,
  classifyInstallOutput,
  computeSourceFingerprint,
  evaluateApp28Evidence,
  getGitSha,
  sanitizeOutput,
  sanitizeRegistry,
  sha256File,
  withEvidenceDigest
} = require('./lib/app28-integral-gate-evidence');

const root = path.resolve(__dirname, '..');
let assertions = 0;
const assert = (condition, message) => {
  assertions += 1;
  if (!condition) throw new Error(message);
};

const success = classifyInstallOutput({ status: 0, output: '' });
assert(success.status === 'PASS', 'Instalação bem-sucedida deve ser PASS.');
assert(success.classification === 'INSTALLED', 'Classificação de sucesso inválida.');
const missing = classifyInstallOutput({ status: 1, output: 'npm ERR! code E404 404 Not Found' });
assert(missing.status === 'BLOCKED', 'E404 deve ser bloqueio ambiental.');
assert(missing.classification === 'REGISTRY_PACKAGE_MISSING', 'E404 mal classificado.');
const dns = classifyInstallOutput({ status: 1, output: 'EAI_AGAIN registry.npmjs.org' });
assert(dns.classification === 'REGISTRY_UNREACHABLE', 'DNS mal classificado.');
const resolve = classifyInstallOutput({ status: 1, output: 'npm ERR! ERESOLVE unable to resolve dependency tree' });
assert(resolve.status === 'FAIL', 'ERESOLVE deve falhar o gate.');
const integrity = classifyInstallOutput({ status: 1, output: 'EINTEGRITY checksum failed' });
assert(integrity.classification === 'INTEGRITY_FAILED', 'Integridade mal classificada.');
assert(sanitizeRegistry('https://user:secret@example.com/npm/') === 'https://example.com/npm', 'Registry não foi sanitizado.');
assert(!sanitizeOutput('https://user:secret@example.com/x _authToken=abc').includes('secret'), 'Credencial vazou no log.');
assert(!sanitizeOutput('_authToken=abc').includes('abc'), 'Token vazou no log.');

const harnessDir = path.join(root, 'artifacts/app28-harness');
fs.rmSync(harnessDir, { recursive: true, force: true });
fs.mkdirSync(harnessDir, { recursive: true });
const junitPath = path.join(harnessDir, 'junit.xml');
const logcatPath = path.join(harnessDir, 'logcat.txt');
const screenshotPath = path.join(harnessDir, 'screen.png');
const maestroPath = path.join(harnessDir, 'maestro.log');
fs.writeFileSync(junitPath, '<testsuites tests="83" failures="0" errors="0"></testsuites>');
fs.writeFileSync(logcatPath, 'logcat evidence\n');
fs.writeFileSync(screenshotPath, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.from('fake-png-body')]));
fs.writeFileSync(maestroPath, '83/83 PASS\n');
const steps = ['dependency-install','dependency-lock','app27-regression','full-typecheck','full-jest','native-gate']
  .map((id) => ({ id, status: 'PASS' }));
const source = computeSourceFingerprint(root);
const base = {
  schemaVersion: 'dnd-combat-app28-integral-gate.v1',
  status: 'PASS',
  generatedAt: new Date().toISOString(),
  source: { ...source, gitSha: getGitSha(root), packageLockSha256: sha256File(path.join(root, 'package-lock.json')) },
  steps,
  nativeEvidence: {
    status: 'PASS',
    flowCount: 83,
    appVersionMatches: true,
    artifacts: {
      junit: artifactDescriptor(root, path.relative(root, junitPath)),
      logcat: artifactDescriptor(root, path.relative(root, logcatPath)),
      screenshot: artifactDescriptor(root, path.relative(root, screenshotPath)),
      maestroLog: artifactDescriptor(root, path.relative(root, maestroPath))
    }
  }
};
const report = withEvidenceDigest(base);
let result = evaluateApp28Evidence(report, { root, minimumMaestroFlows: 83, requireGitMatch: false });
assert(result.valid, `Evidência válida rejeitada: ${result.errors.join('; ')}`);
assert(report.evidenceSha256.length === 64, 'Digest não possui 64 caracteres.');

const blocked = withEvidenceDigest({ ...base, status: 'BLOCKED' });
result = evaluateApp28Evidence(blocked, { root, requireGitMatch: false });
assert(!result.valid, 'Evidência bloqueada foi aceita.');
const missingStep = withEvidenceDigest({ ...base, steps: steps.filter((step) => step.id !== 'full-jest') });
assert(!evaluateApp28Evidence(missingStep, { root, requireGitMatch: false }).valid, 'Etapa ausente foi aceita.');
const stale = withEvidenceDigest({ ...base, generatedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString() });
assert(!evaluateApp28Evidence(stale, { root, maxAgeHours: 24, requireGitMatch: false }).valid, 'Evidência expirada foi aceita.');
const fewFlows = withEvidenceDigest({ ...base, nativeEvidence: { ...base.nativeEvidence, flowCount: 82 } });
assert(!evaluateApp28Evidence(fewFlows, { root, minimumMaestroFlows: 83, requireGitMatch: false }).valid, 'Quantidade insuficiente de fluxos foi aceita.');
const wrongLock = withEvidenceDigest({ ...base, source: { ...base.source, packageLockSha256: '0'.repeat(64) } });
assert(!evaluateApp28Evidence(wrongLock, { root, requireGitMatch: false }).valid, 'Lockfile divergente foi aceito.');
const badDigest = { ...report, status: 'FAIL' };
assert(!evaluateApp28Evidence(badDigest, { root, requireGitMatch: false }).valid, 'Digest adulterado foi aceito.');
fs.appendFileSync(logcatPath, 'tampered');
assert(!evaluateApp28Evidence(report, { root, requireGitMatch: false }).valid, 'Artefato adulterado foi aceito.');

const output = {
  schemaVersion: 'dnd-combat-app28-runtime-harness.v1',
  status: 'PASS',
  generatedAt: new Date().toISOString(),
  assertions,
  minimumMaestroFlows: 83,
  temporaryDirectory: os.tmpdir()
};
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-28-runtime-harness.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
