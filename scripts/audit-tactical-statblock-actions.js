#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado.');
};
const ts = loadTypeScript();
require.extensions['.ts'] = (mod, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText;
  mod._compile(output, filename);
};

const { createEmptyCharacter, defaultCombatState } = require(path.join(root, 'src/data/mockData.ts'));
const rules = require(path.join(root, 'src/characters/tacticalStatBlockRules.ts'));
const tactical = require(path.join(root, 'src/rules-engine/turns/tacticalCombat.ts'));
const turns = require(path.join(root, 'src/rules-engine/turns/turnCycle.ts'));
const { createCombatScenario } = require(path.join(root, 'src/rules-engine/turns/compareRotations.ts'));
const pack = require(path.join(root, 'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json'));

const stored = (name) => {
  const item = pack.items.find((entry) => entry.kind === 'creatureStatBlock' && entry.name === name);
  assert.ok(item, `fixture ${name}`);
  return {
    id: `phb:${item.id}`, importItemId: item.id, packId: pack.id, sourceId: item.source.id,
    type: 'creatureStatBlock', name: item.name, summary: item.summary, version: item.source.version,
    rawJson: item, normalizedJson: item.payload, tags: [], status: 'validated',
    createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z'
  };
};
const scenarioWith = (characterId, target) => ({
  ...createCombatScenario({ id: 'scenario', characterId, name: 'Stat blocks', combatState: { ...defaultCombatState }, now: '2026-08-11T00:00:00.000Z' }),
  actorPositionFeet: 0,
  targets: [target]
});
const seq = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)] ?? 0; };

const report = { checks: [] };
const check = (name, fn) => {
  try { fn(); report.checks.push({ name, pass: true }); }
  catch (error) { report.checks.push({ name, pass: false, error: error instanceof Error ? error.stack || error.message : String(error) }); }
};

check('Wolf projection', () => {
  const projection = rules.projectCreatureStatBlockToTacticalTarget(stored('Wolf'), { positionFeet: 5 });
  assert.equal(projection.target.armorClass, 12);
  assert.equal(projection.target.hitPoints.max, 11);
  assert.equal(projection.target.speedFeet, 40);
  assert.equal(projection.actions[0].attackBonus, 4);
  assert.equal(projection.actions[0].damageFormula, '1d6+2');
});

check('Attack vs character AC', () => {
  const character = { ...createEmptyCharacter('Hero'), abilities: { STR: 10, DEX: 14, CON: 10, INT: 10, WIS: 10, CHA: 10 }, hitPoints: { current: 20, max: 20, temporary: 0 } };
  const projection = rules.projectCreatureStatBlockToTacticalTarget(stored('Wolf'), { positionFeet: 5 });
  const target = tactical.createTacticalTarget({ id: 'wolf', ...projection.target });
  let scenario = turns.ensureTacticalParticipants(scenarioWith(character.id, target), character.name);
  scenario = turns.startTacticalTurn({ scenario, character, participantId: turns.targetParticipantId(target.id) }).scenario;
  const result = turns.resolveTargetStatBlockAction({ scenario, character, targetId: target.id, actionId: projection.actions[0].id, damageMode: 'average', rng: seq(0.45) });
  assert.equal(result.characterArmorClass, 12);
  assert.equal(result.attackRoll, 10);
  assert.equal(result.attackTotal, 14);
  assert.equal(result.hit, true);
  assert.equal(result.damage, 5);
  assert.equal(result.character.hitPoints.current, 15);
});

check('Save action', () => {
  const character = { ...createEmptyCharacter('Hero'), hitPoints: { current: 20, max: 20, temporary: 0 } };
  const projection = rules.projectCreatureStatBlockToTacticalTarget(stored('Quasit'), { positionFeet: 5 });
  const target = tactical.createTacticalTarget({ id: 'quasit', ...projection.target });
  let scenario = turns.ensureTacticalParticipants(scenarioWith(character.id, target), character.name);
  scenario = turns.startTacticalTurn({ scenario, character, participantId: turns.targetParticipantId(target.id) }).scenario;
  const scare = projection.actions.find((action) => action.name === 'Scare');
  const result = turns.resolveTargetStatBlockAction({ scenario, character, targetId: target.id, actionId: scare.id, rng: seq(0.2) });
  assert.equal(result.saveRoll, 5);
  assert.equal(result.saveSuccess, false);
  assert.ok(result.character.activeEffects.flatMap((effect) => effect.conditionIds || []).includes('frightened'));
});

check('Recharge resource', () => {
  const character = createEmptyCharacter('Hero');
  const projection = rules.projectCreatureStatBlockToTacticalTarget(stored('Ape'), { positionFeet: 20 });
  const target = tactical.createTacticalTarget({ id: 'ape', ...projection.target, statBlockResources: projection.resources.map((resource) => ({ ...resource, current: 0 })) });
  const scenario = turns.ensureTacticalParticipants(scenarioWith(character.id, target), character.name);
  assert.equal(target.statBlockResources[0].rechargeMin, 6);
  const result = turns.rechargeTargetStatBlockResource({ scenario, targetId: target.id, resourceId: target.statBlockResources[0].id, rng: () => 0.99 });
  assert.equal(result.roll, 6);
  assert.equal(result.recharged, true);
  assert.equal(result.scenario.targets[0].statBlockResources[0].current, 1);
});

check('Target reaction', () => {
  const character = createEmptyCharacter('Hero');
  const projection = rules.projectCreatureStatBlockToTacticalTarget(stored('Construct Spirit'), { positionFeet: 5 });
  const target = tactical.createTacticalTarget({ id: 'construct', ...projection.target });
  const scenario = turns.ensureTacticalParticipants(scenarioWith(character.id, target), character.name);
  const reaction = projection.actions.find((action) => action.section === 'reaction');
  const result = turns.resolveTargetStatBlockAction({ scenario, character, targetId: target.id, actionId: reaction.id });
  assert.equal(result.issues.length, 0);
  assert.equal(result.scenario.participants.find((entry) => entry.id === turns.targetParticipantId(target.id)).reactionAvailable, false);
});

const failed = report.checks.filter((entry) => !entry.pass);
report.summary = { total: report.checks.length, passed: report.checks.length - failed.length, failed: failed.length };
const artifactPath = path.join(root, 'artifacts/tactical-statblock-actions-audit.json');
fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
fs.writeFileSync(artifactPath, JSON.stringify(report, null, 2) + '\n');
if (failed.length) {
  console.error('Tactical stat block actions audit FAIL');
  failed.forEach((entry) => console.error(`- ${entry.name}: ${entry.error}`));
  process.exit(1);
}
console.log(`Tactical stat block actions audit PASS — ${report.summary.passed}/${report.summary.total}`);
