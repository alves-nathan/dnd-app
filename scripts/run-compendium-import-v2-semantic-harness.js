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
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-import-v2-semantic-harness-'));
const sourcePath = path.join(root, 'src', 'compendium', 'importSemanticValidation.ts');
const compiledPath = path.join(tempRoot, 'importSemanticValidation.js');
const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  fileName: sourcePath,
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
fs.writeFileSync(compiledPath, output);
const { analyzeCompendiumImportV2Semantics } = require(compiledPath);

const source = { id: 'harness', status: 'needsReview', confidence: 'importedNeedsReview' };
const pack = (items) => ({ templateVersion: 'dnd-combat-import.v2', id: 'harness-pack', source, items });
const codes = (result, severity) => result.issues.filter((entry) => !severity || entry.severity === severity).map((entry) => entry.code);

const duplicateCondition = analyzeCompendiumImportV2Semantics(pack([
  { id: 'condition-a', kind: 'condition', name: 'A', source, payload: { conditionId: 'same' } },
  { id: 'condition-b', kind: 'condition', name: 'B', source, payload: { conditionId: 'same' } }
]));
assert.equal(duplicateCondition.valid, false);
assert.ok(codes(duplicateCondition, 'error').includes('IMPORT_V2_DUPLICATE_CONDITION_ID'));
assert.equal(duplicateCondition.errors[0].path, 'payload.conditionId');

const ownerTiming = analyzeCompendiumImportV2Semantics(pack([
  {
    id: 'class-wizard', kind: 'class', name: 'Wizard', source,
    payload: { featureIds: ['feature-late'], progression: [{ level: 1, featureIds: ['feature-late'] }] }
  },
  {
    id: 'feature-late', kind: 'feature', name: 'Late Feature', source,
    payload: { sourceType: 'classFeature', classId: 'class-wizard', levelGained: 3 }
  }
]));
assert.ok(codes(ownerTiming, 'error').includes('IMPORT_V2_FEATURE_GRANTED_BEFORE_LEVEL_GAINED'));

const repeatedUpgrade = analyzeCompendiumImportV2Semantics(pack([
  {
    id: 'class-fighter', kind: 'class', name: 'Fighter', source,
    payload: {
      featureIds: ['feature-asi'],
      progression: [
        { level: 4, featureIds: ['feature-asi'] },
        { level: 6, featureIds: ['feature-asi'] },
        { level: 8, featureIds: ['feature-asi'] }
      ]
    }
  },
  {
    id: 'feature-asi', kind: 'feature', name: 'ASI', source,
    payload: { sourceType: 'classFeature', classId: 'class-fighter', levelGained: 4 }
  }
]));
assert.equal(repeatedUpgrade.errors.length, 0);

const equipmentRules = analyzeCompendiumImportV2Semantics(pack([
  {
    id: 'weapon-bad', kind: 'weapon', name: 'Bad Weapon', source,
    payload: { weaponType: 'melee', damageFormula: '1d6', properties: ['Versatile'], cost: { amount: 1, unit: 'GP' } }
  },
  {
    id: 'shield', kind: 'armor', name: 'Shield', source,
    payload: { armorCategory: 'shield', baseAC: 0, acBonus: 2, cost: { amount: 10, unit: 'GP' } }
  }
]));
assert.ok(codes(equipmentRules, 'error').includes('IMPORT_V2_WEAPON_CATEGORY_MISSING'));
assert.ok(codes(equipmentRules, 'warning').includes('IMPORT_V2_WEAPON_VERSATILE_DAMAGE_MISSING'));
assert.equal(equipmentRules.errors.some((entry) => entry.itemId === 'shield'), false);

const externalOwner = analyzeCompendiumImportV2Semantics(pack([
  { id: 'subclass-remote', kind: 'subclass', name: 'Remote', source, payload: { classId: 'class-existing' } }
]), { externalItems: [{ id: 'class-existing', kind: 'class' }] });
assert.equal(externalOwner.valid, true);

const actionRefs = analyzeCompendiumImportV2Semantics(pack([
  { id: 'condition-stunned', kind: 'condition', name: 'Stunned', source, payload: { conditionId: 'stunned' } },
  { id: 'equipment-kit', kind: 'equipment', name: 'Kit', source, payload: { cost: { amount: 1, unit: 'GP' } } },
  { id: 'spell-test', kind: 'spell', name: 'Test', source, payload: { level: 1, classes: ['Wizard'], castingTime: { kind: 'action', actionCost: 'action' } } },
  {
    id: 'feature-action', kind: 'feature', name: 'Action', source,
    payload: {
      sourceType: 'coreRule',
      grantsActions: [{
        name: 'Use', type: 'spell', spellId: 'spell-test', conditionIds: ['stunned'],
        consumes: [{ itemId: 'equipment-kit', amount: 1 }]
      }]
    }
  }
]));
assert.equal(actionRefs.errors.length, 0);
assert.equal(actionRefs.warnings.length, 0);

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('[compendium:import-v2:semantic-harness] PASS');
console.log('assertions=13');
