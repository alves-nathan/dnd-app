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
  ['src/catalog/characterChoiceTypes.ts', [
    "export type CharacterChoiceOrigin = 'catalog' | 'compendium'",
    'catalogSnapshotId?: string',
    'overrideAuthorized: boolean'
  ]],
  ['src/catalog/characterChoiceBridge.ts', [
    'catalog:',
    'compendium:',
    'hiddenDuplicateCount',
    'resolveCharacterChoice',
    'normalizeCharacterChoiceReference'
  ]],
  ['src/catalog/catalogCompendiumAdapter.ts', [
    '__characterChoice',
    'não persistir no compêndio local',
    "choice.origin === 'compendium'"
  ]],
  ['src/catalog/characterChoiceApplication.ts', [
    'previewCharacterChoiceApplication',
    'CHARACTER_CHOICE_ALREADY_APPLIED',
    'CHARACTER_CHOICE_EDITORIAL_REVIEW'
  ]],
  ['src/catalog/useCharacterChoiceBridge.ts', [
    'useCatalogStore',
    'useCompendiumStore',
    'characterChoiceToMapperItem',
    'legacyItemIds'
  ]],
  ['src/compendium/mapper.ts', [
    '__characterChoice',
    'catalogEntityId',
    'catalogSnapshotId',
    'CATALOG_EDITORIAL_REVIEW_REQUIRED'
  ]],
  ['src/storage/characterMigrations.ts', [
    'CHARACTER_STORE_VERSION = 24',
    'normalizeCharacterChoiceReference'
  ]],
  ['src/characters/creationDraft.ts', [
    'export const CHARACTER_CREATION_DRAFT_VERSION =',
    'normalizeCharacterChoiceReference'
  ]],
  ['app/characters/new.tsx', [
    'useCharacterChoiceBridge',
    'catalogSnapshotId',
    'Preparando criação',
    'A criação foi bloqueada'
  ]],
  ['app/characters/[id]/level-up.tsx', [
    'useCharacterChoiceBridge',
    'snapshotMigrationApproved',
    'existingClassUnavailable',
    'Preparando progressão'
  ]],
  ['src/tests/catalogCharacterChoiceBridge.test.ts', ['APP-03 character choice bridge']],
  ['src/tests/catalogCharacterChoiceApplication.test.ts', ['APP-03 character choice application']],
  ['src/tests/catalogCharacterProgressionIntegration.test.ts', ['APP-03 progression compatibility']],
  ['src/tests/catalogCharacterChoiceRealData.test.ts', ['APP-03 real catalog and bundled compendium bridge']]
];

for (const [relativePath, snippets] of contracts) {
  const content = read(relativePath);
  for (const snippet of snippets) {
    if (content && !content.includes(snippet)) {
      errors.push(`${relativePath}: contrato ausente (${snippet})`);
    }
  }
}

for (const relativePath of ['app/characters/new.tsx', 'app/characters/[id]/level-up.tsx']) {
  const content = read(relativePath);
  if (/useCompendiumStore\(\(state\)\s*=>\s*state\.(items|searchItems|enabledSourceIds)/.test(content)) {
    errors.push(`${relativePath}: ainda consulta escolhas diretamente no compêndio`);
  }
}

const bundlePath = path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json');
const packPath = path.join(root, 'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json');
let coverage = { catalogEntries: 0, carrierItems: 0, carrierByKind: {}, directIdCarriers: 0, directByKind: {} };
if (fs.existsSync(bundlePath) && fs.existsSync(packPath)) {
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  const entityIds = new Set(bundle.runtimeIndex?.entries?.map((entry) => entry.entityId) ?? []);
  const items = Array.isArray(pack.items) ? pack.items : [];
  const carrierByKind = items.reduce((counts, item) => {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    return counts;
  }, {});
  const directItems = items.filter((item) => entityIds.has(item.id));
  const directByKind = directItems.reduce((counts, item) => {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    return counts;
  }, {});
  coverage = {
    catalogEntries: entityIds.size,
    carrierItems: items.length,
    carrierByKind,
    directIdCarriers: directItems.length,
    directByKind
  };
  if (coverage.catalogEntries !== 5841) errors.push('catálogo deve conter 5.841 entidades');
  if (coverage.carrierItems !== 1284) errors.push('pacote mecânico deve conter 1.284 itens');
  if (coverage.directIdCarriers < 500) errors.push('menos de 500 payloads têm identidade oficial direta');
  const requiredCarrierCoverage = { class: 12, subclass: 48, species: 10, background: 16, feat: 75, spell: 391, weapon: 38, armor: 13 };
  for (const [kind, expected] of Object.entries(requiredCarrierCoverage)) {
    if ((coverage.carrierByKind[kind] ?? 0) !== expected) {
      errors.push(`cobertura mecânica divergente para ${kind}: esperado ${expected}`);
    }
  }
  const requiredDirectCoverage = { class: 12, species: 10, background: 16, weapon: 38, armor: 13 };
  for (const [kind, minimum] of Object.entries(requiredDirectCoverage)) {
    if ((coverage.directByKind[kind] ?? 0) < minimum) {
      errors.push(`cobertura direta insuficiente para ${kind}: esperado ao menos ${minimum}`);
    }
  }
} else {
  errors.push('bundle ou pacote mecânico necessário ao APP-03 está ausente');
}

if (errors.length) {
  console.error('[catalog:character-bridge:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('[catalog:character-bridge:check] PASS');
console.log(`catalogEntries=${coverage.catalogEntries}`);
console.log(`carrierItems=${coverage.carrierItems}`);
console.log(`carrierByKind=${JSON.stringify(coverage.carrierByKind)}`);
console.log(`directIdCarriers=${coverage.directIdCarriers}`);
console.log(`directByKind=${JSON.stringify(coverage.directByKind)}`);
console.log('characterStoreVersion=24');
const creationDraftVersion = read('src/characters/creationDraft.ts').match(/CHARACTER_CREATION_DRAFT_VERSION = (\d+)/)?.[1] ?? 'unknown';
console.log(`creationDraftVersion=${creationDraftVersion}`);
