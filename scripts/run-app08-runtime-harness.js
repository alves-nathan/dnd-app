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
  throw new Error('TypeScript não encontrado para o harness APP-08.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app08-harness-'));
const transpile = (relativePath) => {
  const input = path.join(root, relativePath);
  const output = path.join(tempRoot, relativePath.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(input, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, fileName: input }).outputText);
};
for (const file of ['src/catalog/errors.ts', 'src/catalog/contentPolicyService.ts', 'src/characters/characterCompatibility.ts']) transpile(file);
const runtimePath = path.join(tempRoot, 'src/characters/characterCompatibility.js');
const runtimeModule = new Module(runtimePath, module);
runtimeModule.filename = runtimePath;
runtimeModule.paths = Module._nodeModulePaths(path.dirname(runtimePath));
runtimeModule._compile(fs.readFileSync(runtimePath, 'utf8'), runtimePath);
const { buildCharacterCompatibilityReport } = runtimeModule.exports;

const bundle = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'), 'utf8'));
const entries = bundle.runtimeIndex.entries;
const snapshot = {
  snapshotId: `catalog-${bundle.catalogVersion}-app08-harness`, catalogVersion: bundle.catalogVersion, loadedAt: bundle.generatedAt,
  manifest: bundle.manifest, entries, registry: new Map(bundle.entityRegistry.entries.map((entry) => [entry.entityId, entry])),
  entryById: new Map(entries.map((entry) => [entry.entityId, entry])), categories: bundle.contentCategories.entities,
  categoryById: new Map(bundle.contentCategories.entities.map((category) => [category.id, category])), dependenciesFrom: new Map(), dependenciesTo: new Map(),
  aliases: new Map(bundle.aliases.entities.map((alias) => [alias.from, alias])), filterPolicy: bundle.contentFilterPolicy, readinessProfile: bundle.readinessProfile,
  validation: { status: 'passed', checkedAt: bundle.generatedAt, checks: { bundleChecksum: true, versionCoherence: true, counts: true, uniqueEntityIds: true, registryCoverage: true, categoryReferences: true, dependencyReferences: true, aliasReferences: true }, counts: { runtimeEntries: entries.length, registryEntries: bundle.entityRegistry.entries.length, dependencyEdges: bundle.dependencyGraph.edges.length, categories: bundle.contentCategories.entities.length, aliases: bundle.aliases.entities.length }, issues: [] }
};
const filterState = { bookStates: Object.fromEntries(bundle.manifest.sourceBooks.map((book) => [book, true])), categoryStates: {}, entityStates: { 'phb-2024-spell-acid-splash': 'disabled' } };
const catalogChoice = (entityId, kind, name) => ({ choiceId: `catalog:${entityId}`, entityId, kind, name, sourceBookId: 'phb-2024', sourceLabel: 'PHB 2024', origin: 'catalog', catalogSnapshotId: snapshot.snapshotId, catalogEntityId: entityId, ownerIds: [], searchableText: name.toLowerCase(), available: true, blockedReasons: [], manualReviewRequired: false, payload: {}, provenance: { origin: 'catalog', sourceBookId: 'phb-2024', sourceId: 'phb-2024', catalogSnapshotId: snapshot.snapshotId, catalogVersion: bundle.catalogVersion, catalogEntityId: entityId, legacyItemIds: [], overrideAuthorized: false } });
const localChoice = { choiceId: 'compendium:local-draft', entityId: 'local-draft', kind: 'feat', name: 'Local Draft Feat', sourceLabel: 'Homebrew', origin: 'compendium', compendiumItemId: 'local-draft', ownerIds: [], searchableText: 'local draft feat', available: false, blockedReasons: [{ code: 'localItemNotValidated', message: 'O item local está como draft.' }], manualReviewRequired: true, payload: {}, provenance: { origin: 'compendium', sourceId: 'homebrew', compendiumItemId: 'local-draft', legacyItemIds: ['local-draft'], overrideAuthorized: false } };
const link = (id, choiceId, appliedAs, name, extra = {}) => ({ id, characterId: 'app08-character', itemId: choiceId, importItemId: choiceId, packId: 'pack', sourceId: extra.sourceId ?? 'phb-2024', itemType: appliedAs, appliedAs, appliedEntityId: id, appliedEntityName: name, status: 'active', addedAt: '2026-08-04T00:00:00.000Z', choiceId, ...extra });
const character = {
  id: 'app08-character', name: 'Manifest Wizard', level: 1, catalogSnapshotId: 'catalog-4.7.0-old', classes: [], subclasses: [],
  proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] }, abilities: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 10 },
  weapons: [], equipment: [], magicItems: [], feats: [], spells: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: [],
  compendiumLinks: [
    link('wizard', 'catalog:phb-2024-class-wizard', 'class', 'Wizard', { origin: 'catalog', catalogEntityId: 'phb-2024-class-wizard', catalogSnapshotId: 'catalog-4.7.0-old' }),
    link('acid', 'catalog:phb-2024-spell-acid-splash', 'spell', 'Acid Splash', { origin: 'catalog', catalogEntityId: 'phb-2024-spell-acid-splash', catalogSnapshotId: 'catalog-4.7.0-old' }),
    link('removed', 'catalog:removed-app08-entity', 'feat', 'Removed Feat', { origin: 'catalog', catalogEntityId: 'removed-app08-entity', catalogSnapshotId: 'catalog-4.7.0-old' }),
    link('local', 'compendium:local-draft', 'feat', 'Local Draft Feat', { origin: 'compendium', sourceId: 'homebrew' })
  ]
};
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
const before = JSON.stringify(character);
const report = buildCharacterCompatibilityReport({ character, snapshot, filterState, choices: [catalogChoice('phb-2024-class-wizard', 'class', 'Wizard'), catalogChoice('phb-2024-spell-acid-splash', 'spell', 'Acid Splash'), localChoice], now: () => new Date('2026-08-04T03:30:00.000Z') });
assert(report.status === 'blocked', 'Disabled and missing references should block compatibility.');
assert(report.requiresReview, 'Blocked report should require review.');
assert(report.canOpenAfterAcknowledgement, 'User should retain explicit continue option.');
assert(report.issues.some((issue) => issue.code === 'CHARACTER_SNAPSHOT_MISMATCH'), 'Snapshot mismatch should be reported.');
assert(report.issues.some((issue) => issue.code === 'CHARACTER_CATALOG_ENTITY_DISABLED'), 'Disabled official entity should be reported.');
assert(report.issues.some((issue) => issue.code === 'CHARACTER_CATALOG_ENTITY_MISSING'), 'Removed official entity should be reported.');
assert(report.issues.some((issue) => issue.code === 'CHARACTER_LOCAL_ITEM_DISABLED'), 'Invalid local item should be reported.');
assert(report.manifest.schemaVersion === 'dnd-character-rules-manifest.v1', 'Manifest should be versioned.');
assert(report.manifest.currentCatalogVersion === '4.8.0', 'Current catalog version should be registered.');
assert(report.manifest.catalogSnapshotIds.includes('catalog-4.7.0-old'), 'Character snapshot should be registered.');
assert(report.manifest.sourceBookIds.includes('phb-2024'), 'Source books should be registered.');
assert(report.manifest.sourceIds.includes('homebrew'), 'Local sources should be registered.');
assert(report.manifest.catalogEntityIds.includes('phb-2024-class-wizard'), 'Official entities should be registered.');
assert(report.manifest.compendiumItemIds.includes('local-draft'), 'Local item IDs should be registered.');
assert(report.manifest.counts.disabled === 2, `Expected two disabled references, got ${report.manifest.counts.disabled}.`);
assert(report.manifest.counts.missing === 1, 'Expected one missing reference.');
assert(JSON.stringify(character) === before, 'Diagnostic must not mutate the character.');
assert(report.issues.every((issue) => issue.actions.length > 0), 'Every issue should include guided actions.');
const outputReport = { status: 'PASS', assertions, catalogVersion: bundle.catalogVersion, catalogEntries: entries.length, manifest: report.manifest.counts, issues: report.issues.map((issue) => issue.code) };
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reports/app-08-runtime-harness.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(outputReport, null, 2)}\n`);
console.log(JSON.stringify(outputReport, null, 2));
