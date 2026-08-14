#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const errors = [];
const read = (relativePath) => {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) { errors.push(`${relativePath}: arquivo ausente`); return ''; }
  return fs.readFileSync(absolute, 'utf8');
};
const contracts = [
  ['src/characters/catalogChangeImpact.ts', [
    'dnd-catalog-character-impact.v1',
    'buildCatalogChangeCharacterImpact',
    'createPreventiveCompatibilityPlans',
    'requiresAcknowledgement',
    'reportBefore',
    'reportAfter'
  ]],
  ['src/characters/compatibilityRemediation.ts', [
    "'preventiveCatalogChange'",
    'preventiveContext',
    "origin: params.origin ?? 'diagnostic'"
  ]],
  ['app/content-management.tsx', [
    'Preview preventivo',
    'Reconheço o impacto nas fichas',
    'Aplicar e iniciar planos preventivos',
    'catalog-impact-acknowledgement',
    'buildCatalogChangeCharacterImpact'
  ]],
  ['app/e2e-seed.tsx', [
    'prepareCatalogImpactScenario',
    'e2e-seed-catalog-impact',
    'phb-2024-spell-acid-splash'
  ]],
  ['scripts/run-app11-runtime-harness.js', [
    'newlyBlockedCharacters',
    'automaticDecisions',
    'reverseActivationAffectedCharacters'
  ]],
  ['scripts/run-app06-native-gate.js', [
    '16-catalog-impact-preview.yaml',
    '17-catalog-impact-cancel.yaml',
    '18-catalog-impact-remediation.yaml'
  ]]
];
for (const [file, snippets] of contracts) {
  const content = read(file);
  for (const snippet of snippets) if (content && !content.includes(snippet)) errors.push(`${file}: contrato ausente (${snippet})`);
}
for (const flow of ['16-catalog-impact-preview.yaml', '17-catalog-impact-cancel.yaml', '18-catalog-impact-remediation.yaml']) {
  const content = read(`.maestro/flows/${flow}`);
  if (content && !content.includes('e2e-seed-catalog-impact')) errors.push(`${flow}: fixture preventiva ausente`);
}
const packageJson = JSON.parse(read('package.json') || '{}');
for (const script of ['catalog:character-impact:check', 'catalog:character-impact:harness', 'app11:smoke', 'app11:native:gate']) {
  if (!packageJson.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
}
if (errors.length) {
  console.error('[catalog:character-impact:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('[catalog:character-impact:check] PASS');
console.log('preventiveFlows=3');
console.log('nativeGateFlows=11');
