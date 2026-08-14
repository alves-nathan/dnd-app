#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assetRoot = path.join(root, 'assets', 'catalog-v4.8.0');
const bundlePath = path.join(assetRoot, 'runtime-bundle-v4.8.0.json');
const checksumPath = `${bundlePath}.sha256`;

const fail = (message) => {
  console.error(`[catalog:runtime:check] FAIL: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(bundlePath)) fail(`bundle ausente: ${bundlePath}`);
if (!fs.existsSync(checksumPath)) fail(`checksum ausente: ${checksumPath}`);

const raw = fs.readFileSync(bundlePath, 'utf8');
const expected = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
const actual = crypto.createHash('sha256').update(raw).digest('hex');
if (actual !== expected) fail(`SHA-256 divergente. esperado=${expected} atual=${actual}`);

const bundle = JSON.parse(raw);
const checks = [
  [bundle.catalogVersion === '4.8.0', 'versão do catálogo deve ser 4.8.0'],
  [bundle.runtimeIndex?.entries?.length === 5841, 'runtime index deve conter 5.841 entradas'],
  [bundle.entityRegistry?.entries?.length === 5841, 'registry deve conter 5.841 entradas'],
  [bundle.dependencyGraph?.edges?.length === 15385, 'grafo deve conter 15.385 arestas'],
  [bundle.contentCategories?.entities?.length === 57, 'deve haver 57 categorias'],
  [bundle.aliases?.entities?.length === 127, 'deve haver 127 aliases']
];
for (const [ok, message] of checks) if (!ok) fail(message);

console.log('[catalog:runtime:check] PASS');
console.log(`version=${bundle.catalogVersion}`);
console.log(`entities=${bundle.runtimeIndex.entries.length}`);
console.log(`dependencies=${bundle.dependencyGraph.edges.length}`);
console.log(`categories=${bundle.contentCategories.entities.length}`);
console.log(`aliases=${bundle.aliases.entities.length}`);
console.log(`sha256=${actual}`);
