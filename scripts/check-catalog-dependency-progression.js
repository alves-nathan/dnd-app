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
  ['src/catalog/characterDependencyResolver.ts', [
    'resolveCharacterPendingChoice',
    "'dependency' | 'owner' | 'kindFallback' | 'unresolved'",
    'offersChoice',
    'allowsCandidate',
    'availableToClass',
    'CATALOG_PENDING_CHOICE_NO_AVAILABLE_CANDIDATE'
  ]],
  ['src/catalog/useCharacterChoiceBridge.ts', [
    'resolvePendingChoice',
    'resolveCharacterPendingChoice',
    'choiceById.set(choice.entityId'
  ]],
  ['src/components/PendingChoiceContextCard.tsx', [
    'availableCandidateChoices',
    'blockedCandidateChoices',
    'IssueList'
  ]],
  ['app/characters/[id]/progression.tsx', [
    'pendingId=',
    'resolvePendingChoice',
    'grafo de dependências'
  ]],
  ['app/characters/[id]/compendium.tsx', [
    'pendingCandidateIds',
    'applyCharacterChoice',
    'choiceForItemId'
  ]],
  ['app/characters/[id]/feats.tsx', ['pendingCandidateIds', 'useCharacterChoiceBridge']],
  ['app/characters/[id]/spells.tsx', ['pendingCandidateIds', 'applyCharacterChoice']],
  ['app/characters/[id]/invocations.tsx', ['PendingChoiceContextCard', 'pendingCandidateIds']],
  ['app/characters/[id]/classes.tsx', ['PendingChoiceContextCard', 'choiceForItemId']],
  ['app/characters/[id]/identity.tsx', ['PendingChoiceContextCard', 'choiceForItemId']],
  ['app/characters/[id]/equipment.tsx', ['PendingChoiceContextCard', 'choiceForItemId']],
  ['app/characters/[id]/pact-weapon.tsx', ['PendingChoiceContextCard', 'pendingCandidateIds']],
  ['app/characters/[id]/warlock-special.tsx', ['PendingChoiceContextCard', 'useCharacterChoiceBridge']],
  ['src/tests/catalogCharacterDependencyResolver.test.ts', ['APP-04 dependency-aware pending choices']]
];

for (const [relativePath, snippets] of contracts) {
  const content = read(relativePath);
  for (const snippet of snippets) {
    if (content && !content.includes(snippet)) errors.push(`${relativePath}: contrato ausente (${snippet})`);
  }
}

const secondaryEditors = [
  'app/characters/[id]/classes.tsx',
  'app/characters/[id]/identity.tsx',
  'app/characters/[id]/equipment.tsx',
  'app/characters/[id]/feats.tsx',
  'app/characters/[id]/spells.tsx',
  'app/characters/[id]/invocations.tsx',
  'app/characters/[id]/pact-weapon.tsx',
  'app/characters/[id]/warlock-special.tsx',
  'app/characters/[id]/combat.tsx'
];
for (const relativePath of secondaryEditors) {
  const content = read(relativePath);
  if (!content.includes('useCharacterChoiceBridge')) errors.push(`${relativePath}: não usa a ponte unificada`);
  if (/useCompendiumStore\(\(state\)\s*=>\s*state\.(items|searchItems|enabledSourceIds)/.test(content)) {
    errors.push(`${relativePath}: ainda consulta opções diretamente no compêndio`);
  }
}

const bundlePath = path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json');
let graphMetrics = { edges: 0, offersChoice: 0, allowsCandidate: 0, availableToClass: 0, belongsToClass: 0 };
if (fs.existsSync(bundlePath)) {
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const edges = bundle.dependencyGraph?.edges ?? [];
  graphMetrics = edges.reduce((metrics, edge) => {
    metrics.edges += 1;
    if (Object.prototype.hasOwnProperty.call(metrics, edge.relation)) metrics[edge.relation] += 1;
    return metrics;
  }, graphMetrics);
  if (graphMetrics.edges !== 15385) errors.push(`grafo divergente: esperado 15385, recebido ${graphMetrics.edges}`);
  for (const relation of ['offersChoice', 'allowsCandidate', 'availableToClass', 'belongsToClass']) {
    if (!graphMetrics[relation]) errors.push(`grafo sem relação necessária: ${relation}`);
  }
} else {
  errors.push('bundle do catálogo ausente');
}

if (errors.length) {
  console.error('[catalog:dependency-progression:check] FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('[catalog:dependency-progression:check] PASS');
console.log(`secondaryEditors=${secondaryEditors.length}`);
console.log(`graphMetrics=${JSON.stringify(graphMetrics)}`);
