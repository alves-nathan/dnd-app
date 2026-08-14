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
  ['src/characters/compatibilityRemediationRecovery.ts', ['COMPATIBILITY_PLAN_RECOVERED', 'COMPATIBILITY_PLAN_CONFLICT', 'COMPATIBILITY_PLAN_CATALOG_STALE', 'reconcileCompatibilityRemediationRecovery', 'acknowledgeCompatibilityRemediationRecovery']],
  ['src/characters/compatibilityRemediationBatch.ts', ['buildCompatibilityRemediationBatchOverview', 'activePlans', 'readyPlans', 'activePlanCount']],
  ['src/store/characterStore.ts', ['compatibilityRemediationRecovery', 'compatibilityRemediationQuarantine', 'acknowledgeCompatibilityRemediationPlan', 'dismissCompatibilityRemediationQuarantine']],
  ['src/storage/characterMigrations.ts', ['CHARACTER_STORE_VERSION = 24', 'compatibilityRemediationRecovery', 'compatibilityRemediationQuarantine']],
  ['app/character-compatibility.tsx', ['Resumo agregado', 'Recuperação de planos', 'Ocorrências compartilhadas', 'Confirmar somente este personagem', 'Planos em quarentena']],
  ['app/characters/[id]/compatibility.tsx', ['Plano recuperado', 'Retomar com segurança', 'planEditable']],
  ['app/e2e-seed.tsx', ['prepareCompatibilityScenario', 'e2e-seed-remediation-create', 'e2e-seed-remediation-rollback']],
  ['scripts/run-app06-native-gate.js', ['12-remediation-plan-create.yaml', '15-remediation-plan-rollback.yaml']],
  ['scripts/run-app10-runtime-harness.js', ['sharedEntityCharacters', 'independentCommit', 'staleCatalogCharacterIds']]
];
for (const [file, snippets] of contracts) {
  const content = read(file);
  for (const snippet of snippets) if (content && !content.includes(snippet)) errors.push(`${file}: contrato ausente (${snippet})`);
}
for (const flow of ['12-remediation-plan-create.yaml', '13-remediation-plan-discard.yaml', '14-remediation-plan-commit.yaml', '15-remediation-plan-rollback.yaml']) {
  const content = read(`.maestro/flows/${flow}`);
  if (content && !content.includes('e2e-compatibility-remediation')) errors.push(`${flow}: fixture de remediação ausente`);
}
const packageJson = JSON.parse(read('package.json') || '{}');
for (const script of ['catalog:compatibility-remediation-recovery:check', 'catalog:compatibility-remediation-recovery:harness', 'app10:smoke', 'app10:native:gate']) {
  if (!packageJson.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
}
if (errors.length) {
  console.error('[catalog:compatibility-remediation-recovery:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('[catalog:compatibility-remediation-recovery:check] PASS');
console.log('storeVersion=24');
console.log('maestroFlows=4');
