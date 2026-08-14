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
if (publication.schemaVersion !== 'dnd-catalog-publication.v1') throw new Error('A publicação é incompatível.');
const privateDocument = JSON.parse(fs.readFileSync(path.resolve(required('--private-key')), 'utf8'));
const privateJwk = privateDocument.privateJwk || privateDocument;
const number = (name, fallback) => { const result = Number(value(name, fallback)); if (!Number.isFinite(result)) throw new Error(`${name} é inválido.`); return result; };
const policy = {
  schemaVersion: 'dnd-catalog-rollout-health-policy.v1',
  policyId: value('--policy-id', `${publication.publicationId}-health-${value('--revision', '1')}`),
  publisherId: publication.publisherId,
  keyId: publication.keyId,
  publicationId: publication.publicationId,
  channel: publication.channel,
  issuedAt: value('--issued-at', new Date().toISOString()),
  ...(value('--expires-at') ? { expiresAt: value('--expires-at') } : {}),
  revision: number('--revision', '1'),
  thresholds: {
    minimumSampleSize: number('--minimum-samples', '20'),
    minimumSuccessRate: number('--minimum-success-rate', '0.98'),
    maximumFailureRate: number('--maximum-failure-rate', '0.02'),
    maximumRollbackRate: number('--maximum-rollback-rate', '0.01'),
    maximumIntegrityFailureRate: number('--maximum-integrity-failure-rate', '0'),
    maximumP95DurationMs: number('--maximum-p95-duration-ms', '120000')
  }
};
const signature = crypto.sign('sha256', Buffer.from(stableStringify({ ...policy, signature: undefined })), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const output = { ...policy, signature };
const outputPath = path.resolve(value('--out', 'catalog-rollout-health-policy.json'));
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: 'PASS', output: outputPath, policyId: output.policyId, publicationId: output.publicationId, revision: output.revision, thresholds: output.thresholds }, null, 2));
