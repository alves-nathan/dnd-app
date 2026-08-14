#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceRelative = 'assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json';
const targetRelative = 'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json';
const checksumRelative = `${targetRelative}.sha256`;
const reportRelative = 'artifacts/compendium-import-v2-phase08-phb-migration-report.json';
const sourcePath = path.join(root, sourceRelative);
const targetPath = path.join(root, targetRelative);
const checksumPath = path.join(root, checksumRelative);
const reportPath = path.join(root, reportRelative);
const checkOnly = process.argv.includes('--check');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const stablePrettyJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const countBy = (values, selector) => values.reduce((acc, value) => {
  const key = selector(value);
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const countSeverity = (issues) => ({
  errors: issues.filter((entry) => entry.severity === 'error').length,
  warnings: issues.filter((entry) => entry.severity === 'warning').length,
  infos: issues.filter((entry) => entry.severity === 'info').length,
  byCode: countBy(issues, (entry) => entry.code)
});

const loadTypeScript = () => {
  for (const candidate of [
    'typescript',
    '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js',
    '/usr/local/lib/node_modules/typescript/lib/typescript.js'
  ]) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado; necessário para executar a migração PHB V2 sem depender do build da aplicação.');
};

const buildRuntime = () => {
  const ts = loadTypeScript();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-phb-v2-migration-'));
  const tempSrc = path.join(tempRoot, 'src');
  const tempCompendium = path.join(tempSrc, 'compendium');
  const tempTypes = path.join(tempSrc, 'types');
  fs.mkdirSync(tempCompendium, { recursive: true });
  fs.mkdirSync(tempTypes, { recursive: true });

  const transpile = (input, output) => {
    const result = ts.transpileModule(fs.readFileSync(input, 'utf8'), {
      fileName: input,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    });
    const errors = (result.diagnostics || []).filter((entry) => entry.category === ts.DiagnosticCategory.Error);
    if (errors.length) {
      throw new Error(`Falha ao transpilar ${path.relative(root, input)} (${errors.length} diagnóstico(s)).`);
    }
    fs.writeFileSync(output, result.outputText);
  };

  transpile(path.join(root, 'src', 'types', 'index.ts'), path.join(tempTypes, 'index.js'));
  for (const fileName of [
    'importVersions.ts',
    'importDomain.ts',
    'importContentHash.ts',
    'importNormalization.ts',
    'importV1Migration.ts',
    'importSemanticValidation.ts'
  ]) {
    transpile(path.join(root, 'src', 'compendium', fileName), path.join(tempCompendium, fileName.replace(/\.ts$/, '.js')));
  }

  return {
    tempRoot,
    migrateImportV1ToV2: require(path.join(tempCompendium, 'importV1Migration.js')).migrateImportV1ToV2,
    normalizeCompendiumImportPack: require(path.join(tempCompendium, 'importNormalization.js')).normalizeCompendiumImportPack,
    analyzeCompendiumImportV2Semantics: require(path.join(tempCompendium, 'importSemanticValidation.js')).analyzeCompendiumImportV2Semantics,
    createCompendiumImportItemContentHash: require(path.join(tempCompendium, 'importContentHash.js')).createCompendiumImportItemContentHash,
    createImportContentHash: require(path.join(tempCompendium, 'importContentHash.js')).createImportContentHash
  };
};

const rawText = fs.readFileSync(sourcePath, 'utf8');
const raw = JSON.parse(rawText);
const runtime = buildRuntime();

try {
  const migrated = runtime.migrateImportV1ToV2(raw, {
    originalEnvelope: raw,
    detectedLegacyVersion: raw.templateVersion || 'legacy-unversioned'
  });
  if (!migrated.value) throw new Error('A migração do PHB V1 não produziu um pacote V2 canônico.');

  const sourceSha256 = sha256(rawText);
  const { extractionInstructions, consolidationMeta, ...canonicalBase } = migrated.value;
  const migratedMetadata = canonicalBase.metadata && typeof canonicalBase.metadata === 'object'
    ? canonicalBase.metadata
    : {};

  // The formal V2 artifact intentionally has only canonical envelope fields.
  // Legacy envelope extensions remain available under metadata.legacyExtensions,
  // and item-level `_importMeta` is preserved as item.metadata.legacyImport.
  const canonicalPack = {
    templateVersion: 'dnd-combat-import.v2',
    id: canonicalBase.id,
    source: canonicalBase.source,
    metadata: {
      ...migratedMetadata,
      legacyExtensions: {
        ...(migratedMetadata.legacyExtensions || {}),
        ...(extractionInstructions !== undefined ? { extractionInstructions } : {}),
        ...(consolidationMeta !== undefined ? { consolidationMeta } : {})
      },
      canonicalMigration: {
        schemaVersion: 'phb-2024-import-v2-migration.v1',
        sourceTemplateVersion: raw.templateVersion || 'legacy-unversioned',
        sourcePackId: raw.id,
        sourceAsset: sourceRelative,
        sourceSha256,
        itemCount: canonicalBase.items.length,
        generator: 'scripts/migrate-phb-2024-to-import-v2.js',
        deterministic: true,
        itemProvenancePath: 'items[].metadata.legacyImport'
      }
    },
    items: canonicalBase.items
  };

  const normalizedAgain = runtime.normalizeCompendiumImportPack(canonicalPack);
  if (!normalizedAgain.value) throw new Error('O artefato V2 formal não é idempotente no normalizador.');

  const semantic = runtime.analyzeCompendiumImportV2Semantics(normalizedAgain.value);
  const sourceIds = raw.items.map((item) => item.id);
  const targetIds = normalizedAgain.value.items.map((item) => item.id);
  const sourceKinds = countBy(raw.items, (item) => item.kind);
  const targetKinds = countBy(normalizedAgain.value.items, (item) => item.kind);
  const targetById = new Map(normalizedAgain.value.items.map((item) => [item.id, item]));
  const migratedById = new Map(migrated.value.items.map((item) => [item.id, item]));
  const missingIds = sourceIds.filter((id) => !targetById.has(id));
  const unexpectedIds = targetIds.filter((id) => !sourceIds.includes(id));
  const kindMismatches = raw.items
    .filter((item) => targetById.get(item.id)?.kind !== item.kind)
    .map((item) => item.id);
  const nameMismatches = raw.items
    .filter((item) => targetById.get(item.id)?.name !== item.name)
    .map((item) => item.id);
  const sourceIdMismatches = raw.items
    .filter((item) => targetById.get(item.id)?.source?.id !== item.source?.id)
    .map((item) => item.id);

  const semanticHashMismatches = [];
  for (const item of migrated.value.items) {
    const target = targetById.get(item.id);
    if (!target || runtime.createCompendiumImportItemContentHash(item) !== runtime.createCompendiumImportItemContentHash(target)) {
      semanticHashMismatches.push(item.id);
    }
  }

  let legacyItemMetaCount = 0;
  let preservedItemMetaCount = 0;
  const provenanceMismatches = [];
  raw.items.forEach((item) => {
    if (!item._importMeta) return;
    legacyItemMetaCount += 1;
    const migratedItem = targetById.get(item.id);
    const preserved = migratedItem?.metadata?.legacyImport;
    if (JSON.stringify(preserved) === JSON.stringify(item._importMeta)) preservedItemMetaCount += 1;
    else provenanceMismatches.push(item.id);
  });

  const targetText = stablePrettyJson(canonicalPack);
  const targetSha256 = sha256(targetText);
  const checksumText = `${targetSha256}  ${path.basename(targetPath)}\n`;
  const semanticIssueCounts = countSeverity(semantic.issues);
  const normalizationIssueCounts = countSeverity(normalizedAgain.issues);
  const migrationIssueCounts = countSeverity(migrated.issues);
  const formalPackHash = runtime.createImportContentHash({
    id: normalizedAgain.value.id,
    source: normalizedAgain.value.source,
    items: normalizedAgain.value.items
  });

  const report = {
    schemaVersion: 'dnd-combat-import-v2-phase08-phb-migration-report.v1',
    source: {
      asset: sourceRelative,
      templateVersion: raw.templateVersion,
      packId: raw.id,
      bytes: Buffer.byteLength(rawText, 'utf8'),
      sha256: sourceSha256,
      itemCount: raw.items.length,
      byKind: sourceKinds
    },
    target: {
      asset: targetRelative,
      templateVersion: canonicalPack.templateVersion,
      packId: canonicalPack.id,
      bytes: Buffer.byteLength(targetText, 'utf8'),
      sha256: targetSha256,
      canonicalPackHash: formalPackHash,
      itemCount: canonicalPack.items.length,
      byKind: targetKinds
    },
    preservation: {
      ids: {
        preserved: sourceIds.length - missingIds.length,
        missingIds,
        unexpectedIds
      },
      kinds: {
        preserved: sourceIds.length - kindMismatches.length,
        mismatchedItemIds: kindMismatches
      },
      names: {
        preserved: sourceIds.length - nameMismatches.length,
        mismatchedItemIds: nameMismatches
      },
      itemSourceIds: {
        preserved: sourceIds.length - sourceIdMismatches.length,
        mismatchedItemIds: sourceIdMismatches
      },
      semanticItemHashes: {
        preserved: sourceIds.length - semanticHashMismatches.length,
        mismatchedItemIds: semanticHashMismatches
      },
      legacyItemProvenance: {
        sourceEntries: legacyItemMetaCount,
        preservedEntries: preservedItemMetaCount,
        mismatchedItemIds: provenanceMismatches
      },
      legacyEnvelopeExtensionsMovedToMetadata: [
        ...(raw.extractionInstructions !== undefined ? ['extractionInstructions'] : []),
        ...(raw.consolidationMeta !== undefined ? ['consolidationMeta'] : [])
      ]
    },
    validation: {
      migrationNormalizationIssues: migrationIssueCounts,
      canonicalRenormalizationIssues: normalizationIssueCounts,
      semanticIssues: semanticIssueCounts,
      semanticValid: semantic.valid
    },
    invariant: {
      topLevelLegacyExtensionsRemoved: canonicalPack.extractionInstructions === undefined && canonicalPack.consolidationMeta === undefined,
      deterministicArtifact: true,
      existingV1AssetPreserved: true,
      runtimeBootstrapSwitched: false
    }
  };

  const pass =
    canonicalPack.templateVersion === 'dnd-combat-import.v2' &&
    raw.items.length === 1284 &&
    canonicalPack.items.length === 1284 &&
    Object.keys(sourceKinds).length === 13 &&
    JSON.stringify(sourceKinds) === JSON.stringify(targetKinds) &&
    missingIds.length === 0 &&
    unexpectedIds.length === 0 &&
    kindMismatches.length === 0 &&
    nameMismatches.length === 0 &&
    sourceIdMismatches.length === 0 &&
    semanticHashMismatches.length === 0 &&
    legacyItemMetaCount === 1284 &&
    preservedItemMetaCount === 1284 &&
    provenanceMismatches.length === 0 &&
    semantic.errors.length === 0 &&
    semantic.warnings.length === 0 &&
    normalizedAgain.issues.every((entry) => entry.severity !== 'error') &&
    report.invariant.topLevelLegacyExtensionsRemoved;

  const reportText = stablePrettyJson(report);

  if (checkOnly) {
    const checks = [
      [targetPath, targetText, 'canonical V2 asset'],
      [checksumPath, checksumText, 'canonical V2 checksum'],
      [reportPath, reportText, 'Phase 08 migration report']
    ];
    const drift = [];
    for (const [filePath, expected, label] of checks) {
      if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== expected) drift.push(label);
    }
    if (drift.length) {
      console.error(`[compendium:import-v2:phb:check] FAIL drift=${drift.join(', ')}`);
      process.exit(1);
    }
  } else {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(targetPath, targetText);
    fs.writeFileSync(checksumPath, checksumText);
    fs.writeFileSync(reportPath, reportText);
  }

  console.log(`[compendium:import-v2:phb:${checkOnly ? 'check' : 'migrate'}] ${pass ? 'PASS' : 'FAIL'}`);
  console.log(`items=${canonicalPack.items.length} kinds=${Object.keys(targetKinds).length}`);
  console.log(`semantic errors=${semantic.errors.length} warnings=${semantic.warnings.length} infos=${semantic.infos.length}`);
  console.log(`ids=${sourceIds.length - missingIds.length}/${sourceIds.length} provenance=${preservedItemMetaCount}/${legacyItemMetaCount} semanticHashes=${sourceIds.length - semanticHashMismatches.length}/${sourceIds.length}`);
  console.log(`target=${targetRelative}`);
  console.log(`sha256=${targetSha256}`);
  console.log(`report=${reportRelative}`);
  if (!pass) process.exit(1);
} finally {
  fs.rmSync(runtime.tempRoot, { recursive: true, force: true });
}
