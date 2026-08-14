#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { writeJson } = require('./lib/app07-release-evidence');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const errors = [];
const warnings = [];
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const sections = ['dependencies', 'devDependencies'];
const direct = [];

if (lock.lockfileVersion !== 3) errors.push(`package-lock.json: lockfileVersion esperado 3, recebido ${lock.lockfileVersion}`);
if (!packageJson.packageManager?.startsWith('npm@')) errors.push('package.json: packageManager npm fixado é obrigatório');
if (!packageJson.engines?.node || !packageJson.engines?.npm) errors.push('package.json: engines.node e engines.npm são obrigatórios');

for (const section of sections) {
  const packageSection = packageJson[section] || {};
  const lockSection = lock.packages?.['']?.[section] || {};
  for (const [name, requested] of Object.entries(packageSection)) {
    const lockEntry = lock.packages?.[`node_modules/${name}`];
    direct.push({ name, section, requested, locked: lockEntry?.version || null });
    if (!exactVersion.test(requested)) errors.push(`package.json: ${name} usa versão não exata (${requested})`);
    if (lockSection[name] !== requested) errors.push(`package-lock.json: declaração raiz divergente para ${name} (${lockSection[name]} != ${requested})`);
    if (!lockEntry) errors.push(`package-lock.json: pacote direto ausente (${name})`);
    else if (lockEntry.version !== requested) errors.push(`package-lock.json: versão resolvida divergente para ${name} (${lockEntry.version} != ${requested})`);
  }
}

let registryEntries = 0;
let integrityEntries = 0;
let nonRegistryEntries = 0;
for (const [packagePath, entry] of Object.entries(lock.packages || {})) {
  if (!packagePath || !entry?.resolved) continue;
  if (String(entry.resolved).startsWith('https://registry.npmjs.org/')) {
    registryEntries += 1;
    if (entry.integrity) integrityEntries += 1;
    else errors.push(`package-lock.json: integrity ausente (${packagePath})`);
  } else if (String(entry.resolved).startsWith('https://')) {
    nonRegistryEntries += 1;
    warnings.push(`resolved externo: ${packagePath} -> ${entry.resolved}`);
  } else {
    errors.push(`package-lock.json: resolved não HTTPS (${packagePath} -> ${entry.resolved})`);
  }
}

const critical = { expo: '57.0.12', 'react-native': '0.86.2', react: '19.2.3', zustand: '5.0.14', zod: '4.4.3', jest: '29.7.0', typescript: '6.0.3' };
for (const [name, expected] of Object.entries(critical)) {
  const requested = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
  if (requested !== expected) errors.push(`pacote crítico ${name}: esperado ${expected}, recebido ${requested || 'ausente'}`);
}

const installed = [];
const nodeModules = path.join(root, 'node_modules');
if (fs.existsSync(nodeModules)) {
  for (const item of direct) {
    const manifest = path.join(nodeModules, item.name, 'package.json');
    if (!fs.existsSync(manifest)) {
      installed.push({ name: item.name, status: 'MISSING' });
      warnings.push(`node_modules incompleto: ${item.name} ausente`);
      continue;
    }
    const version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
    installed.push({ name: item.name, status: version === item.requested ? 'MATCH' : 'MISMATCH', version });
    if (version !== item.requested) errors.push(`node_modules: ${item.name}@${version} diverge de ${item.requested}`);
  }
}

const report = {
  schemaVersion: 'dnd-combat-app07-dependency-lock.v1',
  generatedAt: new Date().toISOString(),
  status: errors.length ? 'FAIL' : 'PASS',
  packageManager: packageJson.packageManager,
  engines: packageJson.engines,
  directDependencies: direct.length,
  registryEntries,
  integrityEntries,
  nonRegistryEntries,
  installedCheck: fs.existsSync(nodeModules) ? installed : 'NOT_RUN',
  warnings,
  errors
};
writeJson(path.join(root, 'artifacts/app07-dependency-lock.json'), report);
if (errors.length) {
  console.error('[dependencies:lock:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('[dependencies:lock:check] PASS');
console.log(`directDependencies=${direct.length}`);
console.log(`registryEntries=${registryEntries}`);
console.log(`integrityEntries=${integrityEntries}`);
