#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'artifacts', 'compendium', 'integration', '2024-legacy-character-smoke-report.json');

const loadTypeScript = () => {
  for (const candidate of [
    'typescript',
    '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js',
    '/usr/local/lib/node_modules/typescript/lib/typescript.js'
  ]) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado para executar o smoke de personagem 2024+legacy.');
};
const ts = loadTypeScript();
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText;
  module._compile(output, filename);
};

const mapper = require(path.join(root, 'src', 'compendium', 'mapper.ts'));
const progression = require(path.join(root, 'src', 'compendium', 'classProgression.ts'));
const { createEmptyCharacter } = require(path.join(root, 'src', 'data', 'mockData.ts'));

const packFiles = [
  'phb-2024-full-consolidated-import-pack-v2-canonical.json',
  'forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json',
  'spelljammer-2022-2024-compatible-import-pack-v2-canonical.json',
  'tcoe-2020-2024-compatible-import-pack-v2-canonical.json',
  'phb-2014-2024-compatible-delta-v2-canonical.json'
];
const packs = packFiles.map((fileName) => JSON.parse(fs.readFileSync(path.join(root, 'assets', 'compendium', fileName), 'utf8')));
const tasha = packs.find((pack) => pack.id === 'tcoe-2020-2024-compatible-import-pack-v2');
const phb2014Delta = packs.find((pack) => pack.id === 'phb-2014-2024-compatible-delta-v1');
assert.ok(tasha, 'Pack Tasha compatível ausente.');
assert.ok(phb2014Delta, 'Pack delta PHB 2014 compatível ausente.');

