#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const validationRoot = path.join(root, '.validation');
const publicDir = path.join(root, 'public');
const artifactsDir = path.join(root, 'artifacts');
const snapshotOut = path.join(publicDir, 'phase7-validation-snapshot.json');
const seedHtmlOut = path.join(publicDir, 'phase7-seed.html');
const reportOut = path.join(artifactsDir, 'phase7-programmatic-import-report.json');

const requireFile = (file) => {
  if (!fs.existsSync(file)) throw new Error(`Arquivo ausente: ${path.relative(root, file)}`);
  return file;
};

const loadTypeScript = () => {
  for (const candidate of [
    path.join(root, 'node_modules', 'typescript', 'lib', 'typescript.js'),
    'typescript'
  ]) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado. Execute npm install antes deste script.');
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

const { parseAndPreviewImportPack } = require(path.join(root, 'src/compendium/parseImportPreview.ts'));
const { createCompendiumImportV2UpsertPlan } = require(path.join(root, 'src/compendium/importUpsertPlan.ts'));
const {
  applyCompendiumImportV2PlanToSnapshot,
  existingPreviewItemsFromSnapshot
} = require(path.join(root, 'src/storage/compendiumV2Persistence.ts'));
const {
  emptyCompendiumPersistenceState,
  COMPENDIUM_PERSISTENCE_VERSION
} = require(path.join(root, 'src/storage/compendiumSnapshot.ts'));

const baselineFiles = [
  'phb-2024-full-consolidated-import-pack-v2-canonical.json',
  'mm-2024-runtime-dependency-delta-v2-canonical.json',
  'forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json',
  'spelljammer-2022-2024-compatible-import-pack-v2-canonical.json',
  'tcoe-2020-2024-compatible-import-pack-v2-canonical.json',
  'phb-2014-2024-compatible-delta-v2-canonical.json'
].map((name) => path.join(root, 'assets/compendium', name));

const phase7Files = [
  path.join(validationRoot, 'phase7b/packs-v2/xgte-2017-2024-compatible-import-pack-v2-canonical.json'),
  path.join(validationRoot, 'phase7b/packs-v2/mtof-2018-2024-compatible-import-pack-v2-canonical.json'),
  path.join(validationRoot, 'phase7b/packs-v2/eberron-rising-2019-2024-compatible-import-pack-v2-canonical.json'),
  path.join(validationRoot, 'phase7b/packs-v2/egtw-2020-2024-compatible-import-pack-v2-canonical.json'),
  path.join(validationRoot, 'phase7b/packs-v2/one-grung-above-2017-2024-compatible-import-pack-v2-canonical.json'),
  path.join(validationRoot, 'phase7b/packs-v2/hold-back-the-dead-2025-2024-compatible-import-pack-v2-canonical.json'),
  path.join(validationRoot, 'phase7b/packs-v2/malady-of-minarrh-2024-compatible-import-pack-v2-canonical.json'),
  path.join(validationRoot, 'phase7b/packs-v2/spelljammer-academy-2022-2024-compatible-import-pack-v2-canonical.json'),
  path.join(validationRoot, 'phase7b/packs-v2/welcome-to-hellfire-club-2025-2024-compatible-import-pack-v2-canonical.json'),
  path.join(validationRoot, 'phase7b/packs-v2/bomt-2023-2024-compatible-import-pack-v2-canonical.json'),
  path.join(validationRoot, 'phase7b/deltas-v2/spelljammer-2022-giff-shipmate-canonical-correction-import-pack-v2-canonical.json'),
  path.join(validationRoot, 'phase7c/packs-v2/mm-2014-phase7c-runtime-dependency-delta-v2-canonical.json'),
  path.join(validationRoot, 'phase7c/packs-v2/dmg-2014-phase7c-runtime-dependency-delta-v2-canonical.json'),
  path.join(validationRoot, 'phase7c/packs-v2/phb-2014-phase7c-runtime-dependency-delta-v2-canonical.json')
];

for (const file of [...baselineFiles, ...phase7Files]) requireFile(file);

const summarizeIssues = (issues) => {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues ?? []) {
    if (issue && counts[issue.severity] !== undefined) counts[issue.severity] += 1;
  }
  return counts;
};

