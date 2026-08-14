#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  computeSourceFingerprint,
  evaluateReleaseGateEvidence,
  sha256,
  withEvidenceDigest,
  writeJson
} = require('./lib/app07-release-evidence');

console.log('APP-07 release evidence harness');
let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
};

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-app07-'));
fs.mkdirSync(path.join(temporaryRoot, 'app'), { recursive: true });
fs.mkdirSync(path.join(temporaryRoot, 'artifacts/maestro/app06-android'), { recursive: true });
fs.writeFileSync(path.join(temporaryRoot, 'package.json'), '{"name":"fixture"}\n');
fs.writeFileSync(path.join(temporaryRoot, 'package-lock.json'), '{"lockfileVersion":3}\n');
fs.writeFileSync(path.join(temporaryRoot, 'app/example.ts'), 'export const value = 1;\n');
fs.writeFileSync(path.join(temporaryRoot, 'artifacts/maestro/app06-android/junit.xml'), '<testsuite tests="4" failures="0" errors="0"/>\n');
fs.writeFileSync(path.join(temporaryRoot, 'artifacts/maestro/app06-android/logcat.txt'), 'logcat fixture\n');
fs.writeFileSync(path.join(temporaryRoot, 'artifacts/maestro/app06-android/final-screen.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));

const source = computeSourceFingerprint(temporaryRoot);
check(source.files === 3, 'fingerprint deve considerar os três arquivos da fixture');
check(source.fingerprint.length === 64, 'fingerprint deve ser SHA-256');
const passSteps = ['dependency-lock', 'app06-smoke', 'typecheck', 'jest', 'native-gate'].map((id) => ({ id, status: 'PASS' }));
const report = withEvidenceDigest({
  schemaVersion: 'dnd-combat-app07-release-gate.v1',
  status: 'PASS',
  generatedAt: new Date().toISOString(),
  source: { ...source, gitSha: null },
  steps: passSteps,
  nativeEvidence: {
    junitPath: 'artifacts/maestro/app06-android/junit.xml',
    logcatPath: 'artifacts/maestro/app06-android/logcat.txt',
    screenshotPath: 'artifacts/maestro/app06-android/final-screen.png',
    appVersionMatches: true,
    artifacts: Object.fromEntries([
      ['junit', 'artifacts/maestro/app06-android/junit.xml'],
      ['logcat', 'artifacts/maestro/app06-android/logcat.txt'],
      ['screenshot', 'artifacts/maestro/app06-android/final-screen.png']
    ].map(([name, relativePath]) => {
      const content = fs.readFileSync(path.join(temporaryRoot, relativePath));
      return [name, { path: relativePath, bytes: content.length, sha256: sha256(content) }];
    }))
  }
});
const accepted = evaluateReleaseGateEvidence(report, { root: temporaryRoot, maxAgeHours: 24 });
check(accepted.valid, accepted.errors.join(' | '));
check(accepted.errors.length === 0, 'evidência válida não deve gerar erros');

fs.writeFileSync(path.join(temporaryRoot, 'app/example.ts'), 'export const value = 2;\n');
const changed = evaluateReleaseGateEvidence(report, { root: temporaryRoot, maxAgeHours: 24 });
check(!changed.valid, 'alteração de código deve invalidar a evidência');
check(changed.errors.some((item) => item.includes('Fingerprint da codebase diverge')), 'deve explicar divergência de fingerprint');
fs.writeFileSync(path.join(temporaryRoot, 'app/example.ts'), 'export const value = 1;\n');

const stale = withEvidenceDigest({ ...report, generatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), evidenceSha256: undefined });
const staleResult = evaluateReleaseGateEvidence(stale, { root: temporaryRoot, maxAgeHours: 24 });
check(!staleResult.valid, 'evidência antiga deve ser rejeitada');
check(staleResult.errors.some((item) => item.includes('Evidência expirada')), 'deve explicar expiração');

const tampered = { ...report, status: 'FAIL' };
const tamperedResult = evaluateReleaseGateEvidence(tampered, { root: temporaryRoot, maxAgeHours: 24 });
check(!tamperedResult.valid, 'evidência adulterada deve ser rejeitada');
check(tamperedResult.errors.some((item) => item.includes('Digest da evidência é inválido')), 'deve detectar digest inválido');

fs.appendFileSync(path.join(temporaryRoot, 'artifacts/maestro/app06-android/logcat.txt'), 'altered\n');
const changedArtifact = evaluateReleaseGateEvidence(report, { root: temporaryRoot, maxAgeHours: 24 });
check(!changedArtifact.valid, 'artefato alterado deve ser rejeitado');
check(changedArtifact.errors.some((item) => item.includes('Artefato nativo alterado após o gate')), 'deve detectar alteração em artefato nativo');
fs.writeFileSync(path.join(temporaryRoot, 'artifacts/maestro/app06-android/logcat.txt'), 'logcat fixture\n');

fs.writeFileSync(path.join(temporaryRoot, 'artifacts/maestro/app06-android/junit.xml'), '<testsuite tests="4" failures="1" errors="0"/>\n');
const failedJunit = evaluateReleaseGateEvidence(report, { root: temporaryRoot, maxAgeHours: 24 });
check(!failedJunit.valid, 'JUnit com falha deve ser rejeitado');
check(failedJunit.errors.some((item) => item.includes('JUnit nativo contém falhas')), 'deve explicar falhas no JUnit');
fs.rmSync(path.join(temporaryRoot, 'artifacts/maestro/app06-android/junit.xml'));
const missingJunit = evaluateReleaseGateEvidence(report, { root: temporaryRoot, maxAgeHours: 24 });
check(!missingJunit.valid, 'evidência sem JUnit deve ser rejeitada');
check(missingJunit.errors.some((item) => item.includes('JUnit nativo ausente')), 'deve explicar ausência de JUnit');

const blockedReport = withEvidenceDigest({ ...report, status: 'BLOCKED', evidenceSha256: undefined });
const blocked = evaluateReleaseGateEvidence(blockedReport, { root: temporaryRoot, maxAgeHours: 24 });
check(!blocked.valid, 'status BLOCKED não deve ser aceito');
check(blocked.errors.some((item) => item.includes('Gate não está aprovado')), 'deve exigir PASS');

const root = path.resolve(__dirname, '..');
writeJson(path.join(root, 'artifacts/app07-runtime-harness.json'), {
  schemaVersion: 'dnd-combat-app07-runtime-harness.v1',
  status: 'PASS',
  generatedAt: new Date().toISOString(),
  assertions
});
fs.rmSync(temporaryRoot, { recursive: true, force: true });
console.log(`assertions=${assertions}`);
console.log('status=PASS');
