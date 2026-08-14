#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative));
const exists = (relative) => fs.existsSync(path.join(root, relative));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const legacyPath = 'assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json';
const canonicalPath = 'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json';
const v1 = json(legacyPath);
const v2 = json(canonicalPath);

assert(v2.templateVersion === 'dnd-combat-import.v2', 'Bundled candidate is not Import V2.');
assert(v1.id === v2.id, 'V1 and V2 logical pack ids diverge.');
assert(v1.items.length === 1284 && v2.items.length === 1284, 'PHB item count must remain 1,284.');

const v1ById = new Map(v1.items.map((item) => [item.id, item]));
const v2ById = new Map(v2.items.map((item) => [item.id, item]));
const missing = [];
const unexpected = [];
const kindMismatches = [];
const sourceMismatches = [];
const storageIdMismatches = [];
for (const [id, item] of v1ById) {
  const next = v2ById.get(id);
  if (!next) { missing.push(id); continue; }
  if (item.kind !== next.kind) kindMismatches.push(id);
  if (item.source?.id !== next.source?.id) sourceMismatches.push(id);
  const legacyStorageId = `${v1.id}:${id}`;
  const canonicalStorageId = `${v2.id}:${id}`;
  if (legacyStorageId !== canonicalStorageId) storageIdMismatches.push(id);
}
for (const id of v2ById.keys()) if (!v1ById.has(id)) unexpected.push(id);

const bundled = read('src/compendium/bundledCompendium.ts');
const bootstrap = read('src/storage/bundledCompendiumBootstrap.ts');
const active = read('src/storage/activeCompendiumRepository.ts');
const store = read('src/store/compendiumStore.ts');
const fileImport = read('src/compendium/fileImport.ts');
const compendiumScreen = read('app/compendium/index.tsx');
const shape = read('scripts/check-project-shape.js');
const bundledCheck = read('scripts/check-bundled-compendium.js');
const functional = exists('artifacts/compendium-import-v2-phase09-functional-parity-report.json')
  ? json('artifacts/compendium-import-v2-phase09-functional-parity-report.json')
  : undefined;

const contracts = {
  bundledUsesCanonicalV2: bundled.includes('phb-2024-full-consolidated-import-pack-v2-canonical.json') && bundled.includes("importFormat: 'v2'"),
  bundledDoesNotLoadLegacyV1: !bundled.includes("require('../../assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json')"),
  bootstrapRoutesV2: bootstrap.includes('repository.saveImportV2Json(json)'),
  bootstrapReconcilesExisting: bootstrap.includes('reconcileBundledCompendium') && bootstrap.includes('preview.updates > 0') && bootstrap.includes('preview.creates > 0'),
  reconciliationPreservesLocalContent: bootstrap.includes('Nenhum dado local') || bootstrap.includes('conteúdo local'),
  activeHydrationReconciles: active.includes('reconcileBundledCompendium(repository)') && active.match(/reconcileBundledCompendium\(repository\)/g)?.length >= 2,
  userImportRoutesV2: store.includes('detectCompendiumImportVersion') && store.includes('repository.saveImportV2Json(json)'),
  userImportKeepsV1: store.includes('repository.saveImportJson(json)'),
  filePreviewIsVersionAware: fileImport.includes('parseImportPack') && !fileImport.includes('validateCompendiumJson'),
  manualPreviewIsVersionAware: compendiumScreen.includes('parseAndPreviewImportPack(json, items)'),
  projectShapeRequiresV2: shape.includes('phb-2024-full-consolidated-import-pack-v2-canonical.json'),
  bundledCheckRequiresV2: bundledCheck.includes("templateVersion: 'dnd-combat-import.v2'"),
  legacyAssetPreserved: exists(legacyPath),
  v2AssetPresent: exists(canonicalPath),
  functionalParityPassed: functional?.functionalParity === true && functional?.failed === 0
};

for (const [name, ok] of Object.entries(contracts)) assert(ok, `Cutover contract failed: ${name}`);
assert(missing.length === 0, `Missing V2 ids: ${missing.slice(0, 5).join(', ')}`);
assert(unexpected.length === 0, `Unexpected V2 ids: ${unexpected.slice(0, 5).join(', ')}`);
assert(kindMismatches.length === 0, `Kind mismatches: ${kindMismatches.slice(0, 5).join(', ')}`);
assert(sourceMismatches.length === 0, `Source mismatches: ${sourceMismatches.slice(0, 5).join(', ')}`);
assert(storageIdMismatches.length === 0, `Storage id mismatches: ${storageIdMismatches.slice(0, 5).join(', ')}`);

const report = {
  phase: 10,
  title: 'Controlled bundled PHB V2 cutover',
  generatedAt: new Date().toISOString(),
  bundled: {
    file: canonicalPath,
    templateVersion: v2.templateVersion,
    packId: v2.id,
    items: v2.items.length,
    uniqueIds: new Set(v2.items.map((item) => item.id)).size
  },
  compatibility: {
    legacyAssetPreserved: exists(legacyPath),
    sameLogicalPackId: v1.id === v2.id,
    sameCanonicalIds: missing.length === 0 && unexpected.length === 0,
    sameKinds: kindMismatches.length === 0,
    sameSourceIds: sourceMismatches.length === 0,
    deterministicStorageIdsPreserved: storageIdMismatches.length === 0,
    v1InputPathPreserved: contracts.userImportKeepsV1,
    v2UserImportEnabled: contracts.userImportRoutesV2
  },
  safety: {
    existingV1ReconciliationEnabled: contracts.bootstrapReconcilesExisting && contracts.activeHydrationReconciles,
    autoReconciliationOnlyForUnchangedContent: bootstrap.includes('preview.creates > 0 || preview.updates > 0 || preview.conflicts > 0'),
    localDivergenceDeferred: bootstrap.includes('BUNDLED_COMPENDIUM_V2_RECONCILIATION_DEFERRED'),
    freshInstallUsesV2: contracts.bootstrapRoutesV2,
    functionalParityFromPhase09: contracts.functionalParityPassed
  },
  contracts,
  mismatches: {
    missing,
    unexpected,
    kindMismatches,
    sourceMismatches,
    storageIdMismatches
  }
};

const out = path.join(root, 'artifacts', 'compendium-import-v2-phase10-cutover-report.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

console.log('[compendium:import-v2:cutover:audit] PASS');
console.log(`bundled=${path.basename(canonicalPath)} items=${v2.items.length} packId=${v2.id}`);
console.log('freshInstall=V2 existingV1=unchanged-reconcile userImports=V1+V2');
console.log(`report=${path.relative(root, out)}`);
