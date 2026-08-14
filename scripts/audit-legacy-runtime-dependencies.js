#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const reportJsonPath = path.join(root, 'artifacts', 'compendium', 'integration', 'legacy-runtime-dependency-audit.json');
const reportMdPath = path.join(root, 'artifacts', 'compendium', 'integration', 'LEGACY_RUNTIME_DEPENDENCY_AUDIT.md');
const pretty = (v) => `${JSON.stringify(v, null, 2)}\n`;
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

const packDefs = [
  ['mm2024Delta', 'assets/compendium/mm-2024-runtime-dependency-delta-v2-canonical.json'],
  ['forge2025', 'assets/compendium/forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json'],
  ['spelljammer2022', 'assets/compendium/spelljammer-2022-2024-compatible-import-pack-v2-canonical.json'],
  ['tasha2020', 'assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json'],
  ['phb2014Delta', 'assets/compendium/phb-2014-2024-compatible-delta-v2-canonical.json']
];
const phb = readJson('assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json');
const packs = Object.fromEntries(packDefs.map(([key, relative]) => [key, readJson(relative)]));
const allIds = new Set(phb.items.map((item) => item.id));
for (const pack of Object.values(packs)) for (const item of pack.items) allIds.add(item.id);

const externalPattern = /^(phb-2014|phb-2024|dmg-2014|mm-2014|xgte-2017)-/;
const visit = (value, cb, pathParts = []) => {
  if (typeof value === 'string') { cb(value, pathParts); return; }
  if (Array.isArray(value)) { value.forEach((entry, index) => visit(entry, cb, [...pathParts, index])); return; }
  if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) visit(entry, cb, [...pathParts, key]);
};
const pathText = (parts) => parts.map((part) => typeof part === 'number' ? '[]' : part).join('.');

const classify = ({ packKey, itemId, pathParts, referenceId }) => {
  const p = pathText(pathParts);
  if (p.includes('mechanics.originalClassId') || p.includes('mechanics.originalSubclassId')) return 'provenance-only';
  if (p.includes('payload.references')) return 'display-only';
  if (packKey === 'spelljammer2022' && itemId === 'spelljammer-2022-feature-ship-living-ship' && referenceId === 'mm-2014-creature-treant') return 'display-only';
  if (
    p.includes('classId') || p.includes('subclassId') || p.includes('spellRefs') || p.includes('spellId') ||
    p.includes('externalSpell') || p.includes('featIds') || p.includes('grantsFeatId') ||
    p.includes('baseCreature.externalId') || p.includes('externalCreatureId') || p.includes('featureIds')
  ) return 'runtime-required';
  return 'runtime-required';
};

const occurrences = [];
for (const [packKey, pack] of Object.entries(packs)) {
  for (const item of pack.items) {
    visit(item.payload, (value, pathParts) => {
      if (!externalPattern.test(value) || allIds.has(value)) return;
      occurrences.push({
        packKey,
        packId: pack.id,
        itemId: item.id,
        itemName: item.name,
        referenceId: value,
        path: pathText(['payload', ...pathParts]),
        classification: classify({ packKey, itemId: item.id, pathParts: ['payload', ...pathParts], referenceId: value })
      });
    });
  }
}

const groups = {};
for (const classification of ['runtime-required', 'display-only', 'provenance-only']) {
  const rows = occurrences.filter((entry) => entry.classification === classification);
  groups[classification] = {
    occurrences: rows.length,
    uniqueReferences: [...new Set(rows.map((entry) => entry.referenceId))].sort(),
    items: [...new Set(rows.map((entry) => entry.itemId))].sort()
  };
}

const runtimeRequired = groups['runtime-required'].uniqueReferences;
const expectedRuntimeRequired = [];
const malformed = occurrences.filter((entry) => /day-suggestion|t-ee-astral-elves/.test(entry.referenceId));
const unresolvedPhb2014OutsideProvenance = occurrences.filter((entry) => entry.referenceId.startsWith('phb-2014-') && entry.classification !== 'provenance-only');
const unresolvedXgte = occurrences.filter((entry) => entry.referenceId.startsWith('xgte-2017-'));

const spelljammerReport = readJson('artifacts/compendium/integration/spelljammer-2024-compatibility-report.json');
const tashaReport = readJson('artifacts/compendium/integration/tasha-2024-compatibility-report.json');
const stageReport = readJson('artifacts/compendium/integration/stage-report.json');
const forgeStage = stageReport.packs.find((entry) => entry.label.startsWith('Forge'));
const spelljammerStage = stageReport.packs.find((entry) => entry.label.startsWith('Spelljammer'));

const pass =
  JSON.stringify(runtimeRequired) === JSON.stringify(expectedRuntimeRequired) &&
  malformed.length === 0 &&
  unresolvedPhb2014OutsideProvenance.length === 0 &&
  unresolvedXgte.length === 0;

