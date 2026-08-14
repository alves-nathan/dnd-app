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
  throw new Error('TypeScript não encontrado para o harness APP-12.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app12-harness-'));
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
const { ContentPolicyService } = loadRuntime('src/catalog/contentPolicyService.ts');
const { createCatalogFilterPreferencesRepository } = loadRuntime('src/storage/catalogFilterPreferences.ts');
const { createMemoryKeyValueStorage } = loadRuntime('src/storage/keyValueStorage.ts');
const { diffCatalogFilterStates } = loadRuntime('src/catalog/catalogConfigurationHistory.ts');
const { buildCharacterCompatibilityReport } = loadRuntime('src/characters/characterCompatibility.ts');
const { createCompatibilityRemediationPlan, upsertCompatibilityRemediationDecision } = loadRuntime('src/characters/compatibilityRemediation.ts');
const { reconcilePreventiveCompatibilityPlans } = loadRuntime('src/characters/catalogChangeImpact.ts');

const bundle = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'), 'utf8'));
const entries = bundle.runtimeIndex.entries;
const dependenciesFrom = new Map();
const dependenciesTo = new Map();
for (const edge of bundle.dependencyGraph.edges) {
  dependenciesFrom.set(edge.fromId, [...(dependenciesFrom.get(edge.fromId) ?? []), edge]);
  dependenciesTo.set(edge.toId, [...(dependenciesTo.get(edge.toId) ?? []), edge]);
}
const snapshot = {
  snapshotId: `catalog-${bundle.catalogVersion}-app12-harness`, catalogVersion: bundle.catalogVersion, loadedAt: bundle.generatedAt,
  manifest: bundle.manifest, entries, registry: new Map(bundle.entityRegistry.entries.map((entry) => [entry.entityId, entry])),
  entryById: new Map(entries.map((entry) => [entry.entityId, entry])), categories: bundle.contentCategories.entities,
  categoryById: new Map(bundle.contentCategories.entities.map((category) => [category.id, category])), dependenciesFrom, dependenciesTo,
  aliases: new Map(bundle.aliases.entities.map((alias) => [alias.from, alias])), filterPolicy: bundle.contentFilterPolicy,
  readinessProfile: bundle.readinessProfile,
  validation: { status: 'passed', checkedAt: bundle.generatedAt, checks: { bundleChecksum: true, versionCoherence: true, counts: true, uniqueEntityIds: true, registryCoverage: true, categoryReferences: true, dependencyReferences: true, aliasReferences: true }, counts: { runtimeEntries: entries.length, registryEntries: bundle.entityRegistry.entries.length, dependencyEdges: bundle.dependencyGraph.edges.length, categories: bundle.contentCategories.entities.length, aliases: bundle.aliases.entities.length }, issues: [] }
};
const policy = new ContentPolicyService(snapshot);
const before = policy.createDefaultState();
const disabled = JSON.parse(JSON.stringify(before));
disabled.entityStates['phb-2024-spell-acid-splash'] = 'disabled';
const choice = {
  choiceId: 'catalog:phb-2024-spell-acid-splash', entityId: 'phb-2024-spell-acid-splash', kind: 'spell', name: 'Acid Splash', sourceBookId: 'phb-2024', sourceLabel: 'PHB 2024', origin: 'catalog',
  catalogSnapshotId: snapshot.snapshotId, catalogEntityId: 'phb-2024-spell-acid-splash', ownerIds: [], searchableText: 'acid splash', available: true, blockedReasons: [], manualReviewRequired: false, payload: {},
  provenance: { origin: 'catalog', sourceBookId: 'phb-2024', sourceId: 'phb-2024', catalogSnapshotId: snapshot.snapshotId, catalogVersion: bundle.catalogVersion, catalogEntityId: 'phb-2024-spell-acid-splash', legacyItemIds: [], overrideAuthorized: false }
};
const character = {
  id: 'app12-wizard', name: 'APP-12 Wizard', level: 1, catalogSnapshotId: snapshot.snapshotId, classes: [], subclasses: [],
  proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
  abilities: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 10 }, weapons: [], equipment: [], magicItems: [], feats: [], spells: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: [],
  compendiumLinks: [{ id: 'app12-acid-link', characterId: 'app12-wizard', itemId: choice.choiceId, importItemId: choice.choiceId, packId: 'official', sourceId: 'phb-2024', itemType: 'spell', appliedAs: 'spell', appliedEntityId: 'app12-acid', appliedEntityName: 'Acid Splash', status: 'active', addedAt: '2026-08-04T12:00:00.000Z', choiceId: choice.choiceId, origin: 'catalog', catalogEntityId: choice.catalogEntityId, catalogSnapshotId: snapshot.snapshotId }]
};
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };

