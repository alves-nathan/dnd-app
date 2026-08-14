#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const errors = [];
const read = (file) => {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) {
    errors.push(`${file}: arquivo ausente`);
    return '';
  }
  return fs.readFileSync(target, 'utf8');
};
const contracts = [
  ['src/backup/portableRestoreSession.ts', [
    'dnd-portable-restore-session.v1',
    'dnd-portable-restore-session-audit.v1',
    'preparePortableRestoreSession',
    'acknowledgePortableRestoreConflict',
    'portableRestoreCheckpointFingerprint',
    'canCommitPortableRestoreSession'
  ]],
  ['src/store/portableRestoreSessionStore.ts', [
    'dnd-combat-math-portable-restore-session',
    'markCommitStarted',
    'markInterrupted',
    'markRollbackStarted',
    'archiveCommittedSession',
    'recoveryRequired'
  ]],
  ['src/backup/portableRestoreSessionExecutor.ts', [
    'capturePortableRestoreCheckpoint',
    'commitPortableRestoreSession',
    'rollbackPortableRestoreSession',
    'replaceConfigurationCheckpoint'
  ]],
  ['src/storage/catalogFilterPreferences.ts', [
    'CatalogConfigurationCheckpointDocument',
    'replace: async ('
  ]],
  ['src/store/catalogStore.ts', ['replaceConfigurationCheckpoint']],
  ['src/catalog/catalogConfigurationHistory.ts', ['portableRestoreSessionId?: string']],
  ['app/backup.tsx', [
    'Preparar sessão de restauração',
    'A configuração do catálogo foi preparada como nova transação',
    "router.push('/restore-session')"
  ]],
  ['app/restore-session.tsx', [
    'restore-session-commit',
    'restore-session-discard',
    'restore-session-rollback',
    'Retomar commit idempotente'
  ]],
  ['app/_layout.tsx', ['<Stack.Screen name="restore-session" />']],
  ['app/e2e-seed.tsx', [
    'prepareRestoreSessionScenario',
    'e2e-seed-restore-session-preview',
    'e2e-seed-restore-session-interrupted',
    'e2e-seed-restore-session-commit',
    'e2e-seed-restore-session-rollback'
  ]],
  ['scripts/run-app06-native-gate.js', [
    '27-portable-restore-session-preview-discard.yaml',
    '28-portable-restore-session-resume.yaml',
    '29-portable-restore-session-commit.yaml',
    '30-portable-restore-session-rollback.yaml'
  ]]
];
for (const [file, snippets] of contracts) {
  const content = read(file);
  for (const snippet of snippets) {
    if (content && !content.includes(snippet)) errors.push(`${file}: contrato ausente (${snippet})`);
  }
}
const pkg = JSON.parse(read('package.json') || '{}');
for (const script of [
  'backup:portable-restore-session:check',
  'backup:portable-restore-session:harness',
  'test:portable-restore-session',
  'app14:smoke',
  'app14:native:gate'
]) {
  if (!pkg.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
}
const gateSource = read('scripts/run-app06-native-gate.js');
const flowCount = (gateSource.match(/\.maestro\/flows\/[^'\"]+\.yaml/g) || []).length;
if (flowCount < 23) errors.push(`scripts/run-app06-native-gate.js: esperado ao menos 23 fluxos, encontrado ${flowCount}`);
if (errors.length) {
  console.error('[backup:portable-restore-session:check] FAIL');
  errors.forEach((entry) => console.error(`- ${entry}`));
  process.exit(1);
}
console.log('[backup:portable-restore-session:check] PASS');
console.log('sessionSchema=dnd-portable-restore-session.v1');
console.log('auditSchema=dnd-portable-restore-session-audit.v1');
console.log(`nativeGateFlows=${flowCount}`);
