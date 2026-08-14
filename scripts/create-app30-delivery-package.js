#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sha256File } = require('./lib/app30-production-release-evidence');
const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const outputDir = path.join(root, 'artifacts/app30-delivery');
fs.mkdirSync(outputDir, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-app30-delivery-'));
const packageRoot = path.join(temp, `dnd-combat-${app.version}-operational-delivery`);
fs.mkdirSync(packageRoot, { recursive: true });
const requested = [
  'app.json', 'eas.json', 'package.json', 'package-lock.json',
  'docs/production/APP30_RELEASE_RUNBOOK.md',
  'docs/production/OPERATIONS_HANDBOOK.md',
  'docs/production/INCIDENT_ROLLBACK_PLAYBOOK.md',
  'docs/production/PRIVACY_DATA_HANDLING.md',
  'docs/production/SUPPORT_CHECKLIST.md',
  'docs/production/STORE_LISTING_PT_BR.md',
  'docs/production/RELEASE_NOTES_1.0.0.md',
  'docs/production/DELIVERY_INDEX.md',
  'APP28_INTEGRAL_GATE_REPORT.md',
  'APP29_RELEASE_CANDIDATE_HARDENING_REPORT.md',
  'artifacts/app28-integral-gate.json',
  'artifacts/app29-release-candidate.json',
  'reports/app-29-security-hardening.json',
  'reports/app-29-migration-contracts.json',
  'reports/app-29-install-upgrade-rehearsal.json',
  'reports/app-29-performance-benchmark.json'
];
const included = [];
for (const relative of requested) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
  const destination = path.join(packageRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  included.push({ path: relative, bytes: fs.statSync(source).size, sha256: sha256File(source) });
}
const manifest = {
  schemaVersion: 'dnd-combat-app30-delivery-package.v1',
  generatedAt: new Date().toISOString(),
  app: { name: app.name, version: app.version, androidPackage: app.android?.package, iosBundleIdentifier: app.ios?.bundleIdentifier },
  scope: 'operational-handoff',
  containsProductionBinary: false,
  containsPrivateMaterial: false,
  files: included
};
fs.writeFileSync(path.join(packageRoot, 'delivery-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const output = path.join(outputDir, `dnd-combat-${app.version}-operational-delivery.zip`);
fs.rmSync(output, { force: true });
const zip = spawnSync('zip', ['-q', '-r', output, path.basename(packageRoot)], { cwd: temp, encoding: 'utf8' });
if (zip.status !== 0) {
  console.error(zip.stderr || zip.stdout || 'Falha ao criar o pacote de entrega.');
  fs.rmSync(temp, { recursive: true, force: true });
  process.exit(1);
}
const report = {
  schemaVersion: 'dnd-combat-app30-delivery-package-result.v1',
  status: 'PASS',
  generatedAt: new Date().toISOString(),
  package: { path: path.relative(root, output).replaceAll(path.sep, '/'), bytes: fs.statSync(output).size, sha256: sha256File(output) },
  fileCount: included.length + 1,
  containsProductionBinary: false,
  containsPrivateMaterial: false
};
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-30-delivery-package.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
fs.rmSync(temp, { recursive: true, force: true });
