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
  ['src/characters/compatibilityRemediation.ts', ['dnd-character-compatibility-remediation.v1', 'previewCompatibilityRemediation', 'removeCompatibilityReference', 'COMPATIBILITY_REMEDIATION_INCOMPLETE', 'listCompatibilityReplacementCandidates']],
  ['src/characters/characterCompatibility.ts', ['linkId?: string', 'appliedAs?: CharacterCompendiumLink', 'appliedEntityId?: string']],
  ['src/store/characterStore.ts', ['compatibilityRemediationPlans', 'commitCompatibilityRemediationPlan', "kind: 'compatibilityRemediation'"]],
  ['src/types/index.ts', ["'compatibilityRemediation'"]],
  ['src/storage/characterMigrations.ts', ['CHARACTER_STORE_VERSION = 25', 'compatibilityRemediationPlans']],
  ['app/characters/[id]/compatibility.tsx', ['Criar plano de remediação', 'Confirmar em uma única transação', 'Descartar plano', 'Substituir por']],
  ['src/tests/characterCompatibilityRemediation.test.ts', ['APP-09 compatibility remediation', 'commits atomically with rollback']],
  ['scripts/run-app09-runtime-harness.js', ['compatibilityRemediation', 'rollbackProgressionAudit', 'afterReport.blockingIssueCount']]
];
for (const [file, snippets] of contracts) {
  const content = read(file);
  for (const snippet of snippets) if (content && !content.includes(snippet)) errors.push(`${file}: contrato ausente (${snippet})`);
}
const packageJson = JSON.parse(read('package.json') || '{}');
for (const script of ['catalog:compatibility-remediation:check', 'catalog:compatibility-remediation:harness', 'app09:smoke']) {
  if (!packageJson.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
}
if (errors.length) {
  console.error('[catalog:compatibility-remediation:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('[catalog:compatibility-remediation:check] PASS');
console.log('remediationSchema=dnd-character-compatibility-remediation.v1');
console.log('characterStoreVersion=25');
