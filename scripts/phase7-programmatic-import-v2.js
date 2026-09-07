#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = process.cwd();
const validationRoot = path.join(root, '.validation');
const fixedRoot = path.join(validationRoot, 'phase7-fixed');
const publicDir = path.join(root, 'public');
const artifactsDir = path.join(root, 'artifacts');
const snapshotOut = path.join(publicDir, 'phase7-validation-snapshot.json');
const seedHtmlOut = path.join(publicDir, 'phase7-seed.html');
const reportOut = path.join(artifactsDir, 'phase7-programmatic-import-report-v2.json');
const repairReportOut = path.join(artifactsDir, 'phase7-schema-repair-report-v1.json');
const repairOnly = process.argv.includes('--repair-only');

const phase7Files = [
  'phase7b/packs-v2/xgte-2017-2024-compatible-import-pack-v2-canonical.json',
  'phase7b/packs-v2/mtof-2018-2024-compatible-import-pack-v2-canonical.json',
  'phase7b/packs-v2/eberron-rising-2019-2024-compatible-import-pack-v2-canonical.json',
  'phase7b/packs-v2/egtw-2020-2024-compatible-import-pack-v2-canonical.json',
  'phase7b/packs-v2/one-grung-above-2017-2024-compatible-import-pack-v2-canonical.json',
  'phase7b/packs-v2/hold-back-the-dead-2025-2024-compatible-import-pack-v2-canonical.json',
  'phase7b/packs-v2/malady-of-minarrh-2024-compatible-import-pack-v2-canonical.json',
  'phase7b/packs-v2/spelljammer-academy-2022-2024-compatible-import-pack-v2-canonical.json',
  'phase7b/packs-v2/welcome-to-hellfire-club-2025-2024-compatible-import-pack-v2-canonical.json',
  'phase7b/packs-v2/bomt-2023-2024-compatible-import-pack-v2-canonical.json',
  'phase7b/deltas-v2/spelljammer-2022-giff-shipmate-canonical-correction-import-pack-v2-canonical.json',
  'phase7c/packs-v2/mm-2014-phase7c-runtime-dependency-delta-v2-canonical.json',
  'phase7c/packs-v2/dmg-2014-phase7c-runtime-dependency-delta-v2-canonical.json',
  'phase7c/packs-v2/phb-2014-phase7c-runtime-dependency-delta-v2-canonical.json'
];

const baselineFiles = [
  'phb-2024-full-consolidated-import-pack-v2-canonical.json',
  'mm-2024-runtime-dependency-delta-v2-canonical.json',
  'forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json',
  'spelljammer-2022-2024-compatible-import-pack-v2-canonical.json',
  'tcoe-2020-2024-compatible-import-pack-v2-canonical.json',
  'phb-2014-2024-compatible-delta-v2-canonical.json'
].map((name) => path.join(root, 'assets/compendium', name));

const sourceVerifiedCreatureCore = new Map([
  ['eberron-rising-2019-creature-stat-block-dyrrn', { size: 'Medium', creatureType: 'aberration', alignment: 'chaotic evil' }],
  ['eberron-rising-2019-creature-stat-block-dolgrim', { size: 'Small', creatureType: 'aberration', alignment: 'chaotic evil' }],
  ['eberron-rising-2019-creature-stat-block-valenar-hawk', { size: 'Tiny', creatureType: 'fey', alignment: 'neutral' }],
  ['eberron-rising-2019-creature-stat-block-valenar-hound', { size: 'Medium', creatureType: 'fey', alignment: 'neutral' }]
]);

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const requireFile = (file) => {
  if (!fs.existsSync(file)) throw new Error(`Arquivo ausente: ${path.relative(root, file)}`);
  return file;
};

const repairs = [];
const repair = (file, item, field, before, after, reason, evidence = 'structural') => {
  repairs.push({
    file: path.relative(root, file),
    itemId: item.id,
    kind: item.kind,
    field,
    before,
    after,
    reason,
    evidence
  });
};

const setField = (file, item, payload, field, value, reason, evidence = 'structural') => {
  const before = payload[field];
  if (JSON.stringify(before) === JSON.stringify(value)) return;
  payload[field] = value;
  repair(file, item, `payload.${field}`, before, value, reason, evidence);
};

const deleteFieldIfNull = (file, item, payload, field, reason = 'V2 optional field cannot be null; omission preserves “unspecified”.') => {
  if (payload[field] !== null) return;
  repair(file, item, `payload.${field}`, null, '<omitted>', reason);
  delete payload[field];
};

