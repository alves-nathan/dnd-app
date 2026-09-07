#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACK_PATHS = [
  'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json',
  'assets/compendium/mm-2024-runtime-dependency-delta-v2-canonical.json',
  'assets/compendium/forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json',
  'assets/compendium/spelljammer-2022-2024-compatible-import-pack-v2-canonical.json',
  'assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json',
  'assets/compendium/phb-2014-2024-compatible-delta-v2-canonical.json'
];
const CATALOG_PATH = 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json';
const REPORT_PATH = path.join(ROOT, 'artifacts', 'spell-access-completeness-report.json');
const RECONCILIATION_PATH = 'assets/spell-access/phb2024-catalog-reconciliation-v1.json';
const BRIDGE_SOURCE_PATH = path.join(ROOT, 'src', 'characters', 'phb2024SubclassSpellGrantBridge.ts');

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
const unique = (values) => [...new Set(values.filter(Boolean))];
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asArray = (value) => Array.isArray(value) ? value : [];
const asStringArray = (value) => asArray(value).filter((entry) => typeof entry === 'string' && entry.trim());

const packs = PACK_PATHS.map((packPath) => ({ packPath, data: readJson(packPath) }));
const items = packs.flatMap(({ packPath, data }) => asArray(data.items).map((item) => ({ ...item, __packPath: packPath })));
const byId = new Map(items.map((item) => [item.id, item]));
const spells = new Set(items.filter((item) => item.kind === 'spell').map((item) => item.id));
const classes = items.filter((item) => item.kind === 'class');
const subclasses = items.filter((item) => item.kind === 'subclass');
const features = items.filter((item) => item.kind === 'feature');
const reconciliationManifest = readJson(RECONCILIATION_PATH);
const reconciliationEntries = asArray(reconciliationManifest.entries);
const reconciliationByFeatureId = new Map(reconciliationEntries.map((entry) => [entry.featureId, entry]));
const bridgeSource = fs.readFileSync(BRIDGE_SOURCE_PATH, 'utf8');
const bridgeEntrySource = (grantId) => {
  const marker = `id: "${grantId}"`;
  const markerIndex = bridgeSource.indexOf(marker);
  if (markerIndex < 0) return '';
  const entryStart = bridgeSource.lastIndexOf('  {', markerIndex);
  const nextEntry = bridgeSource.indexOf('\n  {\n    id:', markerIndex + marker.length);
  const arrayEnd = bridgeSource.indexOf('\n];', markerIndex + marker.length);
  const entryEnd = nextEntry >= 0 ? nextEntry : arrayEnd >= 0 ? arrayEnd : bridgeSource.length;
  return bridgeSource.slice(Math.max(0, entryStart), entryEnd);
};

const ownerFeatureIds = (owner) => {
  const payload = isRecord(owner.payload) ? owner.payload : {};
  const direct = asStringArray(payload.featureIds);
  const progression = asArray(payload.progression).flatMap((row) => isRecord(row) ? asStringArray(row.featureIds) : []);
  return unique([...direct, ...progression]);
};

const progressionFeatureIds = new Set([
  ...classes.flatMap(ownerFeatureIds),
  ...subclasses.flatMap(ownerFeatureIds)
]);
const progressionFeatures = features.filter((feature) => progressionFeatureIds.has(feature.id));

const missingClassRefs = [];
const missingProgressionFeatures = [];
for (const subclass of subclasses) {
  const payload = isRecord(subclass.payload) ? subclass.payload : {};
  const classRef = payload.classId || payload.classRef || payload.baseClassId;
  const classItem = byId.get(classRef);
  if (!classItem || classItem.kind !== 'class') {
    missingClassRefs.push({ subclassId: subclass.id, subclassName: subclass.name, classRef });
  }
  for (const featureId of ownerFeatureIds(subclass)) {
    const feature = byId.get(featureId);
    if (!feature || feature.kind !== 'feature') {
      missingProgressionFeatures.push({ ownerId: subclass.id, ownerName: subclass.name, featureId });
    }
  }
}
for (const classItem of classes) {
  for (const featureId of ownerFeatureIds(classItem)) {
    const feature = byId.get(featureId);
    if (!feature || feature.kind !== 'feature') {
      missingProgressionFeatures.push({ ownerId: classItem.id, ownerName: classItem.name, featureId });
    }
  }
}

