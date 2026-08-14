#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json');
const raw = fs.readFileSync(file, 'utf8');
const measure = (operation, iterations = 5) => {
  const values = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now(); operation(); values.push(performance.now() - started);
  }
  values.sort((a, b) => a - b);
  return { minMs: values[0], medianMs: values[Math.floor(values.length / 2)], p95Ms: values[Math.ceil(values.length * 0.95) - 1], maxMs: values.at(-1), iterations };
};
let parsed;
const parse = measure(() => { parsed = JSON.parse(raw); });
const hash = measure(() => crypto.createHash('sha256').update(raw).digest('hex'));
parsed = parsed || JSON.parse(raw);
const entityCount = Number(parsed.entityRegistry?.statistics?.totalEntries || parsed.runtimeIndex?.entryCount || 0);
const dependencyCount = Object.values(parsed.dependencyGraph?.statistics?.byStatus || {}).reduce((sum, value) => sum + Number(value || 0), 0);
const sourceBytes = ['app', 'src'].flatMap((directory) => {
  const walk = (current) => fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(current, entry.name)) : /\.(ts|tsx|js)$/.test(entry.name) ? [fs.statSync(path.join(current, entry.name)).size] : []);
  return walk(path.join(root, directory));
}).reduce((sum, value) => sum + value, 0);
const budgets = { maximumCatalogBytes: 12 * 1024 * 1024, maximumParseP95Ms: 1500, maximumHashP95Ms: 1500, maximumRuntimeSourceBytes: 4 * 1024 * 1024, minimumEntities: 5000, minimumDependencies: 15000 };
const checks = [
  { id: 'catalog-size', pass: Buffer.byteLength(raw) <= budgets.maximumCatalogBytes, actual: Buffer.byteLength(raw), budget: budgets.maximumCatalogBytes },
  { id: 'catalog-parse-p95', pass: parse.p95Ms <= budgets.maximumParseP95Ms, actual: parse.p95Ms, budget: budgets.maximumParseP95Ms },
  { id: 'catalog-hash-p95', pass: hash.p95Ms <= budgets.maximumHashP95Ms, actual: hash.p95Ms, budget: budgets.maximumHashP95Ms },
  { id: 'runtime-source-size', pass: sourceBytes <= budgets.maximumRuntimeSourceBytes, actual: sourceBytes, budget: budgets.maximumRuntimeSourceBytes },
  { id: 'entity-count', pass: entityCount >= budgets.minimumEntities, actual: entityCount, budget: budgets.minimumEntities },
  { id: 'dependency-count', pass: dependencyCount >= budgets.minimumDependencies, actual: dependencyCount, budget: budgets.minimumDependencies }
];
const status = checks.every((entry) => entry.pass) ? 'PASS' : 'FAIL';
const report = { schemaVersion: 'dnd-combat-app29-performance-benchmark.v1', status, generatedAt: new Date().toISOString(), node: process.version, catalog: { file: path.relative(root, file), bytes: Buffer.byteLength(raw), entityCount, dependencyCount, parse, hash }, runtimeSourceBytes: sourceBytes, budgets, checks };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-29-performance-benchmark.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (status !== 'PASS') process.exit(1);
