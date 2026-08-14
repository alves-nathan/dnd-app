#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const assetDirectory = path.join(root, 'assets', 'compendium');
const expectedPacks = [
  {
    fileName: 'phb-2024-full-consolidated-import-pack-v2-canonical.json',
    id: 'phb-2024-full-consolidated-import-pack-v5-complete-invocations',
    minimumItems: 1284,
    templateVersion: 'dnd-combat-import.v2'
  },
  {
    fileName: 'mm-2024-runtime-dependency-delta-v2-canonical.json',
    id: 'mm-2024-runtime-dependency-delta-v1',
    minimumItems: 2,
    templateVersion: 'dnd-combat-import.v2'
  },
  {
    fileName: 'forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json',
    id: 'forge-artificer-2025-full-consolidated-import-pack-v1',
    minimumItems: 200,
    templateVersion: 'dnd-combat-import.v2'
  },
  {
    fileName: 'spelljammer-2022-2024-compatible-import-pack-v2-canonical.json',
    id: 'spelljammer-2022-full-consolidated-import-pack-v1',
    minimumItems: 182,
    templateVersion: 'dnd-combat-import.v2'
  },
  {
    fileName: 'tcoe-2020-2024-compatible-import-pack-v2-canonical.json',
    id: 'tcoe-2020-2024-compatible-import-pack-v2',
    minimumItems: 273,
    templateVersion: 'dnd-combat-import.v2'
  },
  {
    fileName: 'phb-2014-2024-compatible-delta-v2-canonical.json',
    id: 'phb-2014-2024-compatible-delta-v1',
    minimumItems: 56,
    templateVersion: 'dnd-combat-import.v2'
  }
];
const allowedKinds = new Set(['class','subclass','species','background','feat','weapon','armor','equipment','magicItem','spell','feature','condition','creatureStatBlock']);
const errors = [];
const summaries = [];
const globalIds = new Map();
for (const expected of expectedPacks) {
  const filePath = path.join(assetDirectory, expected.fileName);
  if (!fs.existsSync(filePath)) { errors.push(`Arquivo empacotado ausente: ${expected.fileName}`); continue; }
  let pack;
  try { pack = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { errors.push(`JSON inválido em ${expected.fileName}: ${error.message}`); continue; }
  if (pack.id !== expected.id) errors.push(`${expected.fileName}: id "${pack.id}" diferente de "${expected.id}".`);
  if (pack.templateVersion !== expected.templateVersion) errors.push(`${expected.fileName}: templateVersion "${pack.templateVersion}" diferente de "${expected.templateVersion}".`);
  if (!pack.source || typeof pack.source.id !== 'string' || !pack.source.id) errors.push(`${expected.fileName}: source.id ausente.`);
  if (!Array.isArray(pack.items)) { errors.push(`${expected.fileName}: items não é um array.`); continue; }
  if (pack.items.length < expected.minimumItems) errors.push(`${expected.fileName}: esperado ao menos ${expected.minimumItems} itens; encontrado ${pack.items.length}.`);
  const seenIds = new Set();
  const kindCounts = new Map();
  for (const [index, item] of pack.items.entries()) {
    if (!item || typeof item !== 'object') { errors.push(`${expected.fileName}: item ${index} inválido.`); continue; }
    if (typeof item.id !== 'string' || !item.id) errors.push(`${expected.fileName}: item ${index} sem id.`);
    else if (seenIds.has(item.id)) errors.push(`${expected.fileName}: id duplicado ${item.id}.`);
    else {
      seenIds.add(item.id);
      const previousPack = globalIds.get(item.id);
      if (previousPack) errors.push(`${expected.fileName}: id ${item.id} também existe em ${previousPack}.`);
      else globalIds.set(item.id, expected.fileName);
    }
    if (!allowedKinds.has(item.kind)) errors.push(`${expected.fileName}: kind não suportado "${item.kind}" no item ${item.id ?? index}.`);
    if (typeof item.name !== 'string' || !item.name) errors.push(`${expected.fileName}: item ${item.id ?? index} sem name.`);
    if (!item.source || typeof item.source.id !== 'string' || !item.source.id) errors.push(`${expected.fileName}: item ${item.id ?? index} sem source.id.`);
    if (!item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)) errors.push(`${expected.fileName}: item ${item.id ?? index} sem payload de objeto.`);
    kindCounts.set(item.kind, (kindCounts.get(item.kind) ?? 0) + 1);
  }
  summaries.push({ fileName: expected.fileName, id: pack.id, items: pack.items.length, uniqueIds: seenIds.size, kinds: Object.fromEntries([...kindCounts.entries()].sort(([a],[b]) => a.localeCompare(b))) });
}
if (errors.length) { console.error('Bundled compendium validation failed:'); errors.forEach((error) => console.error(`- ${error}`)); process.exit(1); }
for (const summary of summaries) {
  console.log(`Bundled compendium OK: ${summary.fileName}`);
  console.log(`- pack: ${summary.id}`);
  console.log(`- items: ${summary.items} (${summary.uniqueIds} IDs únicos)`);
  console.log(`- kinds: ${JSON.stringify(summary.kinds)}`);
}
