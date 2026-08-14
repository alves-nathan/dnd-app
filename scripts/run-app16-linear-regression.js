#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const commands = [
  'check-project-shape.js',
  'check-accessibility-contracts.js',
  'check-bundled-compendium.js',
  'check-runtime-catalog.js',
  'check-catalog-content-management.js',
  'check-character-choice-bridge.js',
  'check-catalog-dependency-progression.js',
  'check-progression-transaction.js',
  'check-progression-recovery.js',
  'check-dependency-lock.js',
  'check-app07-release-gate.js',
  'check-character-compatibility.js',
  'check-compatibility-remediation.js',
  'check-compatibility-remediation-recovery.js',
  'check-catalog-character-impact.js',
  'check-catalog-configuration-history.js',
  'check-portable-catalog-backup.js',
  'check-portable-restore-session.js',
  'check-portable-restore-verification.js',
  'check-portable-restore-evidence-center.js',
  'check-typescript-syntax.js',
  'run-app04-runtime-harness.js',
  'run-app05-runtime-harness.js',
  'run-app06-runtime-harness.js',
  'run-app07-runtime-harness.js',
  'run-app08-runtime-harness.js',
  'run-app09-runtime-harness.js',
  'run-app10-runtime-harness.js',
  'run-app11-runtime-harness.js',
  'run-app12-runtime-harness.js',
  'run-app13-runtime-harness.js',
  'run-app14-runtime-harness.js',
  'run-app15-runtime-harness.js',
  'run-app16-runtime-harness.js'
];
const results = [];
for (const command of commands) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', command)], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  results.push({ command, status: result.status === 0 ? 'PASS' : 'FAIL', durationMs: Date.now() - started, stdout: String(result.stdout || '').trim().slice(-1000), stderr: String(result.stderr || '').trim().slice(-1000) });
  if (result.status !== 0) break;
}
const status = results.length === commands.length && results.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL';
const report = { schemaVersion: 'dnd-combat-app16-linear-regression.v1', status, generatedAt: new Date().toISOString(), commands: commands.length, completed: results.length, results };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-16-linear-regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status, commands: commands.length, completed: results.length, failed: results.find((entry) => entry.status === 'FAIL')?.command }, null, 2));
if (status !== 'PASS') process.exit(1);
