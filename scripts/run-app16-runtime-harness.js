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
  throw new Error('TypeScript não encontrado para o harness APP-16.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app16-harness-'));
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
const { createCharacterDataBackup } = loadRuntime('src/backup/characterBackup.ts');
const { preparePortableRestoreSession } = loadRuntime('src/backup/portableRestoreSession.ts');
const {
  verifyPortableRestoreIntegrity,
  createPortableRestoreIntegrityReceipt,
  createPortableRestoreEvidenceBundle,
  validatePortableRestoreEvidenceBundle
} = loadRuntime('src/backup/portableRestoreVerification.ts');
const {
  createPortableRestoreHistoricalEvidenceRecord,
  createPortableRestoreEvidenceArchive,
  validatePortableRestoreEvidenceArchive,
  portableRestoreEvidenceArchiveToJson,
  parsePortableRestoreEvidenceImport,
  comparePortableRestoreHistoricalEvidence,
  revalidatePortableRestoreEvidenceHistory,
  shouldRevalidatePortableRestoreEvidence,
  planPortableRestoreEvidenceCleanup
} = loadRuntime('src/backup/portableRestoreEvidenceCenter.ts');
const { emptyProgressionRecoverySummary } = loadRuntime('src/characters/progressionRecovery.ts');
const { emptyCompatibilityRemediationRecoverySummary } = loadRuntime('src/characters/compatibilityRemediationRecovery.ts');

