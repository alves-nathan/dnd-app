#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnEas } = require('./lib/eas-cli-command');
const { evaluateApp29Evidence } = require('./lib/app29-release-candidate-evidence');
const { evaluateApp28Evidence } = require('./lib/app28-integral-gate-evidence');
const { evaluateProductionIdentity } = require('./lib/app30-production-release-evidence');
const root = path.resolve(__dirname, '..');
const execute = process.argv.includes('--execute');
const errors = [];
const read = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const app28 = read(path.join(root, 'artifacts/app28-integral-gate.json'));
const app29 = read(path.join(root, 'artifacts/app29-release-candidate.json'));
const app28Result = app28 ? evaluateApp28Evidence(app28, { root, requireGitMatch: false, minimumMaestroFlows: 83 }) : { valid: false, errors: ['APP-28 ausente.'] };
const app29Result = app29 ? evaluateApp29Evidence(app29, { root, requireGitMatch: false, minimumMaestroFlows: 83 }) : { valid: false, errors: ['APP-29 ausente.'] };
const identity = evaluateProductionIdentity(root);
if (!app28Result.valid) errors.push(...app28Result.errors.map((entry) => `APP-28: ${entry}`));
if (!app29Result.valid) errors.push(...app29Result.errors.map((entry) => `APP-29: ${entry}`));
if (!identity.valid) errors.push(...identity.errors.map((entry) => `Identidade: ${entry}`));
if (!execute) errors.push('Execução não autorizada; informe --execute após revisar os gates.');
if (errors.length) { console.error(JSON.stringify({ status: 'BLOCKED', errors }, null, 2)); process.exit(1); }
const { result } = spawnEas(root, ['build', '--platform', 'android', '--profile', 'production', '--non-interactive'], { spawnOptions: { stdio: 'inherit' } });
process.exit(result.status ?? 1);
