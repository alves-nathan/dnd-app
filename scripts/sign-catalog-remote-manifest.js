#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const required = (name) => { const result = value(name); if (!result) throw new Error(`Argumento obrigatório ausente: ${name}`); return result; };
const stable = (input) => Array.isArray(input) ? input.map(stable) : input && typeof input === 'object' ? Object.keys(input).sort().reduce((out, key) => { if (input[key] !== undefined) out[key] = stable(input[key]); return out; }, {}) : input;
const stableStringify = (input) => JSON.stringify(stable(input));
const privateDocument = JSON.parse(fs.readFileSync(required('--private-key'), 'utf8'));
const privateJwk = privateDocument.privateJwk || privateDocument;
const manifest = {
  schemaVersion: 'dnd-catalog-remote-manifest.v1',
  publisherId: required('--publisher-id'),
  keyId: required('--key-id'),
  issuedAt: value('--issued-at') || new Date().toISOString(),
  ...(value('--expires-at') ? { expiresAt: value('--expires-at') } : {}),
  latestSequence: Number(required('--sequence')),
  latestCatalogChecksum: required('--catalog-checksum').toLowerCase(),
  latestCatalogVersion: required('--catalog-version'),
  latestSnapshotId: required('--snapshot-id'),
  logId: required('--log-id'),
  logSize: Number(required('--log-size')),
  logRoot: required('--log-root').toLowerCase(),
  ...(value('--download-url') ? { downloadUrl: value('--download-url') } : {})
};
if (!Number.isInteger(manifest.latestSequence) || manifest.latestSequence < 0 || !Number.isInteger(manifest.logSize) || manifest.logSize < 0) throw new Error('Sequência e tamanho do log precisam ser inteiros não negativos.');
const signature = crypto.sign('sha256', Buffer.from(stableStringify({ ...manifest, signature: undefined })), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const output = { ...manifest, signature };
const outputPath = path.resolve(value('--out') || `catalog-remote-manifest-${manifest.latestCatalogVersion}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: 'PASS', output: outputPath, publisherId: manifest.publisherId, sequence: manifest.latestSequence, logRoot: manifest.logRoot }, null, 2));
