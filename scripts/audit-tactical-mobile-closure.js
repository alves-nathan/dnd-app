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

const fixture = require(path.join(root, 'src/fixtures/e2eTacticalMobile.ts'));
const turns = require(path.join(root, 'src/rules-engine/turns/turnCycle.ts'));
const { buildAvailableActions } = require(path.join(root, 'src/rules-engine/actions/buildActions.ts'));
const { TACTICAL_MOBILE_CLOSURE_FLOWS } = require(path.join(root, 'scripts/lib/tactical-mobile-closure.js'));

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const files = {
  seed: read('app/e2e-seed.tsx'),
  tactical: read('app/characters/[id]/tactical.tsx'),
  statRow: read('src/components/StatRow.tsx'),
  fixture: read('src/fixtures/e2eTacticalMobile.ts'),
  evidence: read('scripts/lib/beta-native-evidence.js'),
  checklist: read('scripts/lib/mobile-test-session.js'),
  roadmap: read('docs/ROADMAP_CHARACTER_CREATION_PHASE5H_TURN_CYCLE_REACTIONS.md')
};

const flowPaths = TACTICAL_MOBILE_CLOSURE_FLOWS;

const contracts = [
  ['Dedicated tactical E2E fixture', files.fixture.includes('createE2ETacticalMobileCharacter') && files.fixture.includes('createE2ETacticalMobileScenario')],
  ['Seed screen prepares deterministic tactical state', files.seed.includes('e2e-seed-tactical-mobile') && files.seed.includes('e2e-open-tactical-mobile')],
  ['Four tactical Maestro flows are present', flowPaths.every(exists)],
  ['Four tactical Maestro flows share closure tag', flowPaths.every((flow) => read(flow).includes('tactical-mobile-closure'))],
  ['Initiative and round flow has stable selectors', read(flowPaths[0]).includes('tactical-start-turn-character') && read(flowPaths[0]).includes('tactical-round-status')],
  ['Sap/concentration flow has stable selectors', read(flowPaths[1]).includes('tactical-concentration-failure') && read(flowPaths[1]).includes('tactical-character-concentration')],
  ['Opportunity/War Caster flow has stable selectors', read(flowPaths[2]).includes('tactical-target-move-apply') && read(flowPaths[2]).includes('tactical-reaction-select-spell_e2e-tactical-war-caster-spell')],
  ['Ready/slot flow has stable selectors', read(flowPaths[3]).includes('tactical-ready-select-spell_e2e-tactical-ready-spell') && read(flowPaths[3]).includes('tactical-character-spell-slots')],
  ['Tactical screen exposes persistent state for native assertions', files.tactical.includes('testID="tactical-character-hp"') && files.tactical.includes('testID="tactical-character-concentration"') && files.tactical.includes('testID="tactical-character-spell-slots"')],
  ['Tactical status rows expose accessibility labels', files.statRow.includes('accessibilityLabel={`${label}:') && files.statRow.includes('testID={testID}')],
  ['Tactical screen no longer uses legacy hard-coded gray labels', !files.tactical.includes("color: '#475569'") && !files.tactical.includes("color: '#64748b'")],
  ['Native evidence contract is v3', files.evidence.includes("dnd-combat-beta-native-evidence.v3")],
  ['Accessibility checklist includes screen reader and large text', files.checklist.includes("'screenReaderNavigation'") && files.checklist.includes("'largeText'")],
  ['Native closure checklist is documented', exists('docs/TACTICAL_MOBILE_CLOSURE_NATIVE_CHECKLIST.md')],
  ['Focused native Android runner exists', exists('scripts/run-tactical-mobile-closure-native.js') && read('scripts/run-tactical-mobile-closure-native.js').includes('TACTICAL_MOBILE_CLOSURE_FLOWS') && read('scripts/run-tactical-mobile-closure-native.js').includes("MAESTRO_INCLUDE_TAGS: 'tactical-mobile-closure'")],
  ['Artifact runner supports selected flows and remote Maestro host', read('scripts/e2e/run-maestro-with-artifacts.sh').includes('FLOW_ARGS=("$@")') && read('scripts/e2e/run-maestro-with-artifacts.sh').includes('MAESTRO_HOST') && read('scripts/e2e/run-maestro-with-artifacts.sh').includes('MAESTRO_INCLUDE_TAGS')],
  ['Maestro resolver checks default installer directory', read('scripts/lib/mobile-tools.js').includes("'.maestro', 'bin'") && read('scripts/lib/mobile-tools.js').includes('maestroCandidates')]
];