(async () => {
  const storage = createMemoryKeyValueStorage();
  const times = ['2026-08-04T12:00:00.000Z', '2026-08-04T12:05:00.000Z'];
  let timeIndex = 0;
  const repository = createCatalogFilterPreferencesRepository(storage, () => new Date(times[Math.min(timeIndex++, times.length - 1)]));
  const first = await repository.save(snapshot, disabled, {
    beforeState: before, label: 'Desativar Acid Splash', impact: policy.previewImpact(before, disabled),
    context: { origin: 'entity', acknowledgement: { required: true, acknowledged: true, acknowledgedAt: times[0], affectedCharacterIds: [character.id], newBlockingIssues: 1, preventivePlansRequested: true, preventivePlanCharacterIds: [character.id] } }
  });
  assert(first.revision === 1, 'First commit should increment revision.');
  assert(first.history.length === 1, 'First commit should be stored in history.');
  assert(first.historyEntry.origin === 'entity', 'Commit origin should be preserved.');
  assert(first.historyEntry.acknowledgement.affectedCharacterIds[0] === character.id, 'Acknowledged character should be linked.');
  assert(first.historyEntry.changes.entityIds.includes('phb-2024-spell-acid-splash'), 'Entity diff should be precise.');
  assert(diffCatalogFilterStates(before, disabled).entityIds.length === 1, 'Pure diff should detect one entity.');

  const disabledReport = buildCharacterCompatibilityReport({ character, snapshot, filterState: disabled, choices: [choice] });
  assert(disabledReport.blockingIssueCount === 1, 'Disabled entity should block the character.');
  const plan = createCompatibilityRemediationPlan({ character, report: disabledReport, origin: 'preventiveCatalogChange', preventiveContext: { label: 'Desativar Acid Splash', catalogSnapshotId: snapshot.snapshotId, disabledEntityIds: [choice.catalogEntityId], affectedBookIds: ['phb-2024'], affectedCategoryIds: snapshot.entryById.get(choice.catalogEntityId).categoryIds } });
  const reconciliation = reconcilePreventiveCompatibilityPlans({ plans: { [character.id]: plan }, characters: [character], snapshot, filterState: before, choices: [choice] });
  assert(reconciliation.obsoleteEmptyPlanCharacterIds.includes(character.id), 'Empty preventive plan should become obsolete after restoration.');
  assert(reconciliation.activePreventivePlanCharacterIds.length === 0, 'Restored filters should leave no active preventive plan.');
  const decidedPlan = upsertCompatibilityRemediationDecision(plan, { issueId: disabledReport.issues[0].id, referenceKey: disabledReport.issues[0].referenceKey, kind: 'remove' }, times[1]);
  const preserved = reconcilePreventiveCompatibilityPlans({ plans: { [character.id]: decidedPlan }, characters: [character], snapshot, filterState: before, choices: [choice] });
  assert(preserved.obsoletePlanWithDecisionsCharacterIds.includes(character.id), 'Manual decisions should prevent automatic plan removal.');

  const second = await repository.save(snapshot, before, {
    beforeState: disabled, label: 'Restaurar configuração anterior a Desativar Acid Splash', impact: policy.previewImpact(disabled, before),
    context: { origin: 'restore', restoredFromCommitId: first.historyEntry.id, acknowledgement: { required: false, acknowledged: true, obsoletePreventivePlanCharacterIds: reconciliation.obsoleteEmptyPlanCharacterIds, preservedPreventivePlanCharacterIds: [] } }
  });
  assert(second.revision === 2, 'Restoration should be a new revision.');
  assert(second.history.length === 2, 'History must retain original and restoration commits.');
  assert(second.historyEntry.origin === 'restore', 'Restoration origin should be explicit.');
  assert(second.historyEntry.restoredFromCommitId === first.historyEntry.id, 'Restoration should link the source commit.');
  assert(second.historyEntry.impact.enabledCount === 1, 'Restoration impact should record the re-enabled entity.');
  assert(second.historyEntry.acknowledgement.obsoletePreventivePlanCharacterIds.includes(character.id), 'Reconciled plan should be audited.');

  const loaded = await repository.load(snapshot, policy.createDefaultState());
  assert(loaded.restored, 'Persisted history document should restore.');
  assert(loaded.revision === 2, 'Restored revision should remain monotonic.');
  assert(loaded.history.length === 2, 'Both commits should survive hydration.');
  assert(loaded.state.entityStates['phb-2024-spell-acid-splash'] === undefined, 'Restored active state should be current.');
  assert(JSON.stringify(character).includes('Acid Splash'), 'History and reconciliation must not mutate the character.');

  const outputReport = {
    status: 'PASS', assertions, catalogVersion: bundle.catalogVersion, catalogEntries: entries.length,
    history: { revisions: loaded.revision, commits: loaded.history.length, restorationSource: second.historyEntry.restoredFromCommitId, maxRetention: 50 },
    acknowledgement: { affectedCharacters: first.historyEntry.acknowledgement.affectedCharacterIds.length, preventivePlansRequested: first.historyEntry.acknowledgement.preventivePlansRequested },
    reconciliation: { obsoleteEmpty: reconciliation.obsoleteEmptyPlanCharacterIds.length, preservedWithDecisions: preserved.obsoletePlanWithDecisionsCharacterIds.length }
  };
  const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reports/app-12-runtime-harness.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(outputReport, null, 2)}\n`);
  console.log(JSON.stringify(outputReport, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
