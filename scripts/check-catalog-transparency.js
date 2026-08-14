#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const required = [
  'src/catalog/catalogTransparency.ts',
  'src/store/catalogTransparencyStore.ts',
  'app/catalog-transparency.tsx',
  'src/tests/catalogTransparency.test.ts',
  'scripts/run-app19-runtime-harness.js',
  '.maestro/flows/47-catalog-transparency-inconsistency.yaml',
  '.maestro/flows/48-catalog-transparency-omission.yaml',
  '.maestro/flows/49-catalog-trust-quorum-recovery.yaml',
  '.maestro/flows/50-catalog-secure-update-manifest.yaml'
];
const issues = [];
for (const file of required) if (!fs.existsSync(path.join(root, file))) issues.push(`Arquivo obrigatório ausente: ${file}`);
const core = fs.readFileSync(path.join(root, 'src/catalog/catalogTransparency.ts'), 'utf8');
const updateStore = fs.readFileSync(path.join(root, 'src/store/catalogUpdateSessionStore.ts'), 'utf8');
const receipt = fs.readFileSync(path.join(root, 'src/catalog/catalogUpdateTransaction.ts'), 'utf8');
const screen = fs.readFileSync(path.join(root, 'app/catalog-transparency.tsx'), 'utf8');
for (const token of ['dnd-catalog-transparency-log.v1', 'createCatalogInclusionProof', 'createCatalogConsistencyProof', 'verifySignedCatalogRemoteManifest', 'dnd-catalog-trust-portable.v1', 'dnd-catalog-recovery-statement.v1']) if (!core.includes(token)) issues.push(`Contrato ausente: ${token}`);
if (!updateStore.includes('appendAcceptedBundle') || !updateStore.includes('assertBundleAllowed')) issues.push('Atualização do catálogo não está protegida pelo registro de transparência.');
if (!updateStore.includes('replaceStateDocument')) issues.push('Rollback não restaura o checkpoint de transparência.');
if (!receipt.includes('transparency?: CatalogTransparencyAnchor')) issues.push('Recibo não preserva prova de inclusão.');
for (const token of ['catalog-remote-manifest-verify', 'catalog-remote-log-compare', 'catalog-trust-import-preview', 'catalog-recovery-apply']) if (!screen.includes(token)) issues.push(`Controle de interface ausente: ${token}`);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const script of ['catalog:transparency:check', 'catalog:transparency:harness', 'app19:linear']) if (!packageJson.scripts?.[script]) issues.push(`Script npm ausente: ${script}`);
const result = { schemaVersion: 'dnd-combat-app19-contracts.v1', status: issues.length ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), files: required.length, issues };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-19-contracts.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`[catalog:transparency:check] ${result.status}`);
if (issues.length) { issues.forEach((issue) => console.error(`- ${issue}`)); process.exit(1); }
