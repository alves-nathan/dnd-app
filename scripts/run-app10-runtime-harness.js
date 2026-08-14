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
  throw new Error('TypeScript não encontrado para o harness APP-10.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app10-harness-'));
const transpileTree = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) { transpileTree(absolute); continue; }
    if (!entry.name.endsWith('.ts') || absolute.includes(`${path.sep}tests${path.sep}`)) continue;
    const relative = path.relative(root, absolute);
    const output = path.join(tempRoot, relative.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, fileName: absolute
    }).outputText);
  }
};
transpileTree(path.join(root, 'src'));
const loadRuntime = (relativePath) => {
  const runtimePath = path.join(tempRoot, relativePath.replace(/\.ts$/, '.js'));
  const runtimeModule = new Module(runtimePath, module);
  runtimeModule.filename = runtimePath;
  runtimeModule.paths = Module._nodeModulePaths(path.dirname(runtimePath));
  runtimeModule._compile(fs.readFileSync(runtimePath, 'utf8'), runtimePath);
  return runtimeModule.exports;
};
const { buildCharacterCompatibilityReport } = loadRuntime('src/characters/characterCompatibility.ts');
const { createCompatibilityRemediationPlan, previewCompatibilityRemediation, upsertCompatibilityRemediationDecision } = loadRuntime('src/characters/compatibilityRemediation.ts');
const { buildCompatibilityRemediationBatchOverview } = loadRuntime('src/characters/compatibilityRemediationBatch.ts');
const { reconcileCompatibilityRemediationRecovery, acknowledgeCompatibilityRemediationRecovery } = loadRuntime('src/characters/compatibilityRemediationRecovery.ts');
const { createProgressionDraft, commitProgressionDraft } = loadRuntime('src/characters/progressionTransaction.ts');
const { createEmptyCharacter } = loadRuntime('src/data/mockData.ts');

const bundle = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'), 'utf8'));
const entries = bundle.runtimeIndex.entries;
const snapshot = {
  snapshotId: `catalog-${bundle.catalogVersion}-app10-harness`, catalogVersion: bundle.catalogVersion, loadedAt: bundle.generatedAt,
  manifest: bundle.manifest, entries, registry: new Map(bundle.entityRegistry.entries.map((entry) => [entry.entityId, entry])),
  entryById: new Map(entries.map((entry) => [entry.entityId, entry])), categories: bundle.contentCategories.entities,
  categoryById: new Map(bundle.contentCategories.entities.map((category) => [category.id, category])), dependenciesFrom: new Map(), dependenciesTo: new Map(),
  aliases: new Map(bundle.aliases.entities.map((alias) => [alias.from, alias])), filterPolicy: bundle.contentFilterPolicy, readinessProfile: bundle.readinessProfile,
  validation: { status: 'passed', checkedAt: bundle.generatedAt, checks: { bundleChecksum: true, versionCoherence: true, counts: true, uniqueEntityIds: true, registryCoverage: true, categoryReferences: true, dependencyReferences: true, aliasReferences: true }, counts: { runtimeEntries: entries.length, registryEntries: bundle.entityRegistry.entries.length, dependencyEdges: bundle.dependencyGraph.edges.length, categories: bundle.contentCategories.entities.length, aliases: bundle.aliases.entities.length }, issues: [] }
};
const filterState = { bookStates: Object.fromEntries(bundle.manifest.sourceBooks.map((book) => [book, true])), categoryStates: {}, entityStates: {} };
const missingEntityId = 'app10-shared-removed-feat';
const createCharacter = (id, name) => {
  const base = createEmptyCharacter(name);
  return {
    ...base,
    id,
    catalogSnapshotId: 'catalog-4.7.0-old',
    level: 1,
    classes: [{ id: `${id}-wizard`, name: 'Wizard', level: 1, source: { id: 'app10', status: 'active', confidence: 'exact' } }],
    feats: [{ id: `${id}-feat`, name: 'Shared Removed Feat', features: [] }],
    compendiumLinks: [{
      id: `${id}-link`, characterId: id, itemId: `catalog:${missingEntityId}`, importItemId: `catalog:${missingEntityId}`,
      packId: 'app10', sourceId: 'phb-2024', itemType: 'feat', appliedAs: 'feat', appliedEntityId: `${id}-feat`,
      appliedEntityName: 'Shared Removed Feat', status: 'active', addedAt: '2026-08-04T08:00:00.000Z', choiceId: `catalog:${missingEntityId}`,
      origin: 'catalog', catalogEntityId: missingEntityId, catalogSnapshotId: 'catalog-4.7.0-old'
    }],
    progressionTransactions: []
  };
};
const makePlan = (character, at) => {
  const report = buildCharacterCompatibilityReport({ character, snapshot, filterState, choices: [], now: () => new Date(at) });
  const snapshotIssue = report.issues.find((issue) => issue.code === 'CHARACTER_SNAPSHOT_MISMATCH');
  const missingIssue = report.issues.find((issue) => issue.code === 'CHARACTER_CATALOG_ENTITY_MISSING');
  let plan = createCompatibilityRemediationPlan({ character, report, now: () => new Date(at) });
  plan = upsertCompatibilityRemediationDecision(plan, { issueId: snapshotIssue.id, kind: 'adoptSnapshot' }, at);
  plan = upsertCompatibilityRemediationDecision(plan, { issueId: missingIssue.id, referenceKey: missingIssue.referenceKey, kind: 'remove' }, at);
  return { plan, report };
};
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };

