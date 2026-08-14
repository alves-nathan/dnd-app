#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const value = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const required = (name) => { const result = value(name); if (!result) throw new Error(`Argumento obrigatório ausente: ${name}`); return result; };
const stable = (input) => Array.isArray(input) ? input.map(stable) : input && typeof input === 'object' ? Object.keys(input).sort().reduce((out, key) => { if (input[key] !== undefined) out[key] = stable(input[key]); return out; }, {}) : input;
const stableStringify = (input) => JSON.stringify(stable(input));
const sha256 = (input) => crypto.createHash('sha256').update(input).digest('hex');

const bundlePath = path.resolve(required('--bundle'));
const mirrorsPath = path.resolve(required('--mirrors'));
const keyPath = path.resolve(required('--private-key'));
const outputPath = path.resolve(value('--out', 'catalog-distribution-manifest.json'));
const chunkCharacters = Number(value('--chunk-characters', String(128 * 1024)));
if (!Number.isInteger(chunkCharacters) || chunkCharacters < 1024) throw new Error('--chunk-characters deve ser um inteiro de pelo menos 1024.');
const rawText = fs.readFileSync(bundlePath, 'utf8');
const envelope = JSON.parse(rawText);
if (envelope.schemaVersion !== 'dnd-signed-catalog-bundle.v1' || !envelope.provenance) throw new Error('O arquivo informado não é um envelope de catálogo assinado.');
const privateDocument = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
const privateJwk = privateDocument.privateJwk || privateDocument;
const mirrors = JSON.parse(fs.readFileSync(mirrorsPath, 'utf8'));
if (!Array.isArray(mirrors) || mirrors.length < 2) throw new Error('A distribuição exige pelo menos dois mirrors.');
const chunks = [];
let characterOffset = 0;
for (let index = 0; characterOffset < rawText.length; index += 1) {
  const content = rawText.slice(characterOffset, characterOffset + chunkCharacters);
  chunks.push({ index, characterOffset, characterLength: content.length, byteLength: Buffer.byteLength(content, 'utf8'), checksum: sha256(content) });
  characterOffset += content.length;
}
const provenance = envelope.provenance;
const manifest = {
  schemaVersion: 'dnd-catalog-distribution-manifest.v1',
  publisherId: provenance.publisherId,
  keyId: provenance.keyId,
  issuedAt: value('--issued-at', new Date().toISOString()),
  ...(value('--expires-at') ? { expiresAt: value('--expires-at') } : {}),
  sequence: provenance.sequence,
  ...(provenance.previousBundleChecksum ? { previousBundleChecksum: provenance.previousBundleChecksum } : {}),
  catalogChecksum: provenance.catalogChecksum,
  bundleChecksum: sha256(rawText),
  catalogVersion: provenance.catalogVersion,
  snapshotId: provenance.snapshotId,
  bundleByteLength: Buffer.byteLength(rawText, 'utf8'),
  bundleCharacterLength: rawText.length,
  chunks,
  mirrors
};
const signature = crypto.sign('sha256', Buffer.from(stableStringify({ ...manifest, signature: undefined })), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const output = { ...manifest, signature };
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: 'PASS', output: outputPath, publisherId: manifest.publisherId, sequence: manifest.sequence, mirrors: mirrors.length, chunks: chunks.length, bundleByteLength: manifest.bundleByteLength, bundleChecksum: manifest.bundleChecksum }, null, 2));
