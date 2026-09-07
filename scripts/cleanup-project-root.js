#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');
const packagePath = path.join(root, 'package.json');

if (!fs.existsSync(packagePath)) {
  console.error('[cleanup:root] package.json não encontrado; abortando.');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (pkg.name !== 'dnd-combat-math-mvp') {
  console.error(`[cleanup:root] projeto inesperado (${pkg.name || 'sem nome'}); abortando.`);
  process.exit(1);
}

const preservedRootReports = new Set([
  'APP28_INTEGRAL_GATE_REPORT.md',
  'APP29_RELEASE_CANDIDATE_HARDENING_REPORT.md'
]);

const disposableFile = (name) => {
  if (preservedRootReports.has(name)) return false;
  return (
    (/^APP.*_REPORT\.md$/u.test(name)) ||
    (/^FIX_.*\.md$/u.test(name)) ||
    (/^app-.*\.(?:json|md)$/u.test(name)) ||
    (/^BETA_NATIVE_EXECUTION_STATUS_PHASE.*\.json$/u.test(name)) ||
    (/\.patch$/u.test(name)) ||
    (/^dnd-content-extraction-/u.test(name)) ||
    name === 'phase7-programmatic-import.js' ||
    name === 'phase7-programmatic-import.js.sha256'
  );
};

const disposableDirectories = ['.expo', '.validation', 'coverage', 'dist'];
const targets = [];
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && disposableFile(entry.name)) targets.push(entry.name);
}
for (const directory of disposableDirectories) {
  if (fs.existsSync(path.join(root, directory))) targets.push(directory);
}

targets.sort((a, b) => a.localeCompare(b));

if (!targets.length) {
  console.log('[cleanup:root] nada para remover.');
  process.exit(0);
}

console.log(`[cleanup:root] ${apply ? 'removendo' : 'dry-run'}: ${targets.length} entradas`);
for (const relative of targets) console.log(`- ${relative}`);

if (!apply) {
  console.log('\nExecute com --apply para remover.');
  process.exit(0);
}

for (const relative of targets) {
  fs.rmSync(path.join(root, relative), { recursive: true, force: true });
}
console.log(`[cleanup:root] concluído: ${targets.length} entradas removidas.`);
console.log('[cleanup:root] node_modules, artifacts, reports, docs, tests, assets e configurações foram preservados.');