const normalizedChoice = (raw, domain) => {
  const record = isRecord(raw) ? raw : {};
  const count = Number.isInteger(record.count) ? record.count : Number.isInteger(record.choose) ? record.choose : 1;
  const category = hasText(record.fromCategory)
    ? record.fromCategory
    : hasText(record.from) && !['skills', 'tools', 'languages', 'weapons', 'armor', 'custom'].includes(record.from)
      ? record.from
      : hasText(record.choice) ? record.choice : undefined;
  return {
    count,
    from: domain,
    ...(Array.isArray(record.options) ? { options: record.options.filter((x) => typeof x === 'string') } : {}),
    ...(category ? { category } : {}),
    original: clone(record)
  };
};

const moveEmbeddedToolChoice = (file, item, payload) => {
  if (!Array.isArray(payload.toolProficiencies)) return;
  const strings = payload.toolProficiencies.filter((x) => typeof x === 'string');
  const choices = payload.toolProficiencies.filter(isRecord);
  if (!choices.length) return;
  setField(file, item, payload, 'toolProficiencies', strings,
    'V2 toolProficiencies accepts concrete tool names only; embedded choice metadata is promoted to toolProficiencyChoice.');
  if (!payload.toolProficiencyChoice) {
    setField(file, item, payload, 'toolProficiencyChoice', normalizedChoice(choices[0], 'tools'),
      'Promoted source-native tool choice to the V2 proficiency-choice shape while preserving the original selector metadata.');
  }
  if (choices.length > 1) {
    payload.legacyAdditionalToolChoices = clone(choices.slice(1));
    repair(file, item, 'payload.legacyAdditionalToolChoices', undefined, payload.legacyAdditionalToolChoices,
      'Preserved additional non-canonical tool-choice metadata without inventing options.');
  }
};

const normalizeBackgroundChoiceShape = (file, item, payload, field, domain) => {
  if (!isRecord(payload[field])) return;
  const current = payload[field];
  const validFrom = ['skills', 'tools', 'languages', 'weapons', 'armor', 'custom'];
  if (Number.isInteger(current.count) && (current.from === undefined || validFrom.includes(current.from))) return;
  setField(file, item, payload, field, normalizedChoice(current, domain),
    `Converted legacy ${field} selector to V2 {count, from} while retaining the source selector in original.`);
};

const sanitizeSpeedForSchema = (speed) => {
  if (!isRecord(speed)) return speed;
  const out = {};
  for (const [mode, value] of Object.entries(speed)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      out[mode] = value;
    } else if (typeof value === 'string' && value.trim()) {
      // The app normalizer will promote this to {value/condition/original} or {formula/original}.
      out[mode] = value;
    } else if (isRecord(value)) {
      out[mode] = clone(value);
    }
    // Boolean flags such as hover stay preserved in payload.mechanics.speed and
    // are intentionally not emitted as movement-speed values, because V2 speed
    // only accepts number or structured movement entries.
  }
  return out;
};

const promoteBomtCreature = (file, item, payload) => {
  const mechanics = isRecord(payload.mechanics) ? payload.mechanics : {};
  const promotable = {
    size: mechanics.size,
    creatureType: mechanics.creatureType,
    alignment: mechanics.alignment,
    armorClass: mechanics.armorClass,
    hitPoints: mechanics.hitPoints,
    speed: mechanics.speed,
    abilities: mechanics.abilities,
    savingThrows: mechanics.savingThrows,
    skills: mechanics.skills,
    senses: mechanics.senses,
    languages: mechanics.languages,
    traits: mechanics.traits,
    actions: mechanics.actions,
    bonusActions: mechanics.bonusActions,
    reactions: mechanics.reactions
  };
  if (payload.challenge === undefined && mechanics.challengeRating !== undefined) {
    promotable.challenge = mechanics.challengeRating;
  }

  for (const [field, value] of Object.entries(promotable)) {
    if (value === undefined || payload[field] !== undefined) continue;
    const promoted = field === 'speed' ? sanitizeSpeedForSchema(value) : clone(value);
    setField(file, item, payload, field, promoted,
      `Promoted existing Book of Many Things stat-block data from payload.mechanics.${field === 'challenge' ? 'challengeRating' : field} to the canonical V2 creature field; source mechanics are unchanged.`);
  }

  // Euryale stores form-dependent size as an object; V2 accepts a string or string array.
  if (isRecord(payload.size)) {
    const originalSize = clone(payload.size);
    const sizes = [...new Set(Object.values(payload.size).filter(hasText))];
    if (sizes.length) {
      setField(file, item, payload, 'size', sizes,
        'Promoted form-dependent source sizes to the V2 size array; exact form mapping is preserved in sizeByForm.');
      payload.sizeByForm = originalSize;
      repair(file, item, 'payload.sizeByForm', undefined, originalSize,
        'Preserved source-native size-to-form mapping as a V2 extension.');
    }
  }

  if (isRecord(payload.speed)) {
    const normalizedSpeed = sanitizeSpeedForSchema(payload.speed);
    if (JSON.stringify(normalizedSpeed) !== JSON.stringify(payload.speed)) {
      setField(file, item, payload, 'speed', normalizedSpeed,
        'Removed non-speed boolean flags from the canonical speed record; original flags remain in source mechanics/extensions.');
    }
  }
};

