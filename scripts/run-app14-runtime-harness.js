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
  throw new Error('TypeScript não encontrado para o harness APP-14.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app14-harness-'));
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
const { createCatalogConfigurationHistoryEntry } = loadRuntime('src/catalog/catalogConfigurationHistory.ts');
const { createCatalogFilterPreferencesRepository } = loadRuntime('src/storage/catalogFilterPreferences.ts');
const { createCharacterDataBackup } = loadRuntime('src/backup/characterBackup.ts');
const { createPortableCatalogAuditSection, comparePortableCatalogAudit } = loadRuntime('src/backup/portableCatalogBackup.ts');
const { buildCatalogChangeCharacterImpact } = loadRuntime('src/characters/catalogChangeImpact.ts');
const { emptyProgressionRecoverySummary } = loadRuntime('src/characters/progressionRecovery.ts');
const { emptyCompatibilityRemediationRecoverySummary } = loadRuntime('src/characters/compatibilityRemediationRecovery.ts');
const {
  preparePortableRestoreSession,
  acknowledgePortableRestoreConflict,
  canCommitPortableRestoreSession,
  portableRestoreCheckpointFingerprint,
  portableRestoreAuditEntry
} = loadRuntime('src/backup/portableRestoreSession.ts');

(async () => {
const bundle = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'), 'utf8'));
const entries = bundle.runtimeIndex.entries;
const dependenciesFrom = new Map();
const dependenciesTo = new Map();
for (const edge of bundle.dependencyGraph.edges) {
  dependenciesFrom.set(edge.fromId, [...(dependenciesFrom.get(edge.fromId) ?? []), edge]);
  dependenciesTo.set(edge.toId, [...(dependenciesTo.get(edge.toId) ?? []), edge]);
}
const snapshot = {
  snapshotId: `catalog-${bundle.catalogVersion}-app14-harness`, catalogVersion: bundle.catalogVersion, loadedAt: bundle.generatedAt,
  manifest: bundle.manifest, entries,
  registry: new Map(bundle.entityRegistry.entries.map((entry) => [entry.entityId, entry])),
  entryById: new Map(entries.map((entry) => [entry.entityId, entry])),
  categories: bundle.contentCategories.entities,
  categoryById: new Map(bundle.contentCategories.entities.map((category) => [category.id, category])),
  dependenciesFrom, dependenciesTo,
  aliases: new Map(bundle.aliases.entities.map((alias) => [alias.from, alias])),
  filterPolicy: bundle.contentFilterPolicy, readinessProfile: bundle.readinessProfile,
  validation: { status: 'passed', checkedAt: bundle.generatedAt, checks: {}, counts: {}, issues: [] }
};
const policy = new ContentPolicyService(snapshot);
const beforeFilters = policy.createDefaultState();
const afterFilters = JSON.parse(JSON.stringify(beforeFilters));
afterFilters.entityStates['phb-2024-spell-acid-splash'] = 'disabled';
const impact = policy.previewImpact(beforeFilters, afterFilters);
const h1 = createCatalogConfigurationHistoryEntry({
  revision: 1, committedAt: '2026-08-04T13:00:00.000Z', label: 'Disable Acid Splash', origin: 'entity',
  catalogVersion: snapshot.catalogVersion, catalogSnapshotId: snapshot.snapshotId,
  beforeState: beforeFilters, afterState: afterFilters, impact
});
const localCharacter = {
  id: 'app14-local', name: 'Local Wizard', level: 1, catalogSnapshotId: snapshot.snapshotId,
  classes: [], subclasses: [], proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
  abilities: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 10 }, weapons: [], equipment: [], magicItems: [], feats: [], spells: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: [],
  compendiumLinks: [{
    id: 'acid-link', characterId: 'app14-local', itemId: 'catalog:phb-2024-spell-acid-splash', importItemId: 'catalog:phb-2024-spell-acid-splash', packId: 'pack', sourceId: 'phb-2024', itemType: 'spell', appliedAs: 'spell', appliedEntityId: 'acid', appliedEntityName: 'Acid Splash', status: 'active', addedAt: '2026-08-04T12:00:00.000Z', choiceId: 'catalog:phb-2024-spell-acid-splash', origin: 'catalog', catalogEntityId: 'phb-2024-spell-acid-splash', catalogSnapshotId: snapshot.snapshotId
  }]
};
const importedCharacter = {
  ...localCharacter,
  id: 'app14-imported',
  name: 'Imported Wizard',
  compendiumLinks: localCharacter.compendiumLinks.map((link) => ({ ...link, characterId: 'app14-imported' })),
};
const choice = {
  choiceId: 'catalog:phb-2024-spell-acid-splash', entityId: 'phb-2024-spell-acid-splash', kind: 'spell', name: 'Acid Splash', sourceBookId: 'phb-2024', sourceLabel: 'PHB 2024', origin: 'catalog', catalogSnapshotId: snapshot.snapshotId, catalogEntityId: 'phb-2024-spell-acid-splash', ownerIds: [], searchableText: 'acid splash', available: true, blockedReasons: [], manualReviewRequired: false, payload: {}, provenance: { origin: 'catalog', sourceBookId: 'phb-2024', sourceId: 'phb-2024', catalogSnapshotId: snapshot.snapshotId, catalogVersion: bundle.catalogVersion, catalogEntityId: 'phb-2024-spell-acid-splash', legacyItemIds: [], overrideAuthorized: false }
};
const section = createPortableCatalogAuditSection({ snapshot, filterState: afterFilters, revision: 1, history: [h1] });
const comparison = comparePortableCatalogAudit({ snapshot, localFilterState: beforeFilters, localRevision: 0, localHistory: [], localPlans: {}, incoming: section });
const catalogImpact = buildCatalogChangeCharacterImpact({ label: 'Import APP14', characters: [importedCharacter], snapshot, beforeFilterState: beforeFilters, afterFilterState: afterFilters, choices: [choice], impact });
const backup = createCharacterDataBackup({ characters: [importedCharacter], scenarios: [], buildPresets: [], buildHistorySnapshots: [] }, { metadata: { name: 'APP14 harness' }, catalogAudit: section });
const current = {
  characterStore: {
    characters: [localCharacter], progressionDrafts: {}, progressionRecovery: emptyProgressionRecoverySummary(), compatibilityRemediationPlans: {}, compatibilityRemediationRecovery: emptyCompatibilityRemediationRecoverySummary(), compatibilityRemediationQuarantine: {}
  },
  scenarios: [], buildPresets: [], buildHistorySnapshots: [],
  catalog: { filterState: beforeFilters, revision: 0, history: [], savedAt: '2026-08-04T12:59:00.000Z' }
};
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
const beforeFingerprint = portableRestoreCheckpointFingerprint(current);
const preparedResult = preparePortableRestoreSession({
  backup, options: { mode: 'replaceAll' }, current, catalogAudit: section, catalogComparison: comparison, catalogImpact,
  now: () => new Date('2026-08-04T13:10:00.000Z')
});
assert(preparedResult.ok && preparedResult.session, 'Session should be prepared.');
let session = preparedResult.session;
assert(session.schemaVersion === 'dnd-portable-restore-session.v1', 'Session schema should be explicit.');
assert(session.status === 'prepared' && session.phase === 'preview', 'Prepared session must not enter write phases.');
assert(portableRestoreCheckpointFingerprint(current) === beforeFingerprint, 'Preparation must not mutate the checkpoint.');
assert(session.beforeFingerprint === beforeFingerprint, 'Before fingerprint should match captured checkpoint.');
assert(session.projectedFingerprint !== session.beforeFingerprint, 'Projected state should differ from the checkpoint.');
assert(session.preview.before.characters === 1 && session.preview.after.characters === 1, 'Replace-all preview should preserve aggregate count.');
assert(session.preview.imported.characterCount === 1, 'One character should be imported.');
assert(session.preview.affectedCharacters === 1, 'Catalog impact should identify the local affected character.');
assert(session.preview.newBlockingIssues === 1, 'One new blocker should be surfaced.');
assert(session.preview.preventivePlans === 1, 'A preventive plan should be projected without decisions.');
assert(session.conflicts.some((entry) => entry.kind === 'replaceAll'), 'Replace-all conflict should be explicit.');
assert(session.conflicts.some((entry) => entry.kind === 'catalogImpact'), 'Catalog impact conflict should be explicit.');
assert(!canCommitPortableRestoreSession(session), 'Commit must remain blocked before acknowledgements.');
for (const conflict of session.conflicts) session = acknowledgePortableRestoreConflict(session, conflict.id, true, () => new Date('2026-08-04T13:11:00.000Z'));
assert(canCommitPortableRestoreSession(session), 'All required acknowledgements should unlock commit.');
assert(session.events.filter((entry) => entry.kind === 'acknowledged').length === session.conflicts.length, 'Each acknowledgement should be audited.');
assert(session.projected.characterStore.compatibilityRemediationPlans['app14-imported']?.decisions.length === 0, 'Preventive plan must contain no automatic decisions.');
const audit = portableRestoreAuditEntry(session, 'committed', '2026-08-04T13:12:00.000Z');
assert(audit.schemaVersion === 'dnd-portable-restore-session-audit.v1', 'Session audit schema should be explicit.');
assert(audit.conflictIds.length === session.conflicts.length, 'Audit should preserve all conflicts.');
assert(audit.acknowledgedConflictIds.length === session.conflicts.length, 'Audit should preserve acknowledgements.');
const memory = new Map();
const storage = { getItem: async (key) => memory.get(key) ?? null, setItem: async (key, value) => { memory.set(key, value); }, removeItem: async (key) => { memory.delete(key); } };
const repository = createCatalogFilterPreferencesRepository(storage, () => new Date('2026-08-04T13:13:00.000Z'));
await repository.replace(snapshot, current.catalog);
const loadedBefore = await repository.load(snapshot, beforeFilters);
assert(loadedBefore.revision === 0 && loadedBefore.history.length === 0, 'Exact catalog checkpoint should be restorable.');
const saved = await repository.save(snapshot, afterFilters, { beforeState: beforeFilters, label: 'APP14 import', impact, context: { origin: 'import', portableRestoreSessionId: session.id } });
assert(saved.historyEntry.portableRestoreSessionId === session.id, 'Catalog commit should be linked to the restore session.');
await repository.replace(snapshot, current.catalog);
const rolledBack = await repository.load(snapshot, beforeFilters);
assert(rolledBack.revision === 0 && Object.keys(rolledBack.state.entityStates).length === 0, 'Catalog rollback should restore exact filters and linear history.');


// Exercise the real coordinator with deterministic in-memory stores. This validates
// write ordering, interruption recovery, duplicate catalog commit protection and rollback.
const createStore = (state) => ({
  getState: () => state,
  setState: (update) => Object.assign(state, typeof update === 'function' ? update(state) : update)
});
const characterState = JSON.parse(JSON.stringify(current.characterStore));
const characterStore = createStore(characterState);
const scenarioState = { scenarios: [], setScenarios: (items) => { scenarioState.scenarios = items; } };
const scenarioStore = createStore(scenarioState);
const presetState = { presets: [], setPresets: (items) => { presetState.presets = items; } };
const presetStore = createStore(presetState);
const buildHistoryState = { snapshots: [], setSnapshots: (items) => { buildHistoryState.snapshots = items; } };
const buildHistoryStore = createStore(buildHistoryState);
let pendingAudit;
const catalogState = {
  snapshot, filterState: JSON.parse(JSON.stringify(beforeFilters)), revision: 0, history: [], lastSavedAt: '2026-08-04T12:59:00.000Z',
  previewPortableBackupImport: (auditSection) => { pendingAudit = auditSection; },
  commitPendingChange: async (context) => {
    const id = `catalog-session-${catalogState.revision + 1}`;
    catalogState.filterState = JSON.parse(JSON.stringify(pendingAudit.filterState));
    catalogState.revision += 1;
    catalogState.history.push({ id, portableRestoreSessionId: context.portableRestoreSessionId });
    return { ok: true, issues: [], historyEntryId: id };
  },
  replaceConfigurationCheckpoint: async (checkpoint) => {
    catalogState.filterState = JSON.parse(JSON.stringify(checkpoint.filterState));
    catalogState.revision = checkpoint.revision;
    catalogState.history = JSON.parse(JSON.stringify(checkpoint.history));
    catalogState.lastSavedAt = checkpoint.savedAt;
    return { ok: true, issues: [] };
  }
};
const catalogStore = createStore(catalogState);
const sessionState = { activeSession: JSON.parse(JSON.stringify(session)) };
Object.assign(sessionState, {
  markCommitStarted: () => { sessionState.activeSession.status = 'committing'; sessionState.activeSession.phase = 'data'; sessionState.activeSession.recoveryRequired = true; return true; },
  markDataApplied: () => { sessionState.activeSession.phase = 'catalog'; sessionState.activeSession.applied.data = true; return true; },
  markCatalogApplied: (historyEntryId) => { sessionState.activeSession.phase = 'complete'; sessionState.activeSession.applied.catalog = true; sessionState.activeSession.catalogHistoryEntryId = historyEntryId; return true; },
  markCommitted: () => { sessionState.activeSession.status = 'committed'; sessionState.activeSession.phase = 'complete'; sessionState.activeSession.recoveryRequired = false; sessionState.activeSession.committedAt = '2026-08-04T13:20:00.000Z'; return true; },
  recordPostRestoreVerification: (verification) => { sessionState.activeSession.postRestoreVerification = verification; return true; },
  markInterrupted: (message) => { sessionState.activeSession.status = 'interrupted'; sessionState.activeSession.recoveryRequired = true; sessionState.activeSession.lastError = message; return true; },
  markRollbackStarted: () => { sessionState.activeSession.status = 'rollingBack'; sessionState.activeSession.phase = 'rollbackData'; return true; },
  markDataRolledBack: () => { sessionState.activeSession.phase = 'rollbackCatalog'; sessionState.activeSession.applied.data = false; return true; },
  markCatalogRolledBack: () => { sessionState.activeSession.phase = 'complete'; sessionState.activeSession.applied.catalog = false; return true; },
  markRolledBack: () => { sessionState.activeSession.status = 'rolledBack'; sessionState.activeSession.phase = 'complete'; sessionState.activeSession.recoveryRequired = false; return true; }
});
const sessionStore = createStore(sessionState);
const compendiumStore = createStore({ isHydrated: true, items: [], enabledSourceIds: [] });
const executorRuntimePath = path.join(tempRoot, 'src/backup/portableRestoreSessionExecutor.js');
const storeMocks = {
  '../store/buildHistoryStore': { useBuildHistoryStore: buildHistoryStore },
  '../store/buildPresetStore': { useBuildPresetStore: presetStore },
  '../store/catalogStore': { useCatalogStore: catalogStore },
  '../store/characterStore': { useCharacterStore: characterStore },
  '../store/combatScenarioStore': { useCombatScenarioStore: scenarioStore },
  '../store/compendiumStore': { useCompendiumStore: compendiumStore },
  '../store/portableRestoreSessionStore': { usePortableRestoreSessionStore: sessionStore }
};
const originalModuleLoad = Module._load;
Module._load = function app14MockedLoad(request, parent, isMain) {
  if (parent?.filename === executorRuntimePath && storeMocks[request]) return storeMocks[request];
  return originalModuleLoad.call(this, request, parent, isMain);
};
let executor;
try {
  executor = loadRuntime('src/backup/portableRestoreSessionExecutor.ts');
} finally {
  Module._load = originalModuleLoad;
}
const coordinatedCommit = await executor.commitPortableRestoreSession();
assert(coordinatedCommit.ok && sessionState.activeSession.status === 'committed', 'Coordinator should commit the entire session.');
assert(characterState.characters[0].id === 'app14-imported', 'Coordinator should atomically publish projected characters.');
assert(catalogState.revision === 1 && catalogState.history.length === 1, 'Coordinator should create one catalog transaction.');
assert(catalogState.history[0].portableRestoreSessionId === session.id, 'Catalog transaction should preserve the session link.');
// Simulate a crash after the catalog commit was persisted but before the session reached committed.
sessionState.activeSession.status = 'interrupted';
sessionState.activeSession.applied = { data: true, catalog: false };
const resumedCommit = await executor.commitPortableRestoreSession();
assert(resumedCommit.ok && catalogState.history.length === 1, 'Resumed commit must not duplicate an existing catalog transaction.');
const coordinatedRollback = await executor.rollbackPortableRestoreSession();
assert(coordinatedRollback.ok && sessionState.activeSession.status === 'rolledBack', 'Coordinator should rollback the whole session.');
assert(characterState.characters[0].id === 'app14-local', 'Rollback should restore the original character checkpoint.');
assert(catalogState.revision === 0 && catalogState.history.length === 0, 'Rollback should restore exact catalog revision and history.');
const outputReport = {
  status: 'PASS', assertions, catalogVersion: bundle.catalogVersion, catalogEntries: entries.length,
  session: { id: session.id, conflicts: session.conflicts.length, acknowledgements: session.acknowledgedConflictIds.length, events: session.events.length },
  preview: session.preview,
  recovery: { checkpointFingerprint: session.beforeFingerprint, projectedFingerprint: session.projectedFingerprint, exactCatalogRollback: true, coordinatorCommit: coordinatedCommit.ok, idempotentResume: resumedCommit.ok, coordinatorRollback: coordinatedRollback.ok },
  audit: { schemaVersion: audit.schemaVersion, conflictCount: audit.conflictIds.length, catalogSessionLink: saved.historyEntry.portableRestoreSessionId }
};
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reports/app-14-runtime-harness.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(outputReport, null, 2)}\n`);
console.log(JSON.stringify(outputReport, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
