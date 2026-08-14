#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const issues = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const requiredFiles = [
  'src/catalog/catalogOperationalAuthorization.ts',
  'src/store/catalogOperationalAuthorizationStore.ts',
  'app/catalog-operational-authorization.tsx',
  'src/tests/catalogOperationalAuthorization.test.ts',
  'scripts/run-app24-runtime-harness.js',
  'scripts/sign-catalog-operational-authorization.js',
  'scripts/sign-catalog-executor-confirmation.js'
];
for (const file of requiredFiles) if (!fs.existsSync(path.join(root, file))) issues.push(`Arquivo APP-24 ausente: ${file}`);
if (!issues.length) {
  const core = read('src/catalog/catalogOperationalAuthorization.ts');
  for (const token of ['dnd-catalog-operational-authorization.v1','dnd-catalog-executor-confirmation.v1','dnd-catalog-operational-execution-receipt.v1','maximumUses: 1','humanConfirmationRequired: true','automaticExecution: false','assertCatalogOperationalAuthorizationUnused','verifySignedCatalogExecutorConfirmation']) if (!core.includes(token)) issues.push(`Contrato APP-24 ausente: ${token}`);
  const store = read('src/store/catalogOperationalAuthorizationStore.ts');
  for (const token of ['confirmAndExecute','applyOperationalOverride','setSelectedChannel','useCatalogUpdateSessionStore','humanConfirmedAt','receipts']) if (!store.includes(token)) issues.push(`Integração operacional ausente: ${token}`);
  const ui = read('app/catalog-operational-authorization.tsx');
  for (const token of ['Confirmação humana final','operational-authorization-import','operational-executor-confirmation-import','Confirmar e executar']) if (!ui.includes(token)) issues.push(`Contrato de UI APP-24 ausente: ${token}`);
  const health = read('src/store/catalogRolloutHealthStore.ts');
  for (const token of ['operationalOverrides','applyOperationalOverride','restoreOperationalOverrides']) if (!health.includes(token)) issues.push(`Override operacional ausente: ${token}`);
  const packageJson = JSON.parse(read('package.json'));
  for (const script of ['catalog:operation:authorization:sign','catalog:operation:confirmation:sign','catalog:operation:check','catalog:operation:harness','app24:linear']) if (!packageJson.scripts?.[script]) issues.push(`Script APP-24 ausente: ${script}`);
  const flows = fs.readdirSync(path.join(root, '.maestro/flows')).filter((name) => /^6[7-9]-|^70-/.test(name));
  if (flows.length !== 4) issues.push(`Esperados 4 fluxos Maestro APP-24, encontrados ${flows.length}.`);
}
const report = { status: issues.length ? 'FAIL' : 'PASS', issues, schemas: 3, expectedMaestroFlows: 4 };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-24-contracts.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exit(1);
