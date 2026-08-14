#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'assets', 'compendium', 'phb-2024-full-consolidated-import-pack-v5-complete-invocations.json');
const output = path.join(root, 'artifacts', 'compendium-import-v2-phase03-semantic-report.json');

const loadTypeScript = () => {
  for (const candidate of [
    'typescript',
    '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js',
    '/usr/local/lib/node_modules/typescript/lib/typescript.js'
  ]) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado para executar a auditoria semântica V2.');
};

const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-import-v2-semantic-'));
const tempCompendium = path.join(tempRoot, 'src', 'compendium');
fs.mkdirSync(tempCompendium, { recursive: true });

const transpile = (fileName) => {
  const input = path.join(root, 'src', 'compendium', fileName);
  const source = fs.readFileSync(input, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: input,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    }
  });
  fs.writeFileSync(path.join(tempCompendium, fileName.replace(/\.ts$/, '.js')), result.outputText);
};

for (const fileName of [
  'importVersions.ts',
  'importDomain.ts',
  'importNormalization.ts',
  'importV1Migration.ts',
  'importSemanticValidation.ts'
]) transpile(fileName);

const { migrateImportV1ToV2 } = require(path.join(tempCompendium, 'importV1Migration.js'));
const { analyzeCompendiumImportV2Semantics } = require(path.join(tempCompendium, 'importSemanticValidation.js'));

const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const migrated = migrateImportV1ToV2(raw, {
  originalEnvelope: raw,
  detectedLegacyVersion: 'dnd-combat-import.v1'
});

if (!migrated.value) {
  console.error('[compendium:import-v2:semantic-audit] FAIL: migration returned no canonical pack.');
  process.exit(1);
}

const semantic = analyzeCompendiumImportV2Semantics(migrated.value);
const byKind = {};
for (const item of migrated.value.items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
const normalizationIssueCounts = {};
for (const issue of migrated.issues) normalizationIssueCounts[issue.severity] = (normalizationIssueCounts[issue.severity] ?? 0) + 1;

const report = {
  schemaVersion: 'dnd-combat-import-v2-phase03-semantic-audit.v1',
  sourcePack: raw.id,
  canonicalTemplateVersion: migrated.value.templateVersion,
  items: migrated.value.items.length,
  uniqueIds: new Set(migrated.value.items.map((item) => item.id)).size,
  byKind,
  normalizationIssueCounts,
  semantic: semantic.summary,
  semanticIssues: semantic.issues.map(({ severity, code, message, itemId, itemKind, path: issuePath, relatedId }) => ({
    severity,
    code,
    message,
    itemId,
    itemKind,
    path: issuePath,
    relatedId
  }))
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });

console.log('[compendium:import-v2:semantic-audit] ' + (semantic.valid ? 'PASS' : 'FAIL'));
console.log(`items=${report.items} uniqueIds=${report.uniqueIds}`);
console.log(`semantic errors=${semantic.errors.length} warnings=${semantic.warnings.length} info=${semantic.infos.length}`);
console.log(`report=${path.relative(root, output)}`);

if (!semantic.valid) {
  for (const issue of semantic.errors.slice(0, 25)) {
    console.error(`- ${issue.code} ${issue.itemId ?? ''} ${issue.path ?? ''}: ${issue.message}`.trim());
  }
  process.exit(1);
}
