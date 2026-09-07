#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const errors = [];
const read = (relativePath) => {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    errors.push(`${relativePath}: arquivo ausente`);
    return '';
  }
  return fs.readFileSync(absolute, 'utf8');
};

const contracts = [
  ['src/characters/progressionRecovery.ts', [
    'reconcileProgressionRecovery',
    'acknowledgeRecoveredProgressionDraft',
    "'orphaned' | 'invalid'",
    "'recoverable'",
    "'conflicted'"
  ]],
  ['src/characters/progressionTransaction.ts', [
    'CharacterProgressionRecoveryMetadata',
    'checkpointSequence',
    'PROGRESSION_TRANSACTION_RECOVERY_ACK_REQUIRED',
    'PROGRESSION_TRANSACTION_RECOVERY_CONFLICT'
  ]],
  ['src/store/characterStore.ts', [
    'progressionRecovery',
    'reconcileProgressionRecovery',
    'acknowledgeProgressionRecovery',
    'onRehydrateStorage'
  ]],
  ['src/storage/characterMigrations.ts', ['CHARACTER_STORE_VERSION = 25', 'progressionRecovery']],
  ['app/progression-recovery.tsx', ['Recuperação de progressão', 'Retomar com segurança', 'Conflito de recuperação']],
  ['app/characters/[id]/progression.tsx', ['Rascunho recuperado após reinício', 'progression-recovery-resume']],
  ['app/e2e-seed.tsx', ['Preparar recuperação transacional', 'Preparar conflito transacional', 'Preparar rollback transacional']],
  ['src/tests/characterProgressionRecovery.test.ts', ['APP-06 progression recovery', 'checkpoint sequence']],
  ['.maestro/flows/08-progression-recovery-commit.yaml', ['Recuperar e confirmar progressão após reinício']],
  ['.maestro/flows/09-progression-recovery-discard.yaml', ['Descartar progressão recuperada sem alterar ficha']],
  ['.maestro/flows/10-progression-recovery-conflict.yaml', ['Isolar conflito de progressão após reinício']],
  ['.maestro/flows/11-progression-rollback.yaml', ['Reverter último commit de progressão']]
];

for (const [relativePath, snippets] of contracts) {
  const content = read(relativePath);
  for (const snippet of snippets) {
    if (content && !content.includes(snippet)) errors.push(`${relativePath}: contrato ausente (${snippet})`);
  }
}

const packageJson = JSON.parse(read('package.json') || '{}');
for (const script of ['catalog:progression-recovery:check', 'catalog:progression-recovery:harness', 'app06:smoke', 'app06:native:gate']) {
  if (!packageJson.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
}

if (errors.length) {
  console.error('[catalog:progression-recovery:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('[catalog:progression-recovery:check] PASS');
console.log('storeVersion=25');
console.log('maestroFlows=4');