const runtimeChecks = [];
const check = (name, fn) => {
  try {
    const details = fn() || {};
    runtimeChecks.push({ name, pass: true, details });
  } catch (error) {
    runtimeChecks.push({ name, pass: false, error: error instanceof Error ? error.stack || error.message : String(error) });
  }
};

const reset = () => {
  const character = fixture.createE2ETacticalMobileCharacter();
  return { character, scenario: fixture.createE2ETacticalMobileScenario(character) };
};

check('Initiative order completes a round', () => {
  let { character, scenario } = reset();
  const actorId = turns.actorParticipantId(character.id);
  const targetId = turns.targetParticipantId(fixture.E2E_TACTICAL_TARGET_ID);
  let result = turns.startTacticalTurn({ scenario, character, participantId: actorId });
  assert.equal(result.issues.length, 0);
  ({ scenario, character } = result);
  result = turns.endTacticalTurn({ scenario, character });
  assert.equal(result.issues.length, 0);
  ({ scenario, character } = result);
  assert.equal(scenario.round, 1);
  result = turns.startTacticalTurn({ scenario, character, participantId: targetId });
  assert.equal(result.issues.length, 0);
  ({ scenario, character } = result);
  result = turns.endTacticalTurn({ scenario, character });
  assert.equal(result.issues.length, 0);
  assert.equal(result.scenario.round, 2);
  assert.equal(result.scenario.participants.every((entry) => entry.hasActed === false), true);
  return { round: result.scenario.round };
});

check('Target attack consumes Sap, applies damage and resolves concentration failure', () => {
  let { character, scenario } = reset();
  const started = turns.startTacticalTurn({ scenario, character, participantId: turns.targetParticipantId(fixture.E2E_TACTICAL_TARGET_ID) });
  ({ scenario, character } = started);
  const attack = turns.recordTargetAttack({
    scenario,
    character,
    targetId: fixture.E2E_TACTICAL_TARGET_ID,
    attackName: 'E2E Club',
    hit: true,
    damage: 12,
    concentrationSave: 'failure'
  });
  assert.equal(attack.issues.length, 0);
  assert.equal(attack.rollMode, 'disadvantage');
  assert.equal(attack.concentrationDC, 10);
  assert.equal(attack.character.hitPoints.current, 20);
  assert.equal(attack.character.activeEffects.some((effect) => effect.status === 'active' && effect.concentration), false);
  assert.equal(attack.scenario.targets[0].effects.some((effect) => effect.kind === 'sap'), false);
  return { rollMode: attack.rollMode, concentrationDC: attack.concentrationDC, hitPoints: attack.character.hitPoints.current };
});

check('Opportunity movement exposes War Caster spell and spends reaction', () => {
  let { character, scenario } = reset();
  const started = turns.startTacticalTurn({ scenario, character, participantId: turns.targetParticipantId(fixture.E2E_TACTICAL_TARGET_ID) });
  ({ scenario, character } = started);
  const moved = turns.moveTargetDuringTurn({
    scenario,
    characterName: character.name,
    targetId: fixture.E2E_TACTICAL_TARGET_ID,
    distanceFeet: 10,
    direction: 'awayFromActor'
  });
  assert.equal(moved.issues.length, 0);
  assert.equal(moved.opportunityProvoked, true);
  assert.equal(moved.scenario.pendingReaction?.kind, 'opportunityAttack');
  const warCasterId = `spell_${fixture.E2E_TACTICAL_WAR_CASTER_SPELL_ID}`;
  assert.equal(turns.eligibleWarCasterReactionSpells(character).some((action) => action.id === warCasterId), true);
  const resolved = turns.resolvePendingReaction({ scenario: moved.scenario, character, actionId: warCasterId, hit: true, damage: 7 });
  assert.equal(resolved.issues.length, 0);
  assert.equal(resolved.scenario.targets[0].hitPoints.current, 23);
  assert.equal(resolved.scenario.participants.find((entry) => entry.kind === 'character')?.reactionAvailable, false);
  assert.equal(resolved.scenario.pendingReaction, undefined);
  return { targetHitPoints: resolved.scenario.targets[0].hitPoints.current, reactionAvailable: false };
});

