#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const legacyAsset = 'phb-2024-full-consolidated-import-pack-v5-complete-invocations.json';
const canonicalAsset = 'phb-2024-full-consolidated-import-pack-v2-canonical.json';
const errors = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const runtimeConsumers = [
  'src/compendium/bundledCompendium.ts',
  'scripts/check-character-choice-bridge.js',
  'scripts/run-app04-runtime-harness.js',
  'src/tests/catalogCharacterChoiceRealData.test.ts'
];

for (const relative of runtimeConsumers) {
  const content = read(relative);
  if (!content.includes(canonicalAsset)) errors.push(`${relative}: não referencia o artefato canônico V2.`);
  if (content.includes(legacyAsset)) errors.push(`${relative}: ainda referencia diretamente o PHB V1.`);
}

const packageJson = JSON.parse(read('package.json'));
const releaseGate = packageJson.scripts?.['compendium:import-v2:release-gate'] ?? '';
if (!releaseGate.includes('compendium:import-v2:post-cutover:check')) {
  errors.push('package.json: release gate V2 não inclui o gate pós-cutover.');
}

const bundled = read('src/compendium/bundledCompendium.ts');
if (!bundled.includes("importFormat: 'v2'")) errors.push('bundledCompendium.ts: PHB bundled não está marcado como V2.');
if (!bundled.includes("require('../../assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json')")) {
  errors.push('bundledCompendium.ts: require Metro não aponta para o PHB V2 canônico.');
}

// V1 deve continuar existindo apenas como fixture/artefato de compatibilidade e migração.
const legacyPath = path.join(root, 'assets/compendium', legacyAsset);
if (!fs.existsSync(legacyPath)) errors.push('Artefato V1 de compatibilidade/migração foi removido prematuramente.');

const canonicalPath = path.join(root, 'assets/compendium', canonicalAsset);
if (!fs.existsSync(canonicalPath)) errors.push('Artefato PHB V2 canônico está ausente.');
else {
  const pack = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
  if (pack.templateVersion !== 'dnd-combat-import.v2') errors.push('PHB canônico não usa dnd-combat-import.v2.');
  if (!Array.isArray(pack.items) || pack.items.length !== 1284) errors.push(`PHB canônico deve conter 1.284 itens; encontrado ${pack.items?.length ?? 'n/a'}.`);
  if (new Set((pack.items ?? []).map((item) => item.id)).size !== 1284) errors.push('PHB canônico não contém 1.284 IDs únicos.');
}

if (errors.length) {
  console.error('[compendium:import-v2:post-cutover:check] FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('[compendium:import-v2:post-cutover:check] PASS');
console.log(`runtimeConsumers=${runtimeConsumers.length}`);
console.log('bundledFormat=v2');
console.log('canonicalItems=1284');
console.log('legacyCompatibilityArtifact=preserved');