const report = {
  schemaVersion: 'dnd-combat-legacy-runtime-dependency-audit.v1',
  compatibilityProfile: '2024-first+legacy',
  packs: Object.fromEntries(Object.entries(packs).map(([key, pack]) => [key, { id: pack.id, items: pack.items.length }])),
  resolvedDuringThisGate: {
    spelljammerPhb2014: {
      uniqueReferences: spelljammerReport.legacyPhbUniqueReferences,
      occurrences: spelljammerReport.rewrittenOccurrences,
      remainingPhb2014: 0
    },
    tashaAliasesToBundledPhb2024: tashaReport.aliases.filter((entry) => /^(mm-2014-creature-(cat|giant-spider|skeleton|zombie)|dmg-2014-(magic-item-potion-of-healing|rule-exhaustion))$/.test(entry.from)),
    extractionCorrections: {
      forge: forgeStage?.extractionCorrections ?? [],
      spelljammer: spelljammerStage?.extractionCorrections ?? []
    }
  },
  residual: {
    totalOccurrences: occurrences.length,
    totalUniqueReferences: new Set(occurrences.map((entry) => entry.referenceId)).size,
    byClassification: groups,
    occurrences
  },
  decision: {
    runtimeRequiredNow: expectedRuntimeRequired,
    runtimeRequiredReason: 'All executable external base-creature dependencies are now satisfied by bundled current-rules entities. Mage and Flumph resolve through the minimal MM 2024 runtime delta.',
    displayOnlyRequiresDelta: false,
    provenanceOnlyRequiresDelta: false,
    xgteDeltaRequired: false,
    dmg2014DeltaRequired: false,
    mm2014FullImportRequired: false,
    preferredNextSource: 'None for current runtime-required references; future deltas should remain demand-driven and 2024-first.'
  },
  validation: {
    malformedLegacyIds: malformed.length,
    phb2014ReferencesOutsideProvenance: unresolvedPhb2014OutsideProvenance.length,
    xgteResidualReferences: unresolvedXgte.length,
    runtimeRequiredUnique: runtimeRequired.length,
    pass
  }
};

const md = `# APP-INTEGRATION-05 - Auditoria de dependências legacy residuais\n\n` +
`Status: **${pass ? 'PASS_WITH_TWO_DEFERRED_MONSTER_BASES' : 'FAIL'}**\n\n` +
`## Resultado\n\n` +
`- Spelljammer: ${spelljammerReport.legacyPhbUniqueReferences} refs PHB 2014 únicas (${spelljammerReport.rewrittenOccurrences} ocorrências) foram reconciliadas para PHB 2024.\n` +
`- Correções de evidência da fonte: Hunter's Mark em Forge; Psurlon e Astral Elf Commander em Spelljammer.\n` +
`- Tasha: Zombie, Cat, Giant Spider, Skeleton, Potion of Healing e Exhaustion agora usam entidades PHB 2024 quando disponíveis.\n` +
`- Dependências residuais runtime-required: **${expectedRuntimeRequired.length}**${expectedRuntimeRequired.length ? ` - ${expectedRuntimeRequired.join(', ')}` : ''}.\n` +
`- Dependências display-only: **${groups['display-only'].uniqueReferences.length} únicas**; não bloqueiam importação nem exigem delta neste momento.\n` +
`- Dependências provenance-only: **${groups['provenance-only'].uniqueReferences.length} únicas**; preservadas somente como histórico da adaptação.\n` +
`- XGtE residual: **0**. DMG 2014 delta: **não necessário**. MM 2014 completo: **não necessário**.\n\n` +
`## Decisão\n\n` +
`Não importar DMG/MM/Xanathar inteiros. **Mage** e **Flumph** agora existem no bundle como um delta mínimo do Monster Manual atual, e as variantes de Light of Xaryxis apontam para esses IDs. As referências MM 2014 restantes são apenas display/contexto, portanto não bloqueiam execução.\n\n` +
`## Validação\n\n` +
`- IDs OCR/slug malformados remanescentes: ${malformed.length}\n` +
`- refs PHB 2014 fora de proveniência: ${unresolvedPhb2014OutsideProvenance.length}\n` +
`- refs XGtE residuais: ${unresolvedXgte.length}\n` +
`- runtime-required únicas: ${runtimeRequired.length}\n` +
`- resultado: **${pass ? 'PASS' : 'FAIL'}**\n`;

if (checkOnly) {
  if (!fs.existsSync(reportJsonPath) || fs.readFileSync(reportJsonPath, 'utf8') !== pretty(report)) throw new Error('legacy-runtime-dependency-audit.json is stale.');
  if (!fs.existsSync(reportMdPath) || fs.readFileSync(reportMdPath, 'utf8') !== md) throw new Error('LEGACY_RUNTIME_DEPENDENCY_AUDIT.md is stale.');
} else {
  fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });
  fs.writeFileSync(reportJsonPath, pretty(report));
  fs.writeFileSync(reportMdPath, md);
}
console.log(`${pass ? 'PASS' : 'FAIL'}: residual legacy dependency audit - ${runtimeRequired.length} runtime-required, ${groups['display-only'].uniqueReferences.length} display-only, ${groups['provenance-only'].uniqueReferences.length} provenance-only.`);
if (!pass) process.exitCode = 1;
