#!/usr/bin/env node
// expectedAssertions=43
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado para o harness APP-17.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app17-harness-'));
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
const fakeNodeModules = path.join(tempRoot, 'node_modules');
fs.mkdirSync(path.join(fakeNodeModules, 'zustand'), { recursive: true });
fs.writeFileSync(path.join(fakeNodeModules, 'zustand/index.js'), `
exports.create = function create() {
  return function build(initializer) {
    let state;
    const listeners = new Set();
    const set = (patch) => {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = Object.assign({}, state, next);
      listeners.forEach((listener) => listener(state));
    };
    const get = () => state;
    state = initializer(set, get, {});
    const hook = (selector) => (selector || ((value) => value))(state);
    hook.getState = get;
    hook.setState = set;
    hook.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
    return hook;
  };
};
`);
fs.mkdirSync(path.join(fakeNodeModules, 'zustand/middleware'), { recursive: true });
fs.writeFileSync(path.join(fakeNodeModules, 'zustand/middleware/index.js'), `
exports.persist = (initializer) => initializer;
exports.createJSONStorage = (factory) => ({ factory });
`);
fs.mkdirSync(path.join(fakeNodeModules, '@react-native-async-storage/async-storage'), { recursive: true });
fs.writeFileSync(path.join(fakeNodeModules, '@react-native-async-storage/async-storage/index.js'), `
const data = new Map();
module.exports = { getItem: async (key) => data.has(key) ? data.get(key) : null, setItem: async (key, value) => { data.set(key, value); }, removeItem: async (key) => { data.delete(key); } };
module.exports.default = module.exports;
`);
fs.mkdirSync(path.join(tempRoot, 'assets/catalog-v4.8.0'), { recursive: true });
fs.copyFileSync(path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'), path.join(tempRoot, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'));
const loadRuntime = (relativePath) => {
  const runtimePath = path.join(tempRoot, relativePath.replace(/\.ts$/, '.js'));
  const runtimeModule = new Module(runtimePath, module);
  runtimeModule.filename = runtimePath;
  runtimeModule.paths = Module._nodeModulePaths(path.dirname(runtimePath));
  runtimeModule._compile(fs.readFileSync(runtimePath, 'utf8'), runtimePath);
  return runtimeModule.exports;
};
const { CatalogLoader } = loadRuntime('src/catalog/catalogLoader.ts');
const { ContentPolicyService } = loadRuntime('src/catalog/contentPolicyService.ts');
const { sha256Hex } = loadRuntime('src/catalog/catalogBundleDigest.ts');
const {
  parseAndValidateCatalogCandidate,
  compareCatalogSnapshots,
  projectCatalogFilterState,
  buildCatalogUpdateImpact,
  createCatalogUpdateSession,
  canCommitCatalogUpdate,
  migrateCharacterCatalogSnapshots,
  createCatalogUpdateReceipt,
  validateCatalogUpdateReceipt
} = loadRuntime('src/catalog/catalogUpdateTransaction.ts');
const { createCatalogPackageRepository } = loadRuntime('src/storage/catalogPackageRepository.ts');
const { createMemoryKeyValueStorage } = loadRuntime('src/storage/keyValueStorage.ts');

