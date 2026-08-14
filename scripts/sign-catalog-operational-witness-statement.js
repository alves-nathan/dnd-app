#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const loadRuntime = require('./load-catalog-operational-audit-runtime');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const readArg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const input = readArg('--input');
const policyPath = readArg('--policy');
const privateKeyPath = readArg('--private-key');
const witnessId = readArg('--witness-id');
const publisherId = readArg('--publisher-id');
const keyId = readArg('--key-id');
const deviceHash = readArg('--device-hash');
const output = readArg('--output');
const issuedAt = readArg('--issued-at') ?? new Date().toISOString();
const expiresAt = readArg('--expires-at');
if (!input || !policyPath || !privateKeyPath || !witnessId || !publisherId || !keyId || !deviceHash || !output) {
  console.error('Uso: node scripts/sign-catalog-operational-witness-statement.js --input pacote.json --policy politica.json --private-key chave.jwk.json --witness-id ID --publisher-id ID --key-id ID --device-hash HASH --output testemunho.json [--issued-at ISO] [--expires-at ISO]');
  process.exit(2);
}
try {
  const { audit, federation } = loadRuntime(root);
  const auditPackage = audit.parseCatalogOperationalAuditPackage(fs.readFileSync(path.resolve(input), 'utf8'));
  const verification = audit.verifyCatalogOperationalAuditPackage(auditPackage);
  if (verification.status === 'rejected') throw new Error('A testemunha não pode assinar um pacote rejeitado.');
  const policy = JSON.parse(fs.readFileSync(path.resolve(policyPath), 'utf8'));
  const authorized = policy.authorizedWitnesses?.find((entry) => entry.witnessId === witnessId && entry.publisherId === publisherId && entry.keyId === keyId);
  if (!authorized) throw new Error('A testemunha não está autorizada pela política informada.');
  const statementId = `catalog-operational-witness-${witnessId}-${auditPackage.packageId}`;
  const unsigned = {
    schemaVersion: federation.CATALOG_OPERATIONAL_WITNESS_STATEMENT_SCHEMA,
    statementId, issuedAt, ...(expiresAt ? { expiresAt } : {}), witnessId, publisherId, keyId,
    witnessDeviceIdHash: deviceHash,
    packageId: auditPackage.packageId,
    packageChecksum: auditPackage.checksum,
    sourceDeviceIdHash: auditPackage.source.deviceIdHash,
    verificationStatus: verification.status,
    ...(verification.firstSequence !== undefined ? { firstSequence: verification.firstSequence } : {}),
    ...(verification.lastSequence !== undefined ? { lastSequence: verification.lastSequence } : {}),
    ...(verification.headHash ? { headHash: verification.headHash } : {}),
    signature: ''
  };
  const privateJwk = JSON.parse(fs.readFileSync(path.resolve(privateKeyPath), 'utf8'));
  const signature = crypto.sign('sha256', Buffer.from(federation.catalogOperationalWitnessStatementPayload(unsigned)), {
    key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363'
  }).toString('base64url');
  const signed = { ...unsigned, signature };
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(signed, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'PASS', output: path.resolve(output), statementId, packageId: auditPackage.packageId, verificationStatus: verification.status }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'ERROR', issue: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}
