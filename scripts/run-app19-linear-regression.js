#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const commands = ['run-app18-linear-regression.js', 'check-catalog-transparency.js', 'run-app19-runtime-harness.js'];
const results = [];
for (const command of commands) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', command)], { cwd: root, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  results.push({ command, status: result.status === 0 ? 'PASS' : 'FAIL', durationMs: Date.now() - started, stdout: String(result.stdout || '').trim().slice(-2000), stderr: String(result.stderr || '').trim().slice(-2000) });
  if (result.status !== 0) break;
}
const inherited = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'reports/app-18-linear-regression.json'), 'utf8')).commands || 0; } catch { return 0; } })();
const status = results.length === commands.length && results.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL';
const report = { schemaVersion: 'dnd-combat-app19-linear-regression.v1', status, generatedAt: new Date().toISOString(), inheritedChecks: inherited, app19Checks: 2, totalChecks: inherited + 2, results };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-19-linear-regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status, inheritedChecks: inherited, app19Checks: 2, totalChecks: inherited + 2, failed: results.find((entry) => entry.status === 'FAIL')?.command }, null, 2));
if (status !== 'PASS') process.exit(1);
