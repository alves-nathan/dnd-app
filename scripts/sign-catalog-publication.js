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
const distributionPath = path.resolve(required('--distribution'));
const keyPath = path.resolve(required('--private-key'));
const notesPath = path.resolve(required('--notes'));
const outputPath = path.resolve(value('--out', 'catalog-publication.json'));
const distribution = JSON.parse(fs.readFileSync(distributionPath, 'utf8'));
if (distribution.schemaVersion !== 'dnd-catalog-distribution-manifest.v1') throw new Error('O arquivo de distribuição é incompatível.');
const channel = required('--channel');
if (!['stable', 'beta', 'preview'].includes(channel)) throw new Error('--channel deve ser stable, beta ou preview.');
const rolloutPercent = Number(value('--rollout', '100'));
if (!Number.isFinite(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) throw new Error('--rollout deve estar entre 0 e 100.');
const notesInput = JSON.parse(fs.readFileSync(notesPath, 'utf8'));
const notesPayload = { locale: notesInput.locale, title: notesInput.title, summary: notesInput.summary, items: notesInput.items };
if (!notesPayload.locale || !notesPayload.title || !notesPayload.summary || !Array.isArray(notesPayload.items) || !notesPayload.items.length) throw new Error('As notas de versão estão incompletas.');
const releaseNotes = { ...notesPayload, checksum: sha256(stableStringify(notesPayload)) };
const privateDocument = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
const privateJwk = privateDocument.privateJwk || privateDocument;
const publication = {
  schemaVersion: 'dnd-catalog-publication.v1',
  publicationId: value('--publication-id', `${distribution.publisherId}-${channel}-${distribution.sequence}`),
  publisherId: distribution.publisherId,
  keyId: distribution.keyId,
  issuedAt: value('--issued-at', new Date().toISOString()),
  ...(value('--expires-at') ? { expiresAt: value('--expires-at') } : {}),
  channel,
  sequence: distribution.sequence,
  distributionManifestChecksum: sha256(stableStringify(distribution)),
  catalogChecksum: distribution.catalogChecksum,
  bundleChecksum: distribution.bundleChecksum,
  catalogVersion: distribution.catalogVersion,
  snapshotId: distribution.snapshotId,
  minAppVersion: required('--min-app-version'),
  ...(value('--max-app-version') ? { maxAppVersion: value('--max-app-version') } : {}),
  rolloutPercent,
  cohortSalt: required('--cohort-salt'),
  releaseNotes
};
const signature = crypto.sign('sha256', Buffer.from(stableStringify({ ...publication, signature: undefined })), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const output = { ...publication, signature };
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: 'PASS', output: outputPath, publicationId: output.publicationId, channel, rolloutPercent, minAppVersion: output.minAppVersion, maxAppVersion: output.maxAppVersion ?? null, releaseNotesChecksum: releaseNotes.checksum }, null, 2));
