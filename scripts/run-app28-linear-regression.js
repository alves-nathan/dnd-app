#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const commands = [
  'run-app27-linear-regression.js',
  'check-app28-integral-gate.js',
  'run-app28-runtime-harness.js',
  'check-typescript-syntax.js'
];
const results = [];
for (const command of commands) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', command)], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 192 * 1024 * 1024
  });
  results.push({
    command,
    status: result.status === 0 ? 'PASS' : 'FAIL',
    durationMs: Date.now() - startedAt,
    stdout: String(result.stdout || '').trim().slice(-6000),
    stderr: String(result.stderr || '').trim().slice(-6000)
  });
  if (result.status !== 0) break;
}
const status = results.length === commands.length && results.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL';
const inherited = (() => {
  try {
    const previous = JSON.parse(fs.readFileSync(path.join(root, 'reports/app-27-linear-regression.json'), 'utf8'));
    return Number(previous.inheritedBaselineChecks || 0) + Number(previous.currentPassChecks || 0);
  } catch {
    return 202;
  }
})();
const report = {
  schemaVersion: 'dnd-combat-app28-linear-regression.v1',
  status,
  generatedAt: new Date().toISOString(),
  inheritedBaselineChecks: inherited,
  currentPassChecks: results.filter((entry) => entry.status === 'PASS').length,
  currentPlannedChecks: commands.length,
  results
};
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-28-linear-regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status,
  inheritedBaselineChecks: inherited,
  currentPassChecks: report.currentPassChecks,
  currentPlannedChecks: commands.length,
  failed: results.find((entry) => entry.status === 'FAIL')?.command || null
}, null, 2));
if (status !== 'PASS') process.exit(1);
