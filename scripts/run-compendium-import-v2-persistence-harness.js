#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-import-v2-persistence-harness-'));
const tempSrc = path.join(tempRoot, 'src');
const tempCompendium = path.join(tempSrc, 'compendium');
const tempStorage = path.join(tempSrc, 'storage');
const tempTypes = path.join(tempSrc, 'types');
fs.mkdirSync(tempCompendium, { recursive: true });
fs.mkdirSync(tempStorage, { recursive: true });
fs.mkdirSync(tempTypes, { recursive: true });

const transpile = (input, output) => {
  const result = ts.transpileModule(fs.readFileSync(input, 'utf8'), {
    fileName: input,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  });
  fs.writeFileSync(output, result.outputText);
};

transpile(path.join(root, 'src', 'types', 'index.ts'), path.join(tempTypes, 'index.js'));
for (const fileName of ['importVersions.ts', 'importDomain.ts', 'importContentHash.ts', 'importUpsertPlan.ts']) {
  transpile(path.join(root, 'src', 'compendium', fileName), path.join(tempCompendium, fileName.replace(/\.ts$/, '.js')));
}
transpile(path.join(root, 'src', 'storage', 'compendiumV2Persistence.ts'), path.join(tempStorage, 'compendiumV2Persistence.js'));

const {
  applyCompendiumImportV2PlanToSnapshot,
  buildStoredCompendiumV2Item,
  createCompendiumV2StorageItemId
} = require(path.join(tempStorage, 'compendiumV2Persistence.js'));

const source = { id: 'phb-2024', book: 'PHB', version: '2024', status: 'active', confidence: 'exact', rulesEra: '2024', contentType: 'official' };
const spell = (damage = '1d10') => ({ id: 'phb-2024-spell-fire-bolt', kind: 'spell', name: 'Fire Bolt', source, payload: { level: 0, classes: ['Wizard'], damageFormula: damage } });
const pack = (id = 'phb-pack', damage = '1d10') => ({ templateVersion: 'dnd-combat-import.v2', id, source, items: [spell(damage)] });
const empty = { sources: [], packs: [], items: [], enabledSourceIds: [] };
const createPlan = {
  packId: 'phb-pack', creates: [{ kind: 'create', itemId: spell().id, contentHash: 'cmpv2_create', item: spell(), changedPaths: [] }], updates: [], unchangedItemIds: [], unchangedContentHashes: {}, conflictItemIds: [], executable: true
};

const first = applyCompendiumImportV2PlanToSnapshot(empty, pack(), createPlan, { importedAt: '2026-08-10T23:00:00.000Z' });
assert.equal(first.summary.created, 1);
assert.equal(first.snapshot.items[0].id, createCompendiumV2StorageItemId('phb-pack', spell().id));
assert.equal(first.snapshot.items[0].contentHash, 'cmpv2_create');
assert.equal(first.snapshot.enabledSourceIds.includes('phb-2024'), true);

const existingId = first.snapshot.items[0].id;
const characterReference = { itemId: existingId };
const updatePlan = {
  packId: 'patch-pack', creates: [], updates: [{ kind: 'update', itemId: spell().id, contentHash: 'cmpv2_update', item: spell('2d10'), existingStorageId: existingId, changedPaths: ['payload.damageFormula'] }], unchangedItemIds: [], unchangedContentHashes: {}, conflictItemIds: [], executable: true
};
const updated = applyCompendiumImportV2PlanToSnapshot(first.snapshot, pack('patch-pack', '2d10'), updatePlan, { importedAt: '2026-08-10T23:30:00.000Z' });
assert.equal(updated.summary.updated, 1);
assert.equal(updated.snapshot.items[0].id, characterReference.itemId);
assert.equal(updated.snapshot.items[0].packId, 'phb-pack');
assert.equal(updated.snapshot.items[0].normalizedJson.damageFormula, '2d10');

const disabled = { ...updated.snapshot.items[0], status: 'disabled', reviewDecision: 'rejected', reviewNotes: 'local' };
const persistedDisabled = buildStoredCompendiumV2Item(updatePlan.updates[0], 'patch-pack', '2026-08-11T00:00:00.000Z', disabled);
assert.equal(persistedDisabled.status, 'disabled');
assert.equal(persistedDisabled.reviewNotes, 'local');

const noHashSnapshot = { ...updated.snapshot, items: [{ ...updated.snapshot.items[0], contentHash: undefined }] };
const unchangedPlan = { packId: 'patch-pack', creates: [], updates: [], unchangedItemIds: [spell().id], unchangedContentHashes: { [spell().id]: 'cmpv2_backfill' }, conflictItemIds: [], executable: true };
const backfilled = applyCompendiumImportV2PlanToSnapshot(noHashSnapshot, pack('patch-pack', '2d10'), unchangedPlan, { importedAt: '2026-08-11T00:15:00.000Z' });
assert.equal(backfilled.summary.contentHashesBackfilled, 1);
assert.equal(backfilled.snapshot.items[0].contentHash, 'cmpv2_backfill');
assert.equal(backfilled.snapshot.items[0].id, existingId);

assert.throws(() => applyCompendiumImportV2PlanToSnapshot(first.snapshot, pack(), { ...createPlan, executable: false }), /não pode ser executado/);

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('[compendium:import-v2:persistence-harness] PASS');
console.log('assertions=14');
