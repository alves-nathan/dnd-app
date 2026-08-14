#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'assets', 'compendium', 'phb-2024-full-consolidated-import-pack-v5-complete-invocations.json');
const output = path.join(root, 'artifacts', 'compendium-import-v2-phase04-preview-report.json');

const loadTypeScript = () => {
  for (const candidate of [
    'typescript',
    '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js',
    '/usr/local/lib/node_modules/typescript/lib/typescript.js'
  ]) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado para auditoria de preview V2.');
};

const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-import-v2-preview-audit-'));
const tempSrc = path.join(tempRoot, 'src');
const tempCompendium = path.join(tempSrc, 'compendium');
const tempTypes = path.join(tempSrc, 'types');
fs.mkdirSync(tempCompendium, { recursive: true });
fs.mkdirSync(tempTypes, { recursive: true });

const transpile = (input, outputPath) => {
  const result = ts.transpileModule(fs.readFileSync(input, 'utf8'), {
    fileName: input,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  });
  fs.writeFileSync(outputPath, result.outputText);
};

transpile(path.join(root, 'src', 'types', 'index.ts'), path.join(tempTypes, 'index.js'));
for (const fileName of [
  'importVersions.ts',
  'importDomain.ts',
  'importNormalization.ts',
  'importV1Migration.ts',
  'importSemanticValidation.ts',
  'importContentHash.ts',
  'importPreview.ts',
  'importUpsertPlan.ts'
]) transpile(path.join(root, 'src', 'compendium', fileName), path.join(tempCompendium, fileName.replace(/\.ts$/, '.js')));

const { migrateImportV1ToV2 } = require(path.join(tempCompendium, 'importV1Migration.js'));
const { buildCompendiumImportV2Preview } = require(path.join(tempCompendium, 'importPreview.js'));
const { createCompendiumImportV2UpsertPlan } = require(path.join(tempCompendium, 'importUpsertPlan.js'));

const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const migrated = migrateImportV1ToV2(raw, { originalEnvelope: raw, detectedLegacyVersion: 'dnd-combat-import.v1' });
if (!migrated.value) throw new Error('PHB migration returned no canonical V2 pack.');

const emptyPreview = buildCompendiumImportV2Preview(migrated.value, []);
const existing = raw.items.map((item) => ({
  id: `${raw.id}:${item.id}`,
  importItemId: item.id,
  type: item.kind,
  name: item.name,
  summary: item.summary,
  sourceId: item.source?.id,
  version: item.source?.version,
  rawJson: item
}));
const replayPreview = buildCompendiumImportV2Preview(migrated.value, existing);
const replayPlan = createCompendiumImportV2UpsertPlan(migrated.value, replayPreview);

const changedPack = {
  ...migrated.value,
  items: migrated.value.items.map((item, index) => index === 0 ? { ...item, summary: `${item.summary ?? ''} [phase04-update-check]`.trim() } : item)
};
const updatePreview = buildCompendiumImportV2Preview(changedPack, existing);
const updatePlan = createCompendiumImportV2UpsertPlan(changedPack, updatePreview);

const report = {
  schemaVersion: 'dnd-combat-import-v2-phase04-preview-audit.v1',
  sourcePack: raw.id,
  itemCount: migrated.value.items.length,
  emptyCatalog: {
    valid: emptyPreview.valid,
    creates: emptyPreview.creates,
    updates: emptyPreview.updates,
    unchanged: emptyPreview.unchanged,
    conflicts: emptyPreview.conflicts
  },
  replayAgainstSameV1Catalog: {
    valid: replayPreview.valid,
    creates: replayPreview.creates,
    updates: replayPreview.updates,
    unchanged: replayPreview.unchanged,
    conflicts: replayPreview.conflicts,
    executable: replayPlan.executable
  },
  oneItemChanged: {
    valid: updatePreview.valid,
    creates: updatePreview.creates,
    updates: updatePreview.updates,
    unchanged: updatePreview.unchanged,
    conflicts: updatePreview.conflicts,
    executable: updatePlan.executable,
    updateItemId: updatePlan.updates[0]?.itemId,
    changedPaths: updatePlan.updates[0]?.changedPaths ?? []
  },
  byKind: replayPreview.byKind,
  semantic: replayPreview.semanticValidation.summary
};

const pass =
  report.itemCount === 1284 &&
  emptyPreview.valid && emptyPreview.creates === 1284 && emptyPreview.conflicts === 0 &&
  replayPreview.valid && replayPreview.unchanged === 1284 && replayPreview.creates === 0 && replayPreview.updates === 0 && replayPreview.conflicts === 0 &&
  updatePreview.valid && updatePreview.updates === 1 && updatePreview.unchanged === 1283 && updatePreview.conflicts === 0 && updatePlan.executable;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });

console.log(`[compendium:import-v2:preview-audit] ${pass ? 'PASS' : 'FAIL'}`);
console.log(`empty creates=${emptyPreview.creates} updates=${emptyPreview.updates} unchanged=${emptyPreview.unchanged} conflicts=${emptyPreview.conflicts}`);
console.log(`replay creates=${replayPreview.creates} updates=${replayPreview.updates} unchanged=${replayPreview.unchanged} conflicts=${replayPreview.conflicts}`);
console.log(`changed creates=${updatePreview.creates} updates=${updatePreview.updates} unchanged=${updatePreview.unchanged} conflicts=${updatePreview.conflicts}`);
console.log(`report=${path.relative(root, output)}`);
if (!pass) process.exit(1);