const pendingShapes = {
  catalogReconciliationRequired: [],
  subclassSpellcasting: [],
  mysticArcanum: [],
  spellbookBonusChoice: [],
  spellbookGrant: [],
  spellbookSpecialChoice: [],
  ritualGrant: [],
  directSpellReference: [],
  grantedCantrip: [],
  conditionalList: []
};
const spellAccessFeatureIds = new Set();
const explicitSpellRefsBySubclass = new Map();

const addSubclassRefs = (subclassId, refs) => {
  if (!subclassId || !refs.length) return;
  const current = explicitSpellRefsBySubclass.get(subclassId) || [];
  explicitSpellRefsBySubclass.set(subclassId, unique([...current, ...refs]));
};
const levelMapRefs = (value) => isRecord(value)
  ? Object.values(value).flatMap(asStringArray)
  : [];

for (const feature of progressionFeatures) {
  const payload = isRecord(feature.payload) ? feature.payload : {};
  const mechanics = isRecord(payload.mechanics) ? payload.mechanics : {};
  const subclassId = payload.subclassId || payload.ownerSubclassId;
  let accessRelevant = false;
  const refs = [];

  if (payload.alwaysPreparedSpellRefsNeedsReview === true) {
    if (!reconciliationByFeatureId.has(feature.id)) {
      pendingShapes.catalogReconciliationRequired.push(feature.id);
    }
    accessRelevant = true;
  }
  refs.push(...asStringArray(payload.alwaysPreparedSpellRefs), ...asStringArray(payload.alwaysPreparedSpells));
  if (asStringArray(payload.spellRefs).length) {
    refs.push(...asStringArray(payload.spellRefs));
    // FIX43: ritual-only refs are materialized as feature-granted rituals; all
    // other direct refs are represented explicitly as specialSpellReference
    // signals so they cannot be mistaken for normal class-list membership.
    accessRelevant = true;
  }
  if (isRecord(payload.spellcasting) && subclassId) {
    // FIX40: subclass spellcasting is represented by the shared spellcasting profile resolver.
    accessRelevant = true;
  }
  if (isRecord(payload.arcanumByLevel)) {
    // FIX42: Mystic Arcanum is modeled independently from Pact Magic by warlockMysticArcanumRules.
    accessRelevant = true;
  }
  if (payload.freeSpells === true && typeof payload.school === 'string') {
    // FIX41: school-based Savant choices are handled by wizardSpellbookRules.
    accessRelevant = true;
  }
  if (asArray(payload.chooseSpells).length) {
    // FIX41: Spell Mastery / Signature Spells choices are handled by wizardSpellbookRules.
    accessRelevant = true;
  }
  if (typeof payload.spellListMode === 'string') {
    // FIX43: conditional spell-list modes are resolved through subclass choices.
    accessRelevant = true;
  }
  if (typeof mechanics.grantedCantrip === 'string') {
    refs.push(mechanics.grantedCantrip);
    // FIX43: granted cantrips are materialized by automatic spell access.
    accessRelevant = true;
  }
  if (typeof mechanics.addsSpellToSpellbook === 'string') {
    refs.push(mechanics.addsSpellToSpellbook);
    // FIX41: direct legacy spellbook grants are handled by wizardSpellbookRules.
    accessRelevant = true;
  }
  const grants = asArray(mechanics.spellGrants);
  if (grants.length) {
    for (const grant of grants) if (isRecord(grant)) refs.push(...asStringArray(grant.spellIds), ...asStringArray(grant.spellRefs));
    accessRelevant = true;
  }
  const progression = asArray(mechanics.spellProgression);
  if (progression.length) {
    for (const row of progression) if (isRecord(row)) refs.push(...asStringArray(row.spellIds), ...asStringArray(row.spellRefs));
    accessRelevant = true;
  }
  if (isRecord(mechanics.domainSpellTable)) {
    refs.push(...Object.values(mechanics.domainSpellTable).flatMap(asStringArray));
    accessRelevant = true;
  }
  refs.push(...levelMapRefs(mechanics.addedToWarlockSpellListBySpellLevel));
  refs.push(...levelMapRefs(mechanics.commonBySpellLevel));
  if (isRecord(mechanics.byKind)) {
    for (const value of Object.values(mechanics.byKind)) refs.push(...levelMapRefs(value));
  }
  if (typeof mechanics.cantripId === 'string') refs.push(mechanics.cantripId);
  if (isRecord(mechanics.cantripChoice) || typeof mechanics.cantripChoiceCount === 'number' || isRecord(mechanics.spellChoice) || asStringArray(mechanics.spellChoices).length) accessRelevant = true;
  if (typeof payload.additionalPreparedSpells === 'number' || asStringArray(payload.expandedSpellLists).length) accessRelevant = true;
  if (isRecord(payload.alternateOption) || asArray(payload.choice).some((row) => isRecord(row) && typeof row.extraCantrips === 'number')) accessRelevant = true;

  if (refs.length) accessRelevant = true;
  if (accessRelevant) spellAccessFeatureIds.add(feature.id);
  addSubclassRefs(subclassId, unique(refs));
}