const importedAt = '2026-08-11T22:05:00.000Z';
const toStored = (pack) => pack.items.map((item) => ({
  id: `${pack.id}:${item.id}`,
  importItemId: item.id,
  packId: pack.id,
  sourceId: item.source.id,
  type: item.kind,
  name: item.name,
  summary: item.summary,
  version: item.source.version,
  rawJson: item,
  normalizedJson: {
    ...item.payload,
    id: item.id,
    name: item.name,
    type: item.kind,
    sourceId: item.source.id,
    sourceStatus: item.source.status,
    sourceConfidence: item.source.confidence,
    requiresReview: false
  },
  tags: [item.kind, item.name.toLowerCase(), ...(Array.isArray(item.payload?.tags) ? item.payload.tags.filter((tag) => typeof tag === 'string') : [])],
  status: 'validated',
  reviewDecision: 'approved',
  createdAt: importedAt,
  updatedAt: importedAt
}));
const items = packs.flatMap(toStored);
const find = (id) => {
  const item = items.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Item de smoke ausente: ${id}`);
  return item;
};

const buildLegacySubclass = ({ classId, subclassId, level, expectedFeatures, excludedFeatures = [] }) => {
  let character = createEmptyCharacter(`Smoke ${subclassId}`);
  let applied = mapper.applyCompendiumItemToCharacter(character, find(classId));
  assert.equal(applied.ok, true, `${classId} deve ser aplicável`);
  character = applied.character;
  const classLink = character.compendiumLinks?.find((link) => link.appliedAs === 'class');
  assert.ok(classLink, `${classId}: link da classe ausente`);
  character = {
    ...character,
    level,
    classes: character.classes.map((entry) => entry.id === classLink.appliedEntityId ? { ...entry, level } : entry)
  };
  applied = mapper.applyCompendiumItemToCharacter(character, find(subclassId));
  assert.equal(applied.ok, true, `${subclassId} deve ser aplicável sobre ${classId}`);
  character = applied.character;
  const reconciled = progression.applyAutomaticClassProgression(character, items);
  assert.deepEqual(reconciled.issues, [], `${subclassId}: progressão não deve produzir issues`);
  const names = reconciled.character.features.map((feature) => feature.name);
  for (const feature of expectedFeatures) assert.ok(names.includes(feature), `${subclassId}@${level}: feature esperada ausente: ${feature}`);
  for (const feature of excludedFeatures) assert.ok(!names.includes(feature), `${subclassId}@${level}: feature legacy superseded não deveria estar presente: ${feature}`);
  return {
    classId,
    subclassId,
    level,
    expectedFeatures,
    matchedFeatures: expectedFeatures.filter((name) => names.includes(name)),
    featureCount: names.length,
    choiceCount: reconciled.choiceItems.length
  };
};

const checks = [];
const check = (name, fn) => {
  try { checks.push({ name, pass: true, result: fn() }); }
  catch (error) { checks.push({ name, pass: false, error: error instanceof Error ? error.message : String(error) }); }
};

check('all retained legacy subclasses target PHB 2024 and unlock at level 3', () => {
  const subclasses = tasha.items.filter((item) => item.kind === 'subclass');
  assert.equal(subclasses.length, 18);
  for (const item of subclasses) {
    assert.match(item.payload.classId, /^phb-2024-class-/i, `${item.id}: owner não é PHB 2024`);
    assert.equal(item.payload.progression?.[0]?.level, 3, `${item.id}: primeiro nível não foi projetado para 3`);
  }
  return { subclassCount: subclasses.length };
});

check('reprinted Tasha content is absent from compatibility profile', () => {
  const ids = new Set(tasha.items.map((item) => item.id));
  for (const id of [
    'tcoe-2020-class-artificer',
    'tcoe-2020-subclass-circle-of-stars',
    'tcoe-2020-subclass-way-of-mercy',
    'tcoe-2020-subclass-oath-of-glory',
    'tcoe-2020-subclass-fey-wanderer',
    'tcoe-2020-subclass-soulknife',
    'tcoe-2020-subclass-aberrant-mind',
    'tcoe-2020-subclass-clockwork-soul',
    'tcoe-2020-spell-summon-beast',
    'tcoe-2020-feat-chef'
  ]) assert.equal(ids.has(id), false, `${id} deveria usar a versão 2024/Forge`);
  return { checked: 10 };
});

check('Barbarian 2024 + Path of the Beast legacy', () => buildLegacySubclass({
  classId: 'phb-2024-class-barbarian', subclassId: 'tcoe-2020-subclass-path-of-the-beast', level: 3,
  expectedFeatures: ['Rage', 'Form of the Beast']
}));
check('Cleric 2024 + Order Domain legacy at level 3', () => buildLegacySubclass({
  classId: 'phb-2024-class-cleric', subclassId: 'tcoe-2020-subclass-order-domain', level: 3,
  expectedFeatures: ['Voice of Authority', "Channel Divinity: Order's Demand"], excludedFeatures: ['Divine Strike', 'Potent Spellcasting']
}));
check('Cleric 2024 + Order Domain uses Blessed Strikes at level 8', () => buildLegacySubclass({
  classId: 'phb-2024-class-cleric', subclassId: 'tcoe-2020-subclass-order-domain', level: 8,
  expectedFeatures: ['Voice of Authority', 'Blessed Strikes'], excludedFeatures: ['Divine Strike', 'Potent Spellcasting']
}));
check('Druid 2024 + Circle of Wildfire legacy', () => buildLegacySubclass({
  classId: 'phb-2024-class-druid', subclassId: 'tcoe-2020-subclass-circle-of-wildfire', level: 3,
  expectedFeatures: ['Summon Wildfire Spirit']
}));
check('Fighter 2024 + Rune Knight legacy', () => buildLegacySubclass({
  classId: 'phb-2024-class-fighter', subclassId: 'tcoe-2020-subclass-rune-knight', level: 3,
  expectedFeatures: ['Rune Carver', "Giant's Might"]
}));
check('Warlock 2024 + The Genie legacy', () => buildLegacySubclass({
  classId: 'phb-2024-class-warlock', subclassId: 'tcoe-2020-subclass-the-genie', level: 3,
  expectedFeatures: ["Genie's Vessel"]
}));
check('Wizard 2024 + Bladesinging legacy', () => buildLegacySubclass({
  classId: 'phb-2024-class-wizard', subclassId: 'tcoe-2020-subclass-bladesinging', level: 3,
  expectedFeatures: ['Bladesong']
}));


check('PHB 2014 delta has exactly the 12 official retained options projected for 2024', () => {
  const subclasses = phb2014Delta.items.filter((item) => item.kind === 'subclass');
  const species = phb2014Delta.items.filter((item) => item.kind === 'species');
  const feats = phb2014Delta.items.filter((item) => item.kind === 'feat');
  assert.equal(subclasses.length, 7);
  assert.equal(species.length, 2);
  assert.equal(feats.length, 3);
  for (const item of subclasses) {
    assert.match(item.payload.classId, /^phb-2024-class-(cleric|wizard)$/i, `${item.id}: owner runtime não é PHB 2024`);
    assert.equal(item.payload.progression?.[0]?.level, 3, `${item.id}: primeiro nível da subclass não foi projetado para 3`);
  }
  for (const item of species) {
    assert.equal(item.payload.mechanics?.ignoreLegacySpeciesAbilityScoreIncrease, true, `${item.id}: ASI legacy precisa ficar desativado no perfil 2024`);
  }
  return { itemCount: phb2014Delta.items.length, subclasses: subclasses.length, species: species.length, feats: feats.length };
});

check('Cleric 2024 + Knowledge Domain legacy at level 3', () => buildLegacySubclass({
  classId: 'phb-2024-class-cleric', subclassId: 'phb-2014-subclass-cleric-knowledge-domain', level: 3,
  expectedFeatures: ['Blessings of Knowledge', 'Channel Divinity: Knowledge of the Ages'], excludedFeatures: ['Potent Spellcasting', 'Divine Strike']
}));
check('Cleric 2024 + Knowledge Domain uses Blessed Strikes at level 8', () => buildLegacySubclass({
  classId: 'phb-2024-class-cleric', subclassId: 'phb-2014-subclass-cleric-knowledge-domain', level: 8,
  expectedFeatures: ['Blessings of Knowledge', 'Blessed Strikes'], excludedFeatures: ['Potent Spellcasting', 'Divine Strike']
}));
check('Cleric 2024 + Nature Domain legacy at level 6', () => buildLegacySubclass({
  classId: 'phb-2024-class-cleric', subclassId: 'phb-2014-subclass-cleric-nature-domain', level: 6,
  expectedFeatures: ['Acolyte of Nature', 'Channel Divinity: Charm Animals and Plants', 'Dampen Elements'], excludedFeatures: ['Divine Strike']
}));
check('Cleric 2024 + Nature Domain uses Blessed Strikes at level 8', () => buildLegacySubclass({
  classId: 'phb-2024-class-cleric', subclassId: 'phb-2014-subclass-cleric-nature-domain', level: 8,
  expectedFeatures: ['Acolyte of Nature', 'Blessed Strikes'], excludedFeatures: ['Divine Strike']
}));
check('Cleric 2024 + Tempest Domain legacy at level 3', () => buildLegacySubclass({
  classId: 'phb-2024-class-cleric', subclassId: 'phb-2014-subclass-cleric-tempest-domain', level: 3,
  expectedFeatures: ['Wrath of the Storm', 'Channel Divinity: Destructive Wrath'], excludedFeatures: ['Divine Strike']
}));
check('Cleric 2024 + Tempest Domain reaches Stormborn and uses Blessed Strikes', () => buildLegacySubclass({
  classId: 'phb-2024-class-cleric', subclassId: 'phb-2014-subclass-cleric-tempest-domain', level: 17,
  expectedFeatures: ['Wrath of the Storm', 'Blessed Strikes', 'Stormborn'], excludedFeatures: ['Divine Strike']
}));
check('Wizard 2024 + School of Conjuration legacy', () => buildLegacySubclass({
  classId: 'phb-2024-class-wizard', subclassId: 'phb-2014-subclass-wizard-school-of-conjuration', level: 6,
  expectedFeatures: ['Minor Conjuration', 'Benign Transposition']
}));
check('Wizard 2024 + School of Enchantment legacy', () => buildLegacySubclass({
  classId: 'phb-2024-class-wizard', subclassId: 'phb-2014-subclass-wizard-school-of-enchantment', level: 3,
  expectedFeatures: ['Hypnotic Gaze']
}));
check('Wizard 2024 + School of Necromancy legacy', () => buildLegacySubclass({
  classId: 'phb-2024-class-wizard', subclassId: 'phb-2014-subclass-wizard-school-of-necromancy', level: 6,
  expectedFeatures: ['Grim Harvest', 'Undead Thralls']
}));
check('Wizard 2024 + School of Transmutation legacy', () => buildLegacySubclass({
  classId: 'phb-2024-class-wizard', subclassId: 'phb-2014-subclass-wizard-school-of-transmutation', level: 6,
  expectedFeatures: ['Minor Alchemy', "Transmuter's Stone"]
}));

check('PHB 2014 delta keeps 2014 class ids only as provenance, never as runtime owners', () => {
  const runtimeOwners = phb2014Delta.items
    .filter((item) => item.kind === 'subclass' || item.kind === 'feature')
    .map((item) => item.payload?.classId)
    .filter((id) => typeof id === 'string');
  assert.equal(runtimeOwners.some((id) => id.startsWith('phb-2014-class-')), false);
  const provenance = phb2014Delta.items
    .filter((item) => item.kind === 'subclass')
    .map((item) => item.payload?.mechanics?.originalClassId)
    .filter(Boolean);
  assert.deepEqual(new Set(provenance), new Set(['phb-2014-class-cleric', 'phb-2014-class-wizard']));
  return { runtimePhb2014Owners: 0, provenanceClassIds: [...new Set(provenance)] };
});

check('Martial Adept resolves its additional Tasha maneuvers in the installed catalog', () => {
  const feat = phb2014Delta.items.find((item) => item.id === 'phb-2014-feat-martial-adept');
  assert.ok(feat);
  const additional = feat.payload.mechanics?.maneuverChoice?.additionalCatalogFeatureIds ?? [];
  assert.equal(additional.length, 7);
  for (const id of additional) assert.ok(items.some((item) => item.importItemId === id), `Maneuver adicional ausente: ${id}`);
  return { additionalManeuvers: additional.length };
});

check('Tasha profile contains no PHB 2014 reference', () => {
  const serializedItems = JSON.stringify(tasha.items);
  assert.equal(serializedItems.includes('phb-2014-'), false);
  assert.deepEqual(tasha.metadata?.externalDependencies?.phb2014 ?? [], []);
  return { unresolvedPhb2014: 0 };
});

check('Custom Lineage is retained without a species ASI in the 2024 profile', () => {
  const lineage = tasha.items.find((item) => item.id === 'tcoe-2020-species-custom-lineage');
  assert.ok(lineage);
  assert.equal('abilityScoreIncrease' in lineage.payload, false);
  assert.equal('abilityScoreIncreaseRule' in lineage.payload, false);
  assert.equal(lineage.payload.mechanics?.ignoreLegacySpeciesAbilityScoreIncrease, true);
  return { speciesId: lineage.id };
});

const failures = checks.filter((entry) => !entry.pass);
const report = {
  schemaVersion: 'dnd-combat-2024-legacy-character-smoke.v1',
  compatibilityProfile: '2024-first+legacy',
  packs: packs.map((pack) => ({ id: pack.id, items: pack.items.length })),
  checks,
  passed: checks.length - failures.length,
  failed: failures.length,
  pass: failures.length === 0
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[compendium:legacy:2024:smoke] ${report.pass ? 'PASS' : 'FAIL'} — ${report.passed}/${checks.length}`);
for (const entry of checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.error ? ` — ${entry.error}` : ''}`);
console.log(`report=${path.relative(root, reportPath)}`);
if (failures.length) process.exit(1);
