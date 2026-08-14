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
  throw new Error('TypeScript não encontrado para o harness APP-05.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app05-harness-'));

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
transpile('src/utils/id.ts');
transpile('src/characters/progressionTransaction.ts');
const runtimePath = path.join(tempRoot, 'src/characters/progressionTransaction.js');
const runtimeModule = new Module(runtimePath, module);
runtimeModule.filename = runtimePath;
runtimeModule.paths = Module._nodeModulePaths(path.dirname(runtimePath));
runtimeModule._compile(fs.readFileSync(runtimePath, 'utf8'), runtimePath);
const {
  characterProgressionFingerprint,
  commitProgressionDraft,
  createProgressionDraft,
  progressionOperation,
  rollbackProgressionAudit,
  updateProgressionDraft,
  validateProgressionDraft
} = runtimeModule.exports;

const source = { id: 'test', status: 'active', confidence: 'exact' };
const character = () => ({
  id: 'character-app05',
  catalogSnapshotId: 'catalog-4.7.0-harness',
  name: 'Atomic Wizard',
  level: 1,
  classes: [{ id: 'class-wizard', name: 'Wizard', level: 1, source }],
  subclasses: [],
  abilityScoreBonuses: {},
  featChoices: [],
  buildChoices: { speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: [] },
  pendingChoices: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
  abilities: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 10 },
  armors: [], armorAccessories: [], weapons: [], equipment: [], magicItems: [], feats: [], spells: [], spellbookEntries: [], weaponMasteries: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: [], compendiumLinks: []
});

let assertions = 0;
const assert = (condition, message) => {
  assertions += 1;
  if (!condition) throw new Error(`Assertion ${assertions}: ${message}`);
};

const published = character();
const projected = {
  ...published,
  level: 2,
  classes: [{ ...published.classes[0], level: 2 }],
  catalogSnapshotId: 'catalog-4.8.0-harness',
  feats: [{ id: 'feat-alert', name: 'Alert', source }]
};
const draft = createProgressionDraft({
  character: published,
  workingCharacter: projected,
  targetCatalogSnapshotId: 'catalog-4.8.0-harness',
  migrationApproved: true,
  operations: [
    progressionOperation('levelUp', 'Wizard 1 → 2'),
    progressionOperation('choice', 'Selecionar Alert')
  ]
});
assert(published.level === 1, 'Published character must remain untouched before commit.');
assert(draft.workingCharacter.level === 2, 'Draft should contain the projected level.');
assert(draft.baseCharacter.feats.length === 0, 'Base snapshot should remain immutable.');
assert(validateProgressionDraft(draft, published).ok, 'Valid transaction should be ready.');

const committed = commitProgressionDraft(published, draft);
assert(committed.ok, 'Commit should succeed.');
assert(committed.character.level === 2, 'Committed character should be level 2.');
assert(committed.character.feats[0]?.name === 'Alert', 'Committed choice should be present.');
assert(committed.character.progressionTransactions.length === 1, 'Audit history should be appended once.');
assert(committed.auditEntry.before.level === 1 && committed.auditEntry.after.level === 2, 'Audit should retain before and after snapshots.');
assert(!Object.prototype.hasOwnProperty.call(committed.auditEntry.before, 'progressionTransactions'), 'Snapshots must not recursively contain audit history.');

const mandatoryDraft = createProgressionDraft({
  character: published,
  workingCharacter: {
    ...projected,
    pendingChoices: [{ id: 'pending-subclass', kind: 'subclass', title: 'Subclass', description: 'Required', status: 'pending', createdAt: '2026-08-03T00:00:00.000Z' }]
  },
  targetCatalogSnapshotId: 'catalog-4.8.0-harness',
  migrationApproved: true,
  operations: [progressionOperation('levelUp', 'Blocked level up')]
});
const mandatoryPreview = validateProgressionDraft(mandatoryDraft, published);
assert(!mandatoryPreview.ok, 'Mandatory pending choices should block commit.');
assert(mandatoryPreview.blockingIssues.some((issue) => issue.code === 'PROGRESSION_TRANSACTION_PENDING_CHOICES'), 'Mandatory pending issue should be explicit.');

const resolvedDraft = updateProgressionDraft(
  mandatoryDraft,
  (working) => ({ ...working, pendingChoices: [] }),
  progressionOperation('choice', 'Resolve subclass', { pendingChoiceId: 'pending-subclass' })
);
assert(validateProgressionDraft(resolvedDraft, published).ok, 'Resolving the pending choice should unblock the transaction.');
assert(resolvedDraft.operations.length === 2, 'Choice resolution should be added to audit operations.');

const concurrent = { ...published, notes: 'Changed outside transaction' };
const conflict = commitProgressionDraft(concurrent, draft);
assert(!conflict.ok, 'Concurrent published changes should block commit.');
assert(conflict.preview.blockingIssues.some((issue) => issue.code === 'PROGRESSION_TRANSACTION_CONFLICT'), 'Conflict code should be explicit.');
assert(conflict.character.notes === 'Changed outside transaction', 'Conflict must preserve the current published character.');

const unapproved = createProgressionDraft({
  character: published,
  workingCharacter: projected,
  targetCatalogSnapshotId: 'catalog-4.8.0-harness',
  migrationApproved: false,
  operations: [progressionOperation('snapshotMigration', 'Migrate snapshot')]
});
assert(validateProgressionDraft(unapproved, published).blockingIssues.some((issue) => issue.code === 'PROGRESSION_TRANSACTION_SNAPSHOT_APPROVAL_REQUIRED'), 'Snapshot migration should require approval.');

const rollback = rollbackProgressionAudit(committed.character, committed.auditEntry);
assert(rollback.character.level === 1, 'Rollback should restore the previous level.');
assert(rollback.character.feats.length === 0, 'Rollback should restore the previous feats exactly.');
assert(rollback.auditEntry.status === 'rolledBack', 'Rollback should be audited.');
assert(rollback.auditEntry.rolledBackTransactionId === committed.auditEntry.transactionId, 'Rollback should reference the original transaction.');
assert(rollback.character.progressionTransactions.length === 2, 'Rollback should append, not erase, audit history.');

assert(characterProgressionFingerprint(published) === characterProgressionFingerprint({ ...published, progressionTransactions: [] }), 'Audit metadata should not create false conflicts.');

const report = {
  status: 'PASS',
  assertions,
  storeVersion: 23,
  scenarios: {
    atomicCommit: { beforeLevel: published.level, afterLevel: committed.character.level, operations: draft.operations.length },
    mandatoryPending: { blocked: mandatoryPreview.blockingIssues.length, resolvedOperations: resolvedDraft.operations.length },
    conflictDetection: { blocked: !conflict.ok, issueCodes: conflict.preview.blockingIssues.map((issue) => issue.code) },
    snapshotMigration: { approvalRequired: true },
    rollback: { restoredLevel: rollback.character.level, historyEntries: rollback.character.progressionTransactions.length }
  }
};
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reports/app-05-runtime-harness.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
