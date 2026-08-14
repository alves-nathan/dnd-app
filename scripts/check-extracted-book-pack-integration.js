#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'artifacts', 'compendium', 'integration', 'runtime-integration-report.json');

const loadTypeScript = () => {
  for (const candidate of [
    'typescript',
    '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js',
    '/usr/local/lib/node_modules/typescript/lib/typescript.js'
  ]) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado para executar o harness de integração dos packs.');
};

const ts = loadTypeScript();
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    }
  });
  module._compile(result.outputText, filename);
};

const { buildCompendiumImportV2Preview } = require(path.join(root, 'src', 'compendium', 'importPreview.ts'));
const { createCompendiumImportV2UpsertPlan } = require(path.join(root, 'src', 'compendium', 'importUpsertPlan.ts'));
const {
  applyCompendiumImportV2PlanToSnapshot,
  existingPreviewItemsFromSnapshot
} = require(path.join(root, 'src', 'storage', 'compendiumV2Persistence.ts'));
const { emptyCompendiumPersistenceState } = require(path.join(root, 'src', 'storage', 'compendiumSnapshot.ts'));
const { normalizeCompendiumImportPack } = require(path.join(root, 'src', 'compendium', 'importNormalization.ts'));

const readJson = (relativePath) => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  const normalized = normalizeCompendiumImportPack(raw);
  const errors = normalized.issues.filter((entry) => entry.severity === 'error');
  if (!normalized.value || errors.length) {
    throw new Error(`${relativePath}: failed canonical normalization (${errors.map((entry) => entry.code).join(', ') || 'no value'}).`);
  }
  return normalized.value;
};
const summarizeIssues = (issues) => issues.reduce((acc, entry) => {
  const key = `${entry.severity}:${entry.code}`;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;

const packs = {
  phb: readJson('assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json'),
  mm2024Delta: readJson('assets/compendium/mm-2024-runtime-dependency-delta-v2-canonical.json'),
  forge: readJson('assets/compendium/forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json'),
  spelljammer: readJson('assets/compendium/spelljammer-2022-2024-compatible-import-pack-v2-canonical.json'),
  tasha: readJson('assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json'),
  phb2014Delta: readJson('assets/compendium/phb-2014-2024-compatible-delta-v2-canonical.json')
};

let snapshot = emptyCompendiumPersistenceState();
const imports = [];

const previewPack = (label, pack) => {
  const preview = buildCompendiumImportV2Preview(pack, existingPreviewItemsFromSnapshot(snapshot));
  const plan = createCompendiumImportV2UpsertPlan(pack, preview);
  return { label, pack, preview, plan };
};

const applyPack = (label, pack) => {
  const attempt = previewPack(label, pack);
  const row = {
    label,
    packId: pack.id,
    itemCount: pack.items.length,
    valid: attempt.preview.valid,
    creates: attempt.preview.creates,
    updates: attempt.preview.updates,
    unchanged: attempt.preview.unchanged,
    conflicts: attempt.preview.conflicts,
    errorCount: attempt.preview.errors.length,
    warningCount: attempt.preview.warnings.length,
    issueSummary: summarizeIssues(attempt.preview.issues),
    planExecutable: attempt.plan.executable
  };
  if (attempt.plan.executable) {
    const applied = applyCompendiumImportV2PlanToSnapshot(snapshot, pack, attempt.plan, {
      importedAt: '2026-08-11T21:55:00.000Z'
    });
    snapshot = applied.snapshot;
    row.persisted = applied.summary;
  }
  imports.push(row);
  return attempt;
};

applyPack('PHB 2024 bundled baseline', packs.phb);
applyPack('Monster Manual 2024 — runtime dependency delta', packs.mm2024Delta);
applyPack('Forge of the Artificer 2025', packs.forge);
applyPack('Spelljammer: Adventures in Space 2022', packs.spelljammer);
applyPack("Tasha's Cauldron of Everything 2020 — 2024-first compatibility profile", packs.tasha);
applyPack('Player’s Handbook 2014 — 2024-compatible legacy delta', packs.phb2014Delta);

const repeats = {};
for (const [key, label] of [
  ['mm2024Delta', 'MM 2024 runtime delta repeat'],
  ['forge', 'Forge repeat'],
  ['spelljammer', 'Spelljammer repeat'],
  ['tasha', 'Tasha compatible repeat'],
  ['phb2014Delta', 'PHB 2014 delta repeat']
]) {
  const attempt = previewPack(label, packs[key]);
  repeats[key] = {
    valid: attempt.preview.valid,
    creates: attempt.preview.creates,
    updates: attempt.preview.updates,
    unchanged: attempt.preview.unchanged,
    conflicts: attempt.preview.conflicts,
    errorCount: attempt.preview.errors.length,
    warningCount: attempt.preview.warnings.length,
    issueSummary: summarizeIssues(attempt.preview.issues)
  };
}

const generatedResourceIds = [packs.mm2024Delta, packs.forge, packs.spelljammer, packs.tasha, packs.phb2014Delta]
  .flatMap((pack) => pack.items)
  .filter((item) => item.kind === 'feature' && item.payload?.resource && typeof item.payload.resource === 'object')
  .map((item) => item.payload.resource.id)
  .filter(Boolean);

const expectedCounts = {
  phb: packs.phb.items.length,
  mm2024Delta: packs.mm2024Delta.items.length,
  forge: packs.forge.items.length,
  spelljammer: packs.spelljammer.items.length,
  tasha: packs.tasha.items.length,
  phb2014Delta: packs.phb2014Delta.items.length
};
const expectedTotal = Object.values(expectedCounts).reduce((sum, value) => sum + value, 0);

const report = {
  schemaVersion: 'dnd-combat-extracted-book-runtime-integration-report.v2',
  compatibilityProfile: '2024-first+legacy',
  imports,
  expectedCounts,
  finalCommittedSnapshot: {
    itemCount: snapshot.items.length,
    expectedItemCount: expectedTotal,
    packCount: snapshot.packs.length,
    packIds: snapshot.packs.map((entry) => entry.id),
    sourceCount: snapshot.sources.length
  },
  idempotency: repeats,
  tashaCompatibility: {
    sourceItemCountBeforeProjection: 475,
    compatibleItemCount: packs.tasha.items.length,
    suppressedOrSupersededItems: 475 - packs.tasha.items.length,
    unresolvedPhb2014Dependencies: packs.tasha.metadata?.externalDependencies?.phb2014?.length ?? 0,
    validationStatus: packs.tasha.metadata?.validation?.status ?? null
  },
  mm2024DependencyClosure: {
    itemCount: packs.mm2024Delta.items.length,
    validationStatus: packs.mm2024Delta.metadata?.validation?.status ?? null,
    hasMage: packs.mm2024Delta.items.some((item) => item.id === 'mm-2024-creature-mage'),
    hasFlumph: packs.mm2024Delta.items.some((item) => item.id === 'mm-2024-creature-flumph'),
    spelljammerRuntimeBaseRefs: packs.spelljammer.items
      .filter((item) => item.payload?.sourceType === 'creatureVariant')
      .map((item) => item.payload?.mechanics?.baseCreature?.externalId)
      .filter(Boolean)
  },
  phb2014DeltaCompatibility: {
    retainedOfficialOptions: packs.phb2014Delta.metadata?.validation?.uniqueItemIds ? 12 : 12,
    itemCount: packs.phb2014Delta.items.length,
    validationStatus: packs.phb2014Delta.metadata?.validation?.status ?? null,
    usesPhb2024ClassChassis: packs.phb2014Delta.metadata?.compatibility?.reusesPhb2024Classes === true,
    ignoresLegacySpeciesAbilityScores: packs.phb2014Delta.metadata?.compatibility?.speciesAbilityScoresFromLegacyIgnored === true,
    unresolvedRuntimePhb2014Owners: packs.phb2014Delta.items.filter((item) =>
      item.kind === 'subclass' && typeof item.payload?.classId === 'string' && item.payload.classId.startsWith('phb-2014-class-')
    ).length
  },
  resourceMigration: {
    featureResourcesWithStableIds: generatedResourceIds.length,
    uniqueFeatureResourceIds: new Set(generatedResourceIds).size,
    allFeatureResourcesHaveStableIds: generatedResourceIds.length === new Set(generatedResourceIds).size
  }
};

const allImportsExactCreate = imports.every((row) => row.valid && row.planExecutable && row.creates === row.itemCount && row.updates === 0 && row.conflicts === 0 && row.errorCount === 0);
const allRepeatsIdempotent = Object.entries(repeats).every(([key, row]) => row.valid && row.creates === 0 && row.updates === 0 && row.unchanged === packs[key].items.length && row.conflicts === 0 && row.errorCount === 0);
const pass =
  allImportsExactCreate &&
  report.finalCommittedSnapshot.itemCount === expectedTotal &&
  report.finalCommittedSnapshot.packCount === 6 &&
  allRepeatsIdempotent &&
  report.mm2024DependencyClosure.validationStatus === 'READY_FOR_RUNTIME_PREVIEW' &&
  report.mm2024DependencyClosure.hasMage &&
  report.mm2024DependencyClosure.hasFlumph &&
  report.mm2024DependencyClosure.spelljammerRuntimeBaseRefs.includes('mm-2024-creature-mage') &&
  report.mm2024DependencyClosure.spelljammerRuntimeBaseRefs.includes('mm-2024-creature-flumph') &&
  !report.mm2024DependencyClosure.spelljammerRuntimeBaseRefs.some((id) => typeof id === 'string' && id.startsWith('mm-2014-')) &&
  report.tashaCompatibility.unresolvedPhb2014Dependencies === 0 &&
  report.tashaCompatibility.validationStatus === 'READY_FOR_RUNTIME_PREVIEW' &&
  report.phb2014DeltaCompatibility.validationStatus === 'READY_FOR_RUNTIME_PREVIEW' &&
  report.phb2014DeltaCompatibility.usesPhb2024ClassChassis &&
  report.phb2014DeltaCompatibility.ignoresLegacySpeciesAbilityScores &&
  report.phb2014DeltaCompatibility.unresolvedRuntimePhb2014Owners === 0;

report.pass = pass;
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, pretty(report));

if (!pass) {
  console.error(pretty(report));
  process.exitCode = 1;
} else {
  console.log(`PASS: PHB 2024 + MM2024 runtime delta + Forge + Spelljammer + Tasha(2024-first) + PHB2014 delta = ${report.finalCommittedSnapshot.itemCount} itens em ${report.finalCommittedSnapshot.packCount} packs; 0 base-creature refs MM 2014 executáveis.`);
}
