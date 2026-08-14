#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  const candidates = [
    'typescript',
    '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js',
    '/usr/local/lib/node_modules/typescript/lib/typescript.js'
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado para transpilar o resolver do harness.');
};

const ts = loadTypeScript();
const resolverPath = path.join(root, 'src/catalog/characterDependencyResolver.ts');
const source = fs.readFileSync(resolverPath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  fileName: resolverPath
}).outputText;
const runtimeModule = new Module(path.join(os.tmpdir(), 'app04-characterDependencyResolver.js'), module);
runtimeModule.filename = path.join(os.tmpdir(), 'app04-characterDependencyResolver.js');
runtimeModule.paths = module.paths;
runtimeModule._compile(compiled, runtimeModule.filename);
const { resolveCharacterPendingChoice } = runtimeModule.exports;

const bundle = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'), 'utf8'));
const pack = JSON.parse(fs.readFileSync(path.join(root, 'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json'), 'utf8'));
const entryById = new Map(bundle.runtimeIndex.entries.map((entry) => [entry.entityId, entry]));
const dependenciesFrom = new Map();
const dependenciesTo = new Map();
for (const edge of bundle.dependencyGraph.edges) {
  dependenciesFrom.set(edge.fromId, [...(dependenciesFrom.get(edge.fromId) ?? []), edge]);
  dependenciesTo.set(edge.toId, [...(dependenciesTo.get(edge.toId) ?? []), edge]);
}
const snapshot = {
  snapshotId: `catalog-${bundle.catalogVersion}-app04-harness`,
  catalogVersion: bundle.catalogVersion,
  entryById,
  aliases: new Map(bundle.aliases.entities.map((alias) => [alias.from, alias])),
  dependenciesFrom,
  dependenciesTo
};
const intentionallyBlocked = 'phb-2024-spell-acid-splash';
const choices = pack.items
  .filter((item) => entryById.has(item.id))
  .map((item) => ({
    choiceId: `catalog:${item.id}`,
    entityId: item.id,
    kind: item.kind,
    name: item.name,
    sourceBookId: 'phb-2024',
    sourceLabel: 'Player’s Handbook (2024)',
    origin: 'catalog',
    catalogSnapshotId: snapshot.snapshotId,
    catalogEntityId: item.id,
    ownerIds: [],
    searchableText: item.name.toLowerCase(),
    available: item.id !== intentionallyBlocked,
    blockedReasons: item.id === intentionallyBlocked ? [{ code: 'entityDisabled', message: 'Bloqueio de teste.' }] : [],
    manualReviewRequired: false,
    payload: item.payload,
    provenance: {
      origin: 'catalog', sourceId: 'phb-2024', sourceBookId: 'phb-2024', catalogSnapshotId: snapshot.snapshotId,
      catalogVersion: bundle.catalogVersion, catalogEntityId: item.id, legacyItemIds: [], overrideAuthorized: false
    }
  }));

let assertions = 0;
const assert = (condition, message) => {
  assertions += 1;
  if (!condition) throw new Error(`Assertion ${assertions}: ${message}`);
};
const resolve = ({ sourceId, appliedAs, kind, sourceInstance = 'source-instance' }) => {
  const character = {
    compendiumLinks: [{
      status: 'active', appliedAs, appliedEntityId: sourceInstance,
      itemId: `catalog:${sourceId}`, choiceId: `catalog:${sourceId}`, catalogEntityId: sourceId
    }]
  };
  return resolveCharacterPendingChoice({
    character,
    pendingChoice: {
      id: `pending-${kind}`, kind, title: kind, description: kind,
      sourceEntityId: sourceInstance, status: 'pending', createdAt: '2026-08-03T00:00:00.000Z'
    },
    choices,
    snapshot
  });
};

