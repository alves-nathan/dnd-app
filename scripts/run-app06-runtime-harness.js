#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado para o harness APP-06.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app06-harness-'));

const transpile = (relativePath) => {
  const input = path.join(root, relativePath);
  const output = path.join(tempRoot, relativePath.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const source = fs.readFileSync(input, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: input
  }).outputText;
  fs.writeFileSync(output, compiled);
};

for (const file of [
  'src/utils/id.ts',
  'src/characters/progressionTransaction.ts',
  'src/characters/progressionRecovery.ts'
]) transpile(file);

const loadRuntime = (relativePath) => {
  const runtimePath = path.join(tempRoot, relativePath.replace(/\.ts$/, '.js'));
  const runtimeModule = new Module(runtimePath, module);
  runtimeModule.filename = runtimePath;
  runtimeModule.paths = Module._nodeModulePaths(path.dirname(runtimePath));
  runtimeModule._compile(fs.readFileSync(runtimePath, 'utf8'), runtimePath);
  return runtimeModule.exports;
};

const transaction = loadRuntime('src/characters/progressionTransaction.ts');
const recovery = loadRuntime('src/characters/progressionRecovery.ts');
const {
  commitProgressionDraft,
  createProgressionDraft,
  progressionOperation,
  updateProgressionDraft,
  validateProgressionDraft
} = transaction;
const {
  acknowledgeRecoveredProgressionDraft,
  reconcileProgressionRecovery
} = recovery;

const source = { id: 'app06-harness', status: 'active', confidence: 'exact' };
const character = (id = 'character-app06') => ({
  id,
  catalogSnapshotId: 'catalog-4.8.0-harness',
  name: 'Recovery Wizard',
  level: 1,
  classes: [{ id: 'class-wizard', name: 'Wizard', level: 1, source }],
  subclasses: [], abilityScoreBonuses: {}, featChoices: [],
  buildChoices: { speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: [], eldritchInvocationCounts: {}, eldritchInvocationChoices: [] },
  pendingChoices: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
  abilities: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 10 },
  armors: [], armorAccessories: [], companions: [], senses: [], hitPoints: { current: 8, max: 8, temporary: 0 }, hitDice: [],
  weapons: [], equipment: [], magicItems: [], feats: [], spells: [], spellbookEntries: [], weaponMasteries: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: [], compendiumLinks: [], progressionTransactions: []
});

let assertions = 0;
const assert = (condition, message) => {
  assertions += 1;
  if (!condition) throw new Error(`Assertion ${assertions}: ${message}`);
};

const published = character();
const projected = { ...published, level: 2, classes: [{ ...published.classes[0], level: 2 }] };
const activeDraft = createProgressionDraft({
  character: published,
  workingCharacter: projected,
  operations: [progressionOperation('levelUp', 'Wizard 1 → 2')]
});
assert(activeDraft.schemaVersion === 1, 'Draft schema should be versioned.');
assert(activeDraft.recovery.status === 'active', 'New drafts should be active.');
assert(activeDraft.recovery.checkpointSequence === 1, 'New drafts should start at checkpoint 1.');

const afterRestart = reconcileProgressionRecovery([published], { [published.id]: JSON.parse(JSON.stringify(activeDraft)) }, [], '2026-08-04T01:00:00.000Z');
const recoveredDraft = afterRestart.drafts[published.id];
assert(Boolean(recoveredDraft), 'Valid persisted draft should survive reconciliation.');
assert(recoveredDraft.recovery.status === 'recoverable', 'Restarted draft should require recovery acknowledgement.');
assert(afterRestart.summary.recoverableCharacterIds.includes(published.id), 'Recovery summary should list the character.');
const blockedPreview = validateProgressionDraft(recoveredDraft, published);
assert(!blockedPreview.ok, 'Unacknowledged recovery should block commit.');
assert(blockedPreview.blockingIssues.some((entry) => entry.code === 'PROGRESSION_TRANSACTION_RECOVERY_ACK_REQUIRED'), 'Recovery acknowledgement issue should be explicit.');

const acknowledged = acknowledgeRecoveredProgressionDraft(recoveredDraft, '2026-08-04T01:01:00.000Z');
assert(acknowledged.recovery.status === 'active', 'Acknowledgement should reactivate the draft.');
assert(validateProgressionDraft(acknowledged, published).ok, 'Acknowledged draft should be valid.');
const committed = commitProgressionDraft(published, acknowledged);
assert(committed.ok, 'Recovered draft should commit atomically after acknowledgement.');
assert(committed.character.level === 2, 'Recovered commit should apply the projected level.');

const checkpointed = updateProgressionDraft(
  activeDraft,
  (working) => ({ ...working, notes: 'new checkpoint' }),
  progressionOperation('manual', 'Checkpoint notes')
);
assert(checkpointed.recovery.checkpointSequence === 2, 'Mutation should advance the checkpoint sequence.');
assert(checkpointed.recovery.lastCheckpointAt === checkpointed.updatedAt, 'Checkpoint timestamp should match updatedAt.');

const concurrentlyEdited = { ...published, notes: 'external edit' };
const conflicted = reconcileProgressionRecovery([concurrentlyEdited], { [published.id]: activeDraft });
assert(conflicted.drafts[published.id].recovery.status === 'conflicted', 'Concurrent change should isolate the draft as conflicted.');
assert(conflicted.summary.conflictedCharacterIds.includes(published.id), 'Conflict should appear in recovery summary.');
assert(!commitProgressionDraft(concurrentlyEdited, conflicted.drafts[published.id]).ok, 'Conflicted recovery must never commit.');

const orphaned = reconcileProgressionRecovery([], { [published.id]: activeDraft });
assert(Object.keys(orphaned.drafts).length === 0, 'Orphaned draft should not remain active.');
assert(orphaned.summary.issues.some((entry) => entry.kind === 'orphaned'), 'Orphaned draft should be quarantined.');

const invalid = reconcileProgressionRecovery([published], { invalid: { id: 'broken' } });
assert(invalid.summary.issues.some((entry) => entry.kind === 'invalid'), 'Invalid record should be quarantined.');
assert(Object.keys(invalid.drafts).length === 0, 'Invalid record should not enter active drafts.');

const report = {
  status: 'PASS',
  assertions,
  storeVersion: 23,
  scenarios: {
    restartRecovery: { status: recoveredDraft.recovery.status, checkpoint: recoveredDraft.recovery.checkpointSequence },
    acknowledgedCommit: { ok: committed.ok, level: committed.character.level },
    checkpoint: { before: activeDraft.recovery.checkpointSequence, after: checkpointed.recovery.checkpointSequence },
    conflict: { status: conflicted.drafts[published.id].recovery.status },
    quarantine: { orphaned: orphaned.summary.issues.length, invalid: invalid.summary.issues.length }
  }
};
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reports/app-06-runtime-harness.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
