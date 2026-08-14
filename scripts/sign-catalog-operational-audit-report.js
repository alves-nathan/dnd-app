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
const publisherId = readArg('--publisher-id');
const keyId = readArg('--key-id');
const output = readArg('--output');
const statement = readArg('--statement') ?? 'O pacote foi verificado de forma independente e o resultado reflete os achados anexos.';
if (!input || !privateKeyPath || !publisherId || !keyId || !output) {
  console.error('Uso: node scripts/sign-catalog-operational-audit-report.js --input pacote.json --private-key chave.jwk.json --publisher-id ID --key-id ID --output relatorio.json [--statement texto]');
  process.exit(2);
}
try {
  const { audit } = loadRuntime(root);
  const candidate = audit.parseCatalogOperationalAuditPackage(fs.readFileSync(path.resolve(input), 'utf8'));
  const verification = audit.verifyCatalogOperationalAuditPackage(candidate);
  const privateJwk = JSON.parse(fs.readFileSync(path.resolve(privateKeyPath), 'utf8'));
  const unsigned = audit.buildCatalogOperationalAuditReport({ verification, publisherId, keyId, auditorStatement: statement });
  const signature = crypto.sign('sha256', Buffer.from(audit.catalogOperationalAuditReportPayload(unsigned)), {
    key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url');
  const report = { ...unsigned, signature };
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'PASS', output: path.resolve(output), reportId: report.reportId, auditStatus: report.auditStatus, packageChecksum: report.packageChecksum }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'ERROR', issue: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}