const bundle = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'), 'utf8'));
const entries = bundle.runtimeIndex.entries;
const snapshot = {
  snapshotId: `catalog-${bundle.catalogVersion}-app16-harness`, catalogVersion: bundle.catalogVersion, loadedAt: bundle.generatedAt,
  manifest: bundle.manifest, entries,
  registry: new Map(bundle.entityRegistry.entries.map((entry) => [entry.entityId, entry])),
  entryById: new Map(entries.map((entry) => [entry.entityId, entry])),
  categories: bundle.contentCategories.entities,
  categoryById: new Map(bundle.contentCategories.entities.map((category) => [category.id, category])),
  dependenciesFrom: new Map(), dependenciesTo: new Map(), aliases: new Map(bundle.aliases.entities.map((alias) => [alias.from, alias])),
  filterPolicy: bundle.contentFilterPolicy, readinessProfile: bundle.readinessProfile,
  validation: { status: 'passed', checkedAt: bundle.generatedAt, checks: {}, counts: {}, issues: [] }
};
const emptyCharacter = (id, name) => ({
  id, name, level: 1, classes: [], subclasses: [],
  proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
  abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }, weapons: [], equipment: [], magicItems: [], feats: [], spells: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: []
});
const checkpoint = () => ({
  characterStore: {
    characters: [emptyCharacter('app16-character', 'App16 Evidence')], progressionDrafts: {},
    progressionRecovery: emptyProgressionRecoverySummary(), compatibilityRemediationPlans: {},
    compatibilityRemediationRecovery: emptyCompatibilityRemediationRecoverySummary(), compatibilityRemediationQuarantine: {}
  },
  scenarios: [], buildPresets: [], buildHistorySnapshots: [],
  catalog: { filterState: { bookStates: {}, categoryStates: {}, entityStates: {} }, revision: 1, history: [] }
});
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
const current = checkpoint();
const backup = createCharacterDataBackup({ characters: [], scenarios: [], buildPresets: [], buildHistorySnapshots: [] });
const prepared = preparePortableRestoreSession({ backup, options: { mode: 'merge' }, current, now: () => new Date('2026-08-04T15:00:00.000Z') }).session;
const committed = { ...prepared, status: 'committed', applied: { data: true, catalog: true }, committedAt: '2026-08-04T15:01:00.000Z' };
const verification = verifyPortableRestoreIntegrity({ session: committed, effective: committed.projected, snapshot, filterState: committed.projected.catalog.filterState, choices: [], now: () => new Date('2026-08-04T15:02:00.000Z') });
const receipt = createPortableRestoreIntegrityReceipt(committed, verification, () => new Date('2026-08-04T15:03:00.000Z'));
const session = { ...committed, postRestoreVerification: verification, integrityReceipt: receipt, closedAt: '2026-08-04T15:04:00.000Z' };
const evidence = createPortableRestoreEvidenceBundle(session, () => new Date('2026-08-04T15:05:00.000Z'));
assert(validatePortableRestoreEvidenceBundle(evidence), 'pacote de evidências deveria ser válido');
const record = createPortableRestoreHistoricalEvidenceRecord(session, () => new Date('2026-08-04T15:06:00.000Z'));
assert(Boolean(record), 'registro histórico local deveria ser criado');
assert(record.source === 'local', 'registro local deveria preservar a origem');
assert(record.localCheckpointAvailable === true, 'registro local deveria indicar checkpoint');
const same = comparePortableRestoreHistoricalEvidence(record, session.projected, [], () => new Date('2026-08-04T15:07:00.000Z'));
assert(same.comparison.status === 'current', 'estado idêntico deveria permanecer atual');
assert(same.comparison.characterCountDelta === 0, 'contagem de personagens deveria coincidir');
const changedCheckpoint = JSON.parse(JSON.stringify(session.projected));
changedCheckpoint.characterStore.characters[0].name = 'Changed after receipt';
const changed = comparePortableRestoreHistoricalEvidence(record, changedCheckpoint, [], () => new Date('2026-08-04T15:08:00.000Z'));
assert(changed.comparison.status === 'changed', 'alteração posterior deveria ser detectada');
assert(changed.comparison.messages.length === 1, 'deveria explicar a divergência');
assert(record.receipt.checksum === receipt.checksum, 'comparação não deveria alterar o recibo');
const archive = createPortableRestoreEvidenceArchive([record], () => new Date('2026-08-04T15:09:00.000Z'));
assert(validatePortableRestoreEvidenceArchive(archive), 'arquivo agregado deveria ser íntegro');
assert(archive.records.length === 1, 'arquivo agregado deveria conter um registro');
const imported = parsePortableRestoreEvidenceImport(portableRestoreEvidenceArchiveToJson(archive), [], () => new Date('2026-08-04T15:10:00.000Z'));
assert(imported.ok, 'arquivo agregado deveria ser importado');
assert(imported.records.length === 1, 'uma evidência deveria ser importada');
assert(imported.records[0].source === 'imported', 'origem deveria ser importada');
assert(imported.records[0].localCheckpointAvailable === false, 'evidência externa não deve liberar rollback');
const duplicate = parsePortableRestoreEvidenceImport(portableRestoreEvidenceArchiveToJson(archive), imported.records.map((entry) => entry.recordId));
assert(duplicate.records.length === 0, 'duplicata deveria ser ignorada');
assert(duplicate.ignoredDuplicateRecordIds.length === 1, 'duplicata deveria ser reportada');
const tamperedEvidence = { ...evidence, sessionId: 'tampered' };
const rejected = parsePortableRestoreEvidenceImport(JSON.stringify(tamperedEvidence));
assert(!rejected.ok, 'evidência adulterada deveria ser rejeitada');
assert(rejected.issues.length > 0, 'rejeição deveria explicar o problema');
const recent = { ...same, comparison: { ...same.comparison, comparedAt: '2026-08-04T15:11:00.000Z' } };
assert(!shouldRevalidatePortableRestoreEvidence(recent, () => new Date('2026-08-04T16:00:00.000Z')), 'registro recente não deveria revalidar antes de 24h');
assert(shouldRevalidatePortableRestoreEvidence(recent, () => new Date('2026-08-05T16:00:00.000Z')), 'registro antigo deveria revalidar');
const history = revalidatePortableRestoreEvidenceHistory([recent], changedCheckpoint, [], { force: true, now: () => new Date('2026-08-04T16:01:00.000Z') });
assert(history[0].comparison.status === 'changed', 'revalidação forçada deveria detectar alteração');
const checkpoints = Array.from({ length: 8 }, (_, index) => ({ ...session, id: `checkpoint-${index}`, closedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` }));
const cleanup = planPortableRestoreEvidenceCleanup([record, imported.records[0]], checkpoints);
assert(cleanup.recommendedCheckpointSessionIds.length === 3, 'deveria recomendar retenção dos cinco checkpoints mais recentes');
assert(cleanup.retainedCheckpointCount === 5, 'limite de retenção deveria ser cinco');
assert(cleanup.evidenceRecordCount === 2, 'evidências deveriam permanecer separadas dos checkpoints');
assert(bundle.runtimeIndex.entries.length === 5841, 'catálogo real deveria conter 5841 entidades');
assert(bundle.dependencyGraph.edges.length === 15385, 'grafo real deveria conter 15385 dependências');
const report = {
  status: 'PASS', assertions, catalogVersion: bundle.catalogVersion,
  entities: bundle.runtimeIndex.entries.length, dependencies: bundle.dependencyGraph.edges.length,
  evidence: { localRecords: 1, importedRecords: imported.records.length, archiveChecksum: archive.checksum, changedStatus: changed.comparison.status },
  cleanup: { checkpoints: checkpoints.length, recommendedRemoval: cleanup.recommendedCheckpointSessionIds.length, retained: cleanup.retainedCheckpointCount }
};
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-16-runtime-harness.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
