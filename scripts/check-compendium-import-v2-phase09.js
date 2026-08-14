#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const bundled = read('src/compendium/bundledCompendium.ts');
const mapper = read('src/compendium/mapper.ts');
const customBackground = read('src/characters/customBackgroundRules.ts');
const startingEquipment = read('src/characters/startingEquipmentRules.ts');
const companion = read('src/characters/pactChainCompanionRules.ts');
const test = read('src/tests/compendiumImportV2FunctionalParity.test.ts');
const pkg = json('package.json');
const reportPath = 'artifacts/compendium-import-v2-phase09-functional-parity-report.json';
assert(fs.existsSync(path.join(root, reportPath)), 'Functional parity report is missing; run the Phase 09 audit first.');
const report = json(reportPath);

assert(report.functionalParity === true, 'Functional parity audit must pass before completing Phase 09.');
assert(report.failed === 0, 'Functional parity report contains failures.');
assert(report.passed >= 13, `Expected at least 13 functional checks, found ${report.passed}.`);
assert(report.itemCount.v1 === 1284 && report.itemCount.v2 === 1284, 'Functional parity must compare all 1,284 PHB items in both formats.');

// The functional parity result remains a historical prerequisite after the controlled
// cutover. Later phases may legitimately point the production bundle at V2.
assert(bundled.includes('phb-2024-full-consolidated-import-pack-v2-canonical.json'), 'Production bootstrap must reference the canonical PHB V2 artifact after cutover.');

assert(mapper.includes('resolveAbilityReference'), 'Mapper must resolve canonical V2 AbilityReference values.');
assert(mapper.includes("const structured = asString(record.actionCost)"), 'Mapper must accept structured V2 casting/action timing.');
assert(customBackground.includes("const amount = typeof record.amount === 'number'"), 'Custom background pricing must accept structured V2 CurrencyValue.');
assert(startingEquipment.includes('structured.currency'), 'Starting equipment must consume structured V2 equipment options.');
assert(startingEquipment.includes('itemIds?: string[]'), 'Starting equipment options must preserve direct item references.');
assert(companion.includes("asNumber(asRecord(value).value)"), 'Companion stat blocks must consume structured V2 speed values.');

assert(test.includes('representative level-1 character'), 'Phase 09 must include a representative full character assembly regression.');
assert(test.includes('custom-background equipment'), 'Phase 09 must cover custom background equipment.');
assert(test.includes('Warlock progression'), 'Phase 09 must cover Warlock progression and invocations.');
assert(test.includes('deferred selection validation'), 'Phase 09 must cover deferred spell selection.');

assert(pkg.scripts['compendium:import-v2:functional-parity'], 'Missing Phase 09 functional parity audit script.');
assert(pkg.scripts['test:compendium-import-v2-functional-parity'], 'Missing Phase 09 Jest regression script.');
assert(pkg.scripts['test:compendium-import-v2-phase09'], 'Missing aggregate Phase 09 test script.');

console.log('[compendium:import-v2:phase09:check] PASS');
console.log(`functional=${report.passed}/${report.passed + report.failed} items=${report.itemCount.v2}`);
console.log('functional-parity=preserved; current-bootstrap=V2-canonical');
