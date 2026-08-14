#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const loadRuntime = require('./load-catalog-operational-audit-runtime');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const readArg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const input = readArg('--input');
const output = readArg('--output');
const compare = readArg('--compare');
if (!input) {
  console.error('Uso: node scripts/verify-catalog-operational-audit.js --input pacote.json [--compare outro.json] [--output relatorio.json]');
  process.exit(2);
}
try {
  const { audit } = loadRuntime(root);
  const candidate = audit.parseCatalogOperationalAuditPackage(fs.readFileSync(path.resolve(input), 'utf8'));
  const verification = audit.verifyCatalogOperationalAuditPackage(candidate);
  const result = { schemaVersion: 'dnd-catalog-operational-audit-cli-result.v1', verifiedAt: new Date().toISOString(), input: path.resolve(input), verification };
  if (compare) {
    const other = audit.parseCatalogOperationalAuditPackage(fs.readFileSync(path.resolve(compare), 'utf8'));
    result.comparison = audit.compareCatalogOperationalAuditPackages(candidate, other);
  }
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (output) fs.writeFileSync(path.resolve(output), text);
  process.stdout.write(text);
  process.exit(verification.status === 'rejected' ? 1 : 0);
} catch (error) {
  console.error(JSON.stringify({ status: 'ERROR', issue: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(2);
}
