#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const issues = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const requiredFiles = [
  'src/catalog/catalogOperationalJournal.ts',
  'src/store/catalogOperationalAuthorizationStore.ts',
  'app/catalog-operational-journal.tsx',
  'src/tests/catalogOperationalJournal.test.ts',
  'scripts/run-app25-runtime-harness.js'
];
for (const file of requiredFiles) if (!fs.existsSync(path.join(root, file))) issues.push(`Arquivo APP-25 ausente: ${file}`);
if (!issues.length) {
  const core = read('src/catalog/catalogOperationalJournal.ts');
  for (const token of ['dnd-catalog-operational-journal-entry.v1','dnd-catalog-operational-reconciliation.v1','dnd-catalog-operational-evidence.v1','dnd-catalog-operational-recovery-authorization.v1','validateCatalogOperationalJournalChain','validateCatalogOperationalJournalArchiveChain','createCatalogOperationalReconciliation','assertCatalogOperationalRecoveryUnused']) if (!core.includes(token)) issues.push(`Contrato APP-25 ausente: ${token}`);
  const store = read('src/store/catalogOperationalAuthorizationStore.ts');
  for (const token of ['recoverInterruptedSessions','resumeInterruptedExecution','reconcileReceipt','closeOperation','executeRecovery','archiveJournal','status: \'interrupted\'']) if (!store.includes(token)) issues.push(`Integração APP-25 ausente: ${token}`);
  const ui = read('app/catalog-operational-journal.tsx');
  for (const token of ['Diário operacional','Reconciliar estado','Encerrar e gerar evidência','Autorização de correção ou rollback','operational-journal-archive']) if (!ui.includes(token)) issues.push(`Contrato de UI APP-25 ausente: ${token}`);
  const maintenance = read('app/compendium/maintenance.tsx');
  if (!maintenance.includes('/catalog-operational-journal')) issues.push('A manutenção do Compêndio não expõe o diário operacional.');
  const packageJson = JSON.parse(read('package.json'));
  for (const script of ['catalog:operation:journal:check','catalog:operation:journal:harness','app25:linear']) if (!packageJson.scripts?.[script]) issues.push(`Script APP-25 ausente: ${script}`);
  const flows = fs.readdirSync(path.join(root, '.maestro/flows')).filter((name) => /^7[1-4]-/.test(name));
  if (flows.length !== 4) issues.push(`Esperados 4 fluxos Maestro APP-25, encontrados ${flows.length}.`);
}
const report = { schemaVersion: 'dnd-combat-app25-contracts.v1', status: issues.length ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), issues, expectedMaestroFlows: 4 };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-25-contracts.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exit(1);
