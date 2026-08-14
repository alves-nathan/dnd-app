#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'artifacts', 'compendium', 'integration', 'app06-monster-dependency-closure-report.json');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;

const phb = read('assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json');
const mm = read('assets/compendium/mm-2024-runtime-dependency-delta-v2-canonical.json');
const spelljammer = read('assets/compendium/spelljammer-2022-2024-compatible-import-pack-v2-canonical.json');
const audit = read('artifacts/compendium/integration/legacy-runtime-dependency-audit.json');

const expectedIds = ['mm-2024-creature-flumph', 'mm-2024-creature-mage'];
const ids = mm.items.map((item) => item.id).sort();
const engineKeys = mm.items.map((item) => item.payload?.engineKey).filter(Boolean);
const phbIds = new Set(phb.items.map((item) => item.id));
const mage = mm.items.find((item) => item.id === 'mm-2024-creature-mage');
const flumph = mm.items.find((item) => item.id === 'mm-2024-creature-flumph');
const mageSpellRefs = Array.isArray(mage?.payload?.mechanics?.spellRefs) ? mage.payload.mechanics.spellRefs : [];
const creatureVariants = spelljammer.items.filter((item) => item.payload?.sourceType === 'creatureVariant');
const baseRefs = creatureVariants.map((item) => ({
  itemId: item.id,
  name: item.name,
  externalId: item.payload?.mechanics?.baseCreature?.externalId ?? null
}));
const legacyBaseRefs = baseRefs.filter((entry) => typeof entry.externalId === 'string' && entry.externalId.startsWith('mm-2014-'));
const currentBaseRefs = baseRefs.filter((entry) => typeof entry.externalId === 'string' && entry.externalId.startsWith('mm-2024-'));
const runtimeRequired = audit.residual?.byClassification?.['runtime-required']?.items ?? [];

const checks = {
  packContainsExactlyMageAndFlumph: ids.length === 2 && JSON.stringify(ids) === JSON.stringify(expectedIds),
  packUsesCurrentRulesEra: mm.items.every((item) => item.source?.rulesEra === '2024'),
  engineKeysUnique: engineKeys.length === mm.items.length && new Set(engineKeys).size === engineKeys.length,
  magePresent: Boolean(mage),
  flumphPresent: Boolean(flumph),
  mageSpellsResolveToBundledPhb2024: mageSpellRefs.length > 0 && mageSpellRefs.every((id) => phbIds.has(id)),
  spelljammerUsesMage2024Base: baseRefs.some((entry) => entry.externalId === 'mm-2024-creature-mage'),
  spelljammerUsesFlumph2024Base: baseRefs.some((entry) => entry.externalId === 'mm-2024-creature-flumph'),
  noSpelljammerMm2014RuntimeBases: legacyBaseRefs.length === 0,
  residualRuntimeRequiredDependenciesClosed: runtimeRequired.length === 0,
  mmDeltaReadyForRuntimePreview: mm.metadata?.validation?.status === 'READY_FOR_RUNTIME_PREVIEW'
};

const report = {
  schemaVersion: 'dnd-combat-app06-monster-dependency-closure.v1',
  compatibilityProfile: '2024-first+legacy',
  pack: {
    id: mm.id,
    itemCount: mm.items.length,
    itemIds: ids,
    validationStatus: mm.metadata?.validation?.status ?? null
  },
  spelljammerBaseCreatureRefs: baseRefs,
  currentBaseRefCount: currentBaseRefs.length,
  legacyBaseRefCount: legacyBaseRefs.length,
  mageSpellRefs: {
    total: mageSpellRefs.length,
    unresolvedAgainstBundledPhb2024: mageSpellRefs.filter((id) => !phbIds.has(id))
  },
  residualRuntimeRequiredDependencies: runtimeRequired,
  checks,
  passedChecks: Object.values(checks).filter(Boolean).length,
  totalChecks: Object.keys(checks).length,
  pass: Object.values(checks).every(Boolean)
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, pretty(report));
if (!report.pass) {
  console.error(pretty(report));
  process.exitCode = 1;
} else {
  console.log(`PASS: APP06 monster dependency closure ${report.passedChecks}/${report.totalChecks}; Mage + Flumph use current-rules IDs and residual runtime-required legacy dependencies = 0.`);
}
