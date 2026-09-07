#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const issues = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const requiredFiles = [
  'src/catalog/catalogOperationalAudit.ts',
  'src/store/catalogOperationalAuditStore.ts',
  'app/catalog-operational-audit.tsx',
  'src/tests/catalogOperationalAudit.test.ts',
  'scripts/verify-catalog-operational-audit.js',
  'scripts/sign-catalog-operational-audit-report.js',
  'scripts/run-app26-runtime-harness.js'
];
for (const file of requiredFiles) if (!fs.existsSync(path.join(root, file))) issues.push(`Arquivo APP-26 ausente: ${file}`);
if (!issues.length) {
  const core = read('src/catalog/catalogOperationalAudit.ts');
  for (const token of ['dnd-catalog-operational-audit-package.v1','dnd-catalog-operational-audit-report.v1','dnd-catalog-operational-audit-retention-policy.v1','verifyCatalogOperationalAuditPackage','compareCatalogOperationalAuditPackages','AUDIT_SEGMENT_MISSING','AUDIT_SEGMENT_OVERLAP','verifySignedCatalogOperationalAuditReport','evaluateCatalogOperationalAuditRetention']) if (!core.includes(token)) issues.push(`Contrato APP-26 ausente: ${token}`);
  const store = read('src/store/catalogOperationalAuditStore.ts');
  for (const token of ['readOnly: true','importAuditPackage','importSignedReport','compareImportedWithLocal']) if (!store.includes(token)) issues.push(`Store APP-26 incompleta: ${token}`);
  const ui = read('app/catalog-operational-audit.tsx');
  for (const token of ['Auditoria operacional externa','Compartilhar pacote completo','Importar para auditoria','Relatório de auditoria assinado','Verificador independente']) if (!ui.includes(token)) issues.push(`UI APP-26 incompleta: ${token}`);
  const maintenance = read('app/compendium/maintenance.tsx');
  if (!maintenance.includes('/catalog-operational-audit')) issues.push('A manutenção do Compêndio não expõe a auditoria operacional externa.');
  const journal = read('app/catalog-operational-journal.tsx');
  if (!journal.includes('operational-audit-open')) issues.push('O diário operacional não oferece acesso à auditoria externa.');
  const packageJson = JSON.parse(read('package.json'));
  for (const script of ['catalog:operation:audit:check','catalog:operation:audit:harness','catalog:operation:audit:verify','catalog:operation:audit:report:sign','app26:linear']) if (!packageJson.scripts?.[script]) issues.push(`Script APP-26 ausente: ${script}`);
  const flows = fs.readdirSync(path.join(root, '.maestro/flows')).filter((name) => /^7[5-8]-/.test(name));
  if (flows.length !== 4) issues.push(`Esperados 4 fluxos Maestro APP-26, encontrados ${flows.length}.`);
}
const report = { schemaVersion: 'dnd-combat-app26-contracts.v1', status: issues.length ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), issues, expectedMaestroFlows: 4, readOnlyImport: true, automaticExecution: false };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-26-contracts.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exit(1);