const repairItem = (file, item) => {
  const payload = isRecord(item.payload) ? item.payload : {};
  item.payload = payload;

  // Null is not a valid value for these optional V2 fields. Omission means “not specified”.
  if (item.kind === 'creatureStatBlock') {
    deleteFieldIfNull(file, item, payload, 'challenge');
    deleteFieldIfNull(file, item, payload, 'proficiencyBonus');
    for (const field of ['abilities', 'abilityScores', 'abilityModifiers']) {
      if (!isRecord(payload[field])) continue;
      const cleaned = Object.fromEntries(Object.entries(payload[field]).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
      if (JSON.stringify(cleaned) !== JSON.stringify(payload[field])) {
        setField(file, item, payload, field, cleaned,
          'V2 ability-score records accept numeric values only; source-omitted/null abilities remain omitted rather than fabricated.');
      }
    }
  }
  if (item.kind === 'magicItem') {
    deleteFieldIfNull(file, item, payload, 'rarity');
    deleteFieldIfNull(file, item, payload, 'weight');
  }
  if (item.kind === 'equipment') deleteFieldIfNull(file, item, payload, 'weight');

  // Source-verified corrections from Eberron: Rising from the Last War.
  const verified = sourceVerifiedCreatureCore.get(item.id);
  if (verified) {
    for (const [field, value] of Object.entries(verified)) {
      if (payload[field] === null || payload[field] === undefined || payload[field] === '') {
        setField(file, item, payload, field, value,
          'Filled a required V2 creature core field from the supplied source stat block.',
          'source-verified');
      }
    }
  }

  // Legacy background selectors embedded in concrete proficiency arrays.
  if (item.kind === 'background') {
    moveEmbeddedToolChoice(file, item, payload);
    normalizeBackgroundChoiceShape(file, item, payload, 'toolProficiencyChoice', 'tools');
    normalizeBackgroundChoiceShape(file, item, payload, 'languageProficiencyChoice', 'languages');
    normalizeBackgroundChoiceShape(file, item, payload, 'skillProficiencyChoice', 'skills');
  }

  if (item.source?.id === 'bomt-2023') {
    if (item.kind === 'magicItem' && typeof payload.attunement === 'string') {
      const requirement = payload.attunement;
      if (payload.attunementRequirement === undefined) {
        payload.attunementRequirement = requirement;
        repair(file, item, 'payload.attunementRequirement', undefined, requirement,
          'Preserved the exact source attunement restriction while canonicalizing the V2 attunement flag.');
      }
      setField(file, item, payload, 'attunement', true,
        'V2 attunement is boolean; the source restriction remains in attunementRequirement/mechanics.');
    }

    if (item.kind === 'spell' && payload.level === undefined && Number.isInteger(payload.spellLevel)) {
      setField(file, item, payload, 'level', payload.spellLevel,
        'Mapped the existing source spellLevel value to the required V2 level field.');
    }

    if (item.kind === 'feature' && !hasText(payload.sourceType)) {
      setField(file, item, payload, 'sourceType', 'campaignRule',
        'V2 requires a non-empty feature sourceType. “campaignRule” is an existing app structural category; no source mechanic is changed.',
        'structural-classification');
    }

    if (item.kind === 'creatureStatBlock') promoteBomtCreature(file, item, payload);
  }
};

const materializeFixedPhase7Packs = () => {
  fs.rmSync(fixedRoot, { recursive: true, force: true });
  fs.mkdirSync(fixedRoot, { recursive: true });
  const outputs = [];
  for (const relative of phase7Files) {
    const sourceFile = requireFile(path.join(validationRoot, relative));
    const rawText = fs.readFileSync(sourceFile, 'utf8');
    const pack = JSON.parse(rawText);
    if (!Array.isArray(pack.items)) throw new Error(`${relative}: items ausente/não-array.`);
    for (const item of pack.items) repairItem(sourceFile, item);
    pack.metadata = {
      ...(isRecord(pack.metadata) ? pack.metadata : {}),
      phase7SchemaRepair: {
        version: 1,
        sourceSha256: sha256(rawText),
        note: 'Structural V2 repair only; source mechanics/provenance retained. Generated for authoritative parse/preview validation.'
      }
    };
    const outFile = path.join(fixedRoot, relative.replace(/^phase7[bc]\//, ''));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const outText = `${JSON.stringify(pack, null, 2)}\n`;
    fs.writeFileSync(outFile, outText);
    outputs.push({ relative, sourceFile, outFile, sourceSha256: sha256(rawText), fixedSha256: sha256(outText), items: pack.items.length });
  }
  return outputs;
};

fs.mkdirSync(artifactsDir, { recursive: true });
const fixedPacks = materializeFixedPhase7Packs();
const repairReport = {
  schemaVersion: 'dnd-combat-math.phase7-schema-repair-report.v1',
  generatedAt: new Date().toISOString(),
  originalPacks: phase7Files.length,
  fixedPacks: fixedPacks.map((entry) => ({
    source: path.relative(root, entry.sourceFile),
    output: path.relative(root, entry.outFile),
    items: entry.items,
    sourceSha256: entry.sourceSha256,
    fixedSha256: entry.fixedSha256
  })),
  repairsCount: repairs.length,
  sourceVerifiedRepairs: repairs.filter((entry) => entry.evidence === 'source-verified').length,
  repairs
};
fs.writeFileSync(repairReportOut, `${JSON.stringify(repairReport, null, 2)}\n`);

console.log(`[phase7:schema-repair] fixedPacks=${fixedPacks.length} repairs=${repairs.length}`);
console.log(`repairReport=${path.relative(root, repairReportOut)}`);
if (repairOnly) {
  console.log('[phase7:schema-repair] REPAIR_ONLY_COMPLETE');
  process.exit(0);
}

const loadTypeScript = () => {
  for (const candidate of [path.join(root, 'node_modules', 'typescript', 'lib', 'typescript.js'), 'typescript']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado. Execute npm install antes deste script.');
};
const ts = loadTypeScript();
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  });
  module._compile(result.outputText, filename);
};

const { parseAndPreviewImportPack } = require(path.join(root, 'src/compendium/parseImportPreview.ts'));
const { createCompendiumImportV2UpsertPlan } = require(path.join(root, 'src/compendium/importUpsertPlan.ts'));
const { applyCompendiumImportV2PlanToSnapshot, existingPreviewItemsFromSnapshot } = require(path.join(root, 'src/storage/compendiumV2Persistence.ts'));
const { emptyCompendiumPersistenceState, COMPENDIUM_PERSISTENCE_VERSION } = require(path.join(root, 'src/storage/compendiumSnapshot.ts'));

for (const file of baselineFiles) requireFile(file);

const summarizeIssues = (issues) => {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues ?? []) if (issue && counts[issue.severity] !== undefined) counts[issue.severity] += 1;
  return counts;
};
const formatIssues = (issues, severity) => (issues ?? [])
  .filter((entry) => !severity || entry.severity === severity)
  .slice(0, 30)
  .map((entry) => `${entry.code}: ${entry.message}`)
  .join('\n  - ');