const unresolvedExplicitSpellRefs = [];
for (const [subclassId, refs] of explicitSpellRefsBySubclass) {
  for (const ref of refs) {
    if (!spells.has(ref)) unresolvedExplicitSpellRefs.push({ subclassId, spellRef: ref });
  }
}

const runtime = readJson(CATALOG_PATH);
const runtimeEntries = asArray(runtime.runtimeIndex && runtime.runtimeIndex.entries);
const runtimeEdges = asArray(runtime.dependencyGraph && runtime.dependencyGraph.edges);
const runtimeRegistryEntries = asArray(runtime.entityRegistry && runtime.entityRegistry.entries);
const runtimeRegistry = new Map(runtimeRegistryEntries.map((entry) => [entry.entityId, entry]));
const normalizedName = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[’']/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');
const resolveRuntimeEntityToCompendium = (runtimeId, kind) => {
  const direct = byId.get(runtimeId);
  if (direct && direct.kind === kind) return direct.id;
  const runtimeEntry = runtimeRegistry.get(runtimeId);
  const candidates = items.filter((item) => item.kind === kind && normalizedName(item.name) === normalizedName(runtimeEntry && runtimeEntry.name));
  const phbCandidate = candidates.find((item) => item.id.startsWith('phb-2024-'));
  return phbCandidate?.id ?? (candidates.length === 1 ? candidates[0].id : undefined);
};
const grantEntities = runtimeEntries.filter((entry) => entry.kind === 'subclassSpellGrant');
const runtimeGrantChecks = [];
const unresolvedRuntimeGrantSpellRefs = [];
const runtimeGrantOwnershipErrors = [];
const runtimeGrantBridgeCoverageErrors = [];
const catalogReconciliationErrors = [];

