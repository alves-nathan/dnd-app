#!/usr/bin/env node
const fs = require('fs');
const crypto = require('crypto');

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const required = (name) => {
  const result = value(name);
  if (!result) throw new Error(`Argumento obrigatório ausente: ${name}`);
  return result;
};
const stable = (input) => Array.isArray(input)
  ? input.map(stable)
  : input && typeof input === 'object'
    ? Object.keys(input).sort().reduce((result, key) => { result[key] = stable(input[key]); return result; }, {})
    : input;
const stableStringify = (input) => JSON.stringify(stable(input));
const sha256 = (input) => crypto.createHash('sha256').update(input).digest('hex');
const simpleStableHash = (input) => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const catalogPath = required('--catalog');
const keyPath = required('--private-key');
const outputPath = required('--output');
const sequence = Number(required('--sequence'));
if (!Number.isInteger(sequence) || sequence < 1) throw new Error('--sequence deve ser um inteiro positivo.');
const privateDocument = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
const privateJwk = privateDocument.privateJwk || privateDocument;
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const compactCatalogText = JSON.stringify(catalog);
const rawChecksum = sha256(compactCatalogText);
const snapshotSeed = stableStringify({
  catalogVersion: catalog.catalogVersion,
  bundleSha256: rawChecksum,
  runtimeEntries: catalog.runtimeIndex.entryCount,
  dependencyEdges: catalog.dependencyGraph.edgeCount
});
const snapshotId = `catalog-${catalog.catalogVersion}-${simpleStableHash(snapshotSeed)}`;
const provenance = {
  publisherId: value('--publisher-id', privateDocument.publisherId || 'dnd-combat-official'),
  publisherName: value('--publisher-name', privateDocument.publisherName || 'D&D Combat Official Catalog'),
  publisherKind: value('--publisher-kind', privateDocument.publisherKind || 'official'),
  keyId: value('--key-id', privateDocument.keyId || 'root-2026-01'),
  algorithm: 'ECDSA_P256_SHA256',
  issuedAt: value('--issued-at', new Date().toISOString()),
  ...(value('--expires-at') ? { expiresAt: value('--expires-at') } : {}),
  sequence,
  ...(value('--previous-checksum') ? { previousBundleChecksum: value('--previous-checksum').toLowerCase() } : {}),
  catalogChecksum: sha256(stableStringify(catalog)),
  catalogVersion: catalog.catalogVersion,
  snapshotId
};
const payload = stableStringify({ schemaVersion: 'dnd-signed-catalog-bundle.v1', provenance });
const signature = crypto.sign('sha256', Buffer.from(payload), {
  key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }),
  dsaEncoding: 'ieee-p1363'
}).toString('base64url');
const envelope = { schemaVersion: 'dnd-signed-catalog-bundle.v1', catalog, provenance, signature };
fs.writeFileSync(outputPath, JSON.stringify(envelope));
const envelopeChecksum = sha256(fs.readFileSync(outputPath));
console.log(JSON.stringify({
  status: 'SIGNED',
  output: outputPath,
  publisherId: provenance.publisherId,
  keyId: provenance.keyId,
  sequence,
  catalogVersion: provenance.catalogVersion,
  snapshotId,
  catalogChecksum: provenance.catalogChecksum,
  envelopeChecksum
}, null, 2));
