#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const phbPath = path.join(root, 'assets', 'compendium', 'phb-2024-full-consolidated-import-pack-v5-complete-invocations.json');
const outputPath = path.join(root, 'artifacts', 'compendium-import-v2-domain-audit.json');

const walk = (directory, filter) => {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walk(absolute, filter));
    else if (filter(absolute)) results.push(absolute);
  }
  return results;
};

const sourceFiles = [path.join(root, 'src'), path.join(root, 'app')]
  .filter(fs.existsSync)
  .flatMap((directory) => walk(directory, (file) => /\.(ts|tsx)$/.test(file)));

const relative = (file) => path.relative(root, file).replaceAll('\\', '/');
const payloadAccessFiles = [];
const importDomainFiles = new Set();
const zodSchemaFiles = [];

for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const payloadMatches = text.match(/(?:\.payload\b|\bpayload\s*:|normalizedJson\b|rawJson\b)/g) ?? [];
  if (payloadMatches.length) payloadAccessFiles.push({ file: relative(file), occurrences: payloadMatches.length });
  if (/compendium|character|spell|equipment|background|progression|rules-engine|catalog/i.test(file)) importDomainFiles.add(relative(file));
  if (/from ['"]zod['"]/.test(text) || /z\.(?:object|union|discriminatedUnion|enum)\(/.test(text)) zodSchemaFiles.push(relative(file));
}

const pack = JSON.parse(fs.readFileSync(phbPath, 'utf8'));
const countsByKind = {};
const payloadKeysByKind = {};
const payloadValueSamplesByKind = {};
for (const item of pack.items ?? []) {
  countsByKind[item.kind] = (countsByKind[item.kind] ?? 0) + 1;
  payloadKeysByKind[item.kind] ??= {};
  payloadValueSamplesByKind[item.kind] ??= {};
  for (const [key, value] of Object.entries(item.payload ?? {})) {
    payloadKeysByKind[item.kind][key] = (payloadKeysByKind[item.kind][key] ?? 0) + 1;
    if (!(key in payloadValueSamplesByKind[item.kind])) {
      payloadValueSamplesByKind[item.kind][key] = value;
    }
  }
}

const currentSchema = fs.readFileSync(path.join(root, 'src', 'compendium', 'schemas.ts'), 'utf8');
const currentTemplate = fs.readFileSync(path.join(root, 'src', 'compendium', 'importTemplate.ts'), 'utf8');
const currentTypes = fs.readFileSync(path.join(root, 'src', 'types', 'index.ts'), 'utf8');

const report = {
  generatedAt: new Date().toISOString(),
  baseline: 'BUGFIX-011 custom background',
  promptTarget: 'dnd-combat-import.v2',
  currentImportModel: {
    templateVersion: /STANDARD_IMPORT_TEMPLATE_VERSION\s*=\s*['"]([^'"]+)/.exec(currentTemplate)?.[1] ?? 'unknown',
    payloadIsGenericRecord: /payload:\s*z\.record\(z\.string\(\),\s*z\.unknown\(\)\)/.test(currentSchema),
    zodSchemaFiles: zodSchemaFiles.sort(),
    runtimeDefinesCanonicalAbilityScore: /export type AbilityScore\s*=/.test(currentTypes),
    runtimeDefinesCanonicalActionCost: /export type ActionCost\s*=/.test(currentTypes),
    runtimeDefinesDamageFormula: /export interface DamageFormula\s*{/.test(currentTypes),
    runtimeDefinesSpellScalingRule: /export interface SpellScalingRule\s*{/.test(currentTypes),
    runtimeDefinesActiveEffectTemplate: /export interface ActiveEffectTemplate\s*{/.test(currentTypes)
  },
  phb2024: {
    path: relative(phbPath),
    templateVersion: pack.templateVersion,
    itemCount: (pack.items ?? []).length,
    countsByKind,
    payloadKeysByKind,
    payloadValueSamplesByKind
  },
  codeUsage: {
    typescriptFileCount: sourceFiles.length,
    payloadAccessFileCount: payloadAccessFiles.length,
    payloadAccessFiles: payloadAccessFiles.sort((a, b) => b.occurrences - a.occurrences || a.file.localeCompare(b.file)),
    domainCandidateFiles: Array.from(importDomainFiles).sort()
  },
  findings: [
    'O schema atual valida payload como Record<string, unknown>, enquanto o runtime já possui vários tipos canônicos reutilizáveis.',
    'O templateVersion v1 existe no template/pacote, mas o schema atual de envelope não o exige explicitamente.',
    'O PHB 2024 já contém estruturas mais ricas que o template v1 documenta, especialmente progression, spellcasting, resources, equipmentOptions, mechanics e creature stat blocks.',
    'Há valores importados que não coincidem com enums runtime (por exemplo actionCost passive/magicAction e abilities compostas como STR_OR_DEX), exigindo normalização explícita antes do modelo canônico V2.',
    'Preço ainda aparece principalmente como string no pacote atual, embora custom background faça cálculo monetário; V2 deve promover CurrencyValue estruturado mantendo compatibilidade de migração.',
    'O domínio de personagens e rules-engine usa payload genérico em alguns adaptadores; a refatoração deve ser incremental para não quebrar dados existentes.'
  ]
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(`[compendium-import-v2:audit] PASS -> ${relative(outputPath)}`);
console.log(`items=${report.phb2024.itemCount}`);
console.log(`kinds=${Object.keys(countsByKind).length}`);
console.log(`payloadAccessFiles=${payloadAccessFiles.length}`);
