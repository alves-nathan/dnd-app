#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'artifacts', 'custom-feat-feature-smoke-report.json');

const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado.');
};
const ts = loadTypeScript();
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText;
  module._compile(output, filename);
};

const { getSpellListAdditionRules, getSpellReplacementRules } = require(path.join(root, 'src', 'characters', 'customRuleEffects.ts'));
const { createEmptyCharacter, defaultCombatState } = require(path.join(root, 'src', 'data', 'mockData.ts'));
const { analyzeActionDamage } = require(path.join(root, 'src', 'rules-engine', 'damage', 'calculateDamage.ts'));
const { parseDamageFormula } = require(path.join(root, 'src', 'rules-engine', 'dice', 'parser.ts'));
const { applyRest, spendResources } = require(path.join(root, 'src', 'rules-engine', 'resources', 'resourceManager.ts'));

const friendlyFireFeature = () => ({
  id: 'friendly-fire-feature', name: 'Friendly Fire', sourceType: 'feat', custom: true,
  customRules: {
    damageMultipliers: [{ id: 'friendly-fire-double', damageType: 'fire', multiplier: 2, label: 'Friendly Fire' }],
    triggeredDamage: [{ id: 'friendly-fire-trigger', triggerDamageType: 'fire', triggerRoll: { count: 1, sides: 8 }, triggerValues: [1], radiusFeet: 30, saveAbility: 'DEX', saveSuccessDamage: 'half', damageMode: 'sameAsTriggeringDamage' }],
    grantedSpellItemIds: ['phb-2024-spell-fire-bolt']
  }
});
const fireBoltAction = () => ({
  id: 'fire-bolt-action', type: 'spell', name: 'Fire Bolt', actionCost: 'action', sourceType: 'spell', spellLevel: 0,
  damage: parseDamageFormula('1d10', { defaultSourceType: 'spell' }), damageTypes: ['fire'], targets: 1
});

const checks = [];
const check = (name, fn) => {
  try { checks.push({ name, pass: true, result: fn() }); }
  catch (error) { checks.push({ name, pass: false, error: error instanceof Error ? error.message : String(error) }); }
};

check('Friendly Fire damage multiplier and trigger surface', () => {
  const character = { ...createEmptyCharacter('Homebrew'), feats: [{ id: 'friendly-fire-feat', name: 'Friendly Fire', custom: true, features: [friendlyFireFeature()] }] };
  const result = analyzeActionDamage({ action: fireBoltAction(), character, combatState: defaultCombatState });
  assert.equal(result.perHit.min, 2); assert.equal(result.perHit.max, 20); assert.equal(result.perHit.average, 11);
  assert.ok(result.formula.includes('× 2'));
  assert.ok(result.warnings.some((issue) => issue.code === 'CUSTOM_DAMAGE_MULTIPLIER_APPLIED'));
  assert.ok(result.warnings.some((issue) => issue.code === 'CUSTOM_TRIGGERED_DAMAGE_RULE'));
  return { average: result.perHit.average, warnings: result.warnings.map((issue) => issue.code) };
});

check('damage multiplier is scoped by damage type', () => {
  const character = { ...createEmptyCharacter('Homebrew'), features: [friendlyFireFeature()] };
  const action = { ...fireBoltAction(), id: 'cold-bolt', name: 'Cold Bolt', damageTypes: ['cold'] };
  const result = analyzeActionDamage({ action, character, combatState: defaultCombatState });
  assert.equal(result.perHit.average, 5.5);
  assert.equal(result.warnings.some((issue) => issue.code === 'CUSTOM_DAMAGE_MULTIPLIER_APPLIED'), false);
  return { average: result.perHit.average };
});

check('custom spell-list addition is class scoped', () => {
  const character = {
    ...createEmptyCharacter('Bard'),
    features: [{ id: 'friendly-fire-list-feature', name: 'Friendly Fire', sourceType: 'manual', custom: true, customRules: { spellListAdditions: [{ id: 'friendly-fire-list', spellItemIds: ['phb-2024-spell-fire-bolt'], classNames: ['Bard'] }] } }]
  };
  assert.ok(getSpellListAdditionRules(character, 'Bard')[0]?.rule.spellItemIds.includes('phb-2024-spell-fire-bolt'));
  assert.equal(getSpellListAdditionRules(character, 'Wizard').length, 0);
  return { bardRules: getSpellListAdditionRules(character, 'Bard').length };
});

check('custom spell replacement spends and restores long-rest resource', () => {
  const character = {
    ...createEmptyCharacter('Bard'),
    classes: [{ id: 'bard-class', name: 'Bard', level: 7 }],
    features: [{ id: 'bard-flexibility', name: 'Flexible Repertoire', sourceType: 'manual', custom: true, customRules: { spellReplacement: [{ id: 'bard-flexibility-rule', count: 1, recharge: 'longRest', resourceId: 'bard-flexibility-resource', classNames: ['Bard'] }] } }],
    resources: [{ id: 'bard-flexibility-resource', name: 'Flexible Repertoire · troca de magia', max: 1, current: 1, recharge: 'longRest' }]
  };
  assert.equal(getSpellReplacementRules(character, 'Bard')[0]?.available, true);
  const spent = spendResources({ character, costs: [{ resourceId: 'bard-flexibility-resource', amount: 1 }], reason: 'Smoke' });
  assert.equal(spent.issues.some((issue) => issue.severity === 'error'), false);
  assert.equal(getSpellReplacementRules(spent.character, 'Bard')[0]?.available, false);
  const rested = applyRest(spent.character, 'longRest');
  assert.equal(getSpellReplacementRules(rested.character, 'Bard')[0]?.available, true);
  return { afterRest: rested.character.resources.find((resource) => resource.id === 'bard-flexibility-resource')?.current };
});

check('custom feat/feature UI wiring remains present', () => {
  const files = {
    customRule: fs.readFileSync(path.join(root, 'app/characters/[id]/custom-rule.tsx'), 'utf8'),
    feats: fs.readFileSync(path.join(root, 'app/characters/[id]/feats.tsx'), 'utf8'),
    features: fs.readFileSync(path.join(root, 'app/characters/[id]/features.tsx'), 'utf8'),
    newCharacter: fs.readFileSync(path.join(root, 'app/characters/new.tsx'), 'utf8'),
    selector: fs.readFileSync(path.join(root, 'src/components/ChoiceChipSelector.tsx'), 'utf8')
  };
  assert.ok(files.feats.includes('Criar feat personalizado'));
  assert.ok(files.features.includes('Criar feature personalizada'));
  assert.ok(files.customRule.includes('Preencher exemplo Friendly Fire'));
  assert.ok(files.newCharacter.includes('lockedSelectedValues={inheritedBackgroundTools'));
  assert.ok(files.selector.includes('lockedSelectedValues.includes(option)'));
  return { contracts: 5 };
});

const failures = checks.filter((entry) => !entry.pass);
const report = { schemaVersion: 'dnd-combat-custom-feat-feature-smoke.v1', checks, passed: checks.length - failures.length, failed: failures.length, pass: failures.length === 0 };
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[custom-feat-feature:smoke] ${report.pass ? 'PASS' : 'FAIL'} — ${report.passed}/${checks.length}`);
for (const entry of checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.error ? ` — ${entry.error}` : ''}`);
console.log(`report=${path.relative(root, reportPath)}`);
if (failures.length) process.exit(1);
