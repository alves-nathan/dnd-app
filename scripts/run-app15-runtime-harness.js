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
  throw new Error('TypeScript não encontrado para o harness APP-15.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app15-harness-'));
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
const { verifyPortableRestoreIntegrity, createPortableRestoreIntegrityReceipt, validatePortableRestoreIntegrityReceipt, createPortableRestoreEvidenceBundle, validatePortableRestoreEvidenceBundle } = loadRuntime('src/backup/portableRestoreVerification.ts');
const { emptyProgressionRecoverySummary } = loadRuntime('src/characters/progressionRecovery.ts');
const { emptyCompatibilityRemediationRecoverySummary } = loadRuntime('src/characters/compatibilityRemediationRecovery.ts');

const bundle = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'), 'utf8'));
const entries = bundle.runtimeIndex.entries;
const snapshot = {
  snapshotId: `catalog-${bundle.catalogVersion}-app15-harness`, catalogVersion: bundle.catalogVersion, loadedAt: bundle.generatedAt,
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
const baseCheckpoint = () => ({
  characterStore: {
    characters: [emptyCharacter('app15-character', 'App15 Verified')], progressionDrafts: {},
    progressionRecovery: emptyProgressionRecoverySummary(), compatibilityRemediationPlans: {},
    compatibilityRemediationRecovery: emptyCompatibilityRemediationRecoverySummary(), compatibilityRemediationQuarantine: {}
  },
  scenarios: [], buildPresets: [], buildHistorySnapshots: [],
  catalog: { filterState: { bookStates: {}, categoryStates: {}, entityStates: {} }, revision: 1, history: [] }
});
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(message); };
const current = baseCheckpoint();
const backup = createCharacterDataBackup({ characters: [], scenarios: [], buildPresets: [], buildHistorySnapshots: [] });
const session = { ...preparePortableRestoreSession({ backup, options: { mode: 'merge' }, current }).session, status: 'committed', applied: { data: true, catalog: true } };
const passed = verifyPortableRestoreIntegrity({ session, effective: session.projected, snapshot, filterState: session.projected.catalog.filterState, choices: [] });
assert(passed.status === 'passed', 'estado projetado deveria passar');
assert(passed.canClose === true, 'sessão íntegra deveria poder encerrar');
assert(passed.expectedFingerprint === passed.effectiveFingerprint, 'fingerprints deveriam coincidir');
assert(passed.counts.characters === 1, 'personagem deveria ser contado');
assert(passed.counts.errors === 0, 'não deveria haver erros');
const divergedCheckpoint = JSON.parse(JSON.stringify(session.projected));
divergedCheckpoint.characterStore.characters[0].name = 'Mutated';
const failed = verifyPortableRestoreIntegrity({ session, effective: divergedCheckpoint, snapshot, filterState: divergedCheckpoint.catalog.filterState, choices: [] });
assert(failed.status === 'failed', 'divergência deveria falhar');
assert(failed.canClose === false, 'divergência deveria bloquear encerramento');
assert(failed.issues.some((entry) => entry.code === 'RESTORE_EFFECTIVE_FINGERPRINT_MISMATCH'), 'deveria sinalizar fingerprint');
const warningSession = JSON.parse(JSON.stringify(session));
warningSession.projected.characterStore.compatibilityRemediationQuarantine.q1 = { id: 'q1', quarantinedAt: '2026-08-04T00:00:00.000Z', reason: 'invalid', rawPlan: {} };
const warning = verifyPortableRestoreIntegrity({ session: warningSession, effective: warningSession.projected, snapshot, filterState: warningSession.projected.catalog.filterState, choices: [] });
assert(warning.status === 'warning', 'quarentena deveria produzir aviso');
assert(warning.requiresAcknowledgement === true, 'aviso deveria exigir reconhecimento');
assert(warning.canClose === false, 'aviso não reconhecido deveria bloquear encerramento');
const acknowledged = { ...warning, acknowledgedAt: '2026-08-04T15:00:00.000Z', canClose: true };
const receipt = createPortableRestoreIntegrityReceipt(warningSession, acknowledged, () => new Date('2026-08-04T15:01:00.000Z'));
assert(receipt.schemaVersion === 'dnd-portable-restore-integrity-receipt.v1', 'schema de recibo incorreto');
assert(validatePortableRestoreIntegrityReceipt(receipt), 'recibo deveria ser íntegro');
assert(!validatePortableRestoreIntegrityReceipt({ ...receipt, sourceName: 'tampered' }), 'adulteração deveria invalidar recibo');
warningSession.postRestoreVerification = acknowledged;
warningSession.integrityReceipt = receipt;
const evidence = createPortableRestoreEvidenceBundle(warningSession, () => new Date('2026-08-04T15:02:00.000Z'));
assert(Boolean(evidence), 'evidência deveria ser criada');
assert(validatePortableRestoreEvidenceBundle(evidence), 'evidência deveria ser íntegra');
assert(!validatePortableRestoreEvidenceBundle({ ...evidence, sessionId: 'tampered' }), 'adulteração deveria invalidar evidência');
const orphan = JSON.parse(JSON.stringify(session.projected));
orphan.characterStore.progressionDrafts.ghost = { id: 'draft-ghost', characterId: 'ghost' };
const orphanResult = verifyPortableRestoreIntegrity({ session, effective: orphan, snapshot, filterState: orphan.catalog.filterState, choices: [] });
assert(orphanResult.issues.some((entry) => entry.code === 'RESTORE_ORPHAN_PROGRESSION_DRAFT'), 'draft órfão deveria ser detectado');
assert(orphanResult.status === 'failed', 'draft órfão deveria bloquear');
assert(bundle.runtimeIndex.entries.length === 5841, 'catálogo real deveria conter 5841 entidades');
assert(bundle.dependencyGraph.edges.length === 15385, 'grafo real deveria conter 15385 dependências');
const report = {
  status: 'PASS', assertions, catalogVersion: bundle.catalogVersion,
  entities: bundle.runtimeIndex.entries.length, dependencies: bundle.dependencyGraph.edges.length,
  verification: { passed: passed.status, failed: failed.status, warning: warning.status }, receiptChecksum: receipt.checksum, evidenceChecksum: evidence.checksum
};
fs.writeFileSync(path.join(root, 'reports/app-15-runtime-harness.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