for (const grant of grantEntities) {
  const outgoing = runtimeEdges.filter((edge) => edge.fromId === grant.entityId);
  const runtimeClassId = outgoing.find((edge) => edge.relation === 'belongsToClass')?.toId;
  const runtimeSubclassId = outgoing.find((edge) => edge.relation === 'belongsToSubclass')?.toId;
  const classId = runtimeClassId ? resolveRuntimeEntityToCompendium(runtimeClassId, 'class') : undefined;
  const subclassId = runtimeSubclassId ? resolveRuntimeEntityToCompendium(runtimeSubclassId, 'subclass') : undefined;
  const runtimeSpellRefs = unique(outgoing.filter((edge) => edge.relation === 'referencesSpell').map((edge) => edge.toId));
  const spellRefs = runtimeSpellRefs.map((ref) => resolveRuntimeEntityToCompendium(ref, 'spell'));
  if (!classId || !subclassId) {
    runtimeGrantOwnershipErrors.push({ grantId: grant.entityId, runtimeClassId, classId, runtimeSubclassId, subclassId });
  }
  runtimeSpellRefs.forEach((runtimeSpellRef, index) => {
    if (!spellRefs[index]) unresolvedRuntimeGrantSpellRefs.push({ grantId: grant.entityId, runtimeSpellRef });
  });
  const canonicalSpellRefs = spellRefs.filter(Boolean);
  const explicit = new Set(explicitSpellRefsBySubclass.get(subclassId) || []);
  const explicitRepresented = canonicalSpellRefs.filter((ref) => explicit.has(ref));
  const rawUnrepresented = canonicalSpellRefs.filter((ref) => !explicit.has(ref));
  const bridgeBlock = bridgeEntrySource(grant.entityId);
  if (!bridgeBlock) runtimeGrantBridgeCoverageErrors.push({ grantId: grant.entityId, reason: 'bridge entry missing' });
  const bridgeBacked = rawUnrepresented.filter((ref) => bridgeBlock.includes(`"${ref}"`));
  const uncovered = rawUnrepresented.filter((ref) => !bridgeBlock.includes(`"${ref}"`));
  if (uncovered.length) runtimeGrantBridgeCoverageErrors.push({ grantId: grant.entityId, uncovered });
  runtimeGrantChecks.push({
    grantId: grant.entityId,
    runtimeClassId,
    classId,
    runtimeSubclassId,
    subclassId,
    spellReferenceCount: canonicalSpellRefs.length,
    explicitRepresentedCount: explicitRepresented.length,
    rawUnrepresentedCount: rawUnrepresented.length,
    bridgeBackedCount: bridgeBacked.length,
    uncoveredCount: uncovered.length,
    rawUnrepresentedSpellReferences: rawUnrepresented,
    bridgeBackedSpellReferences: bridgeBacked,
    uncoveredSpellReferences: uncovered
  });
}

for (const entry of reconciliationEntries) {
  const feature = byId.get(entry.featureId);
  if (!feature || feature.kind !== 'feature') {
    catalogReconciliationErrors.push({ featureId: entry.featureId, bridgeId: entry.bridgeId, reason: 'feature missing' });
    continue;
  }
  const payload = isRecord(feature.payload) ? feature.payload : {};
  if (payload.alwaysPreparedSpellRefsNeedsReview !== true) {
    catalogReconciliationErrors.push({ featureId: entry.featureId, bridgeId: entry.bridgeId, reason: 'review marker no longer present; manifest must be revalidated' });
  }
  if (!bridgeEntrySource(entry.bridgeId)) {
    catalogReconciliationErrors.push({ featureId: entry.featureId, bridgeId: entry.bridgeId, reason: 'bridge entry missing' });
  }
}

const genieFeature = progressionFeatures.find((feature) => {
  const mechanics = isRecord(feature.payload && feature.payload.mechanics) ? feature.payload.mechanics : {};
  return asStringArray(mechanics.genieKinds).length === 4 && isRecord(mechanics.byKind);
});
const genieCoverage = genieFeature ? (() => {
  const mechanics = genieFeature.payload.mechanics;
  const common = unique(levelMapRefs(mechanics.commonBySpellLevel));
  const kinds = asStringArray(mechanics.genieKinds);
  const byKind = mechanics.byKind;
  return {
    featureId: genieFeature.id,
    commonSpellReferenceCount: common.length,
    kinds: Object.fromEntries(kinds.map((kind) => [kind, unique(levelMapRefs(byKind[kind])).length])),
    hasAllFourKinds: ['dao', 'djinni', 'efreeti', 'marid'].every((kind) => kinds.includes(kind))
  };
})() : { featureId: null, commonSpellReferenceCount: 0, kinds: {}, hasAllFourKinds: false };

