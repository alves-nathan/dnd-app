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
  throw new Error('TypeScript não encontrado para o harness APP-09.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app09-harness-'));
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
const {
  createCompatibilityRemediationPlan,
  previewCompatibilityRemediation,
  upsertCompatibilityRemediationDecision
} = loadRuntime('src/characters/compatibilityRemediation.ts');
const { createProgressionDraft, commitProgressionDraft, rollbackProgressionAudit, progressionSnapshot } = loadRuntime('src/characters/progressionTransaction.ts');

const bundle = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'), 'utf8'));
const entries = bundle.runtimeIndex.entries;
const snapshot = {
  snapshotId: `catalog-${bundle.catalogVersion}-app09-harness`, catalogVersion: bundle.catalogVersion, loadedAt: bundle.generatedAt,
  manifest: bundle.manifest, entries, registry: new Map(bundle.entityRegistry.entries.map((entry) => [entry.entityId, entry])),
  entryById: new Map(entries.map((entry) => [entry.entityId, entry])), categories: bundle.contentCategories.entities,
  categoryById: new Map(bundle.contentCategories.entities.map((category) => [category.id, category])), dependenciesFrom: new Map(), dependenciesTo: new Map(),
  aliases: new Map(bundle.aliases.entities.map((alias) => [alias.from, alias])), filterPolicy: bundle.contentFilterPolicy, readinessProfile: bundle.readinessProfile,
  validation: { status: 'passed', checkedAt: bundle.generatedAt, checks: { bundleChecksum: true, versionCoherence: true, counts: true, uniqueEntityIds: true, registryCoverage: true, categoryReferences: true, dependencyReferences: true, aliasReferences: true }, counts: { runtimeEntries: entries.length, registryEntries: bundle.entityRegistry.entries.length, dependencyEdges: bundle.dependencyGraph.edges.length, categories: bundle.contentCategories.entities.length, aliases: bundle.aliases.entities.length }, issues: [] }
};
const filterState = { bookStates: Object.fromEntries(bundle.manifest.sourceBooks.map((book) => [book, true])), categoryStates: {}, entityStates: { 'phb-2024-spell-acid-splash': 'disabled' } };
const catalogChoice = (entityId, kind, name, available = true) => ({
  choiceId: `catalog:${entityId}`, entityId, kind, name, sourceBookId: 'phb-2024', sourceLabel: 'PHB 2024', origin: 'catalog', catalogSnapshotId: snapshot.snapshotId,
  catalogEntityId: entityId, ownerIds: [], searchableText: name.toLowerCase(), available,
  blockedReasons: available ? [] : [{ code: 'entityDisabled', message: 'Entidade desativada.' }], manualReviewRequired: false, payload: {},
  provenance: { origin: 'catalog', sourceBookId: 'phb-2024', sourceId: 'phb-2024', catalogSnapshotId: snapshot.snapshotId, catalogVersion: bundle.catalogVersion, catalogEntityId: entityId, legacyItemIds: [], overrideAuthorized: false }
});
const localChoice = { choiceId: 'compendium:local-draft', entityId: 'local-draft', kind: 'feat', name: 'Local Draft Feat', sourceLabel: 'Homebrew', origin: 'compendium', compendiumItemId: 'local-draft', ownerIds: [], searchableText: 'local draft feat', available: false, blockedReasons: [{ code: 'localItemNotValidated', message: 'O item local está como draft.' }], manualReviewRequired: true, payload: {}, provenance: { origin: 'compendium', sourceId: 'homebrew', compendiumItemId: 'local-draft', legacyItemIds: ['local-draft'], overrideAuthorized: false } };
const choices = [
  catalogChoice('phb-2024-class-wizard', 'class', 'Wizard'),
  catalogChoice('phb-2024-spell-acid-splash', 'spell', 'Acid Splash', false),
  catalogChoice('phb-2024-spell-fire-bolt', 'spell', 'Fire Bolt'),
  catalogChoice('phb-2024-feat-origin-alert', 'feat', 'Alert'),
  localChoice
];
const link = (id, choiceId, appliedAs, appliedEntityId, name, extra = {}) => ({ id, characterId: 'app09-character', itemId: choiceId, importItemId: choiceId, packId: 'pack', sourceId: extra.sourceId ?? 'phb-2024', itemType: appliedAs, appliedAs, appliedEntityId, appliedEntityName: name, status: 'active', addedAt: '2026-08-04T00:00:00.000Z', choiceId, ...extra });
const character = {
  id: 'app09-character', name: 'Transactional Remediation Wizard', level: 1, catalogSnapshotId: 'catalog-4.7.0-old',
  classes: [{ id: 'wizard', name: 'Wizard', level: 1 }], subclasses: [],
  proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] }, abilities: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 10 },
  weapons: [], equipment: [], magicItems: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: [],
  spells: [{ id: 'acid', name: 'Acid Splash', level: 0, castingTime: 'action', requiresAttackRoll: false, targeting: { targets: 1 } }],
  feats: [{ id: 'removed-feat', name: 'Removed Feat', features: [] }, { id: 'local-feat', name: 'Local Draft Feat', features: [] }],
  compendiumLinks: [
    link('wizard-link', 'catalog:phb-2024-class-wizard', 'class', 'wizard', 'Wizard', { origin: 'catalog', catalogEntityId: 'phb-2024-class-wizard', catalogSnapshotId: 'catalog-4.7.0-old' }),
    link('acid-link', 'catalog:phb-2024-spell-acid-splash', 'spell', 'acid', 'Acid Splash', { origin: 'catalog', catalogEntityId: 'phb-2024-spell-acid-splash', catalogSnapshotId: 'catalog-4.7.0-old' }),
    link('missing-link', 'catalog:removed-app09-feat', 'feat', 'removed-feat', 'Removed Feat', { origin: 'catalog', catalogEntityId: 'removed-app09-feat', catalogSnapshotId: 'catalog-4.7.0-old' }),
    link('local-link', 'compendium:local-draft', 'feat', 'local-feat', 'Local Draft Feat', { origin: 'compendium', sourceId: 'homebrew' })
  ], progressionTransactions: []
};
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
const before = JSON.stringify(character);
const report = buildCharacterCompatibilityReport({ character, snapshot, filterState, choices, now: () => new Date('2026-08-04T04:00:00.000Z') });
assert(report.blockingIssueCount === 3, `Expected three blockers, got ${report.blockingIssueCount}.`);
const byCode = (code) => report.issues.find((issue) => issue.code === code);
let plan = createCompatibilityRemediationPlan({ character, report, now: () => new Date('2026-08-04T04:01:00.000Z') });
plan = upsertCompatibilityRemediationDecision(plan, { issueId: byCode('CHARACTER_SNAPSHOT_MISMATCH').id, kind: 'adoptSnapshot' }, '2026-08-04T04:02:00.000Z');
plan = upsertCompatibilityRemediationDecision(plan, { issueId: byCode('CHARACTER_CATALOG_ENTITY_DISABLED').id, referenceKey: byCode('CHARACTER_CATALOG_ENTITY_DISABLED').referenceKey, kind: 'replace', replacementChoiceId: 'catalog:phb-2024-spell-fire-bolt' }, '2026-08-04T04:03:00.000Z');
plan = upsertCompatibilityRemediationDecision(plan, { issueId: byCode('CHARACTER_CATALOG_ENTITY_MISSING').id, referenceKey: byCode('CHARACTER_CATALOG_ENTITY_MISSING').referenceKey, kind: 'replace', replacementChoiceId: 'catalog:phb-2024-feat-origin-alert' }, '2026-08-04T04:04:00.000Z');
plan = upsertCompatibilityRemediationDecision(plan, { issueId: byCode('CHARACTER_LOCAL_ITEM_DISABLED').id, referenceKey: byCode('CHARACTER_LOCAL_ITEM_DISABLED').referenceKey, kind: 'remove' }, '2026-08-04T04:05:00.000Z');
assert(plan.decisions.length === 4, 'Four explicit decisions should be recorded.');
const preview = previewCompatibilityRemediation({ character, report, plan, snapshot, filterState, choices, now: () => new Date('2026-08-04T04:06:00.000Z') });
assert(preview.ok, `Preview should be valid: ${preview.blockingIssues.map((issue) => issue.message).join(' | ')}`);
assert(preview.impact.replacements === 2, 'Two replacements should be previewed.');
assert(preview.impact.removals === 1, 'One removal should be previewed.');
assert(preview.impact.snapshotMigrations === 1, 'One snapshot migration should be previewed.');
assert(preview.afterReport.blockingIssueCount === 0, 'No blocking compatibility issues should remain.');
assert(preview.projectedCharacter.catalogSnapshotId === snapshot.snapshotId, 'Projected character should use the current snapshot.');
assert(!preview.projectedCharacter.spells.some((spell) => spell.id === 'acid'), 'Disabled spell entity should be removed from projection.');
assert(preview.projectedCharacter.spells.some((spell) => spell.name === 'Fire Bolt'), 'Replacement spell should be applied.');
assert(preview.projectedCharacter.feats.some((feat) => feat.name === 'Alert'), 'Replacement feat should be applied.');
assert(!preview.projectedCharacter.feats.some((feat) => feat.id === 'local-feat'), 'Explicitly removed local feat should be absent.');
assert(JSON.stringify(character) === before, 'Preview must not mutate the published character.');
const draft = createProgressionDraft({ character, workingCharacter: preview.projectedCharacter, kind: 'compatibilityRemediation', targetCatalogSnapshotId: plan.targetCatalogSnapshotId, migrationApproved: true, operations: preview.operations });
const committed = commitProgressionDraft(character, draft);
assert(committed.ok, 'Remediation should commit atomically.');
assert(committed.auditEntry.kind === 'compatibilityRemediation', 'Audit should identify compatibility remediation.');
assert(committed.character.progressionTransactions.length === 1, 'Commit should append one audit entry.');
assert(committed.character.spells.some((spell) => spell.name === 'Fire Bolt'), 'Committed character should contain replacement spell.');
const rollback = rollbackProgressionAudit(committed.character, committed.auditEntry);
const restored = progressionSnapshot(rollback.character);
const original = progressionSnapshot(character);
assert(restored.catalogSnapshotId === original.catalogSnapshotId, 'Rollback should restore the original snapshot.');
assert(restored.spells.some((spell) => spell.id === 'acid'), 'Rollback should restore the original spell.');
assert(restored.feats.some((feat) => feat.id === 'local-feat'), 'Rollback should restore explicitly removed local content.');
assert(rollback.auditEntry.rolledBackTransactionId === committed.auditEntry.transactionId, 'Rollback should reference the remediation transaction.');
const outputReport = { status: 'PASS', assertions, catalogVersion: bundle.catalogVersion, catalogEntries: entries.length, decisions: plan.decisions.length, impact: preview.impact, audit: { kind: committed.auditEntry.kind, historyEntriesAfterCommit: committed.character.progressionTransactions.length, rollbackRestoredSnapshot: restored.catalogSnapshotId } };
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reports/app-09-runtime-harness.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(outputReport, null, 2)}\n`);
console.log(JSON.stringify(outputReport, null, 2));