check('Ready spell commits slot immediately and never refunds it when triggered', () => {
  let { character, scenario } = reset();
  const started = turns.startTacticalTurn({ scenario, character, participantId: turns.actorParticipantId(character.id) });
  ({ scenario, character } = started);
  const readyActionId = `spell_${fixture.E2E_TACTICAL_READY_SPELL_ID}`;
  const available = buildAvailableActions(character);
  assert.equal(available.some((action) => action.id === readyActionId), true);
  const prepared = turns.setReadyAction({
    scenario,
    character,
    actionId: readyActionId,
    trigger: 'O alvo se move',
    targetId: fixture.E2E_TACTICAL_TARGET_ID,
    selectedSlotLevel: 1
  });
  assert.equal(prepared.issues.length, 0);
  assert.equal(prepared.character.spellSlots.find((slot) => slot.level === 1)?.current, 0);
  assert.equal(prepared.character.activeEffects.some((effect) => effect.status === 'active' && effect.concentration && effect.name === 'Ready: E2E Arcane Lance'), true);
  assert.equal(prepared.character.activeEffects.some((effect) => effect.name === 'E2E Concentration'), false);
  const ready = prepared.scenario.readyActions[0];
  assert.equal(ready.resourcesCommitted, true);
  const triggered = turns.triggerReadyAction({ scenario: prepared.scenario, character: prepared.character, readyActionId: ready.id, targetId: fixture.E2E_TACTICAL_TARGET_ID });
  assert.equal(triggered.issues.length, 0);
  const resolved = turns.resolvePendingReaction({
    scenario: triggered.scenario,
    character: prepared.character,
    actionId: readyActionId,
    hit: true,
    damage: 9
  });
  assert.equal(resolved.issues.length, 0);
  assert.equal(resolved.character.spellSlots.find((slot) => slot.level === 1)?.current, 0);
  assert.equal(resolved.character.activeEffects.some((effect) => effect.name === 'Ready: E2E Arcane Lance' && effect.status === 'active'), false);
  assert.equal(resolved.scenario.targets[0].hitPoints.current, 21);
  assert.equal(resolved.scenario.readyActions.length, 0);
  assert.equal(resolved.scenario.pendingReaction, undefined);
  return { slotAfterPrepare: 0, slotAfterResolve: 0, targetHitPoints: 21 };
});

const contractFailures = contracts.filter(([, pass]) => !pass).map(([name]) => name);
const runtimeFailures = runtimeChecks.filter((entry) => !entry.pass);
const report = {
  schemaVersion: 'dnd-combat-tactical-mobile-closure-audit.v1',
  generatedAt: new Date().toISOString(),
  status: contractFailures.length || runtimeFailures.length ? 'FAIL' : 'PASS',
  nativeExecution: 'not-run-by-this-audit',
  contracts: Object.fromEntries(contracts),
  runtimeChecks,
  maestroFlows: flowPaths,
  evidenceSchema: 'dnd-combat-beta-native-evidence.v3',
  failures: [...contractFailures, ...runtimeFailures.map((entry) => entry.name)]
};
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
fs.writeFileSync(path.join(artifacts, 'tactical-mobile-closure-audit.json'), JSON.stringify(report, null, 2) + '\n');
if (report.status !== 'PASS') {
  console.error('Tactical mobile closure audit FAIL');
  report.failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Tactical mobile closure audit PASS — ${runtimeChecks.length}/${runtimeChecks.length} runtime checks + ${contracts.length}/${contracts.length} contracts`);
