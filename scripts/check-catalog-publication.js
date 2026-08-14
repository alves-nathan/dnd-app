#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const required = [
  'src/catalog/catalogPublication.ts',
  'src/store/catalogPublicationStore.ts',
  'src/config/appMetadata.ts',
  'app/catalog-publication.tsx',
  'src/tests/catalogPublication.test.ts',
  'scripts/sign-catalog-publication.js',
  'scripts/sign-catalog-publication-control.js',
  'scripts/run-app21-runtime-harness.js',
  '.maestro/flows/55-catalog-channel-migration.yaml',
  '.maestro/flows/56-catalog-rollout-eligibility.yaml',
  '.maestro/flows/57-catalog-publication-paused.yaml',
  '.maestro/flows/58-catalog-publication-withdrawn.yaml'
];
const issues = [];
for (const file of required) if (!fs.existsSync(path.join(root, file))) issues.push(`Arquivo obrigatório ausente: ${file}`);
const core = fs.readFileSync(path.join(root, 'src/catalog/catalogPublication.ts'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src/store/catalogPublicationStore.ts'), 'utf8');
const distributionStore = fs.readFileSync(path.join(root, 'src/store/catalogDistributionStore.ts'), 'utf8');
const screen = fs.readFileSync(path.join(root, 'app/catalog-publication.tsx'), 'utf8');
const home = fs.readFileSync(path.join(root, 'app/index.tsx'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'app/settings.tsx'), 'utf8');
for (const token of ['dnd-catalog-publication.v1', 'dnd-catalog-publication-control.v1', 'dnd-catalog-publication-eligibility.v1', 'stable', 'beta', 'preview', 'calculateCatalogCohortScore', 'evaluateCatalogPublicationEligibility', 'verifySignedCatalogPublicationControl']) if (!core.includes(token)) issues.push(`Contrato ausente: ${token}`);
for (const token of ['selectedChannel', 'cohortId', 'setSelectedChannel', 'importPublication', 'importControl', 'assertDistributionEligible']) if (!store.includes(token)) issues.push(`Store de publicação incompleta: ${token}`);
if (!distributionStore.includes('assertDistributionEligible')) issues.push('Download e cache não estão protegidos pela elegibilidade da publicação.');
for (const token of ['catalog-channel-${channel}', 'catalog-publication-import', 'catalog-publication-control-import', 'catalog-publication-evidence-share']) if (!screen.includes(token)) issues.push(`Controle de interface ausente: ${token}`);
if (!home.includes('open-catalog-publication')) issues.push('A Home não expõe publicações elegíveis.');
if (!settings.includes('/catalog-publication')) issues.push('Ajustes não expõe canais e rollout.');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const script of ['catalog:publication:check', 'catalog:publication:harness', 'catalog:publication:sign', 'catalog:publication:control:sign', 'app21:linear']) if (!packageJson.scripts?.[script]) issues.push(`Script npm ausente: ${script}`);
const appVersion = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo.version;
const metadata = fs.readFileSync(path.join(root, 'src/config/appMetadata.ts'), 'utf8').match(/CURRENT_APP_VERSION\s*=\s*'([^']+)'/)?.[1];
if (appVersion !== metadata) issues.push(`Versão do app divergente: app.json=${appVersion}, metadata=${metadata || 'ausente'}`);
if (store.includes('prepareCandidate(') || core.includes('prepareCandidate(')) issues.push('A camada de publicação não pode aplicar automaticamente um catálogo.');
const result = { schemaVersion: 'dnd-combat-app21-contracts.v1', status: issues.length ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), files: required.length, issues };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-21-contracts.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`[catalog:publication:check] ${result.status}`);
if (issues.length) { issues.forEach((issue) => console.error(`- ${issue}`)); process.exit(1); }
