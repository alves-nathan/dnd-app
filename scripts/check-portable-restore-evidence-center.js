#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const errors = [];
const read = (relative) => {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) { errors.push(`${relative}: arquivo ausente`); return ''; }
  return fs.readFileSync(absolute, 'utf8');
};
const mustContain = (relative, snippets) => {
  const content = read(relative);
  snippets.forEach((snippet) => { if (content && !content.includes(snippet)) errors.push(`${relative}: contrato ausente (${snippet})`); });
};
mustContain('src/backup/portableRestoreEvidenceCenter.ts', [
  'dnd-portable-restore-evidence-record.v1',
  'dnd-portable-restore-evidence-archive.v1',
  'createPortableRestoreHistoricalEvidenceRecord',
  'parsePortableRestoreEvidenceImport',
  'comparePortableRestoreHistoricalEvidence',
  'revalidatePortableRestoreEvidenceHistory',
  'planPortableRestoreEvidenceCleanup',
  'localCheckpointAvailable: false'
]);
mustContain('src/store/portableRestoreSessionStore.ts', [
  'PORTABLE_RESTORE_SESSION_STORE_VERSION = 3',
  'evidenceRecords',
  'importEvidenceRecords',
  'revalidateEvidenceHistory',
  'cleanupEvidenceHistory',
  'createPortableRestoreHistoricalEvidenceRecord'
]);
mustContain('src/backup/usePortableRestoreEvidenceRevalidation.ts', ['REVALIDATION_INTERVAL_MS', 'revalidateEvidenceHistory']);
mustContain('app/evidence-center.tsx', [
  'Central de evidências',
  'evidence-center-import',
  'evidence-center-revalidate',
  'evidence-center-clean-checkpoints',
  'Evidências externas nunca habilitam rollback local'
]);
mustContain('app/settings.tsx', ['Central de evidências']);
mustContain('app/_layout.tsx', ['evidence-center', 'usePortableRestoreEvidenceRevalidation']);
mustContain('src/tests/portableRestoreEvidenceCenter.test.ts', ['archives, exports and imports', 'detects later changes', 'controlled cleanup']);
mustContain('scripts/run-app16-runtime-harness.js', ['app-16-runtime-harness.json', '5841', '15385']);
const pkg = JSON.parse(read('package.json') || '{}');
for (const script of [
  'backup:portable-restore-evidence:check',
  'backup:portable-restore-evidence:harness',
  'test:portable-restore-evidence',
  'app16:smoke',
  'app16:native:gate'
]) if (!pkg.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
const flows = [35, 36, 37, 38].map((number) => fs.readdirSync(path.join(root, '.maestro/flows')).find((name) => name.startsWith(`${number}-`))).filter(Boolean);
if (flows.length !== 4) errors.push(`esperado 4 fluxos Maestro APP-16, encontrado ${flows.length}`);
const gate = read('scripts/run-app06-native-gate.js');
if (!gate.includes('38-evidence-center-cleanup.yaml')) errors.push('gate nativo não inclui o fluxo 38');
const flowCount = (gate.match(/\.maestro\/flows\//g) || []).length;
if (flowCount < 31) errors.push(`gate nativo deveria reconhecer ao menos 31 fluxos, encontrado ${flowCount}`);
if (errors.length) {
  console.error('[backup:portable-restore-evidence:check] FAIL');
  errors.forEach((entry) => console.error(`- ${entry}`));
  process.exit(1);
}
console.log('[backup:portable-restore-evidence:check] PASS');
console.log('recordSchema=dnd-portable-restore-evidence-record.v1');
console.log('archiveSchema=dnd-portable-restore-evidence-archive.v1');
console.log(`nativeGateFlows=${flowCount}`);
