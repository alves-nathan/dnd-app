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
  throw new Error('TypeScript não encontrado para o harness APP-13.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app13-harness-'));
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
const {
  createPortableCatalogAuditSection,
  validatePortableCatalogAuditSection,
  comparePortableCatalogAudit,
  portableCatalogImportMetadata,
  preparePortableRemediationPlanImport
} = loadRuntime('src/backup/portableCatalogBackup.ts');
const { createCharacterDataBackup, parseCharacterDataBackup } = loadRuntime('src/backup/characterBackup.ts');
const { createEmptyCharacter } = loadRuntime('src/data/mockData.ts');

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
  snapshotId: `catalog-${bundle.catalogVersion}-app13-harness`, catalogVersion: bundle.catalogVersion, loadedAt: bundle.generatedAt,
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
const defaultState = policy.createDefaultState();
const disabledAcid = JSON.parse(JSON.stringify(defaultState));
disabledAcid.entityStates['phb-2024-spell-acid-splash'] = 'disabled';
const restoredAcid = JSON.parse(JSON.stringify(defaultState));
const h1 = createCatalogConfigurationHistoryEntry({
  revision: 1, committedAt: '2026-08-04T12:00:00.000Z', label: 'Disable Acid Splash', origin: 'entity',
  catalogVersion: snapshot.catalogVersion, catalogSnapshotId: snapshot.snapshotId,
  beforeState: defaultState, afterState: disabledAcid, impact: policy.previewImpact(defaultState, disabledAcid)
});
const h2 = createCatalogConfigurationHistoryEntry({
  revision: 2, committedAt: '2026-08-04T12:05:00.000Z', label: 'Restore Acid Splash', origin: 'restore',
  catalogVersion: snapshot.catalogVersion, catalogSnapshotId: snapshot.snapshotId,
  beforeState: disabledAcid, afterState: restoredAcid, impact: policy.previewImpact(disabledAcid, restoredAcid), context: { restoredFromCommitId: h1.id }
});
const character = { ...createEmptyCharacter('Portable Wizard'), id: 'portable-character', catalogSnapshotId: snapshot.snapshotId };
const plan = {
  schemaVersion: 'dnd-character-compatibility-remediation.v1', id: 'portable-plan', characterId: character.id,
  createdAt: '2026-08-04T12:06:00.000Z', updatedAt: '2026-08-04T12:06:00.000Z', baseFingerprint: 'source-fingerprint',
  baseCatalogSnapshotId: snapshot.snapshotId, targetCatalogSnapshotId: snapshot.snapshotId, decisions: [],
  origin: 'preventiveCatalogChange', preventiveContext: { label: 'Disable Acid Splash', catalogSnapshotId: snapshot.snapshotId, disabledEntityIds: ['phb-2024-spell-acid-splash'], affectedBookIds: ['phb-2024'], affectedCategoryIds: ['spells'] }
};
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
const section = createPortableCatalogAuditSection({
  snapshot, filterState: restoredAcid, revision: 2, history: [h1, h2], remediationPlans: { [character.id]: plan },
  now: () => new Date('2026-08-04T12:10:00.000Z')
});
assert(section.schemaVersion === 'dnd-portable-catalog-audit.v1', 'Portable audit schema should be explicit.');
assert(section.history.length === 2, 'Both catalog commits should be exported.');
assert(section.revision === 2, 'Catalog revision should be exported.');
assert(section.remediationPlans.length === 1, 'Preventive plan should be exported.');
assert(section.historyIntegrity.checksum.length === 8, 'History integrity should be recorded.');
const backup = createCharacterDataBackup({ characters: [character], scenarios: [], buildPresets: [], buildHistorySnapshots: [] }, { catalogAudit: section, metadata: { name: 'APP13 harness' } });
assert(backup.schemaVersion === 'dnd-combat-character-backup.v3', 'Backup should use portable v3 contract.');
assert(backup.app.backupKind === 'portable-user-data', 'Backup kind should identify portable data.');
assert(backup.summary.catalogHistoryCommitCount === 2, 'Summary should count catalog history.');
assert(backup.summary.remediationPlanCount === 1, 'Summary should count remediation plans.');
const parsed = parseCharacterDataBackup(JSON.stringify(backup));
assert(parsed.ok && parsed.backup?.catalogAudit, 'Portable backup should roundtrip through parser.');
const validation = validatePortableCatalogAuditSection({ candidate: parsed.backup.catalogAudit, snapshot, fallback: defaultState, knownCharacterIds: parsed.backup.summary.characterIds });
assert(validation.ok, 'Catalog audit should pass structural validation.');
assert(validation.section.historyIntegrity.checksum === section.historyIntegrity.checksum, 'Sanitized history checksum should remain stable.');
const tampered = JSON.parse(JSON.stringify(section));
tampered.history[0].label = 'Tampered';
const tamperedValidation = validatePortableCatalogAuditSection({ candidate: tampered, snapshot, fallback: defaultState });
assert(!tamperedValidation.ok, 'Tampered history should fail integrity validation.');
assert(tamperedValidation.issues.some((entry) => entry.code === 'backup.catalogAudit.historyIntegrityMismatch'), 'Integrity mismatch should be explicit.');
const localHistory = [h1];
const incomingAhead = comparePortableCatalogAudit({ snapshot, localFilterState: disabledAcid, localRevision: 1, localHistory, localPlans: {}, incoming: section });
assert(incomingAhead.relation === 'incomingAhead', 'Backup with descendant commit should be incomingAhead.');
assert(incomingAhead.incomingOnlyCommitIds.includes(h2.id), 'New backup commit should be identified.');
const divergentH1 = { ...h1, label: 'Local conflicting label' };
const divergence = comparePortableCatalogAudit({ snapshot, localFilterState: disabledAcid, localRevision: 1, localHistory: [divergentH1], localPlans: { [character.id]: { ...plan, id: 'local-plan' } }, incoming: section });
assert(divergence.relation === 'diverged', 'Conflicting commit content should diverge.');
assert(divergence.conflictingCommitIds.includes(h1.id), 'Conflicting commit ID should be preserved.');
assert(divergence.planConflicts.includes(character.id), 'Plan conflict should be reported.');
const importedCharacter = { ...character, id: 'portable-character-imported' };
const planImport = preparePortableRemediationPlanImport({ incomingPlans: section.remediationPlans, currentPlans: {}, characterIdMap: { [character.id]: importedCharacter.id }, importedCharacters: [importedCharacter] });
assert(planImport.accepted.length === 1, 'Non-conflicting plan should be imported.');
assert(planImport.accepted[0].characterId === importedCharacter.id, 'Imported plan should follow remapped character ID.');
assert(planImport.accepted[0].baseFingerprint !== plan.baseFingerprint, 'Imported plan fingerprint should be recomputed.');
const conflictImport = preparePortableRemediationPlanImport({ incomingPlans: section.remediationPlans, currentPlans: { [importedCharacter.id]: { ...plan, id: 'existing', characterId: importedCharacter.id } }, characterIdMap: { [character.id]: importedCharacter.id }, importedCharacters: [importedCharacter] });
assert(conflictImport.accepted.length === 0 && conflictImport.conflictingCharacterIds.length === 1, 'Local plans must not be silently overwritten.');
const memory = new Map();
const storage = { getItem: async (key) => memory.get(key) ?? null, setItem: async (key, value) => { memory.set(key, value); }, removeItem: async (key) => { memory.delete(key); } };
const repository = createCatalogFilterPreferencesRepository(storage, () => new Date('2026-08-04T12:20:00.000Z'));
const saved = await repository.save(snapshot, restoredAcid, {
  beforeState: disabledAcid, label: 'Import portable backup', impact: policy.previewImpact(disabledAcid, restoredAcid),
  context: { origin: 'import', portableImport: portableCatalogImportMetadata(section, incomingAhead) }
});
assert(saved.historyEntry.origin === 'import', 'Portable restore should be stored as a new import transaction.');
assert(saved.historyEntry.portableImport.sourceHistory.length === 2, 'Source audit should be preserved inside import transaction.');
assert(saved.historyEntry.portableImport.sourceHistoryChecksum === section.historyIntegrity.checksum, 'Source audit checksum should be preserved.');
assert(saved.history.length === 1, 'Imported audit must not overwrite local linear history.');
const outputReport = {
  status: 'PASS', assertions, catalogVersion: bundle.catalogVersion, catalogEntries: entries.length,
  backup: { schemaVersion: backup.schemaVersion, integrity: backup.integrity.checksum, characters: backup.summary.characterCount },
  audit: { revision: section.revision, commits: section.history.length, checksum: section.historyIntegrity.checksum, plans: section.remediationPlans.length },
  comparison: { incomingAhead: incomingAhead.relation, divergent: divergence.relation, conflictingCommits: divergence.conflictingCommitIds.length, planConflicts: divergence.planConflicts.length },
  import: { acceptedPlans: planImport.accepted.length, preservedLocalPlanConflicts: conflictImport.conflictingCharacterIds.length, localHistoryCommitsAfterImport: saved.history.length, sourceHistoryEmbedded: saved.historyEntry.portableImport.sourceHistory.length }
};
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reports/app-13-runtime-harness.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(outputReport, null, 2)}\n`);
console.log(JSON.stringify(outputReport, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