const report = {
  status: 'PASS',
  generatedAt: new Date().toISOString(),
  bundledItemCount: items.length,
  classCount: classes.length,
  subclassCount: subclasses.length,
  progressionFeatureCount: progressionFeatures.length,
  spellAccessFeatureCount: spellAccessFeatureIds.size,
  runtimeSubclassSpellGrantCount: grantEntities.length,
  runtimeSubclassSpellGrantSpellReferenceCount: runtimeGrantChecks.reduce((sum, row) => sum + row.spellReferenceCount, 0),
  runtimeSubclassSpellGrantExplicitRepresentedReferenceCount: runtimeGrantChecks.reduce((sum, row) => sum + row.explicitRepresentedCount, 0),
  runtimeSubclassSpellGrantRawUnrepresentedReferenceCount: runtimeGrantChecks.reduce((sum, row) => sum + row.rawUnrepresentedCount, 0),
  runtimeSubclassSpellGrantBridgeBackedReferenceCount: runtimeGrantChecks.reduce((sum, row) => sum + row.bridgeBackedCount, 0),
  runtimeSubclassSpellGrantUncoveredReferenceCount: runtimeGrantChecks.reduce((sum, row) => sum + row.uncoveredCount, 0),
  catalogReconciliationCount: reconciliationEntries.length,
  genieCoverage,
  pendingShapeCounts: Object.fromEntries(Object.entries(pendingShapes).map(([key, value]) => [key, value.length])),
  pendingShapes,
  runtimeGrantChecks,
  failures: {
    missingClassRefs,
    missingProgressionFeatures,
    unresolvedExplicitSpellRefs,
    runtimeGrantOwnershipErrors,
    unresolvedRuntimeGrantSpellRefs,
    runtimeGrantBridgeCoverageErrors,
    catalogReconciliationErrors
  }
};

if (subclasses.length !== 78) {
  report.failures.subclassCountMismatch = [{ expected: 78, actual: subclasses.length }];
}
if (grantEntities.length !== 35) {
  report.failures.runtimeGrantCountMismatch = [{ expected: 35, actual: grantEntities.length }];
}
if (!genieCoverage.hasAllFourKinds) {
  report.failures.genieVariantCoverage = [{ expected: ['dao', 'djinni', 'efreeti', 'marid'], actual: Object.keys(genieCoverage.kinds) }];
}
const totalFailureCount = Object.values(report.failures).reduce((sum, list) => sum + list.length, 0);
report.status = totalFailureCount === 0 ? 'PASS' : 'FAIL';

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

console.log(`[spell-access:audit] ${report.status}`);
console.log(`items=${items.length} classes=${classes.length} subclasses=${subclasses.length} progressionFeatures=${progressionFeatures.length}`);
console.log(`runtimeSubclassSpellGrants=${grantEntities.length} refs=${report.runtimeSubclassSpellGrantSpellReferenceCount} explicit=${report.runtimeSubclassSpellGrantExplicitRepresentedReferenceCount} rawUnrepresented=${report.runtimeSubclassSpellGrantRawUnrepresentedReferenceCount} bridgeBacked=${report.runtimeSubclassSpellGrantBridgeBackedReferenceCount} uncovered=${report.runtimeSubclassSpellGrantUncoveredReferenceCount}`);
console.log(`catalogReconciliations=${report.catalogReconciliationCount}`);
console.log(`genieKinds=${Object.keys(genieCoverage.kinds).join(',')} commonRefs=${genieCoverage.commonSpellReferenceCount}`);
console.log(`pendingShapes=${JSON.stringify(report.pendingShapeCounts)}`);
if (report.status !== 'PASS') {
  console.error(JSON.stringify(report.failures, null, 2));
  process.exitCode = 1;
}
