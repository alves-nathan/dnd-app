#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const loadRuntime = require('./load-catalog-operational-audit-runtime');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const readArg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const policyPath = readArg('--policy');
const packagesArg = readArg('--packages');
const statementsArg = readArg('--statements');
const output = readArg('--output');
if (!policyPath || !packagesArg || !statementsArg || !output) {
  console.error('Uso: node scripts/create-catalog-operational-federation.js --policy politica.json --packages pacote-a.json,pacote-b.json --statements testemunho-1.json,testemunho-2.json --output federacao.json');
  process.exit(2);
}
const readMany = (value) => value.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => JSON.parse(fs.readFileSync(path.resolve(entry), 'utf8')));
try {
  const { federation } = loadRuntime(root);
  const policy = JSON.parse(fs.readFileSync(path.resolve(policyPath), 'utf8'));
  const result = federation.createCatalogOperationalFederationPackage({ policy, auditPackages: readMany(packagesArg), witnessStatements: readMany(statementsArg) });
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'PASS', output: path.resolve(output), federationId: result.federationId, packages: result.auditPackages.length, statements: result.witnessStatements.length }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'ERROR', issue: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}
