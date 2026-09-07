#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const required = [
  'src/catalog/catalogRolloutHealth.ts',
  'src/store/catalogRolloutHealthStore.ts',
  'app/catalog-rollout-health.tsx',
  'src/tests/catalogRolloutHealth.test.ts',
  'scripts/sign-catalog-rollout-health-policy.js',
  'scripts/sign-catalog-rollout-directive.js',
  'scripts/run-app22-runtime-harness.js',
  '.maestro/flows/59-rollout-health-opt-in.yaml',
  '.maestro/flows/60-rollout-health-unhealthy.yaml',
  '.maestro/flows/61-rollout-health-promotion.yaml',
  '.maestro/flows/62-rollout-health-rollback.yaml'
];
const issues = [];
for (const file of required) if (!fs.existsSync(path.join(root, file))) issues.push(`Arquivo obrigatório ausente: ${file}`);
const core = fs.readFileSync(path.join(root, 'src/catalog/catalogRolloutHealth.ts'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src/store/catalogRolloutHealthStore.ts'), 'utf8');
const publication = fs.readFileSync(path.join(root, 'src/catalog/catalogPublication.ts'), 'utf8');
const publicationStore = fs.readFileSync(path.join(root, 'src/store/catalogPublicationStore.ts'), 'utf8');
const distributionStore = fs.readFileSync(path.join(root, 'src/store/catalogDistributionStore.ts'), 'utf8');
const updateStore = fs.readFileSync(path.join(root, 'src/store/catalogUpdateSessionStore.ts'), 'utf8');
const screen = fs.readFileSync(path.join(root, 'app/catalog-rollout-health.tsx'), 'utf8');
const maintenance = fs.readFileSync(path.join(root, 'app/compendium/maintenance.tsx'), 'utf8');
const publicationScreen = fs.readFileSync(path.join(root, 'app/catalog-publication.tsx'), 'utf8');
for (const token of ['dnd-catalog-rollout-health-policy.v1', 'dnd-catalog-rollout-health-evidence.v1', 'dnd-catalog-rollout-directive.v1', 'createCatalogRolloutHealthEvidence', 'verifySignedCatalogRolloutDirective', 'resolveEffectiveCatalogRollout', 'preview', 'beta', 'stable']) if (!core.includes(token)) issues.push(`Contrato de saúde ausente: ${token}`);
for (const token of ['sharingOptIn', 'importPolicy', 'importDirective', 'recordSignal', 'generateEvidence', 'effectiveRolloutFor']) if (!store.includes(token)) issues.push(`Store de saúde incompleta: ${token}`);
if (!publication.includes('rolloutPercentOverride') || !publication.includes('rolloutDirectiveId')) issues.push('A elegibilidade não considera diretrizes assinadas.');
if (!publicationStore.includes('useCatalogRolloutHealthStore') || !publicationStore.includes('effectiveRolloutFor')) issues.push('A store de publicação não aplica o rollout efetivo.');
for (const token of ['downloadStarted', 'downloadSucceeded', 'downloadFailed', 'integrityFailed', 'previewOpened']) if (!distributionStore.includes(token)) issues.push(`Distribuição não registra métrica: ${token}`);
for (const token of ['commitSucceeded', 'commitFailed', 'rollbackCompleted']) if (!updateStore.includes(token)) issues.push(`Atualização não registra métrica: ${token}`);
for (const token of ['rollout-health-opt-in', 'rollout-health-policy-import', 'rollout-health-directive-import', 'rollout-health-evidence-share']) if (!screen.includes(token)) issues.push(`Controle de interface ausente: ${token}`);
if (!maintenance.includes('/catalog-rollout-health')) issues.push('A manutenção do Compêndio não expõe a saúde do rollout.');
if (!publicationScreen.includes('open-rollout-health')) issues.push('A tela de publicação não expõe a saúde do rollout.');
if (store.includes('prepareCandidate(') || core.includes('prepareCandidate(') || core.includes('startOrResumeDownload(')) issues.push('A camada de saúde não pode aplicar ou baixar catálogos automaticamente.');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const script of ['catalog:rollout-health:check', 'catalog:rollout-health:harness', 'catalog:rollout-health:policy:sign', 'catalog:rollout:directive:sign', 'app22:linear']) if (!packageJson.scripts?.[script]) issues.push(`Script npm ausente: ${script}`);
const privatePatterns = [/"d"\s*:\s*"[A-Za-z0-9_-]{30,}"/, /BEGIN (EC |RSA )?PRIVATE KEY/];
for (const file of fs.readdirSync(root)) {
  const full = path.join(root, file);
  if (fs.statSync(full).isFile() && privatePatterns.some((pattern) => pattern.test(fs.readFileSync(full, 'utf8')))) issues.push(`Material privado detectado na raiz: ${file}`);
}
const result = { schemaVersion: 'dnd-combat-app22-contracts.v1', status: issues.length ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), files: required.length, issues };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-22-contracts.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`[catalog:rollout-health:check] ${result.status}`);
if (issues.length) { issues.forEach((issue) => console.error(`- ${issue}`)); process.exit(1); }
