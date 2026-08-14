#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'src/catalog/catalogOperationalFederation.ts',
  'src/store/catalogOperationalFederationStore.ts',
  'src/tests/catalogOperationalFederation.test.ts',
  'app/catalog-operational-federation.tsx',
  'scripts/sign-catalog-operational-witness-policy.js',
  'scripts/sign-catalog-operational-witness-statement.js',
  'scripts/create-catalog-operational-federation.js',
  'scripts/verify-catalog-operational-federation.js',
  'scripts/run-app27-runtime-harness.js'
];
const issues = [];
for (const relative of requiredFiles) if (!fs.existsSync(path.join(root, relative))) issues.push(`Arquivo ausente: ${relative}`);
const domain = fs.readFileSync(path.join(root, 'src/catalog/catalogOperationalFederation.ts'), 'utf8');
for (const token of [
  'dnd-catalog-operational-witness-policy.v1',
  'dnd-catalog-operational-witness-statement.v1',
  'dnd-catalog-operational-federation-package.v1',
  'dnd-catalog-operational-federation-consensus.v1',
  'minimumWitnessesPerPackage',
  'minimumDevices',
  'FEDERATION_JOURNAL_FORK',
  'FEDERATION_WITNESS_QUORUM_MISSING'
]) if (!domain.includes(token)) issues.push(`Contrato ausente no núcleo: ${token}`);
const store = fs.readFileSync(path.join(root, 'src/store/catalogOperationalFederationStore.ts'), 'utf8');
for (const token of ['readOnly: true', 'importFederation', 'compareFederations']) if (!store.includes(token)) issues.push(`Contrato ausente na store: ${token}`);
const screen = fs.readFileSync(path.join(root, 'app/catalog-operational-federation.tsx'), 'utf8');
for (const token of ['Federação de auditoria', 'operational-federation-import', 'Ferramentas independentes']) if (!screen.includes(token)) issues.push(`Contrato ausente na interface: ${token}`);
const settings = fs.readFileSync(path.join(root, 'app/settings.tsx'), 'utf8');
if (!settings.includes('/catalog-operational-federation')) issues.push('A federação não está acessível por Ajustes.');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const name of ['catalog:operation:federation:check','catalog:operation:federation:harness','catalog:operation:witness:policy:sign','catalog:operation:witness:sign','catalog:operation:federation:create','catalog:operation:federation:verify','app27:linear']) if (!pkg.scripts?.[name]) issues.push(`Script npm ausente: ${name}`);
const maestro = fs.readdirSync(path.join(root, '.maestro/flows')).filter((entry) => entry.endsWith('.yaml'));
for (const name of ['79-operational-federation-approved.yaml','80-operational-federation-quorum-missing.yaml','81-operational-federation-fork.yaml','82-operational-federation-compare.yaml']) if (!maestro.includes(name)) issues.push(`Fluxo Maestro ausente: ${name}`);
const status = issues.length ? 'FAIL' : 'PASS';
const report = { schemaVersion: 'dnd-combat-app27-contracts.v1', status, generatedAt: new Date().toISOString(), requiredFiles: requiredFiles.length, maestroFlows: maestro.length, issues };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-27-contracts.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exit(1);
