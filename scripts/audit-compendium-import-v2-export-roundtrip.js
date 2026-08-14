#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'assets', 'compendium', 'phb-2024-full-consolidated-import-pack-v5-complete-invocations.json');
const output = path.join(root, 'artifacts', 'compendium-import-v2-phase06-export-roundtrip-report.json');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-import-v2-export-audit-'));
const tempSrc = path.join(tempRoot, 'src');
const tempCompendium = path.join(tempSrc, 'compendium');
const tempStorage = path.join(tempSrc, 'storage');
const tempTypes = path.join(tempSrc, 'types');
fs.mkdirSync(tempCompendium, { recursive: true });
fs.mkdirSync(tempStorage, { recursive: true });
fs.mkdirSync(tempTypes, { recursive: true });
const transpile = (input, outputPath) => {
  const result = ts.transpileModule(fs.readFileSync(input, 'utf8'), { fileName: input, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  fs.writeFileSync(outputPath, result.outputText);
};
transpile(path.join(root, 'src', 'types', 'index.ts'), path.join(tempTypes, 'index.js'));
for (const fileName of [
  'importVersions.ts', 'importDomain.ts', 'importContentHash.ts', 'importNormalization.ts', 'importV1Migration.ts',
  'importSemanticValidation.ts', 'importPreview.ts', 'importUpsertPlan.ts', 'importV2Export.ts', 'packageExport.ts'
]) {
  transpile(path.join(root, 'src', 'compendium', fileName), path.join(tempCompendium, fileName.replace(/\.ts$/, '.js')));
}
transpile(path.join(root, 'src', 'storage', 'compendiumV2Persistence.ts'), path.join(tempStorage, 'compendiumV2Persistence.js'));

fs.writeFileSync(path.join(tempCompendium, 'parseImportPack.js'), `
const { normalizeCompendiumImportPack } = require('./importNormalization.js');
exports.parseImportPack = (input) => {
  let value = input;
  if (typeof input === 'string') {
    try { value = JSON.parse(input); }
    catch { return { ok: false, detectedVersion: 'unknown', issues: [{ severity: 'error', code: 'IMPORT_JSON_ERROR', message: 'JSON inválido.' }], normalizationIssues: [] }; }
  }
  const normalized = normalizeCompendiumImportPack(value);
  const issues = normalized.issues.map((entry) => ({ severity: entry.severity, code: entry.code, message: entry.path ? entry.path + ': ' + entry.message : entry.message }));
  return { ok: Boolean(normalized.value) && issues.every((entry) => entry.severity !== 'error'), detectedVersion: 'dnd-combat-import.v2', data: normalized.value, issues, normalizationIssues: normalized.issues };
};
`);

const { migrateImportV1ToV2 } = require(path.join(tempCompendium, 'importV1Migration.js'));
const { buildCompendiumImportV2Preview } = require(path.join(tempCompendium, 'importPreview.js'));
const { createCompendiumImportV2UpsertPlan } = require(path.join(tempCompendium, 'importUpsertPlan.js'));
const { createCompendiumImportItemContentHash } = require(path.join(tempCompendium, 'importContentHash.js'));
const { buildCompendiumPackageExport } = require(path.join(tempCompendium, 'packageExport.js'));
const { applyCompendiumImportV2PlanToSnapshot } = require(path.join(tempStorage, 'compendiumV2Persistence.js'));

const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const migrated = migrateImportV1ToV2(raw, { originalEnvelope: raw, detectedLegacyVersion: 'dnd-combat-import.v1' });
if (!migrated.value) throw new Error('PHB migration returned no canonical V2 pack.');

const emptySnapshot = { sources: [], packs: [], items: [], enabledSourceIds: [] };
const preview = buildCompendiumImportV2Preview(migrated.value, []);
const plan = createCompendiumImportV2UpsertPlan(migrated.value, preview);
const persisted = applyCompendiumImportV2PlanToSnapshot(emptySnapshot, migrated.value, plan, { importedAt: '2026-08-11T02:00:00.000Z' });
const exported = buildCompendiumPackageExport(persisted.snapshot, {
  exportId: 'phb-2024-roundtrip',
  exportName: 'PHB 2024 Round Trip',
  includeDisabledItems: true,
  includeReviewMetadata: true,
  includeOriginalSourceMetadata: true,
  onlyEnabledSources: false,
  exportedAt: '2026-08-11T02:30:00.000Z'
});

const expectedByKind = {};
for (const item of migrated.value.items) expectedByKind[item.kind] = (expectedByKind[item.kind] || 0) + 1;
const exportedByKind = {};
for (const item of exported.data?.items || []) exportedByKind[item.kind] = (exportedByKind[item.kind] || 0) + 1;

const originalHashes = new Map(migrated.value.items.map((item) => [item.id, createCompendiumImportItemContentHash(item)]));
const exportedHashes = new Map((exported.data?.items || []).map((item) => [item.id, createCompendiumImportItemContentHash(item)]));
let sameItemHashes = 0;
const mismatchedItemIds = [];
for (const [id, hash] of originalHashes) {
  if (exportedHashes.get(id) === hash) sameItemHashes += 1;
  else mismatchedItemIds.push(id);
}

const originalSources = new Map(migrated.value.items.map((item) => [item.id, item.source.id]));
const sourceMismatches = (exported.data?.items || []).filter((item) => originalSources.get(item.id) !== item.source.id).map((item) => item.id);
const payloadMetadataLeaks = (exported.data?.items || []).filter((item) => item.payload && Object.prototype.hasOwnProperty.call(item.payload, 'exportMetadata')).map((item) => item.id);
const storageOrigins = exported.data?.metadata?.storageOrigins || {};
const reviewMetadata = exported.data?.metadata?.review || {};
const errorIssues = exported.issues.filter((entry) => entry.severity === 'error');
const warningIssues = exported.issues.filter((entry) => entry.severity === 'warning');
const infoIssues = exported.issues.filter((entry) => entry.severity === 'info');

const report = {
  schemaVersion: 'dnd-combat-import-v2-phase06-export-roundtrip-audit.v1',
  sourcePack: raw.id,
  templateVersion: exported.data?.templateVersion,
  itemCount: migrated.value.items.length,
  exportedItemCount: exported.summary.exportedItemCount,
  kindCount: Object.keys(expectedByKind).length,
  expectedByKind,
  exportedByKind,
  roundTrip: exported.roundTrip ? {
    valid: exported.roundTrip.valid,
    reparsedItemCount: exported.roundTrip.reparsedItemCount,
    matchingItemHashes: exported.roundTrip.matchingItemHashes,
    mismatchedItemIds: exported.roundTrip.mismatchedItemIds,
    missingItemIds: exported.roundTrip.missingItemIds,
    unexpectedItemIds: exported.roundTrip.unexpectedItemIds
  } : null,
  persistedToExportSemanticEquivalence: {
    matchingItemHashes: sameItemHashes,
    mismatchedItemIds,
    sourceMismatches,
    payloadMetadataLeaks
  },
  metadata: {
    storageOriginEntries: Object.keys(storageOrigins).length,
    reviewEntries: Object.keys(reviewMetadata).length
  },
  issues: {
    errors: errorIssues.length,
    warnings: warningIssues.length,
    infos: infoIssues.length,
    byCode: exported.issues.reduce((acc, entry) => { acc[entry.code] = (acc[entry.code] || 0) + 1; return acc; }, {})
  },
  jsonBytes: exported.json ? Buffer.byteLength(exported.json, 'utf8') : 0
};

const pass =
  exported.ok &&
  report.templateVersion === 'dnd-combat-import.v2' &&
  report.itemCount === 1284 &&
  report.exportedItemCount === 1284 &&
  report.kindCount === 13 &&
  Object.keys(report.expectedByKind).every((kind) => report.expectedByKind[kind] === report.exportedByKind[kind]) &&
  report.roundTrip?.valid === true &&
  report.roundTrip.matchingItemHashes === 1284 &&
  sameItemHashes === 1284 &&
  mismatchedItemIds.length === 0 &&
  sourceMismatches.length === 0 &&
  payloadMetadataLeaks.length === 0 &&
  report.metadata.storageOriginEntries === 1284 &&
  report.metadata.reviewEntries === 1284 &&
  errorIssues.length === 0;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log(`[compendium:import-v2:export-audit] ${pass ? 'PASS' : 'FAIL'}`);
console.log(`items=${report.itemCount} exported=${report.exportedItemCount} kinds=${report.kindCount}`);
console.log(`roundTrip=${report.roundTrip?.matchingItemHashes}/${report.itemCount} storageToExport=${sameItemHashes}/${report.itemCount}`);
console.log(`errors=${report.issues.errors} warnings=${report.issues.warnings} infos=${report.issues.infos}`);
console.log(`report=${path.relative(root, output)}`);
if (!pass) process.exit(1);