const wizardSpells = resolve({ sourceId: 'phb-2024-class-wizard', appliedAs: 'class', kind: 'spellSelection' });
assert(wizardSpells.mode === 'dependency', 'Wizard spells should resolve through dependency graph.');
assert(wizardSpells.totalCandidateCount === 227, `Expected 227 Wizard spell candidates, got ${wizardSpells.totalCandidateCount}.`);
assert(wizardSpells.availableCandidateChoices.length === 226, 'One Wizard spell should be blocked by the simulated filter.');
assert(wizardSpells.blockedCandidateChoices.length === 1, 'Blocked Wizard spell should be preserved.');
assert(wizardSpells.blockedCandidateChoices[0]?.catalogEntityId === intentionallyBlocked, 'The expected spell should be blocked.');
assert(wizardSpells.relationTypes.includes('availableToClass'), 'Wizard resolution should use availableToClass.');

const wizardSubclass = resolve({ sourceId: 'phb-2024-class-wizard', appliedAs: 'class', kind: 'subclass' });
assert(wizardSubclass.mode === 'dependency', 'Wizard subclasses should resolve through dependency graph.');
assert(wizardSubclass.totalCandidateCount === 4, `Expected four Wizard subclasses, got ${wizardSubclass.totalCandidateCount}.`);
assert(wizardSubclass.candidateChoices.every((choice) => choice.kind === 'subclass'), 'Subclass resolution should not leak other kinds.');
assert(wizardSubclass.relationTypes.join(',') === 'belongsToClass', 'Subclass relation should be canonical and precise.');

const weaponMaster = resolve({ sourceId: 'phb-2024-feat-general-weapon-master', appliedAs: 'feat', kind: 'featOptions' });
assert(weaponMaster.mode === 'dependency', 'Weapon Master options should resolve through a choice contract.');
assert(weaponMaster.totalCandidateCount === 38, `Expected 38 weapon candidates, got ${weaponMaster.totalCandidateCount}.`);
assert(weaponMaster.candidateChoices.every((choice) => choice.kind === 'weapon'), 'Weapon Master should expose only weapons.');
assert(weaponMaster.relationTypes.includes('offersChoice'), 'Weapon Master should traverse offersChoice.');
assert(weaponMaster.relationTypes.includes('references'), 'Weapon Master should traverse references.');

const legacy = resolveCharacterPendingChoice({
  character: { compendiumLinks: [] },
  pendingChoice: {
    id: 'legacy', kind: 'spellSelection', title: 'Legacy', description: 'Legacy', status: 'pending', createdAt: '2026-08-03T00:00:00.000Z'
  },
  choices: choices.filter((choice) => choice.kind === 'spell').slice(0, 5),
  snapshot
});
assert(legacy.mode === 'kindFallback', 'Legacy choice should fail soft to kind fallback.');
assert(legacy.issues.some((issue) => issue.code === 'CATALOG_PENDING_CHOICE_SOURCE_UNRESOLVED'), 'Legacy fallback should be explicit.');
assert(legacy.availableCandidateChoices.length > 0, 'Legacy fallback should remain usable.');

const report = {
  status: 'PASS',
  assertions,
  catalogVersion: bundle.catalogVersion,
  catalogEntries: bundle.runtimeIndex.entryCount,
  dependencyEdges: bundle.dependencyGraph.edgeCount,
  directMechanicalChoices: choices.length,
  scenarios: {
    wizardSpellSelection: {
      mode: wizardSpells.mode,
      total: wizardSpells.totalCandidateCount,
      available: wizardSpells.availableCandidateChoices.length,
      blocked: wizardSpells.blockedCandidateChoices.length,
      relations: wizardSpells.relationTypes
    },
    wizardSubclass: {
      mode: wizardSubclass.mode,
      total: wizardSubclass.totalCandidateCount,
      relations: wizardSubclass.relationTypes
    },
    weaponMasterOptions: {
      mode: weaponMaster.mode,
      total: weaponMaster.totalCandidateCount,
      relations: weaponMaster.relationTypes
    },
    legacyFallback: {
      mode: legacy.mode,
      available: legacy.availableCandidateChoices.length,
      issues: legacy.issues.map((issue) => issue.code)
    }
  }
};
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reports/app-04-runtime-harness.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
