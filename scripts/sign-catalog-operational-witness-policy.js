#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const loadRuntime = require('./load-catalog-operational-audit-runtime');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const readArg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const input = readArg('--input');
const privateKeyPath = readArg('--private-key');
const output = readArg('--output');
if (!input || !privateKeyPath || !output) {
  console.error('Uso: node scripts/sign-catalog-operational-witness-policy.js --input politica.json --private-key chave.jwk.json --output politica-assinada.json');
  process.exit(2);
}
try {
  const { federation } = loadRuntime(root);
  const draft = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  const unsigned = { ...draft, schemaVersion: federation.CATALOG_OPERATIONAL_WITNESS_POLICY_SCHEMA, signature: '' };
  const privateJwk = JSON.parse(fs.readFileSync(path.resolve(privateKeyPath), 'utf8'));
  const signature = crypto.sign('sha256', Buffer.from(federation.catalogOperationalWitnessPolicyPayload(unsigned)), {
    key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363'
  }).toString('base64url');
  const signed = { ...unsigned, signature };
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(signed, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'PASS', output: path.resolve(output), policyId: signed.policyId, witnesses: signed.authorizedWitnesses?.length ?? 0 }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'ERROR', issue: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}
