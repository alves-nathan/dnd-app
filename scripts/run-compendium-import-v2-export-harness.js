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
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-import-v2-export-harness-'));
const tempSrc = path.join(tempRoot, 'src');
const tempCompendium = path.join(tempSrc, 'compendium');
const tempTypes = path.join(tempSrc, 'types');
fs.mkdirSync(tempCompendium, { recursive: true });
fs.mkdirSync(tempTypes, { recursive: true });

const transpile = (input, output) => {
  const result = ts.transpileModule(fs.readFileSync(input, 'utf8'), {
    fileName: input,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  });
  fs.writeFileSync(output, result.outputText);
};

transpile(path.join(root, 'src', 'types', 'index.ts'), path.join(tempTypes, 'index.js'));
for (const fileName of ['importVersions.ts', 'importDomain.ts', 'importContentHash.ts', 'importNormalization.ts', 'importSemanticValidation.ts', 'importV2Export.ts', 'packageExport.ts']) {
  transpile(path.join(root, 'src', 'compendium', fileName), path.join(tempCompendium, fileName.replace(/\.ts$/, '.js')));
}

// Runtime-only parser stub for this dependency-free harness. The production
// function still uses parseImportPack + Zod; this stub exercises the JSON and
// canonical normalization boundary when node_modules is intentionally absent.
fs.writeFileSync(path.join(tempCompendium, 'parseImportPack.js'), `
const { normalizeCompendiumImportPack } = require('./importNormalization.js');
exports.parseImportPack = (input) => {
  let value = input;
  const issues = [];
  if (typeof input === 'string') {
    try { value = JSON.parse(input); }
    catch { return { ok: false, detectedVersion: 'unknown', issues: [{ severity: 'error', code: 'IMPORT_JSON_ERROR', message: 'JSON inválido.' }], normalizationIssues: [] }; }
  }
  const normalized = normalizeCompendiumImportPack(value);
  const runtimeIssues = normalized.issues.map((entry) => ({ severity: entry.severity, code: entry.code, message: entry.path ? entry.path + ': ' + entry.message : entry.message }));
  return { ok: Boolean(normalized.value) && runtimeIssues.every((entry) => entry.severity !== 'error'), detectedVersion: 'dnd-combat-import.v2', data: normalized.value, issues: runtimeIssues, normalizationIssues: normalized.issues };
};
`);

const { buildCompendiumPackageExport } = require(path.join(tempCompendium, 'packageExport.js'));
const { createCompendiumImportItemContentHash } = require(path.join(tempCompendium, 'importContentHash.js'));

const source = { id: 'test-2024', book: 'Round Trip Test', version: '2024', status: 'active', confidence: 'exact', rulesEra: '2024', contentType: 'official' };
const items = [
  { id: 'feature', kind: 'feature', name: 'Feature', source, payload: { sourceType: 'class', classId: 'class', levelGained: 1 } },
  { id: 'class', kind: 'class', name: 'Wizard', source, payload: { featureIds: ['feature'], progression: [{ level: 1, featureIds: ['feature'] }] } },
  { id: 'subclass', kind: 'subclass', name: 'School', source, payload: { classId: 'class', featureIds: [] } },
  { id: 'species', kind: 'species', name: 'Human', source, payload: { creatureType: 'Humanoid', speed: 30, size: 'Medium' } },
  { id: 'feat', kind: 'feat', name: 'Skilled', source, payload: { category: 'Origin' } },
  { id: 'background', kind: 'background', name: 'Sage', source, payload: { featIds: ['feat'], skillProficiencies: ['Arcana', 'History'] } },
  { id: 'weapon', kind: 'weapon', name: 'Spear', source, payload: { weaponCategory: 'simple', weaponType: 'melee', damageFormula: '1d6', cost: { amount: 1, unit: 'GP' } } },
  { id: 'armor', kind: 'armor', name: 'Leather', source, payload: { armorCategory: 'light', baseAC: 11, cost: { amount: 10, unit: 'GP' } } },
  { id: 'equipment', kind: 'equipment', name: 'Book', source, payload: { equipmentCategory: 'gear', cost: { amount: 25, unit: 'GP' } } },
  { id: 'magic-item', kind: 'magicItem', name: 'Wand', source, payload: { rarity: 'Uncommon', equipmentCategory: 'wand' } },
  { id: 'spell', kind: 'spell', name: 'Fire Bolt', source, payload: { level: 0, classes: ['Wizard'], classIds: ['class'], castingTime: { kind: 'action', actionCost: 'action' }, damageFormula: '1d10', damageType: 'fire' } },
  { id: 'condition', kind: 'condition', name: 'Prone', source, payload: { conditionId: 'prone', officialCondition: true } },
  { id: 'creature', kind: 'creatureStatBlock', name: 'Wolf', source, payload: { size: 'Medium', creatureType: 'Beast', armorClass: 13, hitPoints: 11, speed: { walk: 40 }, actions: [{ name: 'Bite', damageFormula: '2d4+2', conditionIds: ['prone'] }] } }
];
const stored = items.map((item, index) => ({
  id: `pack:${item.id}`, importItemId: item.id, packId: 'pack', sourceId: source.id, type: item.kind,
  name: item.name, version: '2024', rawJson: item, normalizedJson: { ...item.payload, id: item.id, name: item.name, type: item.kind, sourceId: source.id },
  contentHash: `old-${index}`, tags: [item.kind], status: 'validated', reviewDecision: 'approved',
  createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z'
}));
const snapshot = {
  sources: [source], enabledSourceIds: [source.id],
  packs: [{ id: 'pack', name: 'Pack', sourceId: source.id, schemaVersion: 'dnd-combat-import.v2', checksum: 'x', importedAt: '2026-08-11T00:00:00.000Z', itemCount: items.length }],
  items: stored
};

const result = buildCompendiumPackageExport(snapshot, { exportId: 'roundtrip', exportName: 'Roundtrip', statuses: ['validated'], includeReviewMetadata: true, includeOriginalSourceMetadata: true, exportedAt: '2026-08-11T01:00:00.000Z' });
assert.equal(result.ok, true);
assert.equal(result.data.templateVersion, 'dnd-combat-import.v2');
assert.equal(result.data.items.length, 13);
assert.equal(new Set(result.data.items.map((item) => item.kind)).size, 13);
assert.equal(result.roundTrip.valid, true);
assert.equal(result.roundTrip.matchingItemHashes, 13);
assert.ok(result.data.metadata.storageOrigins);
assert.ok(result.data.metadata.review);
assert.equal(result.data.items.every((item) => !Object.prototype.hasOwnProperty.call(item.payload, 'exportMetadata')), true);
for (const item of items) {
  const exported = result.data.items.find((entry) => entry.id === item.id);
  assert.ok(exported);
  assert.equal(createCompendiumImportItemContentHash(exported), createCompendiumImportItemContentHash(item));
}

const forced = buildCompendiumPackageExport(snapshot, { exportId: 'forced', statuses: ['validated'], forceNeedsReview: true, exportedAt: '2026-08-11T01:15:00.000Z' });
assert.equal(forced.ok, true);
assert.equal(forced.data.items.every((item) => item.source.status === 'needsReview' && item.source.confidence === 'importedNeedsReview'), true);
assert.equal(forced.roundTrip.valid, true);

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('[compendium:import-v2:export-harness] PASS');
console.log('items=13 kinds=13 roundTrip=13/13');
