#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  for (const candidate of [
    'typescript',
    '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js',
    '/usr/local/lib/node_modules/typescript/lib/typescript.js'
  ]) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-import-v2-preview-harness-'));
const tempSrc = path.join(tempRoot, 'src');
const tempCompendium = path.join(tempSrc, 'compendium');
const tempTypes = path.join(tempSrc, 'types');
fs.mkdirSync(tempCompendium, { recursive: true });
fs.mkdirSync(tempTypes, { recursive: true });

const transpile = (input, output) => {
  const source = fs.readFileSync(input, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: input,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  });
  fs.writeFileSync(output, result.outputText);
};

transpile(path.join(root, 'src', 'types', 'index.ts'), path.join(tempTypes, 'index.js'));
for (const fileName of [
  'importVersions.ts',
  'importDomain.ts',
  'importNormalization.ts',
  'importSemanticValidation.ts',
  'importContentHash.ts',
  'importPreview.ts',
  'importUpsertPlan.ts'
]) transpile(path.join(root, 'src', 'compendium', fileName), path.join(tempCompendium, fileName.replace(/\.ts$/, '.js')));

const { createImportContentHash } = require(path.join(tempCompendium, 'importContentHash.js'));
const { buildCompendiumImportV2Preview } = require(path.join(tempCompendium, 'importPreview.js'));
const { createCompendiumImportV2UpsertPlan } = require(path.join(tempCompendium, 'importUpsertPlan.js'));

const source = { id: 'phb-2024', book: 'PHB', version: '2024', status: 'active', confidence: 'exact', rulesEra: '2024', contentType: 'official' };
const spell = (damageFormula = '1d10', override = {}) => ({
  id: 'phb-2024-spell-fire-bolt',
  kind: 'spell',
  name: 'Fire Bolt',
  source,
  payload: {
    level: 0,
    classes: ['Wizard'],
    castingTime: { kind: 'action', actionCost: 'action' },
    damageFormula,
    ...override
  }
});
const pack = (items) => ({ templateVersion: 'dnd-combat-import.v2', id: 'pack', source, items });

assert.equal(
  createImportContentHash({ a: 1, b: 2, importedAt: 'yesterday' }),
  createImportContentHash({ b: 2, a: 1, importedAt: 'today' })
);

const creates = buildCompendiumImportV2Preview(pack([spell()]), []);
assert.equal(creates.valid, true);
assert.equal(creates.creates, 1);
assert.equal(creates.updates, 0);

const existing = [{
  id: 'stored:fire-bolt', importItemId: 'phb-2024-spell-fire-bolt', type: 'spell', name: 'Fire Bolt', sourceId: 'phb-2024',
  rawJson: spell()
}];
const unchanged = buildCompendiumImportV2Preview(pack([spell()]), existing);
assert.equal(unchanged.unchanged, 1);
assert.equal(unchanged.conflicts, 0);

const updated = buildCompendiumImportV2Preview(pack([spell('2d10')]), existing);
assert.equal(updated.updates, 1);
assert.ok(updated.decisions[0].changedPaths.includes('payload.damageFormula'));
const plan = createCompendiumImportV2UpsertPlan(pack([spell('2d10')]), updated);
assert.equal(plan.executable, true);
assert.equal(plan.updates.length, 1);
assert.equal(plan.updates[0].existingStorageId, 'stored:fire-bolt');

const wrongSource = buildCompendiumImportV2Preview(pack([{ ...spell(), source: { ...source, id: 'legacy-source' } }]), existing);
assert.equal(wrongSource.conflicts, 1);
assert.equal(wrongSource.decisions[0].conflictReason, 'sourceMismatch');
assert.equal(createCompendiumImportV2UpsertPlan(pack([{ ...spell(), source: { ...source, id: 'legacy-source' } }]), wrongSource).executable, false);

const duplicates = buildCompendiumImportV2Preview(pack([spell()]), [existing[0], { ...existing[0], id: 'stored:duplicate' }]);
assert.equal(duplicates.conflicts, 1);
assert.equal(duplicates.decisions[0].conflictReason, 'duplicateExistingId');

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('[compendium:import-v2:preview-harness] PASS');
console.log('assertions=17');
