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
  throw new Error('TypeScript não encontrado para o harness APP-11.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app11-harness-'));
const transpileTree = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) { transpileTree(absolute); continue; }
    if (!entry.name.endsWith('.ts') || absolute.includes(`${path.sep}tests${path.sep}`)) continue;
    const relative = path.relative(root, absolute);
    const output = path.join(tempRoot, relative.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
      fileName: absolute
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
const {
  buildCatalogChangeCharacterImpact,
  createPreventiveCompatibilityPlans
} = loadRuntime('src/characters/catalogChangeImpact.ts');
const { createCompatibilityRemediationPlan } = loadRuntime('src/characters/compatibilityRemediation.ts');

const bundle = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'), 'utf8'));
const entries = bundle.runtimeIndex.entries;
const dependenciesFrom = new Map();
const dependenciesTo = new Map();
for (const edge of bundle.dependencyGraph.edges) {
  dependenciesFrom.set(edge.fromId, [...(dependenciesFrom.get(edge.fromId) ?? []), edge]);
  dependenciesTo.set(edge.toId, [...(dependenciesTo.get(edge.toId) ?? []), edge]);
}
const snapshot = {
  snapshotId: `catalog-${bundle.catalogVersion}-app11-harness`,
  catalogVersion: bundle.catalogVersion,
  loadedAt: bundle.generatedAt,
  manifest: bundle.manifest,
  entries,
  registry: new Map(bundle.entityRegistry.entries.map((entry) => [entry.entityId, entry])),
  entryById: new Map(entries.map((entry) => [entry.entityId, entry])),
  categories: bundle.contentCategories.entities,
  categoryById: new Map(bundle.contentCategories.entities.map((category) => [category.id, category])),
  dependenciesFrom,
  dependenciesTo,
  aliases: new Map(bundle.aliases.entities.map((alias) => [alias.from, alias])),
  filterPolicy: bundle.contentFilterPolicy,
  readinessProfile: bundle.readinessProfile,
  validation: {
    status: 'passed', checkedAt: bundle.generatedAt,
    checks: { bundleChecksum: true, versionCoherence: true, counts: true, uniqueEntityIds: true, registryCoverage: true, categoryReferences: true, dependencyReferences: true, aliasReferences: true },
    counts: { runtimeEntries: entries.length, registryEntries: bundle.entityRegistry.entries.length, dependencyEdges: bundle.dependencyGraph.edges.length, categories: bundle.contentCategories.entities.length, aliases: bundle.aliases.entities.length },
    issues: []
  }
};
const policy = new ContentPolicyService(snapshot);
const beforeFilterState = policy.createDefaultState();
const afterFilterState = JSON.parse(JSON.stringify(beforeFilterState));
afterFilterState.entityStates['phb-2024-spell-acid-splash'] = 'disabled';
const filterImpact = policy.previewImpact(beforeFilterState, afterFilterState);
const catalogChoice = (entityId, kind, name) => ({
  choiceId: `catalog:${entityId}`, entityId, kind, name, sourceBookId: snapshot.entryById.get(entityId)?.sourceBookId ?? undefined,
  sourceLabel: 'PHB 2024', origin: 'catalog', catalogSnapshotId: snapshot.snapshotId, catalogEntityId: entityId,
  ownerIds: [], searchableText: name.toLowerCase(), available: true, blockedReasons: [], manualReviewRequired: false, payload: {},
  provenance: { origin: 'catalog', sourceBookId: 'phb-2024', sourceId: 'phb-2024', catalogSnapshotId: snapshot.snapshotId, catalogVersion: bundle.catalogVersion, catalogEntityId: entityId, legacyItemIds: [], overrideAuthorized: false }
});
const choices = [
  catalogChoice('phb-2024-class-wizard', 'class', 'Wizard'),
  catalogChoice('phb-2024-spell-acid-splash', 'spell', 'Acid Splash')
];
const emptyCharacter = (id, name, withSpell) => ({
  id, name, level: 1, catalogSnapshotId: snapshot.snapshotId,
  classes: [], subclasses: [],
  proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
  abilities: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 10 },
  weapons: [], equipment: [], magicItems: [], feats: [], spells: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: [],
  compendiumLinks: withSpell ? [{
    id: `${id}-acid-link`, characterId: id, itemId: 'catalog:phb-2024-spell-acid-splash', importItemId: 'catalog:phb-2024-spell-acid-splash',
    packId: 'pack', sourceId: 'phb-2024', itemType: 'spell', appliedAs: 'spell', appliedEntityId: `${id}-acid`, appliedEntityName: 'Acid Splash',
    status: 'active', addedAt: '2026-08-04T08:00:00.000Z', choiceId: 'catalog:phb-2024-spell-acid-splash', origin: 'catalog',
    catalogEntityId: 'phb-2024-spell-acid-splash', catalogSnapshotId: snapshot.snapshotId
  }] : []
});
const characters = [
  emptyCharacter('app11-character-a', 'Preventive Wizard A', true),
  emptyCharacter('app11-character-b', 'Preventive Wizard B', true),
  emptyCharacter('app11-character-c', 'Unaffected Fighter', false)
];
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
const beforeCharacters = JSON.stringify(characters);
const preview = buildCatalogChangeCharacterImpact({
  label: 'Desativar Acid Splash', characters, snapshot, beforeFilterState, afterFilterState, choices, impact: filterImpact,
  now: () => new Date('2026-08-04T11:00:00.000Z')
});
assert(preview.schemaVersion === 'dnd-catalog-character-impact.v1', 'Impact preview should be versioned.');
assert(preview.counts.charactersScanned === 3, 'All characters should be scanned.');
assert(preview.counts.affectedCharacters === 2, 'Two characters should be affected.');
assert(preview.counts.newlyBlockedCharacters === 2, 'Both affected characters should gain blockers.');
assert(preview.counts.affectedReferences === 2, 'Each affected character should expose one reference.');
assert(preview.counts.affectedEntities === 1, 'One shared entity should be counted once.');
assert(preview.counts.affectedBooks === 1, 'One source book should be affected.');
assert(preview.counts.newBlockingIssues === 2, 'Two new blocking issues should be reported.');
assert(preview.requiresAcknowledgement, 'Character impact should require acknowledgement.');
assert(preview.affectedCharacters.every((entry) => entry.blockingIssuesBefore === 0 && entry.blockingIssuesAfter === 1), 'Before/after blocker counts should be precise.');
assert(preview.affectedCharacters.every((entry) => entry.newIssues.some((issue) => issue.code === 'CHARACTER_CATALOG_ENTITY_DISABLED')), 'New disabled-entity issues should be attributed to the change.');
const entityGroup = preview.groups.find((group) => group.kind === 'entity' && group.key === 'phb-2024-spell-acid-splash');
assert(entityGroup?.characterIds.length === 2, 'Shared entity group should contain both affected characters.');
const bookGroup = preview.groups.find((group) => group.kind === 'book' && group.key === 'phb-2024');
assert(bookGroup?.characterIds.length === 2, 'Book group should contain both affected characters.');
assert(JSON.stringify(characters) === beforeCharacters, 'Preventive preview must not mutate characters.');

