#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const loadRuntime = require('./load-catalog-operational-audit-runtime');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const readArg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const input = readArg('--input');
const registryPath = readArg('--registry');
const output = readArg('--output');
if (!input || !registryPath) {
  console.error('Uso: node scripts/verify-catalog-operational-federation.js --input federacao.json --registry confianca.json [--output consenso.json]');
  process.exit(2);
}
try {
  const { federation } = loadRuntime(root);
  const candidate = federation.parseCatalogOperationalFederationPackage(fs.readFileSync(path.resolve(input), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.resolve(registryPath), 'utf8'));
  const consensus = federation.verifyCatalogOperationalFederationPackage({ federation: candidate, registry });
  const text = `${JSON.stringify(consensus, null, 2)}\n`;
  if (output) fs.writeFileSync(path.resolve(output), text);
  process.stdout.write(text);
  process.exit(consensus.status === 'rejected' ? 1 : 0);
} catch (error) {
  console.error(JSON.stringify({ status: 'ERROR', issue: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(2);
}
