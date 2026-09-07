#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'src/catalog/catalogRolloutAggregation.ts',
  'src/store/catalogRolloutAggregationStore.ts',
  'src/tests/catalogRolloutAggregation.test.ts',
  'app/catalog-rollout-aggregation.tsx',
  'scripts/run-app23-runtime-harness.js',
  'scripts/sign-catalog-rollout-aggregation-policy.js',
  'scripts/aggregate-catalog-rollout-health.js',
  'scripts/sign-catalog-release-approval.js',
  'docs/CATALOG_ROLLOUT_AGGREGATION_AND_QUORUM.md'
];
const issues = [];
for (const relative of requiredFiles) if (!fs.existsSync(path.join(root, relative))) issues.push(`Arquivo ausente: ${relative}`);
const core = fs.readFileSync(path.join(root, 'src/catalog/catalogRolloutAggregation.ts'), 'utf8');
for (const token of ['dnd-catalog-rollout-health-submission.v1', 'dnd-catalog-rollout-aggregation-policy.v1', 'dnd-catalog-rollout-aggregate-report.v1', 'dnd-catalog-release-approval.v1', 'dnd-catalog-release-quorum-decision.v1', 'minimumUniqueContributors', 'minimumCohortContributors', 'automaticExecution: false', 'createCatalogReleaseQuorumDecision']) if (!core.includes(token)) issues.push(`Contrato APP-23 ausente: ${token}`);
const ui = fs.readFileSync(path.join(root, 'app/catalog-rollout-aggregation.tsx'), 'utf8');
for (const token of ['Agregação e decisão em quórum', 'Gerar contribuição anônima', 'Avaliar quórum', 'Nenhuma decisão executa']) if (!ui.includes(token)) issues.push(`Contrato de UI APP-23 ausente: ${token}`);
const maintenance = fs.readFileSync(path.join(root, 'app/compendium/maintenance.tsx'), 'utf8');
if (!maintenance.includes('/catalog-rollout-aggregation')) issues.push('A manutenção do Compêndio não expõe a central APP-23.');
const gate = fs.readFileSync(path.join(root, 'scripts/run-app06-native-gate.js'), 'utf8');
for (const flow of ['63-rollout-aggregation-export.yaml', '64-rollout-aggregation-anonymity.yaml', '65-rollout-quorum-pending.yaml', '66-rollout-quorum-approved.yaml']) if (!gate.includes(flow)) issues.push(`Gate nativo não reconhece ${flow}.`);
const report = { schemaVersion: 'dnd-combat-app23-contracts.v1', status: issues.length ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), files: requiredFiles.length, issues };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-23-contracts.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exit(1);
