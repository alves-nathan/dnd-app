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

const spatial = require(path.join(root, 'src/rules-engine/targeting/spatialMap.ts'));
const tactical = require(path.join(root, 'src/rules-engine/turns/tacticalCombat.ts'));
const turns = require(path.join(root, 'src/rules-engine/turns/turnCycle.ts'));
const { createCombatScenario } = require(path.join(root, 'src/rules-engine/turns/compareRotations.ts'));
const { createEmptyCharacter, defaultCombatState } = require(path.join(root, 'src/data/mockData.ts'));
const { parseDamageFormula } = require(path.join(root, 'src/rules-engine/dice/parser.ts'));

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const files = {
  types: read('src/types/index.ts'),
  rules: read('src/rules-engine/targeting/spatialMap.ts'),
  combat: read('src/rules-engine/turns/tacticalCombat.ts'),
  turnCycle: read('src/rules-engine/turns/turnCycle.ts'),
  ui: read('app/characters/[id]/tactical.tsx'),
  store: read('src/store/combatScenarioStore.ts'),
  roadmap: read('docs/ROADMAP_CHARACTER_CREATION_PHASE5H_TURN_CYCLE_REACTIONS.md')
};

const contracts = [
  ['Linear mode preserved', files.types.includes("TacticalSpatialMode = 'linear' | 'map2d'") && files.ui.includes('label="Linear"')],
  ['Optional X/Y coordinates', files.types.includes('interface TacticalMapPoint') && files.ui.includes('Personagem · X (ft)') && files.ui.includes('label="Y (ft)"')],
  ['Configurable diagonal distance', files.types.includes('TacticalDiagonalRule') && files.rules.includes('tacticalDistanceBetweenPoints') && files.ui.includes('Alternar 5/10')],
  ['Regional difficult terrain', files.types.includes('interface TacticalTerrainRegion') && files.rules.includes('tacticalMovementCostBetweenPoints') && files.ui.includes('Adicionar região de terreno difícil')],
  ['Per-target cover and LOS', files.types.includes('cover: CoverLevel') && files.types.includes('lineOfSight: boolean') && files.ui.includes('Linha de visão')],
  ['Map distance reaches combat state', files.combat.includes('tacticalDistanceToTarget(normalized, target)')],
  ['Target turn movement uses map cost', files.turnCycle.includes('tacticalMovementCostBetweenPoints(scenario, startPoint, endPoint)')],
  ['2D Cleave adjacency', files.combat.includes('tacticalDistanceBetweenTargets(scenario, secondary, primaryTarget)')],
  ['Conservative automatic AoE membership', files.rules.includes('tacticalTargetsInsideArea') && files.ui.includes('Selecionar pela área')],
  ['Persisted scenario migration v5', files.store.includes('version: 5')],
  ['Roadmap block complete', !files.roadmap.includes('- [ ] Manter o modo linear atual.') && !files.roadmap.includes('- [ ] Adicionar coordenadas X/Y opcionais.')]
];

const baseScenario = (characterId = 'character') => ({
  ...createCombatScenario({ id: 'map', characterId, name: 'Mapa', combatState: { ...defaultCombatState }, now: '2026-08-11T00:00:00.000Z' }),
  spatialMode: 'map2d',
  diagonalRule: 'fiveFeet',
  actorPositionFeet: 0,
  actorMapPosition: { xFeet: 0, yFeet: 0 },
  targets: [
    tactical.createTacticalTarget({ id: 'a', name: 'A', positionFeet: 10, mapPosition: { xFeet: 10, yFeet: 0 }, cover: 'half', lineOfSight: true, hitPoints: { current: 20, max: 20 } }),
    tactical.createTacticalTarget({ id: 'b', name: 'B', positionFeet: 100, mapPosition: { xFeet: 10, yFeet: 5 }, hitPoints: { current: 20, max: 20 } }),
    tactical.createTacticalTarget({ id: 'c', name: 'C', positionFeet: 40, mapPosition: { xFeet: 10, yFeet: 10 }, hitPoints: { current: 20, max: 20 } }),
    tactical.createTacticalTarget({ id: 'd', name: 'D', positionFeet: 60, mapPosition: { xFeet: 30, yFeet: 0 }, hitPoints: { current: 20, max: 20 } })
  ]
});

const runtimeChecks = [];
const check = (name, fn) => {
  try { fn(); runtimeChecks.push({ name, pass: true }); }
  catch (error) { runtimeChecks.push({ name, pass: false, error: error instanceof Error ? error.stack || error.message : String(error) }); }
};

check('Diagonal rules', () => {
  const a = { xFeet: 0, yFeet: 0 };
  const b = { xFeet: 10, yFeet: 10 };
  assert.equal(spatial.tacticalDistanceBetweenPoints(a, b, 'fiveFeet'), 10);
  assert.equal(spatial.tacticalDistanceBetweenPoints(a, b, 'alternating5_10'), 15);
  assert.equal(spatial.tacticalDistanceBetweenPoints(a, b, 'euclidean'), 14.1);
});

check('Cover/LOS with map distance', () => {
  const scenario = baseScenario();
  assert.deepEqual(tactical.combatStateForTarget(scenario, 'a'), assert.match ? tactical.combatStateForTarget(scenario, 'a') : tactical.combatStateForTarget(scenario, 'a'));
  const state = tactical.combatStateForTarget(scenario, 'a');
  assert.equal(state.targetDistanceFeet, 10);
  assert.equal(state.cover, 'half');
  assert.equal(state.lineOfSight, true);
});

