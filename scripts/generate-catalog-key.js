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
    ? Object.keys(input).sort().reduce((result, key) => {
      if (input[key] !== undefined) result[key] = stable(input[key]);
      return result;
    }, {})
    : input;
const sha256 = (input) => crypto.createHash('sha256').update(input).digest('hex');

const output = required('--output');
const publisherId = required('--publisher-id');
const keyId = required('--key-id');
const publisherName = value('--publisher-name');
const publisherKind = value('--publisher-kind', 'official');
if (!['official', 'community'].includes(publisherKind)) {
  throw new Error('--publisher-kind deve ser official ou community.');
}
if (fs.existsSync(output) && !args.includes('--overwrite')) {
  throw new Error(`O arquivo já existe: ${output}. Use --overwrite somente após confirmar o destino.`);
}
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privateJwk = privateKey.export({ format: 'jwk' });
const publicJwk = { kty: 'EC', crv: 'P-256', x: privateJwk.x, y: privateJwk.y };
const publicKeyFingerprint = sha256(JSON.stringify(stable(publicJwk)));
const document = {
  warning: 'SEGREDO CRIPTOGRÁFICO: armazene offline, nunca inclua no aplicativo, Git, backup compartilhado ou ticket.',
  publisherId,
  ...(publisherName ? { publisherName } : {}),
  publisherKind,
  keyId,
  algorithm: 'ECDSA_P256_SHA256',
  publicKeyFingerprint,
  privateJwk
};
fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
try { fs.chmodSync(output, 0o600); } catch {}
console.log(JSON.stringify({
  status: 'GENERATED',
  output,
  publisherId,
  keyId,
  algorithm: document.algorithm,
  publicKeyFingerprint
}, null, 2));
