#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const sourcePath = path.join(root, 'artifacts', 'compendium', 'integration', 'v2', 'spelljammer-2022-full-consolidated-import-pack-v2-canonical.json');
const phbPath = path.join(root, 'assets', 'compendium', 'phb-2024-full-consolidated-import-pack-v2-canonical.json');
const mm2024Path = path.join(root, 'assets', 'compendium', 'mm-2024-runtime-dependency-delta-v2-canonical.json');
const targetPath = path.join(root, 'assets', 'compendium', 'spelljammer-2022-2024-compatible-import-pack-v2-canonical.json');
const checksumPath = `${targetPath}.sha256`;
const reportPath = path.join(root, 'artifacts', 'compendium', 'integration', 'spelljammer-2024-compatibility-report.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const pretty = (v) => `${JSON.stringify(v, null, 2)}\n`;
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const clone = (v) => JSON.parse(JSON.stringify(v));

const source = readJson(sourcePath);
const phb = readJson(phbPath);
const mm2024 = readJson(mm2024Path);
const phbIds = new Set(phb.items.map((item) => item.id));
const mm2024Ids = new Set(mm2024.items.map((item) => item.id));
const aliases = new Map();
const explicitAliases = new Map([
  ['phb-2014-spell-tenser-s-floating-disk', 'phb-2024-spell-tensers-floating-disk'],
  ['mm-2014-creature-flumph', 'mm-2024-creature-flumph'],
  ['mm-2014-creature-mage', 'mm-2024-creature-mage']
]);

const visitStrings = (value, cb, pathParts = []) => {
  if (typeof value === 'string') { cb(value, pathParts); return; }
  if (Array.isArray(value)) { value.forEach((entry, index) => visitStrings(entry, cb, [...pathParts, index])); return; }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) visitStrings(entry, cb, [...pathParts, key]);
  }
};

const legacyPhbRefs = new Set();
visitStrings(source.items, (value) => {
  if (value.startsWith('phb-2014-')) legacyPhbRefs.add(value);
});

for (const legacyId of [...legacyPhbRefs].sort()) {
  const explicit = explicitAliases.get(legacyId);
  const candidate = explicit ?? `phb-2024-${legacyId.slice('phb-2014-'.length)}`;
  if (!phbIds.has(candidate)) throw new Error(`Spelljammer compatibility mapping has no PHB 2024 target for ${legacyId} (candidate ${candidate}).`);
  aliases.set(legacyId, candidate);
}

const legacyMonsterRefs = new Set();
visitStrings(source.items, (value) => {
  if (value === 'mm-2014-creature-flumph' || value === 'mm-2014-creature-mage') legacyMonsterRefs.add(value);
});
for (const legacyId of [...legacyMonsterRefs].sort()) {
  const candidate = explicitAliases.get(legacyId);
  if (!candidate || !mm2024Ids.has(candidate)) throw new Error(`Spelljammer compatibility mapping has no MM 2024 target for ${legacyId}.`);
  aliases.set(legacyId, candidate);
}

let rewrittenOccurrences = 0;
const rewrite = (value) => {
  if (typeof value === 'string') {
    if (aliases.has(value)) { rewrittenOccurrences += 1; return aliases.get(value); }
    return value;
  }
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const rewrittenKey = aliases.get(key) ?? key;
      out[rewrittenKey] = rewrite(entry);
    }
    return out;
  }
  return value;
};

const compatible = clone(source);
compatible.items = compatible.items.map((item) => rewrite(item));
compatible.source = {
  ...compatible.source,
  notes: `${compatible.source?.notes ?? ''} Runtime projection for the 2024-first + legacy profile: PHB 2014 spell/feat references are resolved to PHB 2024 entities while Spelljammer-owned mechanics remain legacy 2022.`.trim()
};

