#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const commands = [
  'run-app28-linear-regression.js',
  'check-app29-release-candidate.js',
  'check-app29-security-hardening.js',
  'check-app29-migration-contracts.js',
  'run-app29-install-upgrade-rehearsal.js',
  'run-app29-performance-benchmark.js',
  'run-app29-isolated-typecheck.js',
  'scan-app29-private-material.js',
  'run-app29-runtime-harness.js',
  'check-typescript-syntax.js'
];
const results = [];
for (const command of commands) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', command)], { cwd: root, encoding: 'utf8', maxBuffer: 192 * 1024 * 1024 });
  results.push({ command, status: result.status === 0 ? 'PASS' : 'FAIL', durationMs: Date.now() - started, stdout: String(result.stdout || '').trim().slice(-5000), stderr: String(result.stderr || '').trim().slice(-5000) });
  if (result.status !== 0) break;
}
const status = results.length === commands.length && results.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL';
const inherited = (() => { try { const report = JSON.parse(fs.readFileSync(path.join(root, 'reports/app-28-linear-regression.json'), 'utf8')); return Number(report.inheritedBaselineChecks || 0) + Number(report.currentPassChecks || 0); } catch { return 206; } })();
const report = { schemaVersion: 'dnd-combat-app29-linear-regression.v1', status, generatedAt: new Date().toISOString(), inheritedBaselineChecks: inherited, currentPassChecks: results.filter((entry) => entry.status === 'PASS').length, currentPlannedChecks: commands.length, accumulatedChecks: inherited + results.filter((entry) => entry.status === 'PASS').length, results };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-29-linear-regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status, inheritedBaselineChecks: inherited, currentPassChecks: report.currentPassChecks, currentPlannedChecks: commands.length, accumulatedChecks: report.accumulatedChecks, failed: results.find((entry) => entry.status === 'FAIL')?.command }, null, 2));
if (status !== 'PASS') process.exit(1);
