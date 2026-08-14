#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'artifacts', 'compendium', 'integration', 'source-v1');
const targetRoot = path.join(root, 'artifacts', 'compendium', 'integration', 'v2');
const reportPath = path.join(root, 'artifacts', 'compendium', 'integration', 'stage-report.json');
const checkOnly = process.argv.includes('--check');

const configs = [
  {
    label: 'Forge of the Artificer 2025',
    source: 'forge-artificer-2025-full-consolidated-import-pack-v1.json',
    target: 'forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json',
    runtimeTarget: 'assets/compendium/forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json'
  },
  {
    label: 'Spelljammer: Adventures in Space 2022',
    source: 'spelljammer-2022-full-consolidated-import-pack-v1.json',
    target: 'spelljammer-2022-full-consolidated-import-pack-v2-canonical.json'
  },
  {
    label: "Tasha's Cauldron of Everything 2020",
    source: 'tcoe-2020-full-consolidated-import-pack-v1.json',
    target: 'tcoe-2020-full-consolidated-import-pack-v2-canonical.json'
  }
];

const loadTypeScript = () => {
  for (const candidate of [
    'typescript',
    '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js',
    '/usr/local/lib/node_modules/typescript/lib/typescript.js'
  ]) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado para executar a migração canônica dos packs extraídos.');
};

const ts = loadTypeScript();
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    }
  });
  module._compile(result.outputText, filename);
};

const { migrateImportV1ToV2 } = require(path.join(root, 'src', 'compendium', 'importV1Migration.ts'));
const { normalizeCompendiumImportPack } = require(path.join(root, 'src', 'compendium', 'importNormalization.ts'));
const { createImportContentHash } = require(path.join(root, 'src', 'compendium', 'importContentHash.ts'));

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;
const issueSummary = (issues) => issues.reduce((acc, entry) => {
  const key = `${entry.severity}:${entry.code}`;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const replaceExactStrings = (value, aliases, counter) => {
  if (typeof value === 'string') {
    if (aliases[value]) { counter.count += 1; return aliases[value]; }
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => replaceExactStrings(entry, aliases, counter));
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) value[key] = replaceExactStrings(entry, aliases, counter);
  }
  return value;
};

const applyKnownExtractionCorrections = (config, canonical) => {
  const corrections = [];
  if (config.source.startsWith('forge-artificer-2025-')) {
    const counter = { count: 0 };
    replaceExactStrings(canonical, {
      'phb-2024-spell-hunters-mark': 'phb-2024-spell-hunter-s-mark'
    }, counter);
    if (counter.count) corrections.push({
      code: 'FORGE_HUNTERS_MARK_CANONICAL_ID',
      count: counter.count,
      evidence: 'PHB 2024 bundled spell entity uses phb-2024-spell-hunter-s-mark.'
    });
  }

  if (config.source.startsWith('spelljammer-2022-')) {
    const psurlon = canonical.items.find((item) => item.id === 'spelljammer-2022-creature-psurlon');
    if (psurlon) {
      const expected = [
        'phb-2014-spell-disguise-self',
        'phb-2014-spell-mage-armor',
        'phb-2014-spell-suggestion'
      ];
      const current = psurlon.payload?.mechanics?.spellRefs;
      if (JSON.stringify(current) !== JSON.stringify(expected)) {
        psurlon.payload.mechanics = { ...(psurlon.payload.mechanics || {}), spellRefs: expected };
        corrections.push({
          code: 'SPELLJAMMER_PSURLON_SPELLREF_OCR_REPAIR',
          count: 1,
          evidence: 'Boo’s Astral Menagerie p.44: Psurlon casts disguise self and mage armor 2/day each, suggestion 1/day.'
        });
      }
    }

    const commander = canonical.items.find((item) => item.id === 'spelljammer-2022-creature-astral-elf-commander');
    if (commander) {
      let changed = false;
      for (const action of commander.payload?.actions || []) {
        for (const group of action.spellcasting?.groups || []) {
          if ((group.spellRefs || []).some((id) => id === 'phb-2014-spell-teleport-t-ee-astral-elves')) {
            group.spells = ['teleport'];
            group.spellRefs = ['phb-2014-spell-teleport'];
            changed = true;
          }
        }
      }
      if ((commander.payload?.mechanics?.spellRefs || []).includes('phb-2014-spell-teleport-t-ee-astral-elves')) {
        commander.payload.mechanics.spellRefs = ['phb-2014-spell-teleport'];
        changed = true;
      }
      if (changed) corrections.push({
        code: 'SPELLJAMMER_ASTRAL_ELF_COMMANDER_TELEPORT_OCR_REPAIR',
        count: 1,
        evidence: 'Boo’s Astral Menagerie p.12: Astral Elf Commander Spellcasting is 2/day: teleport.'
      });
    }
  }
  return corrections;
};

