#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const reportPath = 'artifacts/compendium-import-v2-phase10-cutover-report.json';
assert(fs.existsSync(path.join(root, reportPath)), 'Phase 10 cutover report missing; run the audit first.');
const report = json(reportPath);
const bundled = read('src/compendium/bundledCompendium.ts');
const bootstrap = read('src/storage/bundledCompendiumBootstrap.ts');
const store = read('src/store/compendiumStore.ts');
const tests = read('src/tests/compendiumImportV2Cutover.test.ts');
const pkg = json('package.json');

assert(report.phase === 10, 'Unexpected cutover report phase.');
assert(report.bundled.templateVersion === 'dnd-combat-import.v2', 'Production bundle must be V2.');
assert(report.bundled.items === 1284 && report.bundled.uniqueIds === 1284, 'Bundled V2 PHB must contain 1,284 unique items.');
assert(report.compatibility.legacyAssetPreserved === true, 'V1 asset must remain for compatibility/regression.');
assert(report.compatibility.deterministicStorageIdsPreserved === true, 'Storage ids must stay stable across V1 -> V2.');
assert(report.compatibility.v1InputPathPreserved === true && report.compatibility.v2UserImportEnabled === true, 'Both V1 and V2 user imports must be supported after cutover.');
assert(report.safety.existingV1ReconciliationEnabled === true, 'Existing V1 bundled installations must reconcile automatically.');
assert(report.safety.autoReconciliationOnlyForUnchangedContent === true, 'Automatic reconciliation must never overwrite changed local content.');
assert(report.safety.functionalParityFromPhase09 === true, 'Phase 09 functional parity gate must remain green.');

assert(bundled.includes('phb-2024-full-consolidated-import-pack-v2-canonical.json'), 'Bundled manifest must load canonical V2 PHB.');
assert(!bundled.includes("require('../../assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json')"), 'Production bundled manifest must no longer load V1 PHB.');
assert(bootstrap.includes('reconcileBundledCompendium'), 'Controlled reconciliation function missing.');
assert(store.includes('repository.saveImportV2Json(json)') && store.includes('repository.saveImportJson(json)'), 'Store must route both V2 and V1 input.');
assert(tests.includes('promotes the existing bundled V1 PHB without changing any storage id'), 'Upgrade regression missing.');
assert(tests.includes('installs a fresh 2024-first catalog through V2 persistence'), 'Fresh-install V2 regression missing.');

assert(pkg.scripts['compendium:import-v2:cutover:audit'], 'Missing Phase 10 cutover audit script.');
assert(pkg.scripts['compendium:import-v2:phase10:check'], 'Missing Phase 10 contract script.');
assert(pkg.scripts['test:compendium-import-v2-cutover'], 'Missing Phase 10 Jest cutover script.');
assert(pkg.scripts['test:compendium-import-v2-phase10'], 'Missing aggregate Phase 10 test script.');

console.log('[compendium:import-v2:phase10:check] PASS');
console.log('bootstrap=V2-canonical; existingV1=safe-reconcile; input=V1+V2');
