#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const value = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const required = (name) => { const result = value(name); if (!result) throw new Error(`Argumento obrigatório ausente: ${name}`); return result; };
const stable = (input) => Array.isArray(input) ? input.map(stable) : input && typeof input === 'object' ? Object.keys(input).sort().reduce((out, key) => { if (input[key] !== undefined) out[key] = stable(input[key]); return out; }, {}) : input;
const stableStringify = (input) => JSON.stringify(stable(input));
const publication = JSON.parse(fs.readFileSync(path.resolve(required('--publication')), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.resolve(required('--policy')), 'utf8'));
const evidence = JSON.parse(fs.readFileSync(path.resolve(required('--evidence')), 'utf8'));
const privateDocument = JSON.parse(fs.readFileSync(path.resolve(required('--private-key')), 'utf8'));
const privateJwk = privateDocument.privateJwk || privateDocument;
const action = required('--action');
if (!['expand', 'reduce', 'promote', 'pause', 'rollback'].includes(action)) throw new Error('--action inválida.');
const fromRolloutPercent = Number(required('--from-rollout'));
const toRolloutPercent = Number(required('--to-rollout'));
const revision = Number(value('--revision', '1'));
const targetPublication = value('--target-publication') ? JSON.parse(fs.readFileSync(path.resolve(value('--target-publication')), 'utf8')) : undefined;
const directive = {
  schemaVersion: 'dnd-catalog-rollout-directive.v1',
  directiveId: value('--directive-id', `${publication.publicationId}-${action}-${revision}`),
  publisherId: publication.publisherId,
  keyId: publication.keyId,
  publicationId: publication.publicationId,
  issuedAt: value('--issued-at', new Date().toISOString()),
  revision,
  action,
  fromRolloutPercent,
  toRolloutPercent,
  sourceChannel: publication.channel,
  ...(targetPublication ? { targetChannel: targetPublication.channel, targetPublicationId: targetPublication.publicationId } : {}),
  policyId: policy.policyId,
  healthEvidenceChecksum: evidence.checksum,
  reason: required('--reason')
};
const signature = crypto.sign('sha256', Buffer.from(stableStringify({ ...directive, signature: undefined })), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const output = { ...directive, signature };
const outputPath = path.resolve(value('--out', 'catalog-rollout-directive.json'));
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: 'PASS', output: outputPath, directiveId: output.directiveId, action, fromRolloutPercent, toRolloutPercent, targetPublicationId: output.targetPublicationId ?? null }, null, 2));