const applyFile = (snapshot, file, stage, originalFile) => {
  const json = fs.readFileSync(file, 'utf8');
  const parsed = parseAndPreviewImportPack(json, existingPreviewItemsFromSnapshot(snapshot));
  if (!parsed.parse.ok || !parsed.parse.data) {
    const errors = formatIssues(parsed.parse.issues, 'error');
    const warnings = summarizeIssues(parsed.parse.issues).warning;
    throw new Error(`${path.basename(file)}: parse falhou (${warnings} warning(s), erros abaixo):\n  - ${errors || 'erro não detalhado'}`);
  }
  if (!parsed.preview || !parsed.preview.valid) {
    const errors = formatIssues(parsed.preview?.errors, 'error');
    throw new Error(`${path.basename(file)}: preview inválido:\n  - ${errors || 'erro não detalhado'}`);
  }
  const plan = createCompendiumImportV2UpsertPlan(parsed.parse.data, parsed.preview);
  if (!plan.executable) throw new Error(`${path.basename(file)}: plano não executável; conflitos=${plan.conflictItemIds.length}`);
  const result = applyCompendiumImportV2PlanToSnapshot(snapshot, parsed.parse.data, plan, { importedAt: new Date().toISOString() });
  return {
    snapshot: result.snapshot,
    report: {
      stage,
      file: path.relative(root, file),
      originalFile: originalFile ? path.relative(root, originalFile) : undefined,
      packId: parsed.parse.data.id,
      detectedVersion: parsed.parse.detectedVersion,
      incomingItems: parsed.parse.data.items.length,
      created: result.summary.created,
      updated: result.summary.updated,
      unchanged: result.summary.unchanged,
      conflicts: plan.conflictItemIds.length,
      parseIssues: summarizeIssues(parsed.parse.issues),
      previewIssues: summarizeIssues(parsed.preview.issues),
      previewValid: parsed.preview.valid,
      itemCountAfter: result.snapshot.items.length
    }
  };
};