const applyFile = (snapshot, file, stage) => {
  const json = fs.readFileSync(file, 'utf8');
  const parsed = parseAndPreviewImportPack(json, existingPreviewItemsFromSnapshot(snapshot));
  if (!parsed.parse.ok || !parsed.parse.data) {
    throw new Error(`${path.basename(file)}: parse falhou: ${(parsed.parse.issues ?? []).map((x) => x.code).join(', ')}`);
  }
  if (!parsed.preview || !parsed.preview.valid) {
    throw new Error(`${path.basename(file)}: preview inválido: ${(parsed.preview?.errors ?? []).map((x) => x.code).join(', ')}`);
  }
  const plan = createCompendiumImportV2UpsertPlan(parsed.parse.data, parsed.preview);
  if (!plan.executable) {
    throw new Error(`${path.basename(file)}: plano não executável; conflitos=${plan.conflictItemIds.length}`);
  }
  const result = applyCompendiumImportV2PlanToSnapshot(snapshot, parsed.parse.data, plan, {
    importedAt: new Date().toISOString()
  });
  return {
    snapshot: result.snapshot,
    report: {
      stage,
      file: path.relative(root, file),
      packId: parsed.parse.data.id,
      detectedVersion: parsed.parse.detectedVersion,
      incomingItems: parsed.parse.data.items.length,
      created: result.summary.created,
      updated: result.summary.updated,
      unchanged: result.summary.unchanged,
      conflicts: plan.conflictItemIds.length,
      previewValid: parsed.preview.valid,
      issues: summarizeIssues(parsed.preview.issues),
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

for (const file of phase7Files) {
  const result = applyFile(snapshot, file, 'phase7');
  snapshot = result.snapshot;
  entries.push(result.report);
}
const finalItemCount = snapshot.items.length;

const report = {
  schemaVersion: 'dnd-combat-math.phase7-programmatic-import-report.v1',
  generatedAt: new Date().toISOString(),
  baselineItemCount,
  phase7Files: phase7Files.length,
  finalItemCount,
  expectedBaselineItemCount: 1997,
  expectedFinalItemCount: 3609,
  baselineMatchesExpected: baselineItemCount === 1997,
  finalMatchesExpected: finalItemCount === 3609,
  allExecutable: entries.every((entry) => entry.previewValid && entry.conflicts === 0 && entry.issues.error === 0),
  entries
};

if (!report.baselineMatchesExpected) {
  throw new Error(`Baseline inesperado: ${baselineItemCount}; esperado 1997.`);
}
if (!report.finalMatchesExpected) {
  throw new Error(`Total final inesperado: ${finalItemCount}; esperado 3609.`);
}
if (!report.allExecutable) {
  throw new Error('Um ou mais imports não são executáveis sem erro/conflito.');
}

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(artifactsDir, { recursive: true });

const envelope = { state: snapshot, version: COMPENDIUM_PERSISTENCE_VERSION };
fs.writeFileSync(snapshotOut, `${JSON.stringify(envelope)}\n`);
fs.writeFileSync(reportOut, `${JSON.stringify(report, null, 2)}\n`);

const seedHtml = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Phase 7 seed</title></head>
<body style="font-family: sans-serif; padding: 24px">
  <h1>FASE 7 — seed programático</h1>
  <pre id="status">Preparando…</pre>
  <script>
  (async () => {
    const status = document.getElementById('status');
    try {
      const response = await fetch('/phase7-validation-snapshot.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('snapshot HTTP ' + response.status);
      const snapshotText = await response.text();
      JSON.parse(snapshotText);
      const open = indexedDB.open('dnd-combat-math-web-storage', 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('key-value')) open.result.createObjectStore('key-value');
      };
      open.onerror = () => { throw open.error || new Error('Falha ao abrir IndexedDB'); };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('key-value', 'readwrite');
        tx.objectStore('key-value').put(snapshotText, 'dnd-combat-math-compendium');
        tx.onerror = () => { status.textContent = 'ERRO: ' + (tx.error?.message || 'falha na transação'); };
        tx.oncomplete = () => {
          db.close();
          status.textContent = 'OK — snapshot FASE 7 gravado no IndexedDB. Redirecionando…';
          setTimeout(() => { location.href = '/compendium'; }, 700);
        };
      };
    } catch (error) {
      status.textContent = 'ERRO: ' + (error?.stack || error?.message || String(error));
    }
  })();
  </script>
</body>
</html>`;
fs.writeFileSync(seedHtmlOut, seedHtml);

console.log('[phase7:programmatic-import] PASS');
console.log(`baseline=${baselineItemCount}`);
console.log(`phase7Files=${phase7Files.length}`);
console.log(`final=${finalItemCount}`);
console.log(`snapshot=${path.relative(root, snapshotOut)}`);
console.log(`seed=${path.relative(root, seedHtmlOut)}`);
console.log(`report=${path.relative(root, reportOut)}`);
