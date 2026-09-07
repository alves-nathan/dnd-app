#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const errors = [];
const read = (relative) => {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) { errors.push(`${relative}: arquivo ausente`); return ''; }
  return fs.readFileSync(absolute, 'utf8');
};
const mustContain = (relative, snippets) => {
  const content = read(relative);
  snippets.forEach((snippet) => { if (content && !content.includes(snippet)) errors.push(`${relative}: contrato ausente (${snippet})`); });
};
mustContain('src/catalog/catalogUpdateTransaction.ts', [
  'dnd-catalog-update-session.v1',
  'dnd-catalog-update-receipt.v1',
  'parseAndValidateCatalogCandidate',
  'compareCatalogSnapshots',
  'buildCatalogUpdateImpact',
  'projectCatalogFilterState',
  'canCommitCatalogUpdate',
  'migrateCharacterCatalogSnapshots',
  'validateCatalogUpdateReceipt'
]);
mustContain('src/storage/catalogPackageRepository.ts', [
  'dnd-catalog-package-index.v1',
  'CHUNK_SIZE',
  'stage:',
  'activate:',
  'restoreActive:',
  'readPackage'
]);
mustContain('src/store/catalogStore.ts', ['runtimeRef', 'switchRuntimeCatalog', 'packages.loadActive', 'packages.activate']);
const updateStore = read('src/store/catalogUpdateSessionStore.ts');
if (!/CATALOG_UPDATE_SESSION_STORE_VERSION = [1-9][0-9]*/.test(updateStore)) errors.push('src/store/catalogUpdateSessionStore.ts: versão persistida inválida');
mustContain('src/store/catalogUpdateSessionStore.ts', [
  'prepareCandidate',
  'resumeCommit',
  'packageActivated',
  'charactersMigrated',
  'rollback',
  'createCatalogUpdateReceipt'
]);
mustContain('app/catalog-update.tsx', [
  'Atualização do catálogo',
  'catalog-update-prepare',
  'catalog-update-migrate-all',
  'catalog-update-commit',
  'catalog-update-rollback',
  'Impacto preventivo'
]);
mustContain('app/compendium/maintenance.tsx', ['Atualizar catálogo', 'open-catalog-update-session']);
mustContain('app/_layout.tsx', ['catalog-update']);
mustContain('app/e2e-seed.tsx', ['e2e-seed-catalog-update', 'prepareCatalogUpdateScenario']);
mustContain('scripts/run-app17-runtime-harness.js', ['app-17-runtime-harness.json', '5841', '5842', '43']);
const pkg = JSON.parse(read('package.json') || '{}');
for (const script of ['catalog:update:check', 'catalog:update:harness', 'test:catalog-update', 'app17:smoke', 'app17:native:gate']) {
  if (!pkg.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
}
const flowDirectory = path.join(root, '.maestro/flows');
const flows = [39, 40, 41, 42].map((number) => fs.readdirSync(flowDirectory).find((name) => name.startsWith(`${number}-`))).filter(Boolean);
if (flows.length !== 4) errors.push(`esperado 4 fluxos Maestro APP-17, encontrado ${flows.length}`);
const gate = read('scripts/run-app06-native-gate.js');
if (!gate.includes('42-catalog-update-rollback.yaml')) errors.push('gate nativo não inclui o fluxo 42');
const flowCount = (gate.match(/\.maestro\/flows\//g) || []).length;
if (flowCount < 35) errors.push(`gate nativo deveria reconhecer ao menos 35 fluxos, encontrado ${flowCount}`);
if (errors.length) {
  console.error('[catalog:update:check] FAIL');
  errors.forEach((entry) => console.error(`- ${entry}`));
  process.exit(1);
}
console.log('[catalog:update:check] PASS');
console.log('sessionSchema=dnd-catalog-update-session.v1');
console.log('receiptSchema=dnd-catalog-update-receipt.v1');
console.log(`nativeGateFlows=${flowCount}`);