(async () => {
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
const bundlePath = path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json');
const rawCurrent = fs.readFileSync(bundlePath, 'utf8');
const bundle = JSON.parse(rawCurrent);
const loader = new CatalogLoader();
const current = loader.initializeFromBundle(bundle, { now: () => new Date('2026-08-04T16:00:00.000Z') });
assert(current.entries.length === 5841, 'catálogo atual deve conter 5841 entidades');
assert(sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 puro deve ser correto');

const candidateBundle = JSON.parse(rawCurrent);
candidateBundle.catalogVersion = '4.8.1';
candidateBundle.manifest.version = '4.8.1';
candidateBundle.sourcePackage.version = '4.8.1';
candidateBundle.runtimeIndex.version = '4.8.1';
candidateBundle.entityRegistry.generatedFromVersion = '4.8.1';
candidateBundle.dependencyGraph.generatedFromVersion = '4.8.1';
candidateBundle.contentCategories.version = '4.8.1';
const changedId = candidateBundle.runtimeIndex.entries[0].entityId;
candidateBundle.runtimeIndex.entries[0].displayContext = [...candidateBundle.runtimeIndex.entries[0].displayContext, 'APP-17 updated'];
const addedId = 'app17.synthetic.catalog-update-marker';
candidateBundle.runtimeIndex.entries.push({
  entityId: addedId, kind: 'feature', displayName: 'APP-17 Catalog Update Marker', displayContext: ['Synthetic validation'],
  sourceBookId: 'phb-2024', sourceFile: 'app17-synthetic.json', categoryIds: [], status: 'published', defaultEnabled: true,
  manualReviewRequired: false, dependencyCounts: { outgoing: 0, incoming: 0 }, searchKey: 'app 17 catalog update marker'
});
candidateBundle.entityRegistry.entries.push({
  entityId: addedId, kind: 'feature', sourceBookId: 'phb-2024', sourceFile: 'app17-synthetic.json', name: 'APP-17 Catalog Update Marker',
  key: 'app17-catalog-update-marker', status: 'published', defaultEnabled: true, manualReviewRequired: false, confidence: 'high'
});
candidateBundle.runtimeIndex.entryCount += 1;
candidateBundle.dependencyGraph.nodeCount += 1;
const rawCandidate = JSON.stringify(candidateBundle);
const parsed = await parseAndValidateCatalogCandidate({
  rawText: rawCandidate,
  currentSnapshot: current,
  expectedChecksum: sha256Hex(rawCandidate),
  sourceName: 'catalog-v4.8.1.json',
  now: () => new Date('2026-08-04T16:05:00.000Z')
});
assert(parsed.snapshot.catalogVersion === '4.8.1', 'versão candidata deve ser carregada');
assert(parsed.snapshot.entries.length === 5842, 'candidato deve conter a entidade adicionada');
assert(parsed.diff.addedEntityIds.includes(addedId), 'diff deve listar entidade adicionada');
assert(parsed.diff.changedEntityIds.includes(changedId), 'diff deve listar entidade alterada');
assert(parsed.diff.removedEntityIds.length === 0, 'candidato não deve remover entidades');
const repeatedDiff = compareCatalogSnapshots(current, parsed.snapshot);
assert(repeatedDiff.addedEntityIds.length === 1, 'comparação deve ser determinística');

const currentFilter = new ContentPolicyService(current).createDefaultState();
currentFilter.entityStates[changedId] = 'enabled';
const projectedFilter = projectCatalogFilterState(currentFilter, parsed.snapshot);
assert(projectedFilter.entityStates[changedId] === 'enabled', 'override compatível deve sobreviver à atualização');
assert(projectedFilter.bookStates['phb-2024'] === currentFilter.bookStates['phb-2024'], 'estado do livro deve ser preservado');
const character = {
  id: 'app17-character', name: 'Catalog Migrator', level: 1, catalogSnapshotId: current.snapshotId,
  classes: [], subclasses: [], proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
  abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }, weapons: [], equipment: [], magicItems: [], feats: [], spells: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: []
};
const report = { manifest: { characterId: character.id, references: [{ origin: 'catalog', entityId: changedId }] } };
const historyEntry = { id: 'catalog-history-app17', catalogSnapshotId: current.snapshotId };
const evidenceRecord = { recordId: 'evidence-app17', receipt: { catalogHistoryEntryId: historyEntry.id } };
const impact = buildCatalogUpdateImpact({
  characters: [character], currentReports: [report], candidateSnapshot: parsed.snapshot, candidateFilterState: projectedFilter,
  diff: parsed.diff, evidenceRecords: [evidenceRecord], catalogHistory: [historyEntry]
});
assert(impact.counts.charactersAffected === 1, 'personagem que usa entidade alterada deve ser afetado');
assert(impact.counts.snapshotMigrations === 1, 'snapshot antigo deve exigir migração explícita');
assert(impact.counts.blockingCharacters === 0, 'entidade alterada e disponível não deve bloquear');
assert(impact.counts.evidenceRecordsAffected === 1, 'evidência da versão anterior deve ser sinalizada');

const memory = createMemoryKeyValueStorage();
const repository = createCatalogPackageRepository(memory, () => new Date('2026-08-04T16:10:00.000Z'));
const descriptor = await repository.stage(rawCandidate, {
  id: parsed.packageId, catalogVersion: parsed.snapshot.catalogVersion, snapshotId: parsed.snapshot.snapshotId, checksum: parsed.checksum, sourceName: 'catalog-v4.8.1.json'
});
assert(descriptor.chunkCount > 1, 'bundle real deve ser armazenado em blocos');
const loaded = await repository.readPackage(descriptor.id);
assert(loaded.rawText === rawCandidate, 'blocos devem reconstruir exatamente o bundle');
const activation = await repository.activate({ kind: 'stored', packageId: descriptor.id });
assert(activation.previous.kind === 'bundled', 'primeira ativação deve preservar bundle incluído como anterior');
assert((await repository.loadActive()).ref.kind === 'stored', 'pacote candidato deve se tornar ativo');
await repository.restoreActive({ kind: 'bundled' }, { kind: 'stored', packageId: descriptor.id });
assert((await repository.loadActive()).ref.kind === 'bundled', 'rollback deve restaurar referência anterior');

const session = createCatalogUpdateSession({
  candidate: descriptor, diff: parsed.diff, impact, projectedFilterState: projectedFilter,
  checkpoint: { runtimeRef: { kind: 'bundled' }, catalog: { filterState: currentFilter, revision: 2, history: [] }, characters: [character], evidenceRecords: [evidenceRecord] },
  sourceName: 'catalog-v4.8.1.json', internalFixtureBypass: true, now: () => new Date('2026-08-04T16:15:00.000Z')
});
assert(!canCommitCatalogUpdate(session).ok, 'sessão sem reconhecimentos não deve confirmar');
session.migrationCharacterIds = [character.id];
session.impactAcknowledged = true;
session.evidenceAcknowledged = true;
session.blockingAcknowledged = true;
assert(canCommitCatalogUpdate(session).ok, 'sessão reconhecida e migrada deve confirmar');
const migrated = migrateCharacterCatalogSnapshots([character], [character.id], parsed.snapshot.snapshotId);
assert(migrated[0].catalogSnapshotId === parsed.snapshot.snapshotId, 'migração deve atualizar snapshot explicitamente');
assert(character.catalogSnapshotId === current.snapshotId, 'preview não deve mutar personagem original');
const receipt = createCatalogUpdateReceipt(session, () => new Date('2026-08-04T16:20:00.000Z'));
assert(validateCatalogUpdateReceipt(receipt), 'recibo deve ser íntegro');
assert(!validateCatalogUpdateReceipt({ ...receipt, toVersion: 'tampered' }), 'recibo adulterado deve ser rejeitado');


const { createCatalogStore } = loadRuntime('src/store/catalogStore.ts');
const storeStorage = createMemoryKeyValueStorage();
const storePackages = createCatalogPackageRepository(storeStorage, () => new Date('2026-08-04T16:30:00.000Z'));
await storePackages.stage(rawCandidate, {
  id: parsed.packageId, catalogVersion: parsed.snapshot.catalogVersion, snapshotId: parsed.snapshot.snapshotId,
  checksum: parsed.checksum, sourceName: 'catalog-v4.8.1.json'
});
const catalogStore = createCatalogStore(storeStorage, () => new Date('2026-08-04T16:31:00.000Z'));
const initialized = await catalogStore.getState().initialize();
assert(initialized.ok, 'store deve inicializar o catálogo incluído');
assert(catalogStore.getState().snapshot.catalogVersion === '4.8.0', 'store deve iniciar na versão incluída');
const switchResult = await catalogStore.getState().switchRuntimeCatalog(
  { kind: 'stored', packageId: parsed.packageId },
  { filterState: projectedFilter, revision: 3, history: [] }
);
assert(switchResult.ok, 'store deve ativar pacote armazenado');
assert(catalogStore.getState().snapshot.catalogVersion === '4.8.1', 'store deve expor snapshot candidato após commit');
assert(catalogStore.getState().runtimeRef.kind === 'stored', 'store deve persistir origem armazenada');
const rollbackResult = await catalogStore.getState().switchRuntimeCatalog(
  { kind: 'bundled' },
  { filterState: currentFilter, revision: 2, history: [] }
);
assert(rollbackResult.ok, 'store deve restaurar bundle incluído');
assert(catalogStore.getState().snapshot.catalogVersion === '4.8.0', 'rollback deve restaurar versão anterior');

const installModule = (relativePath, exportsValue) => {
  const filename = path.join(tempRoot, relativePath.replace(/\.ts$/, '.js'));
  const stub = new Module(filename, module);
  stub.filename = filename;
  stub.exports = exportsValue;
  stub.loaded = true;
  require.cache[filename] = stub;
};
const defaultCatalogStoreModule = loadRuntime('src/store/catalogStore.ts');
const defaultCatalogStore = defaultCatalogStoreModule.useCatalogStore;
await defaultCatalogStore.getState().initialize();
let sessionCharacters = [JSON.parse(JSON.stringify(character))];
const characterHook = (selector) => (selector || ((value) => value))(characterHook.getState());
characterHook.getState = () => ({ characters: sessionCharacters, setCharacters: (next) => { sessionCharacters = JSON.parse(JSON.stringify(next)); } });
let sessionEvidenceRecords = [];
const portableHook = (selector) => (selector || ((value) => value))(portableHook.getState());
portableHook.getState = () => ({
  evidenceRecords: sessionEvidenceRecords,
  markEvidenceCatalogChanged: (recordIds, fromVersion, toVersion) => {
    const selected = new Set(recordIds);
    sessionEvidenceRecords = sessionEvidenceRecords.map((record) => selected.has(record.recordId)
      ? { ...record, comparison: { status: 'changed', comparedAt: new Date().toISOString(), expectedFingerprint: record.receipt.effectiveFingerprint, messages: [`${fromVersion} -> ${toVersion}`] } }
      : record);
    return selected.size;
  },
  replaceEvidenceRecords: (records) => { sessionEvidenceRecords = JSON.parse(JSON.stringify(records || [])); }
});
installModule('src/store/catalogStore.ts', { useCatalogStore: defaultCatalogStore });
installModule('src/store/characterStore.ts', { useCharacterStore: characterHook });
installModule('src/store/portableRestoreSessionStore.ts', { usePortableRestoreSessionStore: portableHook });
let trustRegistryState = { schemaVersion: 'dnd-catalog-trust-registry.v1', revision: 0, publishers: [], events: [], updatedAt: new Date().toISOString() };
const trustHook = (selector) => (selector || ((value) => value))(trustHook.getState());
trustHook.getState = () => ({ registry: trustRegistryState, acceptBundle: () => ({ ok: true }), replaceRegistry: (registry) => { trustRegistryState = JSON.parse(JSON.stringify(registry)); } });
installModule('src/store/catalogTrustStore.ts', { useCatalogTrustStore: trustHook });
const { useCatalogUpdateSessionStore } = loadRuntime('src/store/catalogUpdateSessionStore.ts');
const preparedResult = await useCatalogUpdateSessionStore.getState().prepareCandidate({
  rawText: rawCandidate,
  sourceName: 'catalog-v4.8.1.json',
  currentReports: [report],
  trustBypassForInternalFixture: true
});
assert(preparedResult.ok, 'coordenador deve preparar a sessão com o bundle real');
const preparedSession = useCatalogUpdateSessionStore.getState().activeSession;
assert(preparedSession.status === 'prepared', 'sessão coordenada deve permanecer em preview');
assert(defaultCatalogStore.getState().snapshot.catalogVersion === '4.8.0', 'preview coordenado não deve trocar o catálogo');
useCatalogUpdateSessionStore.getState().setMigrationCharacterIds([character.id]);
useCatalogUpdateSessionStore.getState().acknowledgeImpact(true);
useCatalogUpdateSessionStore.getState().acknowledgeEvidence(true);
useCatalogUpdateSessionStore.getState().acknowledgeBlockingReferences(true);
const coordinatedCommit = await useCatalogUpdateSessionStore.getState().commit();
assert(coordinatedCommit.ok, 'coordenador deve confirmar catálogo e personagens');
assert(defaultCatalogStore.getState().snapshot.catalogVersion === '4.8.1', 'commit coordenado deve ativar candidato');
assert(sessionCharacters[0].catalogSnapshotId === parsed.snapshot.snapshotId, 'commit coordenado deve migrar snapshot da ficha');
assert(useCatalogUpdateSessionStore.getState().activeSession.status === 'committed', 'sessão deve terminar confirmada');
const coordinatedRollback = await useCatalogUpdateSessionStore.getState().rollback();
assert(coordinatedRollback.ok, 'coordenador deve executar rollback integral');
assert(defaultCatalogStore.getState().snapshot.catalogVersion === '4.8.0', 'rollback coordenado deve restaurar catálogo anterior');
assert(sessionCharacters[0].catalogSnapshotId === current.snapshotId, 'rollback coordenado deve restaurar snapshot da ficha');
assert(useCatalogUpdateSessionStore.getState().activeSession.status === 'rolledBack', 'sessão deve registrar rollback concluído');

const output = {
  status: 'PASS', assertions, currentVersion: current.catalogVersion, candidateVersion: parsed.snapshot.catalogVersion,
  currentEntities: current.entries.length, candidateEntities: parsed.snapshot.entries.length,
  dependencies: repeatedDiff.dependencyEdgesAfter,
  diff: { added: parsed.diff.addedEntityIds.length, removed: parsed.diff.removedEntityIds.length, changed: parsed.diff.changedEntityIds.length },
  impact: impact.counts,
  storage: { chunks: descriptor.chunkCount, rollbackRef: 'bundled', storeSwitch: 'PASS', coordinatedCommitRollback: 'PASS' },
  receipt: receipt.checksum
};
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-17-runtime-harness.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));

})().catch((error) => { console.error(error); process.exit(1); });
