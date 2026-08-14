#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  artifactDescriptor,
  computeSourceFingerprint,
  evaluateApp29Evidence,
  getGitSha,
  sha256File,
  withEvidenceDigest
} = require('./lib/app29-release-candidate-evidence');
const { withEvidenceDigest: withApp28Digest } = require('./lib/app28-integral-gate-evidence');
const root = path.resolve(__dirname, '..');
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(message); };
const dir = path.join(root, 'artifacts/app29-harness');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const files = {
  junit: path.join(dir, 'junit.xml'),
  logcat: path.join(dir, 'logcat.txt'),
  screenshot: path.join(dir, 'screen.png'),
  maestroLog: path.join(dir, 'maestro.log'),
  security: path.join(dir, 'security.json'),
  migrations: path.join(dir, 'migrations.json'),
  rehearsal: path.join(dir, 'rehearsal.json'),
  performance: path.join(dir, 'performance.json')
};
fs.writeFileSync(files.junit, '<testsuites tests="83" failures="0" errors="0"></testsuites>');
fs.writeFileSync(files.logcat, 'clean logcat\n');
fs.writeFileSync(files.screenshot, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.from('app29') ]));
fs.writeFileSync(files.maestroLog, '83/83 PASS\n');
for (const key of ['security','migrations','rehearsal','performance']) fs.writeFileSync(files[key], JSON.stringify({ status: 'PASS', key }));
const source = computeSourceFingerprint(root);
const app28 = withApp28Digest({
  schemaVersion: 'dnd-combat-app28-integral-gate.v1',
  status: 'PASS',
  generatedAt: new Date().toISOString(),
  source: { ...source, gitSha: getGitSha(root), packageLockSha256: sha256File(path.join(root, 'package-lock.json')) },
  steps: ['dependency-install','dependency-lock','app27-regression','full-typecheck','full-jest','native-gate'].map((id) => ({ id, status: 'PASS' })),
  nativeEvidence: {
    status: 'PASS', flowCount: 83, appVersionMatches: true,
    artifacts: Object.fromEntries(['junit','logcat','screenshot','maestroLog'].map((key) => [key, artifactDescriptor(root, path.relative(root, files[key]))]))
  }
});
const steps = ['source-shape','accessibility-contracts','security-hardening','migration-contracts','install-upgrade-rehearsal','performance-budget','release-readiness','app28-integral-gate'].map((id) => ({ id, status: 'PASS' }));
const base = {
  schemaVersion: 'dnd-combat-app29-release-candidate.v1',
  status: 'PASS',
  generatedAt: new Date().toISOString(),
  source: { ...source, gitSha: getGitSha(root), packageLockSha256: sha256File(path.join(root, 'package-lock.json')) },
  steps,
  app28Evidence: app28,
  artifacts: Object.fromEntries(['security','migrations','rehearsal','performance'].map((key) => [key, artifactDescriptor(root, path.relative(root, files[key]))]))
};
const report = withEvidenceDigest(base);
let result = evaluateApp29Evidence(report, { root, requireGitMatch: false, minimumMaestroFlows: 83 });
assert(result.valid, `Evidência válida rejeitada: ${result.errors.join('; ')}`);
assert(report.evidenceSha256.length === 64, 'Digest APP-29 inválido.');
assert(report.app28Evidence.evidenceSha256.length === 64, 'Digest APP-28 inválido.');
assert(report.steps.length === 8, 'Quantidade de etapas inválida.');
assert(report.app28Evidence.nativeEvidence.flowCount === 83, 'Quantidade de fluxos inválida.');
const blocked = withEvidenceDigest({ ...base, status: 'BLOCKED' });
assert(!evaluateApp29Evidence(blocked, { root, requireGitMatch: false }).valid, 'Status BLOCKED foi aceito.');
const missingStep = withEvidenceDigest({ ...base, steps: steps.slice(1) });
assert(!evaluateApp29Evidence(missingStep, { root, requireGitMatch: false }).valid, 'Etapa ausente foi aceita.');
const failedStep = withEvidenceDigest({ ...base, steps: steps.map((entry) => entry.id === 'security-hardening' ? { ...entry, status: 'FAIL' } : entry) });
assert(!evaluateApp29Evidence(failedStep, { root, requireGitMatch: false }).valid, 'Etapa FAIL foi aceita.');
const fewFlowsApp28 = withApp28Digest({ ...app28, nativeEvidence: { ...app28.nativeEvidence, flowCount: 82 } });
const fewFlows = withEvidenceDigest({ ...base, app28Evidence: fewFlowsApp28 });
assert(!evaluateApp29Evidence(fewFlows, { root, requireGitMatch: false, minimumMaestroFlows: 83 }).valid, '82 fluxos foram aceitos.');
const stale = withEvidenceDigest({ ...base, generatedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString() });
assert(!evaluateApp29Evidence(stale, { root, requireGitMatch: false, maxAgeHours: 24 }).valid, 'Evidência expirada foi aceita.');
const wrongLock = withEvidenceDigest({ ...base, source: { ...base.source, packageLockSha256: '0'.repeat(64) } });
assert(!evaluateApp29Evidence(wrongLock, { root, requireGitMatch: false }).valid, 'Lockfile divergente foi aceito.');
const badDigest = { ...report, status: 'FAIL' };
assert(!evaluateApp29Evidence(badDigest, { root, requireGitMatch: false }).valid, 'Digest adulterado foi aceito.');
fs.appendFileSync(files.security, '\ntampered');
assert(!evaluateApp29Evidence(report, { root, requireGitMatch: false }).valid, 'Artefato adulterado foi aceito.');
assert(report.schemaVersion === 'dnd-combat-app29-release-candidate.v1', 'Schema APP-29 incorreto.');
assert(app28.schemaVersion === 'dnd-combat-app28-integral-gate.v1', 'Schema APP-28 incorreto.');
assert(steps.every((entry) => entry.status === 'PASS'), 'Fixture possui etapa não aprovada.');
assert(Object.keys(base.artifacts).length === 4, 'Quantidade de artefatos APP-29 inválida.');
assert(source.fingerprint.length === 64, 'Fingerprint da source inválido.');
assert(sha256File(path.join(root, 'package-lock.json')).length === 64, 'SHA do lockfile inválido.');
assert(files.screenshot.endsWith('.png'), 'Screenshot inválido.');
const output = { schemaVersion: 'dnd-combat-app29-runtime-harness.v1', status: 'PASS', generatedAt: new Date().toISOString(), assertions, requiredMaestroFlows: 83 };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-29-runtime-harness.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
