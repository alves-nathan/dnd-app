#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  artifactDescriptor,
  computeSourceFingerprint,
  evaluateApp29Evidence,
  getGitSha,
  sha256File,
  withEvidenceDigest
} = require('./lib/app29-release-candidate-evidence');
const { evaluateApp28Evidence } = require('./lib/app28-integral-gate-evidence');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const allowBlocked = args.includes('--allow-blocked');
const outputDir = path.join(root, 'artifacts/app29-release-candidate');
fs.mkdirSync(outputDir, { recursive: true });
const commands = [
  ['source-shape', process.execPath, ['scripts/check-project-shape.js']],
  ['accessibility-contracts', process.execPath, ['scripts/check-accessibility-contracts.js']],
  ['security-hardening', process.execPath, ['scripts/check-app29-security-hardening.js']],
  ['migration-contracts', process.execPath, ['scripts/check-app29-migration-contracts.js']],
  ['install-upgrade-rehearsal', process.execPath, ['scripts/run-app29-install-upgrade-rehearsal.js']],
  ['performance-budget', process.execPath, ['scripts/run-app29-performance-benchmark.js']],
  ['release-readiness', process.execPath, ['scripts/check-release-readiness.js']]
];
const steps = commands.map(([id, command, commandArgs]) => {
  const started = Date.now();
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const log = path.join(outputDir, `${id}.log`);
  fs.writeFileSync(log, `${result.stdout || ''}${result.stderr || ''}`);
  return { id, status: result.status === 0 ? 'PASS' : 'FAIL', durationMs: Date.now() - started, exitCode: result.status, logFile: path.relative(root, log), detail: result.status === 0 ? 'Etapa aprovada.' : `Comando encerrou com código ${result.status}.` };
});
let app28Evidence = null;
const app28Path = path.join(root, 'artifacts/app28-integral-gate.json');
if (fs.existsSync(app28Path)) app28Evidence = JSON.parse(fs.readFileSync(app28Path, 'utf8'));
const app28Validation = app28Evidence ? evaluateApp28Evidence(app28Evidence, { root, requireGitMatch: false, minimumMaestroFlows: 83 }) : { valid: false, errors: ['Evidência APP-28 ausente.'] };
steps.push({
  id: 'app28-integral-gate',
  status: app28Validation.valid ? 'PASS' : app28Evidence?.status === 'FAIL' ? 'FAIL' : 'BLOCKED',
  durationMs: 0,
  exitCode: null,
  logFile: fs.existsSync(app28Path) ? path.relative(root, app28Path) : null,
  detail: app28Validation.valid ? 'Gate integral aprovado para a codebase APP-29.' : app28Validation.errors.join(' | ')
});
const source = computeSourceFingerprint(root);
const status = steps.some((entry) => entry.status === 'FAIL') ? 'FAIL' : steps.some((entry) => entry.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
const artifactFiles = {
  security: 'reports/app-29-security-hardening.json',
  migrations: 'reports/app-29-migration-contracts.json',
  rehearsal: 'reports/app-29-install-upgrade-rehearsal.json',
  performance: 'reports/app-29-performance-benchmark.json',
  app28: fs.existsSync(app28Path) ? 'artifacts/app28-integral-gate.json' : null
};
const unsigned = {
  schemaVersion: 'dnd-combat-app29-release-candidate.v1',
  status,
  generatedAt: new Date().toISOString(),
  source: { ...source, gitSha: getGitSha(root), packageLockSha256: sha256File(path.join(root, 'package-lock.json')) },
  steps,
  app28Evidence,
  artifacts: Object.fromEntries(Object.entries(artifactFiles).filter(([, file]) => file).map(([name, file]) => [name, artifactDescriptor(root, file)])),
  remediation: steps.filter((entry) => entry.status !== 'PASS').map((entry) => ({ id: entry.id, detail: entry.detail }))
};
const report = withEvidenceDigest(unsigned);
const reportPath = path.join(root, 'artifacts/app29-release-candidate.json');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const selfValidation = status === 'PASS' ? evaluateApp29Evidence(report, { root, requireGitMatch: false }) : null;
console.log(JSON.stringify({ status, evidenceSha256: report.evidenceSha256, selfValid: selfValidation?.valid ?? false, report: path.relative(root, reportPath) }, null, 2));
if (status === 'FAIL' || (status === 'BLOCKED' && !allowBlocked)) process.exit(1);
