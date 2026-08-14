#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'src/releaseDelivery/productionReleaseDelivery.ts',
  'src/tests/productionReleaseDelivery.test.ts',
  'app/production-release.tsx',
  'scripts/lib/app30-production-release-evidence.js',
  'scripts/check-app30-operational-docs.js',
  'scripts/run-app30-production-release.js',
  'scripts/verify-app30-production-release.js',
  'scripts/create-app30-delivery-package.js',
  'scripts/build-app30-production-android.js',
  'scripts/submit-app30-production-android.js',
  'docs/production/APP30_RELEASE_RUNBOOK.md',
  'docs/production/OPERATIONS_HANDBOOK.md',
  'docs/production/INCIDENT_ROLLBACK_PLAYBOOK.md',
  'docs/production/PRIVACY_DATA_HANDLING.md',
  'docs/production/SUPPORT_CHECKLIST.md',
  'docs/production/STORE_LISTING_PT_BR.md',
  'docs/production/RELEASE_NOTES_1.0.0.md',
  'docs/production/DELIVERY_INDEX.md'
];
const issues = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file))).map((file) => `Arquivo ausente: ${file}`);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const script of ['app30:check','app30:docs','app30:typecheck:isolated','app30:gate','app30:verify','app30:prepare','app30:delivery','app30:build:android','app30:submit:android','app30:linear']) {
  if (!packageJson.scripts?.[script]) issues.push(`Script npm ausente: ${script}`);
}
const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
if (!layout.includes('name="production-release"')) issues.push('Rota production-release não registrada.');
const settings = fs.readFileSync(path.join(root, 'app/settings.tsx'), 'utf8');
if (!settings.includes("router.push('/production-release')")) issues.push('Acesso ao APP-30 ausente em Ajustes.');
const nativeGate = fs.readFileSync(path.join(root, 'scripts/run-app06-native-gate.js'), 'utf8');
for (const flow of ['87-production-release-overview.yaml','88-production-release-gates.yaml','89-production-release-build.yaml','90-production-release-publication.yaml']) {
  if (!nativeGate.includes(flow)) issues.push(`Fluxo APP-30 não exigido pelo gate nativo: ${flow}`);
}
const report = { schemaVersion: 'dnd-combat-app30-contract-check.v1', status: issues.length ? 'FAIL' : 'PASS', generatedAt: new Date().toISOString(), requiredFiles: requiredFiles.length, issues };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-30-contract-check.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exit(1);
