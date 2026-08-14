#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnEas } = require('./lib/eas-cli-command');
const { evaluateProductionIdentity, artifactDescriptor, validateBuildEvidence } = require('./lib/app30-production-release-evidence');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const execute = args.includes('--execute');
const artifactInput = value('--artifact');
const metadataInput = value('--build-metadata');
const errors = [];
if (!artifactInput || !metadataInput) errors.push('Informe --artifact e --build-metadata.');
let build = null;
if (!errors.length) {
  const artifact = path.relative(root, path.resolve(root, artifactInput)).replaceAll(path.sep, '/');
  const metadata = path.relative(root, path.resolve(root, metadataInput)).replaceAll(path.sep, '/');
  build = { artifact: artifactDescriptor(root, artifact), metadata: artifactDescriptor(root, metadata) };
  validateBuildEvidence(root, build, evaluateProductionIdentity(root).app, errors);
}
if (!execute) errors.push('Submissão não autorizada; informe --execute explicitamente.');
if (errors.length) { console.error(JSON.stringify({ status: 'BLOCKED', errors }, null, 2)); process.exit(1); }
const { result } = spawnEas(root, ['submit', '--platform', 'android', '--profile', 'production', '--path', path.resolve(root, artifactInput), '--non-interactive'], { spawnOptions: { stdio: 'inherit' } });
process.exit(result.status ?? 1);