let snapshot = emptyCompendiumPersistenceState();
const entries = [];
for (const file of baselineFiles) {
  const result = applyFile(snapshot, file, 'baseline');
  snapshot = result.snapshot;
  entries.push(result.report);
}
const baselineItemCount = snapshot.items.length;

for (const fixed of fixedPacks) {
  const result = applyFile(snapshot, fixed.outFile, 'phase7', fixed.sourceFile);
  snapshot = result.snapshot;
  entries.push(result.report);
}
const finalItemCount = snapshot.items.length;

const report = {
  schemaVersion: 'dnd-combat-math.phase7-programmatic-import-report.v2',
  generatedAt: new Date().toISOString(),
  validationBoundary: 'parseAndPreviewImportPack -> createCompendiumImportV2UpsertPlan -> applyCompendiumImportV2PlanToSnapshot',
  baselineItemCount,
  phase7Files: fixedPacks.length,
  finalItemCount,
  expectedBaselineItemCount: 1997,
  expectedFinalItemCount: 3609,
  baselineMatchesExpected: baselineItemCount === 1997,
  finalMatchesExpected: finalItemCount === 3609,
  allExecutable: entries.every((entry) => entry.previewValid && entry.conflicts === 0 && entry.previewIssues.error === 0 && entry.parseIssues.error === 0),
  schemaRepairReport: path.relative(root, repairReportOut),
  entries
};

fs.writeFileSync(reportOut, `${JSON.stringify(report, null, 2)}\n`);
if (!report.baselineMatchesExpected) throw new Error(`Baseline inesperado: ${baselineItemCount}; esperado 1997. Relatório: ${path.relative(root, reportOut)}`);
if (!report.finalMatchesExpected) throw new Error(`Total final inesperado: ${finalItemCount}; esperado 3609. Relatório: ${path.relative(root, reportOut)}`);
if (!report.allExecutable) throw new Error(`Um ou mais imports não são executáveis sem erro/conflito. Relatório: ${path.relative(root, reportOut)}`);

fs.mkdirSync(publicDir, { recursive: true });
const envelope = { state: snapshot, version: COMPENDIUM_PERSISTENCE_VERSION };
fs.writeFileSync(snapshotOut, `${JSON.stringify(envelope)}\n`);

const seedHtml = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Phase 7 seed</title></head>
<body style="font-family:sans-serif;padding:24px"><h1>FASE 7 — seed programático</h1><pre id="status">Preparando…</pre>
<script>(async()=>{const status=document.getElementById('status');try{const response=await fetch('/phase7-validation-snapshot.json',{cache:'no-store'});if(!response.ok)throw new Error('snapshot HTTP '+response.status);const snapshotText=await response.text();JSON.parse(snapshotText);const open=indexedDB.open('dnd-combat-math-web-storage',1);open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains('key-value'))open.result.createObjectStore('key-value');};open.onerror=()=>{status.textContent='ERRO: '+(open.error?.message||'Falha ao abrir IndexedDB');};open.onsuccess=()=>{const db=open.result;const tx=db.transaction('key-value','readwrite');tx.objectStore('key-value').put(snapshotText,'dnd-combat-math-compendium');tx.onerror=()=>{status.textContent='ERRO: '+(tx.error?.message||'falha na transação');};tx.oncomplete=()=>{db.close();status.textContent='OK — snapshot FASE 7 gravado no IndexedDB. Redirecionando…';setTimeout(()=>{location.href='/compendium';},700);};};}catch(error){status.textContent='ERRO: '+(error?.stack||error?.message||String(error));}})();</script></body></html>`;
fs.writeFileSync(seedHtmlOut, seedHtml);

console.log('[phase7:programmatic-import] PASS');
console.log(`baseline=${baselineItemCount}`);
console.log(`phase7Files=${fixedPacks.length}`);
console.log(`final=${finalItemCount}`);
console.log(`snapshot=${path.relative(root, snapshotOut)}`);
console.log(`seed=${path.relative(root, seedHtmlOut)}`);
console.log(`report=${path.relative(root, reportOut)}`);
