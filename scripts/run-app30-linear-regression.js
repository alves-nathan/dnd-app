#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const commands = [
  { command: 'run-app29-linear-regression.js', args: [] },
  { command: 'check-app30-production-release.js', args: [] },
  { command: 'check-app30-operational-docs.js', args: [] },
  { command: 'run-app30-isolated-typecheck.js', args: [] },
  { command: 'scan-app30-private-material.js', args: [] },
  { command: 'create-app30-delivery-package.js', args: [] },
  { command: 'run-app30-runtime-harness.js', args: [] },
  { command: 'check-typescript-syntax.js', args: [] },
  { command: 'run-app30-production-release.js', args: ['--allow-blocked'] }
];
const results = [];
for (const entry of commands) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', entry.command), ...entry.args], { cwd: root, encoding: 'utf8', maxBuffer: 192 * 1024 * 1024 });
  results.push({ command: entry.command, args: entry.args, status: result.status === 0 ? 'PASS' : 'FAIL', durationMs: Date.now() - started, stdout: String(result.stdout || '').trim().slice(-5000), stderr: String(result.stderr || '').trim().slice(-5000) });
  if (result.status !== 0) break;
}
const status = results.length === commands.length && results.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL';
const inherited = (() => { try { const report = JSON.parse(fs.readFileSync(path.join(root, 'reports/app-29-linear-regression.json'), 'utf8')); return Number(report.accumulatedChecks || 216); } catch { return 216; } })();
const currentPassChecks = results.filter((entry) => entry.status === 'PASS').length;
const report = { schemaVersion: 'dnd-combat-app30-linear-regression.v1', status, generatedAt: new Date().toISOString(), inheritedBaselineChecks: inherited, currentPassChecks, currentPlannedChecks: commands.length, accumulatedChecks: inherited + currentPassChecks, results };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-30-linear-regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status, inheritedBaselineChecks: inherited, currentPassChecks, currentPlannedChecks: commands.length, accumulatedChecks: report.accumulatedChecks, failed: results.find((entry) => entry.status === 'FAIL')?.command }, null, 2));
if (status !== 'PASS') process.exit(1);
