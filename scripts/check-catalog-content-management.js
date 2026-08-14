#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const errors = [];
const checks = [
  ['app/content-management.tsx', [
    'Gerenciar conteúdo',
    'previewBookState',
    'previewCategoryState',
    'previewEntityState',
    'hardDependencyBreaks',
    'accessibilityLabel='
  ]],
  ['app/_layout.tsx', [
    'useCatalogStore',
    'initializeCatalog',
    '<Stack.Screen name="content-management" />'
  ]],
  ['app/settings.tsx', [
    'Gerenciar livros e regras',
    "router.push('/content-management')"
  ]],
  ['app/compendium/index.tsx', [
    'Catálogo consolidado de regras',
    "router.push('/content-management')"
  ]],
  ['src/store/catalogStore.ts', [
    'createCatalogStore',
    'commitPendingChange',
    'previewImpact',
    'createCatalogFilterPreferencesRepository'
  ]],
  ['src/storage/catalogFilterPreferences.ts', [
    'CATALOG_FILTER_PREFERENCES_SCHEMA',
    'sanitizeCatalogFilterState',
    'migratedAcrossCatalogVersion'
  ]]
];

for (const [relativePath, snippets] of checks) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`${relativePath}: arquivo ausente`);
    continue;
  }
  const content = fs.readFileSync(absolutePath, 'utf8');
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      errors.push(`${relativePath}: contrato ausente (${snippet})`);
    }
  }
}

const bundle = path.join(
  root,
  'assets',
  'catalog-v4.8.0',
  'runtime-bundle-v4.8.0.json'
);
if (!fs.existsSync(bundle)) errors.push('Bundle de runtime v4.8.0 ausente.');

if (errors.length) {
  console.error('[catalog:ui:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('[catalog:ui:check] PASS');
console.log('route=app/content-management.tsx');
console.log('store=src/store/catalogStore.ts');
console.log('persistence=src/storage/catalogFilterPreferences.ts');