const allIds = new Set([...phb.items.map((item) => item.id), ...mm2024.items.map((item) => item.id), ...compatible.items.map((item) => item.id)]);
const residual = [];
visitStrings(compatible.items, (value, pathParts) => {
  if (/^(phb-2014|dmg-2014|mm-2014|xgte-2017)-/.test(value) && !allIds.has(value)) residual.push({ referenceId: value, path: pathParts.join('.') });
});
const residualUnique = [...new Set(residual.map((entry) => entry.referenceId))].sort();
const residualBySource = residualUnique.reduce((acc, id) => {
  const key = id.startsWith('mm-2014-') ? 'mm2014'
    : id.startsWith('dmg-2014-') ? 'dmg2014'
    : id.startsWith('xgte-2017-') ? 'xgte2017'
    : id.startsWith('phb-2014-') ? 'phb2014'
    : 'other';
  (acc[key] ??= []).push(id);
  return acc;
}, {});

compatible.metadata = {
  ...(compatible.metadata ?? {}),
  edition: '2024+legacy',
  extractionScope: '2024-first-legacy-compatibility-projection',
  compatibility: {
    ...((compatible.metadata ?? {}).compatibility ?? {}),
    profile: '2024-first+legacy',
    derivedFromPackId: source.id,
    targetCorePackId: phb.id,
    policy: [
      'Spelljammer-owned mechanics remain the 2022 legacy rules unless a later source explicitly replaces them.',
      'PHB 2014 spell and feat references resolve to the installed PHB 2024 entities.',
      'Runtime-required Mage and Flumph base-creature references are resolved to the minimal current Monster Manual delta.',
      'Other Monster Manual references remain legacy only when they are display/context references rather than executable dependencies.'
    ],
    phb2014ReferencesRewritten: legacyPhbRefs.size,
    mm2014RuntimeReferencesRewritten: legacyMonsterRefs.size,
    rewrittenOccurrences
  },
  references: {
    ...((compatible.metadata ?? {}).references ?? {}),
    externalUniqueEntityIds: residualUnique.length,
    externalUniqueBySource: Object.fromEntries(Object.entries(residualBySource).map(([key, values]) => [key, values.length]))
  },
  externalDependencies: {
    policy: 'PHB 2014 spell/feat references are resolved to PHB 2024. Runtime-required Mage/Flumph references resolve to the bundled minimal MM 2024 delta; residual MM 2014 references are display/context only.',
    ...residualBySource
  }
};

const remainingPhb2014 = residualUnique.filter((id) => id.startsWith('phb-2014-'));
if (remainingPhb2014.length) throw new Error(`Spelljammer compatibility projection still has PHB 2014 references: ${remainingPhb2014.join(', ')}`);

const outputText = pretty(compatible);
const digest = sha256(outputText);
const checksumText = `${digest}  ${path.basename(targetPath)}\n`;
const report = {
  schemaVersion: 'dnd-combat-spelljammer-2024-compatibility-report.v1',
  sourcePackId: source.id,
  outputPackId: compatible.id,
  itemCount: compatible.items.length,
  legacyPhbUniqueReferences: legacyPhbRefs.size,
  legacyMmRuntimeUniqueReferences: legacyMonsterRefs.size,
  rewrittenOccurrences,
  aliases: [...aliases.entries()].map(([from, to]) => ({ from, to })).sort((a, b) => a.from.localeCompare(b.from)),
  residualExternalDependencies: residualBySource,
  sha256: digest
};

if (checkOnly) {
  if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8') !== outputText) throw new Error('Spelljammer 2024-compatible pack is stale.');
  if (!fs.existsSync(checksumPath) || fs.readFileSync(checksumPath, 'utf8') !== checksumText) throw new Error('Spelljammer 2024-compatible checksum is stale.');
  if (!fs.existsSync(reportPath) || JSON.stringify(readJson(reportPath)) !== JSON.stringify(report)) throw new Error('Spelljammer compatibility report is stale.');
} else {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(targetPath, outputText);
  fs.writeFileSync(checksumPath, checksumText);
  fs.writeFileSync(reportPath, pretty(report));
}

console.log(`PASS: Spelljammer 2022 projected to 2024-first legacy profile; ${legacyPhbRefs.size} PHB 2014 refs and ${legacyMonsterRefs.size} runtime MM 2014 refs mapped to current entities; ${rewrittenOccurrences} occurrences rewritten; ${residualUnique.length} residual external refs remain.`);
