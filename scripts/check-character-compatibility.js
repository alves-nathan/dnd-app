#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const errors = [];
const read = (relativePath) => {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) { errors.push(`${relativePath}: arquivo ausente`); return ''; }
  return fs.readFileSync(absolute, 'utf8');
};
const contracts = [
  ['src/characters/characterCompatibility.ts', ['dnd-character-rules-manifest.v1', 'buildCharacterCompatibilityReport', 'CHARACTER_CATALOG_ENTITY_MISSING', 'CHARACTER_LOCAL_ITEM_DISABLED', 'Nenhuma escolha será migrada automaticamente']],
  ['src/characters/useCharacterCompatibility.ts', ['useCharacterChoiceBridge', 'buildCharacterCompatibilityReport']],
  ['app/characters/[id]/compatibility.tsx', ['Manifesto de regras', 'Abrir ficha mesmo assim', 'Manifesto de conteúdo', 'Referências registradas']],
  ['app/character-compatibility.tsx', ['Planos e manifestos', 'buildCompatibilityRemediationBatchOverview', 'Abrir manifesto']],
  ['app/compendium/maintenance.tsx', ['Manutenção de regras e catálogo', 'Manifestos por personagem', "router.push('/character-compatibility')"]],
  ['app/_layout.tsx', ['characters/[id]/compatibility', 'character-compatibility']],
  ['src/tests/characterCompatibility.test.ts', ['APP-08 character rules compatibility', 'read-only manifest']],
  ['src/storage/characterMigrations.ts', ['CHARACTER_STORE_VERSION = 25']]
];
for (const [file, snippets] of contracts) {
  const content = read(file);
  for (const snippet of snippets) if (content && !content.includes(snippet)) errors.push(`${file}: contrato ausente (${snippet})`);
}
const characterSheet = read('app/characters/[id]/index.tsx');
for (const forbidden of ['useCharacterCompatibility', 'compatibilityReviewed', 'Verificando ficha', 'Abrir manifesto da ficha']) {
  if (characterSheet.includes(forbidden)) errors.push(`app/characters/[id]/index.tsx: manutenção de compatibilidade vazou para a ficha (${forbidden})`);
}
const packageJson = JSON.parse(read('package.json') || '{}');
for (const script of ['catalog:character-compatibility:check', 'catalog:character-compatibility:harness', 'app08:smoke']) {
  if (!packageJson.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
}
if (errors.length) {
  console.error('[catalog:character-compatibility:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('[catalog:character-compatibility:check] PASS');
console.log('manifestSchema=dnd-character-rules-manifest.v1');
console.log('characterStoreVersion=25');
