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
  ['src/characters/progressionTransaction.ts', [
    'createProgressionDraft',
    'validateProgressionDraft',
    'commitProgressionDraft',
    'rollbackProgressionAudit',
    'PROGRESSION_TRANSACTION_CONFLICT',
    'PROGRESSION_TRANSACTION_PENDING_CHOICES',
    'progressionSnapshot'
  ]],
  ['src/characters/useCharacterProgressionSession.ts', [
    'progressionDrafts',
    'updateProgressionDraft',
    'completePendingChoice'
  ]],
  ['src/store/characterStore.ts', [
    'beginProgressionTransaction',
    'commitProgressionTransaction',
    'discardProgressionTransaction',
    'rollbackProgressionTransaction',
    'progressionDrafts'
  ]],
  ['src/storage/characterMigrations.ts', [
    'CHARACTER_STORE_VERSION = 24',
    'progressionTransactions',
    'progressionDrafts'
  ]],
  ['src/types/index.ts', [
    'CharacterProgressionAuditEntry',
    'CharacterProgressionSnapshot',
    'progressionTransactions?'
  ]],
  ['app/characters/[id]/level-up.tsx', [
    'beginProgressionTransaction',
    'Transação de progressão preparada',
    'Preparar transação',
    'progressionOperation'
  ]],
  ['app/characters/[id]/progression.tsx', [
    'validateProgressionDraft',
    'commitProgressionTransaction',
    'discardProgressionTransaction',
    'rollbackProgressionTransaction',
    'Confirmar tudo',
    'Auditoria de progressão'
  ]],
  ['src/tests/characterProgressionTransaction.test.ts', [
    'APP-05 atomic progression transaction',
    'PROGRESSION_TRANSACTION_CONFLICT',
    'rollbackProgressionAudit'
  ]]
];

for (const [relativePath, snippets] of contracts) {
  const content = read(relativePath);
  for (const snippet of snippets) {
    if (content && !content.includes(snippet)) errors.push(`${relativePath}: contrato ausente (${snippet})`);
  }
}

const transactionEditors = [
  'app/characters/[id]/classes.tsx',
  'app/characters/[id]/identity.tsx',
  'app/characters/[id]/equipment.tsx',
  'app/characters/[id]/feats.tsx',
  'app/characters/[id]/spells.tsx',
  'app/characters/[id]/proficiencies.tsx',
  'app/characters/[id]/invocations.tsx',
  'app/characters/[id]/pact-weapon.tsx',
  'app/characters/[id]/warlock-special.tsx',
  'app/characters/[id]/compendium.tsx'
];
for (const relativePath of transactionEditors) {
  const content = read(relativePath);
  if (!content.includes('useCharacterProgressionSession')) errors.push(`${relativePath}: não usa sessão transacional`);
  if (/useCharacterStore\(\(state\)\s*=>\s*state\.updateCharacter/.test(content)) errors.push(`${relativePath}: ainda grava diretamente no personagem publicado`);
}

const levelUp = read('app/characters/[id]/level-up.tsx');
if (/updateCharacter\s*\(/.test(levelUp)) errors.push('level-up ainda executa updateCharacter direto');

const packageJson = JSON.parse(read('package.json') || '{}');
for (const script of ['catalog:progression-transaction:check', 'catalog:progression-transaction:harness', 'app05:smoke']) {
  if (!packageJson.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
}

if (errors.length) {
  console.error('[catalog:progression-transaction:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('[catalog:progression-transaction:check] PASS');
console.log(`transactionEditors=${transactionEditors.length}`);
console.log('storeVersion=24');
