#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const required = (name) => { const result = value(name); if (!result) throw new Error(`Argumento obrigatório ausente: ${name}`); return result; };
const stable = (input) => Array.isArray(input) ? input.map(stable) : input && typeof input === 'object' ? Object.keys(input).sort().reduce((out, key) => { if (input[key] !== undefined) out[key] = stable(input[key]); return out; }, {}) : input;
const input = JSON.parse(fs.readFileSync(path.resolve(required('--input')), 'utf8'));
if (input.schemaVersion !== 'dnd-catalog-operational-authorization.v1') throw new Error('A autorização operacional é incompatível.');
const privateDocument = JSON.parse(fs.readFileSync(path.resolve(required('--private-key')), 'utf8'));
const privateJwk = privateDocument.privateJwk || privateDocument;
const payload = { ...input }; delete payload.signature;
const signature = crypto.sign('sha256', Buffer.from(JSON.stringify(stable(payload))), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const signed = { ...payload, signature };
const outputPath = path.resolve(required('--output'));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(signed, null, 2)}\n`);
console.log(JSON.stringify({ status: 'PASS', output: outputPath, authorizationId: signed.authorizationId, action: signed.action, executorId: signed.executor?.executorId, maximumUses: signed.maximumUses }, null, 2));
