#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'assets', 'compendium', 'phb-2024-full-consolidated-import-pack-v5-complete-invocations.json');
const output = path.join(root, 'artifacts', 'compendium-import-v2-phase05-persistence-report.json');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-import-v2-persistence-audit-'));
const tempSrc = path.join(tempRoot, 'src');
const tempCompendium = path.join(tempSrc, 'compendium');
const tempStorage = path.join(tempSrc, 'storage');
const tempTypes = path.join(tempSrc, 'types');
fs.mkdirSync(tempCompendium, { recursive: true });
fs.mkdirSync(tempStorage, { recursive: true });
fs.mkdirSync(tempTypes, { recursive: true });
const transpile = (input, outputPath) => {
  const result = ts.transpileModule(fs.readFileSync(input, 'utf8'), { fileName: input, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  fs.writeFileSync(outputPath, result.outputText);
};
transpile(path.join(root, 'src', 'types', 'index.ts'), path.join(tempTypes, 'index.js'));
for (const fileName of ['importVersions.ts', 'importDomain.ts', 'importNormalization.ts', 'importV1Migration.ts', 'importSemanticValidation.ts', 'importContentHash.ts', 'importPreview.ts', 'importUpsertPlan.ts']) {
  transpile(path.join(root, 'src', 'compendium', fileName), path.join(tempCompendium, fileName.replace(/\.ts$/, '.js')));
}
transpile(path.join(root, 'src', 'storage', 'compendiumV2Persistence.ts'), path.join(tempStorage, 'compendiumV2Persistence.js'));

const { migrateImportV1ToV2 } = require(path.join(tempCompendium, 'importV1Migration.js'));
const { buildCompendiumImportV2Preview } = require(path.join(tempCompendium, 'importPreview.js'));
const { createCompendiumImportV2UpsertPlan } = require(path.join(tempCompendium, 'importUpsertPlan.js'));
const { applyCompendiumImportV2PlanToSnapshot } = require(path.join(tempStorage, 'compendiumV2Persistence.js'));

const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const migrated = migrateImportV1ToV2(raw, { originalEnvelope: raw, detectedLegacyVersion: 'dnd-combat-import.v1' });
if (!migrated.value) throw new Error('PHB migration returned no canonical V2 pack.');

const allSources = new Map();
for (const item of raw.items) allSources.set(item.source.id, item.source);
allSources.set(raw.source.id, raw.source);
const now = '2026-08-10T23:00:00.000Z';
const legacyItems = raw.items.map((item) => ({
  id: `${raw.id}:${item.id}`,
  importItemId: item.id,
  packId: raw.id,
  sourceId: item.source.id,
  type: item.kind,
  name: item.name,
  summary: item.summary,
  version: item.source.version,
  rawJson: item,
  normalizedJson: { ...item.payload, id: item.id, name: item.name, type: item.kind, sourceId: item.source.id },
  tags: [item.kind], status: 'validated', reviewDecision: 'approved', createdAt: now, updatedAt: now
}));
const legacySnapshot = {
  sources: Array.from(allSources.values()),
  packs: [{ id: raw.id, name: raw.source.book || raw.id, sourceId: raw.source.id, schemaVersion: '1.0.0', checksum: 'legacy', importedAt: now, itemCount: legacyItems.length }],
  items: legacyItems,
  enabledSourceIds: Array.from(allSources.values()).filter((s) => s.status === 'active').map((s) => s.id)
};

const emptySnapshot = { sources: [], packs: [], items: [], enabledSourceIds: [] };
const emptyPreview = buildCompendiumImportV2Preview(migrated.value, []);
const emptyPlan = createCompendiumImportV2UpsertPlan(migrated.value, emptyPreview);
const firstInstall = applyCompendiumImportV2PlanToSnapshot(emptySnapshot, migrated.value, emptyPlan, { importedAt: '2026-08-10T23:30:00.000Z' });
const firstInstallIdsUnique = new Set(firstInstall.snapshot.items.map((item) => item.id)).size === legacyItems.length;
const firstInstallHashesPresent = firstInstall.snapshot.items.every((item) => typeof item.contentHash === 'string' && item.contentHash.startsWith('cmpv2_'));

const preview = buildCompendiumImportV2Preview(migrated.value, legacyItems);
const plan = createCompendiumImportV2UpsertPlan(migrated.value, preview);
const committed = applyCompendiumImportV2PlanToSnapshot(legacySnapshot, migrated.value, plan, { importedAt: '2026-08-11T00:00:00.000Z' });
const idsPreserved = committed.snapshot.items.every((item, index) => item.id === legacyItems[index].id);
const hashesPresent = committed.snapshot.items.every((item) => typeof item.contentHash === 'string' && item.contentHash.startsWith('cmpv2_'));

const changed = {
  ...migrated.value,
  items: migrated.value.items.map((item, index) => index === 0 ? { ...item, summary: `${item.summary ?? ''} [phase05-update]`.trim() } : item)
};
const updatePreview = buildCompendiumImportV2Preview(changed, committed.snapshot.items);
const updatePlan = createCompendiumImportV2UpsertPlan(changed, updatePreview);
const updated = applyCompendiumImportV2PlanToSnapshot(committed.snapshot, changed, updatePlan, { importedAt: '2026-08-11T00:30:00.000Z' });
const changedId = updatePlan.updates[0]?.existingStorageId;
const changedIdPreserved = changedId && updated.snapshot.items.find((item) => item.importItemId === changed.items[0].id)?.id === changedId;

const report = {
  schemaVersion: 'dnd-combat-import-v2-phase05-persistence-audit.v1',
  sourcePack: raw.id,
  itemCount: legacyItems.length,
  firstInstall: {
    valid: emptyPreview.valid,
    executable: emptyPlan.executable,
    creates: emptyPreview.creates,
    itemsPersisted: firstInstall.snapshot.items.length,
    storageIdsUnique: firstInstallIdsUnique,
    allContentHashesPersisted: firstInstallHashesPresent
  },
  replay: {
    valid: preview.valid,
    executable: plan.executable,
    creates: preview.creates,
    updates: preview.updates,
    unchanged: preview.unchanged,
    conflicts: preview.conflicts,
    hashesBackfilled: committed.summary.contentHashesBackfilled,
    storageIdsPreserved: idsPreserved,
    allContentHashesPersisted: hashesPresent
  },
  oneItemUpdate: {
    valid: updatePreview.valid,
    updates: updatePreview.updates,
    unchanged: updatePreview.unchanged,
    storageIdPreserved: Boolean(changedIdPreserved),
    changedPaths: updatePlan.updates[0]?.changedPaths ?? []
  }
};
const pass =
  report.itemCount === 1284 && emptyPreview.valid && emptyPlan.executable && emptyPreview.creates === 1284 && firstInstall.snapshot.items.length === 1284 && firstInstallIdsUnique && firstInstallHashesPresent &&
  preview.valid && plan.executable && preview.unchanged === 1284 && preview.conflicts === 0 &&
  committed.summary.contentHashesBackfilled === 1284 && idsPreserved && hashesPresent &&
  updatePreview.valid && updatePreview.updates === 1 && updatePreview.unchanged === 1283 && Boolean(changedIdPreserved);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log(`[compendium:import-v2:persistence-audit] ${pass ? 'PASS' : 'FAIL'}`);
console.log(`items=${report.itemCount} firstInstall=${report.firstInstall.itemsPersisted} unchanged=${report.replay.unchanged} hashesBackfilled=${report.replay.hashesBackfilled}`);
console.log(`oneItemUpdate=${report.oneItemUpdate.updates} storageIdPreserved=${report.oneItemUpdate.storageIdPreserved}`);
console.log(`report=${path.relative(root, output)}`);
if (!pass) process.exit(1);
