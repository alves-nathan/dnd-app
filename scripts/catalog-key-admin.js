#!/usr/bin/env node
const fs = require('fs');
const crypto = require('crypto');
const args = process.argv.slice(2);
const command = args[0];
const value = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const required = (name) => { const result = value(name); if (!result) throw new Error(`Argumento obrigatório ausente: ${name}`); return result; };
const stable = (input) => Array.isArray(input) ? input.map(stable) : input && typeof input === 'object' ? Object.keys(input).sort().reduce((result, key) => { const entry = input[key]; if (entry !== undefined) result[key] = stable(entry); return result; }, {}) : input;
const stableStringify = (input) => JSON.stringify(stable(input));
const sign = (payload, privateJwk) => crypto.sign('sha256', Buffer.from(stableStringify(payload)), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const current = JSON.parse(fs.readFileSync(required('--current-private-key'), 'utf8'));
const currentPrivateJwk = current.privateJwk || current;
const publisherId = value('--publisher-id', current.publisherId);
const currentKeyId = value('--current-key-id', current.keyId);
const issuedAt = value('--issued-at', new Date().toISOString());
const sequence = Number(required('--sequence'));
const output = required('--output');
if (command === 'rotate') {
  const next = JSON.parse(fs.readFileSync(required('--new-private-key'), 'utf8'));
  const nextPrivateJwk = next.privateJwk || next;
  const payload = {
    schemaVersion: 'dnd-catalog-key-rotation.v1',
    publisherId,
    currentKeyId,
    newKey: {
      keyId: value('--new-key-id', next.keyId),
      algorithm: 'ECDSA_P256_SHA256',
      publicJwk: { kty: 'EC', crv: 'P-256', x: nextPrivateJwk.x, y: nextPrivateJwk.y },
      validFrom: value('--valid-from', issuedAt),
      ...(value('--valid-until') ? { validUntil: value('--valid-until') } : {})
    },
    issuedAt,
    sequence
  };
  fs.writeFileSync(output, JSON.stringify({ ...payload, signature: sign(payload, currentPrivateJwk) }, null, 2));
} else if (command === 'revoke') {
  const payload = {
    schemaVersion: 'dnd-catalog-key-revocation.v1',
    publisherId,
    authorizingKeyId: currentKeyId,
    ...(args.includes('--publisher') ? { revokePublisher: true } : { revokedKeyId: required('--revoked-key-id') }),
    reason: required('--reason'),
    issuedAt,
    sequence
  };
  fs.writeFileSync(output, JSON.stringify({ ...payload, signature: sign(payload, currentPrivateJwk) }, null, 2));
} else {
  throw new Error('Uso: catalog-key-admin.js rotate|revoke ...');
}
console.log(JSON.stringify({ status: 'SIGNED', command, output }, null, 2));
