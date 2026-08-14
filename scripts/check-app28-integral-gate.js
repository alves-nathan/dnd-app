#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const issues = [];
const requiredFiles = [
  'scripts/lib/app28-integral-gate-evidence.js',
  'scripts/install-app28-dependencies.js',
  'scripts/run-app28-integral-gate.js',
  'scripts/verify-app28-integral-gate.js',
  'scripts/run-app28-runtime-harness.js',
  'docs/APP28_INTEGRAL_GATE.md'
];
for (const relative of requiredFiles) if (!fs.existsSync(path.join(root, relative))) issues.push(`Arquivo ausente: ${relative}`);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const name of ['app28:dependencies:install','app28:dependencies:diagnose','app28:gate','app28:gate:diagnose','app28:gate:verify','app28:linear','app28:validate']) {
  if (!pkg.scripts?.[name]) issues.push(`Script npm ausente: ${name}`);
}
const build = fs.readFileSync(path.join(root, 'scripts/build-android-beta-candidate.js'), 'utf8');
for (const token of ['verify-app28-integral-gate.js','app28-integral-gate.json','Gate APP-28']) if (!build.includes(token)) issues.push(`Build candidate não exige APP-28: ${token}`);
const beta = fs.readFileSync(path.join(root, 'scripts/run-beta-local-gate.js'), 'utf8');
if (!beta.includes('app28.gate')) issues.push('Beta local gate não verifica APP-28.');
const gate = fs.readFileSync(path.join(root, 'scripts/run-app28-integral-gate.js'), 'utf8');
for (const token of ['full-typecheck','full-jest','native-gate','packageLockSha256','execute-native']) if (!gate.includes(token)) issues.push(`Contrato ausente no gate: ${token}`);
const verifier = fs.readFileSync(path.join(root, 'scripts/lib/app28-integral-gate-evidence.js'), 'utf8');
for (const token of ['minimumMaestroFlows','appVersionMatches','JUnit','package-lock.json']) if (!verifier.includes(token)) issues.push(`Contrato ausente no verificador: ${token}`);
const flows = fs.readdirSync(path.join(root, '.maestro/flows')).filter((entry) => entry.endsWith('.yaml'));
if (flows.length < 75) issues.push(`Quantidade de fluxos Maestro insuficiente: ${flows.length}/75.`);
const report = {
  schemaVersion: 'dnd-combat-app28-contracts.v1',
  status: issues.length ? 'FAIL' : 'PASS',
  generatedAt: new Date().toISOString(),
  requiredFiles: requiredFiles.length,
  maestroFlows: flows.length,
  issues
};
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-28-contracts.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exit(1);
