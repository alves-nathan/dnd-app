#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const targetRelative = 'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json';
const legacyRelative = 'assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json';
const reportRelative = 'artifacts/compendium-import-v2-phase08-phb-migration-report.json';
const target = json(targetRelative);
const legacy = json(legacyRelative);
const report = json(reportRelative);
const schema = json('docs/dnd-combat-import-v2.schema.json');
const bundled = read('src/compendium/bundledCompendium.ts');
const domain = read('src/compendium/importDomain.ts');
const docs = read('docs/PHB_2024_IMPORT_V2_MIGRATION.md');
const pkg = json('package.json');

assert(target.templateVersion === 'dnd-combat-import.v2', 'Canonical PHB artifact must be V2.');
assert(target.id === legacy.id, 'Canonical PHB artifact must preserve the logical pack id.');
assert(target.items.length === 1284, `Expected 1284 canonical PHB items, found ${target.items.length}.`);
assert(new Set(target.items.map((item) => item.id)).size === 1284, 'Canonical PHB item IDs must be unique.');
assert(Object.keys(report.target.byKind).length === 13, 'Phase 08 report must cover all 13 entity kinds.');
assert(report.preservation.ids.preserved === 1284, 'Phase 08 report must preserve all IDs.');
assert(report.preservation.semanticItemHashes.preserved === 1284, 'Phase 08 report must preserve all semantic item hashes.');
assert(report.preservation.legacyItemProvenance.preservedEntries === 1284, 'All legacy per-item provenance must be preserved.');
assert(report.validation.semanticIssues.errors === 0, 'Canonical PHB migration has semantic errors.');
assert(report.validation.semanticIssues.warnings === 0, 'Canonical PHB migration has semantic warnings.');
assert(report.invariant.runtimeBootstrapSwitched === false, 'Phase 08 must not switch production bootstrap yet.');
assert(bundled.includes('phb-2024-full-consolidated-import-pack-v2-canonical.json'), 'Production bootstrap must reference the canonical PHB V2 artifact after cutover.');
assert(domain.includes('metadata?: Record<string, unknown>'), 'V2 item domain must expose non-gameplay provenance metadata.');
assert(docs.includes(targetRelative), 'PHB V2 migration documentation must reference the canonical artifact.');
assert(pkg.scripts['compendium:import-v2:phb:migrate'], 'Missing PHB V2 migration script.');
assert(pkg.scripts['compendium:import-v2:phb:check'], 'Missing PHB V2 drift check script.');

const itemDefs = Object.entries(schema.$defs || {}).filter(([name, definition]) =>
  name.endsWith('Item') && definition && typeof definition === 'object' && definition.properties?.payload
);
assert(itemDefs.length === 13, `Expected 13 item definitions in JSON Schema, found ${itemDefs.length}.`);
assert(itemDefs.every(([, definition]) => definition.properties.metadata), 'Every V2 item JSON Schema definition must expose optional metadata.');

console.log('[compendium:import-v2:phase08:check] PASS');
console.log(`items=${target.items.length} kinds=${Object.keys(report.target.byKind).length} provenance=${report.preservation.legacyItemProvenance.preservedEntries}`);
console.log(`semantic errors=${report.validation.semanticIssues.errors} warnings=${report.validation.semanticIssues.warnings} infos=${report.validation.semanticIssues.infos}`);
console.log('phase08-artifact=verified; current-bootstrap=V2-canonical');