const characterA = createCharacter('app10-a', 'APP10 Alpha');
const characterB = createCharacter('app10-b', 'APP10 Beta');
const characterCBase = createCharacter('app10-c', 'APP10 Gamma');
const planA = makePlan(characterA, '2026-08-04T08:01:00.000Z').plan;
const planB = { ...makePlan(characterB, '2026-08-04T08:02:00.000Z').plan, targetCatalogSnapshotId: 'catalog-4.7.0-old' };
const planC = makePlan(characterCBase, '2026-08-04T08:03:00.000Z').plan;
const characterC = { ...characterCBase, notes: 'Edição concorrente depois do plano.' };
const orphan = { ...planA, id: 'orphan-plan', characterId: 'removed-character' };
const rawPlans = { [characterA.id]: planA, [characterB.id]: planB, [characterC.id]: planC, orphan: orphan, invalid: { schemaVersion: 'broken' } };

const recovery = reconcileCompatibilityRemediationRecovery({
  characters: [characterA, characterB, characterC], plans: rawPlans, currentCatalogSnapshotId: snapshot.snapshotId,
  markRecovered: true, now: () => new Date('2026-08-04T08:10:00.000Z')
});
assert(recovery.summary.pendingAcknowledgementCharacterIds.includes(characterA.id), 'Valid restored plan should require acknowledgement.');
assert(recovery.summary.staleCatalogCharacterIds.includes(characterB.id), 'Old catalog plan should be stale.');
assert(recovery.summary.conflictedCharacterIds.includes(characterC.id), 'Concurrent edit should create conflict.');
assert(Object.values(recovery.quarantine).some((entry) => entry.reason === 'orphaned'), 'Orphan plan should be quarantined.');
assert(Object.values(recovery.quarantine).some((entry) => entry.reason === 'invalid'), 'Invalid plan should be quarantined.');
assert(Object.keys(recovery.plans).length === 3, 'Only valid plans with existing characters should remain active.');

const acknowledgedSummary = acknowledgeCompatibilityRemediationRecovery(recovery.summary, characterA.id);
assert(!acknowledgedSummary.pendingAcknowledgementCharacterIds.includes(characterA.id), 'Acknowledgement should unlock only the selected plan.');
const overview = buildCompatibilityRemediationBatchOverview({
  characters: [characterA, characterB, characterC], plans: recovery.plans, recovery: acknowledgedSummary,
  snapshot, filterState, choices: [], now: () => new Date('2026-08-04T08:11:00.000Z')
});
const itemA = overview.characters.find((entry) => entry.characterId === characterA.id);
const itemB = overview.characters.find((entry) => entry.characterId === characterB.id);
const itemC = overview.characters.find((entry) => entry.characterId === characterC.id);
assert(itemA.canCommit, 'Acknowledged valid plan should be independently committable.');
assert(itemB.recoveryStatus === 'staleCatalog' && !itemB.canCommit, 'Stale plan must remain blocked.');
assert(itemC.recoveryStatus === 'conflicted' && !itemC.canCommit, 'Conflicted plan must remain blocked.');
assert(overview.aggregate.activePlans === 3, 'Aggregate should include three active plans.');
assert(overview.aggregate.readyPlans === 1, 'Only one plan should be ready for commit.');
assert(overview.aggregate.recoveredPlans === 0, 'Acknowledged plan should leave no recovered plan in this fixture.');
assert(overview.aggregate.staleCatalogPlans === 1, 'Aggregate should expose one stale plan.');
assert(overview.aggregate.conflictedPlans === 1, 'Aggregate should expose one conflict.');
const sharedGroup = overview.groups.find((group) => group.kind === 'entity' && group.key === missingEntityId);
assert(sharedGroup && sharedGroup.characterIds.length === 3, 'Shared removed entity should group all affected characters.');
assert(itemA.preview.ok && itemA.preview.impact.blockingIssuesAfter === 0, 'Individual preview should resolve all blockers for Alpha.');

const beforeB = JSON.stringify(characterB);
const draftA = createProgressionDraft({
  character: characterA,
  workingCharacter: itemA.preview.projectedCharacter,
  kind: 'compatibilityRemediation',
  targetCatalogSnapshotId: planA.targetCatalogSnapshotId,
  migrationApproved: true,
  operations: itemA.preview.operations
});
const committedA = commitProgressionDraft(characterA, draftA);
assert(committedA.ok, 'Alpha should commit atomically.');
assert(committedA.character.catalogSnapshotId === snapshot.snapshotId, 'Alpha should migrate to current snapshot.');
assert(!committedA.character.feats.some((feat) => feat.name === 'Shared Removed Feat'), 'Alpha should remove the missing feat.');
assert(JSON.stringify(characterB) === beforeB, 'Independent commit must not mutate Beta.');
assert(recovery.plans[characterB.id].id === planB.id, 'Beta plan should remain independent after Alpha commit.');

const outputReport = {
  status: 'PASS', assertions, storeVersion: 23, catalogVersion: bundle.catalogVersion, catalogEntries: entries.length,
  recovery: {
    pendingAcknowledgement: recovery.summary.pendingAcknowledgementCharacterIds.length,
    staleCatalog: recovery.summary.staleCatalogCharacterIds.length,
    conflicted: recovery.summary.conflictedCharacterIds.length,
    quarantined: recovery.summary.quarantinedPlanIds.length
  },
  aggregate: overview.aggregate,
  sharedEntityCharacters: sharedGroup.characterIds.length,
  independentCommit: { committedCharacterId: characterA.id, untouchedCharacterId: characterB.id }
};
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reports/app-10-runtime-harness.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(outputReport, null, 2)}\n`);
console.log(JSON.stringify(outputReport, null, 2));
