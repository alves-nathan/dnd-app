#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const required = [
  'src/catalog/catalogDistribution.ts',
  'src/catalog/catalogDownloadCoordinator.ts',
  'src/storage/catalogDownloadCacheRepository.ts',
  'src/store/catalogDistributionStore.ts',
  'app/catalog-distribution.tsx',
  'src/tests/catalogDistribution.test.ts',
  'scripts/run-app20-runtime-harness.js',
  'scripts/sign-catalog-distribution-manifest.js',
  'docs/CATALOG_RESILIENT_DISTRIBUTION.md',
  '.maestro/flows/51-catalog-download-interruption.yaml',
  '.maestro/flows/52-catalog-download-resume.yaml',
  '.maestro/flows/53-catalog-mirror-conflict.yaml',
  '.maestro/flows/54-catalog-offline-update.yaml'
];
const issues = [];
for (const file of required) if (!fs.existsSync(path.join(root, file))) issues.push(`Arquivo obrigatório ausente: ${file}`);
const core = fs.readFileSync(path.join(root, 'src/catalog/catalogDistribution.ts'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src/store/catalogDistributionStore.ts'), 'utf8');
const screen = fs.readFileSync(path.join(root, 'app/catalog-distribution.tsx'), 'utf8');
for (const token of ['dnd-catalog-distribution-manifest.v1', 'dnd-catalog-download-session.v1', 'dnd-catalog-download-evidence.v1', 'verifySignedCatalogDistributionManifest', 'rankCatalogMirrors', 'finalizeCatalogDownload']) if (!core.includes(token)) issues.push(`Contrato ausente: ${token}`);
for (const token of ['startOrResumeDownload', 'prepareCachedUpdate', 'probeMirrors', 'requestPause']) if (!store.includes(token)) issues.push(`Ação da store ausente: ${token}`);
for (const token of ['catalog-distribution-manifest-import', 'catalog-distribution-policy-mode', 'catalog-download-evidence-share', 'catalog-cache-prepare-']) if (!screen.includes(token)) issues.push(`Controle de interface ausente: ${token}`);
const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
if (!layout.includes('catalog-distribution')) issues.push('A rota de distribuição não foi registrada no Stack.');
const maintenance = fs.readFileSync(path.join(root, 'app/compendium/maintenance.tsx'), 'utf8');
if (!maintenance.includes('/catalog-distribution')) issues.push('A manutenção do Compêndio não expõe a distribuição offline.');
if (!maintenance.includes('open-catalog-distribution')) issues.push('A manutenção do Compêndio não alerta downloads interrompidos ou cache offline.');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const script of ['catalog:distribution:check', 'catalog:distribution:harness', 'catalog:distribution:sign', 'app20:linear']) if (!packageJson.scripts?.[script]) issues.push(`Script npm ausente: ${script}`);
const result = { schemaVersion: 'dnd-combat-app20-contracts.v1', status: issues.length ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), files: required.length, issues };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-20-contracts.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`[catalog:distribution:check] ${result.status}`);
if (issues.length) { issues.forEach((issue) => console.error(`- ${issue}`)); process.exit(1); }