check('Regional difficult terrain', () => {
  const scenario = { ...baseScenario(), terrainRegions: [{ id: 'mud', label: 'Lama', shape: 'rectangle', xFeet: 5, yFeet: -5, widthFeet: 10, heightFeet: 10, movementMultiplier: 2 }] };
  const movement = spatial.tacticalMovementCostBetweenPoints(scenario, { xFeet: 0, yFeet: 0 }, { xFeet: 20, yFeet: 0 });
  assert.equal(movement.distanceFeet, 20);
  assert.equal(movement.difficultTerrainFeet, 10);
  assert.equal(movement.costFeet, 30);
});

check('Target movement consumes regional cost', () => {
  const character = createEmptyCharacter('Mover');
  let scenario = { ...baseScenario(character.id), terrainRegions: [{ id: 'mud', label: 'Lama', shape: 'rectangle', xFeet: 5, yFeet: -5, widthFeet: 10, heightFeet: 10, movementMultiplier: 2 }], targets: [tactical.createTacticalTarget({ id: 'walker', name: 'Walker', positionFeet: 20, mapPosition: { xFeet: 20, yFeet: 0 }, speedFeet: 30 })] };
  scenario = turns.ensureTacticalParticipants(scenario, character.name);
  scenario = turns.startTacticalTurn({ scenario, character, participantId: turns.targetParticipantId('walker') }).scenario;
  const moved = turns.moveTargetDuringTurn({ scenario, characterName: character.name, targetId: 'walker', distanceFeet: 10, direction: 'towardActor' });
  assert.equal(moved.issues.length, 0);
  assert.deepEqual(moved.scenario.targets[0].mapPosition, { xFeet: 10, yFeet: 0 });
  assert.equal(moved.scenario.participants.find((participant) => participant.id === turns.targetParticipantId('walker')).movementSpentFeet, 15);
});

check('Automatic area membership', () => {
  const scenario = baseScenario();
  assert.deepEqual(spatial.tacticalTargetsInsideArea(scenario, { shape: 'cone', sizeFeet: 15, origin: 'actor' }, 'a').targetIds, ['a', 'b']);
  assert.deepEqual(spatial.tacticalTargetsInsideArea(scenario, { shape: 'sphere', radiusFeet: 10, origin: 'point' }, 'a').targetIds, ['a', 'b', 'c']);
  assert.equal(spatial.tacticalTargetsInsideArea(scenario, { shape: 'cube', sizeFeet: 15, origin: 'actor' }, 'a').automatic, false);
});

check('2D Cleave adjacency', () => {
  const character = createEmptyCharacter('Cleave');
  const action = { id: 'cleave', type: 'attack', name: 'Greataxe', actionCost: 'action', sourceType: 'weapon', damage: parseDamageFormula('1d12 + STR'), attacksCount: 1, mastery: { property: 'cleave', label: 'Cleave', description: 'Secondary' } };
  const rotation = { id: 'rotation', characterId: character.id, name: 'Cleave', actions: [{ id: 'cleave-action', name: 'Cleave', actionCost: 'action', action, targetId: 'a' }] };
  const scenario = baseScenario(character.id);
  assert.equal(spatial.tacticalDistanceBetweenTargets(scenario, scenario.targets[0], scenario.targets[1]), 5);
  const result = tactical.resolveTacticalRotation({ character, rotation, scenario, resolutions: [{ actionId: 'cleave-action', targetId: 'a', confirmedHits: 1, targetResults: [{ targetId: 'a', confirmedHits: 1, damage: 8 }, { targetId: 'b', confirmedHits: 1, damage: 6 }] }] });
  assert.equal(result.issues.some((entry) => entry.code === 'TACTICAL_CLEAVE_TARGET_NOT_ADJACENT'), false);
  assert.equal(result.scenario.targets.find((target) => target.id === 'b').hitPoints.current, 14);
});

const contractFailures = contracts.filter(([, ok]) => !ok).map(([name]) => name);
const runtimeFailures = runtimeChecks.filter((entry) => !entry.pass);
const report = {
  schemaVersion: 'dnd-combat-tactical-map-audit.v2',
  generatedAt: new Date().toISOString(),
  contracts: Object.fromEntries(contracts),
  runtimeChecks,
  diagonalRules: ['fiveFeet', 'alternating5_10', 'euclidean'],
  terrainShapes: ['rectangle', 'circle'],
  automaticAreaShapes: ['line', 'cone', 'sphere', 'cylinder', 'emanation', 'square(point/target)'],
  status: contractFailures.length || runtimeFailures.length ? 'FAIL' : 'PASS',
  failures: [...contractFailures, ...runtimeFailures.map((entry) => entry.name)]
};
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
fs.writeFileSync(path.join(artifacts, 'tactical-map-audit.json'), JSON.stringify(report, null, 2) + '\n');
if (report.status !== 'PASS') {
  console.error('Tactical map audit FAIL');
  report.failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Tactical map audit PASS — ${runtimeChecks.length}/${runtimeChecks.length} runtime checks + ${contracts.length}/${contracts.length} contracts`);
