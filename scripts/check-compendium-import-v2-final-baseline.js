#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const errors = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) errors.push(message); };

const importVersions = read('src/compendium/importVersions.ts');
assert(importVersions.includes("LEGACY_IMPORT_TEMPLATE_VERSION_V1 = 'dnd-combat-import.v1'"), 'importVersions.ts: falta constante explícita LEGACY_IMPORT_TEMPLATE_VERSION_V1.');
assert(importVersions.includes("IMPORT_TEMPLATE_VERSION_V2 = 'dnd-combat-import.v2'"), 'importVersions.ts: falta constante canônica IMPORT_TEMPLATE_VERSION_V2.');

const canonicalBoundaries = [
  'src/compendium/importVersion.ts',
  'src/compendium/parseImportPack.ts',
  'src/compendium/importV1Migration.ts'
];
for (const relative of canonicalBoundaries) {
  const content = read(relative);
  assert(content.includes('LEGACY_IMPORT_TEMPLATE_VERSION_V1'), `${relative}: boundary legado ainda usa um nome de versão ambíguo.`);
}

const appFiles = [];
const visit = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (/\.(ts|tsx)$/.test(entry.name)) appFiles.push(absolute);
  }
};
visit(path.join(root, 'app'));
for (const absolute of appFiles) {
  const content = fs.readFileSync(absolute, 'utf8');
  assert(!content.includes('dnd-combat-import.v1'), `${path.relative(root, absolute)}: UI ainda anuncia dnd-combat-import.v1.`);
}

const compendiumHome = read('app/compendium/index.tsx');
assert(compendiumHome.includes('dnd-combat-import.v2 canônico'), 'app/compendium/index.tsx: card de exportação não anuncia V2 canônico.');
const exportScreen = read('app/compendium/export.tsx');
assert(exportScreen.includes('dnd-combat-import.v2 canônico'), 'app/compendium/export.tsx: tela de exportação não anuncia V2 canônico.');

const staticTemplatePath = path.join(root, 'docs/import-templates/dnd-compendium-import.template.json');
let template;
try { template = JSON.parse(fs.readFileSync(staticTemplatePath, 'utf8')); }
catch { errors.push('Template estático docs/import-templates/dnd-compendium-import.template.json não é JSON válido.'); }
if (template) {
  assert(template.templateVersion === 'dnd-combat-import.v2', `Template estático deve usar V2; encontrado ${template.templateVersion ?? 'n/a'}.`);
  assert(Array.isArray(template.items), 'Template estático não possui items[].');
  const kinds = new Set((template.items ?? []).map((item) => item.kind));
  for (const kind of ['class', 'feature', 'spell', 'background', 'feat', 'equipment']) {
    assert(kinds.has(kind), `Template estático não contém exemplo mínimo de ${kind}.`);
  }
  const ids = (template.items ?? []).map((item) => item.id);
  assert(new Set(ids).size === ids.length, 'Template estático possui IDs duplicados.');
}

const packageJson = JSON.parse(read('package.json'));
const releaseGate = packageJson.scripts?.['compendium:import-v2:release-gate'] ?? '';
assert(releaseGate.includes('compendium:import-v2:final-baseline:check'), 'Release gate V2 não inclui o gate final de baseline.');

if (errors.length) {
  console.error('[compendium:import-v2:final-baseline:check] FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('[compendium:import-v2:final-baseline:check] PASS');
console.log(`appFiles=${appFiles.length}`);
console.log('userFacingFormat=v2');
console.log('staticTemplate=v2');
console.log('legacyBoundary=explicit');