const existingReport = preview.affectedCharacters.find((entry) => entry.characterId === 'app11-character-b').reportAfter;
const existingPlan = createCompatibilityRemediationPlan({ character: characters[1], report: existingReport, now: () => new Date('2026-08-04T11:01:00.000Z') });
const preventive = createPreventiveCompatibilityPlans({
  preview,
  characters,
  existingPlans: { 'app11-character-b': existingPlan },
  now: () => new Date('2026-08-04T11:02:00.000Z')
});
assert(preventive.plans.length === 1, 'Only a character without an active plan should receive a preventive plan.');
assert(preventive.skippedCharacterIds.length === 1 && preventive.skippedCharacterIds[0] === 'app11-character-b', 'Existing plans must be preserved and reported as skipped.');
assert(preventive.plans[0].characterId === 'app11-character-a', 'Preventive plan should target the correct character.');
assert(preventive.plans[0].origin === 'preventiveCatalogChange', 'Preventive plan origin should be explicit.');
assert(preventive.plans[0].preventiveContext?.disabledEntityIds.includes('phb-2024-spell-acid-splash'), 'Preventive context should preserve disabled entities.');
assert(preventive.plans[0].decisions.length === 0, 'Preventive plans must not make automatic decisions.');

const reverseImpact = policy.previewImpact(afterFilterState, beforeFilterState);
const reversePreview = buildCatalogChangeCharacterImpact({
  label: 'Reativar Acid Splash', characters, snapshot, beforeFilterState: afterFilterState, afterFilterState: beforeFilterState, choices, impact: reverseImpact
});
assert(reversePreview.counts.affectedCharacters === 0, 'Re-enabling content should not create preventive remediation plans.');
assert(!reversePreview.requiresAcknowledgement, 'A non-breaking activation should not require character acknowledgement.');
assert(JSON.stringify(characters) === beforeCharacters, 'Plan generation must not mutate characters.');

const outputReport = {
  status: 'PASS', assertions, catalogVersion: bundle.catalogVersion, catalogEntries: entries.length,
  impact: preview.counts,
  groups: preview.groups.slice(0, 5).map((group) => ({ kind: group.kind, key: group.key, characters: group.characterIds.length })),
  plans: { created: preventive.plans.length, skipped: preventive.skippedCharacterIds.length, automaticDecisions: preventive.plans.reduce((sum, plan) => sum + plan.decisions.length, 0) },
  reverseActivationAffectedCharacters: reversePreview.counts.affectedCharacters
};
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reports/app-11-runtime-harness.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(outputReport, null, 2)}\n`);
console.log(JSON.stringify(outputReport, null, 2));
