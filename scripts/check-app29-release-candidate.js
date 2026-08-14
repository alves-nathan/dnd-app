#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'src/releaseCandidate/persistenceMigrations.ts',
  'src/releaseCandidate/releaseCandidateHardening.ts',
  'app/release-candidate.tsx',
  'scripts/check-app29-security-hardening.js',
  'scripts/check-app29-migration-contracts.js',
  'scripts/run-app29-install-upgrade-rehearsal.js',
  'scripts/run-app29-performance-benchmark.js',
  'scripts/run-app29-release-candidate.js',
  'scripts/verify-app29-release-candidate.js',
  'docs/release-candidate/APP29_RUNBOOK.md'
];
const issues = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file))).map((file) => `Arquivo ausente: ${file}`);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const script of ['app29:check','app29:security','app29:migrations','app29:rehearsal','app29:performance','app29:private-scan','app29:gate','app29:gate:verify','app29:linear']) {
  if (!packageJson.scripts?.[script]) issues.push(`Script npm ausente: ${script}`);
}
const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
if (!layout.includes('name="release-candidate"')) issues.push('Rota release-candidate não registrada.');
const settings = fs.readFileSync(path.join(root, 'app/settings.tsx'), 'utf8');
if (!settings.includes("router.push('/release-candidate')")) issues.push('Acesso ao APP-29 ausente em Ajustes.');
const gate = fs.readFileSync(path.join(root, 'scripts/lib/app29-release-candidate-evidence.js'), 'utf8');
for (const invariant of ['minimumMaestroFlows = 83', 'evaluateApp28Evidence', 'report.status !== \'PASS\'']) if (!gate.includes(invariant)) issues.push(`Invariante do gate ausente: ${invariant}`);
const status = issues.length ? 'FAIL' : 'PASS';
const report = { schemaVersion: 'dnd-combat-app29-contract-check.v1', status, generatedAt: new Date().toISOString(), requiredFiles: requiredFiles.length, issues };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-29-contract-check.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exit(1);
