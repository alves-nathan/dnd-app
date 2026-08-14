#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const errors = [];
const read = (file) => {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) { errors.push(`${file}: arquivo ausente`); return ''; }
  return fs.readFileSync(absolute, 'utf8');
};
const contracts = [
  ['src/catalog/catalogConfigurationHistory.ts', [
    'dnd-catalog-configuration-commit.v1',
    'createCatalogConfigurationHistoryEntry',
    'diffCatalogFilterStates',
    'restoredFromCommitId',
    'Usuário local'
  ]],
  ['src/storage/catalogFilterPreferences.ts', [
    'history?: CatalogConfigurationHistoryEntry[]',
    'revision?: number',
    'historyEntry',
    'slice(-50)'
  ]],
  ['src/store/catalogStore.ts', [
    'previewHistoryRestore',
    "origin: CatalogConfigurationCommitOrigin",
    'history: restored.history',
    'historyEntryId'
  ]],
  ['app/catalog-history.tsx', [
    'Histórico do catálogo',
    'Restaurar configuração anterior',
    'Reaplicar estado deste commit',
    'Nenhum estado anterior é aplicado silenciosamente'
  ]],
  ['app/content-management.tsx', [
    'Histórico transacional',
    'catalog-history-restoration-preview',
    'reconcilePreventiveCompatibilityPlans',
    'obsoletePreventivePlanCharacterIds'
  ]],
  ['app/e2e-seed.tsx', [
    'prepareCatalogHistoryScenario',
    'e2e-seed-catalog-history'
  ]],
  ['scripts/run-app06-native-gate.js', [
    '19-catalog-history-view.yaml',
    '20-catalog-history-restore-cancel.yaml',
    '21-catalog-history-restore-commit.yaml',
    '22-catalog-history-plan-revalidation.yaml'
  ]]
];
for (const [file, snippets] of contracts) {
  const content = read(file);
  for (const snippet of snippets) if (content && !content.includes(snippet)) errors.push(`${file}: contrato ausente (${snippet})`);
}
for (const flow of ['19-catalog-history-view.yaml', '20-catalog-history-restore-cancel.yaml', '21-catalog-history-restore-commit.yaml', '22-catalog-history-plan-revalidation.yaml']) {
  const content = read(`.maestro/flows/${flow}`);
  if (content && !content.includes('e2e-seed-catalog-history')) errors.push(`${flow}: fixture de histórico ausente`);
}
const packageJson = JSON.parse(read('package.json') || '{}');
for (const script of ['catalog:configuration-history:check', 'catalog:configuration-history:harness', 'app12:smoke', 'app12:native:gate']) {
  if (!packageJson.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
}
if (errors.length) {
  console.error('[catalog:configuration-history:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('[catalog:configuration-history:check] PASS');
console.log('historySchema=dnd-catalog-configuration-commit.v1');
console.log('nativeGateFlows=15');