fs.mkdirSync(targetRoot, { recursive: true });
const report = {
  schemaVersion: 'dnd-combat-extracted-book-v2-stage-report.v1',
  generatedAt: new Date().toISOString(),
  packs: []
};

for (const config of configs) {
  const sourcePath = path.join(sourceRoot, config.source);
  const targetPath = path.join(targetRoot, config.target);
  const checksumPath = `${targetPath}.sha256`;
  const rawText = fs.readFileSync(sourcePath, 'utf8');
  const raw = JSON.parse(rawText);
  const migrated = migrateImportV1ToV2(raw, {
    originalEnvelope: raw,
    detectedLegacyVersion: raw.templateVersion || 'legacy-unversioned'
  });
  if (!migrated.value) throw new Error(`${config.label}: a migração V1 -> V2 não produziu pacote.`);

  const migratedCanonical = migrated.value;
  const extractionCorrections = applyKnownExtractionCorrections(config, migratedCanonical);
  const renormalized = normalizeCompendiumImportPack(migratedCanonical);
  if (!renormalized.value) throw new Error(`${config.label}: pacote V2 não sobreviveu à renormalização.`);
  const errors = renormalized.issues.filter((entry) => entry.severity === 'error');
  if (errors.length) throw new Error(`${config.label}: ${errors.length} erro(s) na renormalização V2.`);
  const canonical = renormalized.value;

  const text = pretty(canonical);
  const digest = sha256(text);
  const checksum = `${digest}  ${config.target}\n`;

  if (checkOnly) {
    if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8') !== text) {
      throw new Error(`${config.target} está desatualizado; execute npm run compendium:books:stage.`);
    }
    if (!fs.existsSync(checksumPath) || fs.readFileSync(checksumPath, 'utf8') !== checksum) {
      throw new Error(`${path.basename(checksumPath)} está desatualizado.`);
    }
    if (config.runtimeTarget) {
      const runtimePath = path.join(root, config.runtimeTarget);
      const runtimeChecksumPath = `${runtimePath}.sha256`;
      if (!fs.existsSync(runtimePath) || fs.readFileSync(runtimePath, 'utf8') !== text) {
        throw new Error(`${config.runtimeTarget} está desatualizado; execute npm run compendium:books:stage.`);
      }
      if (!fs.existsSync(runtimeChecksumPath) || fs.readFileSync(runtimeChecksumPath, 'utf8') !== checksum) {
        throw new Error(`${path.relative(root, runtimeChecksumPath)} está desatualizado.`);
      }
    }
  } else {
    fs.writeFileSync(targetPath, text);
    fs.writeFileSync(checksumPath, checksum);
    if (config.runtimeTarget) {
      const runtimePath = path.join(root, config.runtimeTarget);
      fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
      fs.writeFileSync(runtimePath, text);
      fs.writeFileSync(`${runtimePath}.sha256`, checksum);
    }
  }

  report.packs.push({
    label: config.label,
    source: path.relative(root, sourcePath),
    target: path.relative(root, targetPath),
    sourceTemplateVersion: raw.templateVersion,
    targetTemplateVersion: canonical.templateVersion,
    itemCount: canonical.items.length,
    sourceSha256: sha256(rawText),
    targetSha256: digest,
    canonicalContentHash: createImportContentHash({ id: canonical.id, source: canonical.source, items: canonical.items }),
    migrationIssues: issueSummary(migrated.issues),
    renormalizationIssues: issueSummary(renormalized.issues),
    invalidResourcesDropped: migrated.issues.filter((entry) => entry.code === 'IMPORT_INVALID_RESOURCE').length,
    generatedResourceIds: migrated.issues.filter((entry) => entry.code === 'IMPORT_GENERATED_RESOURCE_ID').length,
    extractionCorrections
  });
}

const reportText = pretty(report);
if (checkOnly) {
  if (!fs.existsSync(reportPath)) throw new Error('stage-report.json ausente.');
  // generatedAt intentionally changes, so compare the stable payload only.
  const existing = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (JSON.stringify(existing.packs) !== JSON.stringify(report.packs)) {
    throw new Error('stage-report.json está desatualizado.');
  }
} else {
  fs.writeFileSync(reportPath, reportText);
}

console.log(`PASS: ${report.packs.length} packs V1 migrados para V2 canônico; ${report.packs.reduce((sum, pack) => sum + pack.itemCount, 0)} itens.`);
