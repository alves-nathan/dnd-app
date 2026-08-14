#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'artifacts', 'compendium', 'integration', 'spelljammer-2024-upgrade-report.json');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript unavailable.');
};
const ts = loadTypeScript();
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  });
  module._compile(result.outputText, filename);
};
const { buildCompendiumImportV2Preview } = require(path.join(root, 'src', 'compendium', 'importPreview.ts'));
const { createCompendiumImportV2UpsertPlan } = require(path.join(root, 'src', 'compendium', 'importUpsertPlan.ts'));
const { applyCompendiumImportV2PlanToSnapshot, existingPreviewItemsFromSnapshot } = require(path.join(root, 'src', 'storage', 'compendiumV2Persistence.ts'));
const { emptyCompendiumPersistenceState } = require(path.join(root, 'src', 'storage', 'compendiumSnapshot.ts'));
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const phb = read('assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json');
const mm2024Delta = read('assets/compendium/mm-2024-runtime-dependency-delta-v2-canonical.json');
const oldSpelljammer = read('artifacts/compendium/integration/v2/spelljammer-2022-full-consolidated-import-pack-v2-canonical.json');
const compatible = read('assets/compendium/spelljammer-2022-2024-compatible-import-pack-v2-canonical.json');
const apply = (snapshot, pack, importedAt) => {
  const preview = buildCompendiumImportV2Preview(pack, existingPreviewItemsFromSnapshot(snapshot));
  const plan = createCompendiumImportV2UpsertPlan(pack, preview);
  if (!plan.executable) throw new Error(`Non-executable plan for ${pack.id}`);
  return applyCompendiumImportV2PlanToSnapshot(snapshot, pack, plan, { importedAt }).snapshot;
};
let snapshot = emptyCompendiumPersistenceState();
snapshot = apply(snapshot, phb, '2026-08-11T20:00:00.000Z');
snapshot = apply(snapshot, mm2024Delta, '2026-08-11T20:00:30.000Z');
snapshot = apply(snapshot, oldSpelljammer, '2026-08-11T20:01:00.000Z');
const beforeCount = snapshot.items.length;
const upgradePreview = buildCompendiumImportV2Preview(compatible, existingPreviewItemsFromSnapshot(snapshot));
const upgradePlan = createCompendiumImportV2UpsertPlan(compatible, upgradePreview);
if (upgradePlan.executable) snapshot = applyCompendiumImportV2PlanToSnapshot(snapshot, compatible, upgradePlan, { importedAt: '2026-08-11T20:02:00.000Z' }).snapshot;
const replay = buildCompendiumImportV2Preview(compatible, existingPreviewItemsFromSnapshot(snapshot));
const pass = snapshot.packs.some((entry) => entry.id === mm2024Delta.id) && upgradePreview.valid && upgradePlan.executable && upgradePreview.creates === 0 && upgradePreview.conflicts === 0 && upgradePreview.updates > 0 && snapshot.items.length === beforeCount && replay.valid && replay.creates === 0 && replay.updates === 0 && replay.unchanged === compatible.items.length;
const report = {
  schemaVersion: 'dnd-combat-spelljammer-2024-upgrade.v1',
  logicalPackIdPreserved: oldSpelljammer.id === compatible.id,
  oldPackId: oldSpelljammer.id,
  compatiblePackId: compatible.id,
  mm2024DependencyPackInstalled: snapshot.packs.some((entry) => entry.id === mm2024Delta.id),
  beforeItemCount: beforeCount,
  upgrade: {
    valid: upgradePreview.valid,
    creates: upgradePreview.creates,
    updates: upgradePreview.updates,
    unchanged: upgradePreview.unchanged,
    conflicts: upgradePreview.conflicts,
    errors: upgradePreview.errors.length,
    executable: upgradePlan.executable
  },
  afterItemCount: snapshot.items.length,
  replay: { valid: replay.valid, creates: replay.creates, updates: replay.updates, unchanged: replay.unchanged, conflicts: replay.conflicts, errors: replay.errors.length },
  pass
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${pass ? 'PASS' : 'FAIL'}: Spelljammer in-place 2024 compatibility upgrade - ${upgradePreview.updates} updates, ${upgradePreview.creates} creates, ${upgradePreview.conflicts} conflicts; replay ${replay.unchanged}/${compatible.items.length} unchanged.`);
if (!pass) process.exitCode = 1;
