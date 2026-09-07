#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const run = (script) => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), '--check'], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('check-character-spell-access-completeness.js');
run('check-external-spell-access.js');

const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const core = readJson('artifacts/spell-access-completeness-report.json');
const external = readJson('artifacts/external-spell-access-report.json');
const failures = [];

if (core.status !== 'PASS') failures.push('core spell-access audit is not PASS');
if (external.status !== 'PASS') failures.push('external spell-access audit is not PASS');
if (core.subclassCount !== 78) failures.push(`expected 78 subclasses, received ${core.subclassCount}`);
if (core.runtimeSubclassSpellGrantCount !== 35) failures.push(`expected 35 runtime subclass spell grants, received ${core.runtimeSubclassSpellGrantCount}`);
if (core.runtimeSubclassSpellGrantSpellReferenceCount !== 222) failures.push(`expected 222 runtime grant spell refs, received ${core.runtimeSubclassSpellGrantSpellReferenceCount}`);
if (core.runtimeSubclassSpellGrantUncoveredReferenceCount !== 0) failures.push(`${core.runtimeSubclassSpellGrantUncoveredReferenceCount} runtime grant spell refs are uncovered`);
if (core.runtimeSubclassSpellGrantRawUnrepresentedReferenceCount !== core.runtimeSubclassSpellGrantBridgeBackedReferenceCount) {
  failures.push('raw Compendium/runtime differences are not fully backed by the canonical bridge');
}
if (core.catalogReconciliationCount !== 10) failures.push(`expected 10 explicit catalog reconciliations, received ${core.catalogReconciliationCount}`);
for (const [kind, count] of Object.entries(core.pendingShapeCounts ?? {})) {
  if (count !== 0) failures.push(`pending spell-access shape ${kind}=${count}`);
}
if (!core.genieCoverage?.hasAllFourKinds) failures.push('Genie Dao/Djinni/Efreeti/Marid coverage is incomplete');
if (external.unknownShapes?.length) failures.push(`${external.unknownShapes.length} unknown external spell-access shapes remain`);
if (external.unresolvedRefs?.length) failures.push(`${external.unresolvedRefs.length} unresolved external spell refs remain`);
if (external.speciesReplacementTimingUnsupported !== 0) failures.push(`${external.speciesReplacementTimingUnsupported} species replacement timing rule(s) remain unsupported`);
if (external.speciesReplacementTimingFeatures !== external.speciesReplacementTimingSupported) {
  failures.push('not every detected species spell replacement timing is implemented');
}

const report = {
  status: failures.length ? 'FAIL' : 'PASS',
  generatedAt: new Date().toISOString(),
  scope: {
    bundledItems: core.bundledItemCount,
    classes: core.classCount,
    subclasses: core.subclassCount,
    runtimeSubclassSpellGrants: core.runtimeSubclassSpellGrantCount,
    runtimeGrantSpellReferences: core.runtimeSubclassSpellGrantSpellReferenceCount
  },
  reconciliation: {
    catalogReconciliations: core.catalogReconciliationCount,
    explicitReferences: core.runtimeSubclassSpellGrantExplicitRepresentedReferenceCount,
    rawCompendiumRuntimeDifferences: core.runtimeSubclassSpellGrantRawUnrepresentedReferenceCount,
    bridgeBackedDifferences: core.runtimeSubclassSpellGrantBridgeBackedReferenceCount,
    uncoveredReferences: core.runtimeSubclassSpellGrantUncoveredReferenceCount
  },
  external: {
    unknownShapes: external.unknownShapes?.length ?? 0,
    unresolvedReferences: external.unresolvedRefs?.length ?? 0,
    speciesReplacementTimingDetected: external.speciesReplacementTimingFeatures,
    speciesReplacementTimingSupported: external.speciesReplacementTimingSupported,
    speciesReplacementTimingUnsupported: external.speciesReplacementTimingUnsupported
  },
  genieKinds: Object.keys(core.genieCoverage?.kinds ?? {}),
  pendingShapeCounts: core.pendingShapeCounts,
  failures
};

const reportPath = path.join(ROOT, 'artifacts', 'spell-access-release-gate-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

console.log(`[spell-access:release-gate] ${report.status}`);
console.log(`subclasses=${report.scope.subclasses} runtimeGrants=${report.scope.runtimeSubclassSpellGrants} refs=${report.scope.runtimeGrantSpellReferences}`);
console.log(`rawDiff=${report.reconciliation.rawCompendiumRuntimeDifferences} bridgeBacked=${report.reconciliation.bridgeBackedDifferences} uncovered=${report.reconciliation.uncoveredReferences} catalogReconciliations=${report.reconciliation.catalogReconciliations}`);
console.log(`speciesReplacementTiming=${report.external.speciesReplacementTimingDetected}/${report.external.speciesReplacementTimingSupported} unsupported=${report.external.speciesReplacementTimingUnsupported}`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
