#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado.');
};
const ts = loadTypeScript();
require.extensions['.ts'] = (mod, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText;
  mod._compile(output, filename);
};

const creationData = require(path.join(root, 'src/characters/creationData.ts'));
const proficiencyRules = require(path.join(root, 'src/characters/proficiencyRules.ts'));
const startingEquipment = require(path.join(root, 'src/characters/startingEquipmentRules.ts'));
const customBackground = require(path.join(root, 'src/characters/customBackgroundRules.ts'));
const featChoiceRules = require(path.join(root, 'src/characters/featChoiceRules.ts'));
const spellcastingRules = require(path.join(root, 'src/characters/spellcastingRules.ts'));
const classProgression = require(path.join(root, 'src/compendium/classProgression.ts'));
const invocationRules = require(path.join(root, 'src/characters/eldritchInvocationRules.ts'));
const invocationChoices = require(path.join(root, 'src/characters/eldritchInvocationChoiceRules.ts'));
const companionRules = require(path.join(root, 'src/characters/pactChainCompanionRules.ts'));
const mapper = require(path.join(root, 'src/compendium/mapper.ts'));
const { createEmptyCharacter } = require(path.join(root, 'src/data/mockData.ts'));

const v1 = require(path.join(root, 'assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json'));
const v2 = require(path.join(root, 'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json'));
const importedAt = '2026-08-11T10:00:00.000Z';
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
  tags: [item.kind, item.name.toLowerCase(), ...(Array.isArray(item.payload.tags) ? item.payload.tags.filter((tag) => typeof tag === 'string') : [])],
  status: 'validated',
  reviewDecision: 'approved',
  createdAt: importedAt,
  updatedAt: importedAt
}));
const a = toStored(v1);
const b = toStored(v2);
const enabled = (items) => [...new Set(items.map((item) => item.sourceId))];
const find = (items, id) => {
  const item = items.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};
const ids = (items) => items.map((item) => item.importItemId).sort();
const optionShape = (options) => options.map((option) => ({ optionId: option.optionId, labels: option.labels, goldPieces: option.goldPieces }));
const characterForWeapon = () => ({ ...createEmptyCharacter('Parity'), abilities: { STR: 10, DEX: 18, CON: 14, INT: 12, WIS: 12, CHA: 16 } });

const representativeBuildShape = (items) => {
  let character = createEmptyCharacter('Representative PHB Build');
  for (const itemId of [
    'phb-2024-class-warlock',
    'phb-2024-species-human',
    'phb-2024-background-criminal',
    'phb-2024-feat-alert',
    'phb-2024-spell-eldritch-blast'
  ]) {
    const result = mapper.applyCompendiumItemToCharacter(character, find(items, itemId));
    assert.equal(result.ok, true, `${itemId} deve ser aplicável na montagem representativa`);
    character = result.character;
  }
  const warlock = find(items, 'phb-2024-class-warlock');
  const criminal = find(items, 'phb-2024-background-criminal');
  const equipmentOption = startingEquipment.getStartingEquipmentOptions(warlock, 'class')[0];
  assert.ok(equipmentOption, 'Warlock deve possuir equipamento inicial');
  character = startingEquipment.applyStartingEquipmentSelections(
    character,
    [startingEquipment.createEquipmentSelection(equipmentOption, items)],
    items
  );
  const proficiencies = proficiencyRules.buildProficiencySelection({
    startingClassItem: warlock,
    backgroundItem: criminal,
    allItems: items,
    classSkillChoices: ['Arcana', 'Deception'],
    classToolChoices: [],
    expertiseSkills: []
  });
  assert.equal(proficiencies.ok, true, 'Proficiências da montagem representativa devem ser válidas');
  return {
    level: character.level,
    classes: character.classes.map((entry) => ({ name: entry.name, level: entry.level, hitDie: entry.hitDie })),
    species: character.species?.name,
    background: character.background?.name,
    feats: character.feats.map((entry) => entry.name).sort(),
    spells: character.spells.map((entry) => ({ name: entry.name, level: entry.level, castingTime: entry.castingTime })).sort((left, right) => left.name.localeCompare(right.name)),
    weapons: character.weapons.map((entry) => ({ name: entry.name, attackAbility: entry.attackAbility, damageAbility: entry.damageAbility, damage: entry.damage.raw })).sort((left, right) => left.name.localeCompare(right.name)),
    armors: character.armors.map((entry) => entry.name).sort(),
    armorAccessories: (character.armorAccessories ?? []).map((entry) => entry.name).sort(),
    equipment: character.equipment.map((entry) => ({ name: entry.name, quantity: entry.quantity })).sort((left, right) => left.name.localeCompare(right.name)),
    currency: character.currency,
    proficiencies: proficiencies.proficiencies
  };
};

const applyOne = (items, itemId) => {
  const result = mapper.applyCompendiumItemToCharacter(createEmptyCharacter('Parity'), find(items, itemId));
  assert.equal(result.ok, true, `${itemId} deve ser aplicável`);
  return result.character;
};

const checks = [];
const check = (name, fn) => {
  try { fn(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, error: error instanceof Error ? error.message : String(error) }); }
};

check('creation candidates', () => {
  assert.deepEqual(ids(creationData.getSelectableFeatCandidates(b, enabled(b))), ids(creationData.getSelectableFeatCandidates(a, enabled(a))));
  assert.deepEqual(ids(creationData.getSelectableSpellCandidates(b, enabled(b))), ids(creationData.getSelectableSpellCandidates(a, enabled(a))));
  assert.deepEqual(
    ids(creationData.getSelectableFeatCandidates(b, enabled(b)).filter(creationData.isOriginFeatItem)),
    ids(creationData.getSelectableFeatCandidates(a, enabled(a)).filter(creationData.isOriginFeatItem))
  );
});

check('representative full character assembly', () => {
  const va = representativeBuildShape(a);
  const vb = representativeBuildShape(b);
  assert.deepEqual(vb, va);
  assert.equal(vb.level, 1);
  assert.equal(vb.species, 'Human');
  assert.equal(vb.background, 'Criminal');
  assert.ok(vb.feats.includes('Alert'));
  assert.ok(vb.spells.some((entry) => entry.name === 'Eldritch Blast'));
  for (const skill of ['Arcana', 'Deception', 'Sleight of Hand', 'Stealth']) assert.ok(vb.proficiencies.skills.includes(skill), skill);
});

check('background and proficiencies', () => {
  const ca = find(a, 'phb-2024-background-criminal');
  const cb = find(b, 'phb-2024-background-criminal');
  assert.deepEqual(creationData.backgroundSuggestions(cb), creationData.backgroundSuggestions(ca));
  const wa = find(a, 'phb-2024-class-warlock');
  const wb = find(b, 'phb-2024-class-warlock');
  assert.deepEqual(proficiencyRules.getClassProficiencyRequirement(wb, 1, b), proficiencyRules.getClassProficiencyRequirement(wa, 1, a));
  const input = { classSkillChoices: ['Arcana', 'Deception'], classToolChoices: [], expertiseSkills: [] };
  const ra = proficiencyRules.buildProficiencySelection({ startingClassItem: wa, backgroundItem: ca, allItems: a, ...input });
  const rb = proficiencyRules.buildProficiencySelection({ startingClassItem: wb, backgroundItem: cb, allItems: b, ...input });
  assert.equal(rb.ok, true);
  assert.deepEqual(rb.proficiencies, ra.proficiencies);
});

check('starting equipment', () => {
  for (const [id, kind] of [['phb-2024-class-warlock', 'class'], ['phb-2024-class-fighter', 'class'], ['phb-2024-background-criminal', 'background']]) {
    const oa = startingEquipment.getStartingEquipmentOptions(find(a, id), kind);
    const ob = startingEquipment.getStartingEquipmentOptions(find(b, id), kind);
    assert.deepEqual(optionShape(ob), optionShape(oa), id);
    assert.ok(ob.length > 0, id);
    const selection = startingEquipment.createEquipmentSelection(ob[0], b);
    assert.deepEqual(selection.labels, ob[0].labels);
  }
});

check('custom background equipment budget candidates', () => {
  const ca = customBackground.getCustomBackgroundEquipmentCandidates(a, enabled(a));
  const cb = customBackground.getCustomBackgroundEquipmentCandidates(b, enabled(b));
  const shape = (entries) => entries.map((entry) => ({ id: entry.item.importItemId, costCopper: entry.costCopper, purchaseQuantity: entry.purchaseQuantity }));
  assert.deepEqual(shape(cb), shape(ca));
  assert.equal(cb.find((entry) => entry.item.importItemId === 'phb-2024-weapon-spear')?.costCopper, 100);
  assert.equal(cb.some((entry) => entry.item.importItemId === 'phb-2024-weapon-longsword'), false);
});

check('custom background 50 GP budget', () => {
  const candidates = customBackground.getCustomBackgroundEquipmentCandidates(b, enabled(b));
  const spear = candidates.find((entry) => entry.item.importItemId === 'phb-2024-weapon-spear');
  assert.ok(spear, 'Spear deve ser elegível para custom background');
  let selections = customBackground.ensureCustomBackgroundCashEquipmentSelection([]);
  assert.equal(customBackground.getCustomBackgroundEquipmentSpentCopper(selections, candidates), 0);
  assert.deepEqual(customBackground.validateCustomBackgroundEquipmentSelection(selections, candidates), []);
  selections = customBackground.setCustomBackgroundEquipmentPurchaseCount(selections, spear, 1, candidates);
  assert.equal(customBackground.getCustomBackgroundEquipmentSpentCopper(selections, candidates), 100);
  assert.equal(selections.find((entry) => entry.sourceItemId === 'custom-background')?.currency?.gp, 49);
  const beforeOverflow = selections;
  selections = customBackground.setCustomBackgroundEquipmentPurchaseCount(selections, spear, 51, candidates);
  assert.equal(selections, beforeOverflow, 'Compra acima de 50 GP deve ser rejeitada sem alterar a seleção');
  assert.ok(customBackground.getCustomBackgroundEquipmentSpentCopper(selections, candidates) <= customBackground.CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER);
});

check('origin feat choices', () => {
  for (const id of ['phb-2024-feat-alert', 'phb-2024-feat-musician', 'phb-2024-feat-magic-initiate']) {
    assert.deepEqual(featChoiceRules.getFeatChoiceSchema(find(b, id)), featChoiceRules.getFeatChoiceSchema(find(a, id)), id);
  }
  const musician = featChoiceRules.getFeatChoiceSchema(find(b, 'phb-2024-feat-musician'));
  assert.equal(musician.toolChoiceCount, 3);
  assert.ok(musician.toolOptions.length > 3);
});

check('spellcasting profiles and deferred choices', () => {
  for (const [id, level] of [['phb-2024-class-wizard', 1], ['phb-2024-class-wizard', 7], ['phb-2024-class-warlock', 1], ['phb-2024-class-warlock', 7]]) {
    assert.deepEqual(spellcastingRules.getClassSpellcastingProfile(find(b, id), level), spellcastingRules.getClassSpellcastingProfile(find(a, id), level), `${id}@${level}`);
  }
  const pa = spellcastingRules.getClassSpellcastingProfile(find(a, 'phb-2024-class-wizard'), 1);
  const pb = spellcastingRules.getClassSpellcastingProfile(find(b, 'phb-2024-class-wizard'), 1);
  const eligibleA = a.filter((item) => spellcastingRules.isSpellItemEligibleForProfile(item, pa));
  const eligibleB = b.filter((item) => spellcastingRules.isSpellItemEligibleForProfile(item, pb));
  assert.deepEqual(ids(eligibleB), ids(eligibleA));
  const fa = find(a, 'phb-2024-spell-fire-bolt');
  const fb = find(b, 'phb-2024-spell-fire-bolt');
  const ra = spellcastingRules.validateSpellAssignments({ assignments: { [fa.id]: pa.classItemId }, spellItems: a, profiles: [pa], requireExact: false });
  const rb = spellcastingRules.validateSpellAssignments({ assignments: { [fb.id]: pb.classItemId }, spellItems: b, profiles: [pb], requireExact: false });
  assert.equal(rb.ok, true);
  assert.deepEqual(rb.countsByClassItemId[pb.classItemId], ra.countsByClassItemId[pa.classItemId]);
});

check('spell action economy', () => {
  const expectations = [
    ['phb-2024-spell-fire-bolt', 'action', true],
    ['phb-2024-spell-misty-step', 'bonusAction', true],
    ['phb-2024-spell-counterspell', 'reaction', true],
    // V1 stores the trigger alias "reactionOnHitOrMagicMissile" and the legacy mapper
    // fell back to "action". Canonical V2 promotes the semantic action cost to reaction.
    ['phb-2024-spell-shield', 'reaction', false]
  ];
  for (const [id, expected, compareLegacy] of expectations) {
    const sb = applyOne(b, id).spells.at(-1);
    assert.equal(sb?.castingTime, expected, id);
    if (compareLegacy) {
      const sa = applyOne(a, id).spells.at(-1);
      assert.equal(sb?.castingTime, sa?.castingTime, id);
    }
  }
});

check('flexible weapon ability', () => {
  const wa = mapper.buildWeaponFromCompendiumItem(characterForWeapon(), find(a, 'phb-2024-weapon-dagger')).weapon;
  const wb = mapper.buildWeaponFromCompendiumItem(characterForWeapon(), find(b, 'phb-2024-weapon-dagger')).weapon;
  assert.equal(wb.attackAbility, 'DEX');
  assert.equal(wb.damageAbility, 'DEX');
  assert.deepEqual({ attack: wb.attackAbility, damage: wb.damageAbility, raw: wb.damage.raw }, { attack: wa.attackAbility, damage: wa.damageAbility, raw: wa.damage.raw });
});

check('warlock progression and invocations', () => {
  const wa = find(a, 'phb-2024-class-warlock');
  const wb = find(b, 'phb-2024-class-warlock');
  for (const level of [1, 3, 5, 7, 10, 20]) assert.deepEqual(classProgression.getProgressionFeatureReferences(wb, level), classProgression.getProgressionFeatureReferences(wa, level), `warlock@${level}`);
  assert.equal(invocationRules.getEldritchInvocationLimit(3, [{ item: wb, level: 3 }], b), invocationRules.getEldritchInvocationLimit(3, [{ item: wa, level: 3 }], a));
  assert.deepEqual(ids(invocationRules.getSelectableEldritchInvocations(b, enabled(b))), ids(invocationRules.getSelectableEldritchInvocations(a, enabled(a))));
  const eligibleA = ids(invocationRules.getEligibleEldritchInvocations(a, enabled(a), 3));
  const eligibleB = ids(invocationRules.getEligibleEldritchInvocations(b, enabled(b), 3));
  assert.deepEqual(eligibleB, eligibleA);
  for (const id of ['phb-2024-feature-warlock-eldritch-mind', 'phb-2024-feature-warlock-pact-of-the-blade', 'phb-2024-feature-warlock-pact-of-the-chain']) assert.ok(eligibleB.includes(id), id);
  const familiarA = invocationChoices.getPactChainFamiliarCandidates(a, enabled(a)).map((entry) => [entry.item.importItemId, entry.variant]);
  const familiarB = invocationChoices.getPactChainFamiliarCandidates(b, enabled(b)).map((entry) => [entry.item.importItemId, entry.variant]);
  assert.deepEqual(familiarB, familiarA);
});

check('companion stat blocks and structured speed', () => {
  const base = { character: characterForWeapon(), invocationItemId: find(b, 'phb-2024-feature-warlock-pact-of-the-chain').id, variant: 'special', investmentActive: false };
  const ca = companionRules.buildPactChainCompanion({ ...base, creatureItem: find(a, 'phb-2024-creature-imp') });
  const cb = companionRules.buildPactChainCompanion({ ...base, creatureItem: find(b, 'phb-2024-creature-imp') });
  assert.deepEqual({ ac: cb.armorClass, hp: cb.hitPoints.max, speed: cb.speed, actions: cb.actions.map((entry) => entry.name) }, { ac: ca.armorClass, hp: ca.hitPoints.max, speed: ca.speed, actions: ca.actions.map((entry) => entry.name) });
  const conditional = find(b, 'phb-2024-creature-bestial-spirit');
  const fly = conditional.normalizedJson?.speed?.fly;
  if (fly && typeof fly === 'object' && typeof fly.value === 'number') {
    const companion = companionRules.buildPactChainCompanion({ ...base, creatureItem: conditional, variant: 'standard' });
    assert.equal(companion.speed.fly, fly.value);
  }
});

check('resources actions effects creature tags', () => {
  const innateA = applyOne(a, 'phb-2024-feature-sorcerer-innate-sorcery');
  const innateB = applyOne(b, 'phb-2024-feature-sorcerer-innate-sorcery');
  const resourceShape = (c) => c.resources.map(({ id, max, recharge }) => ({ id, max, recharge }));
  assert.deepEqual(resourceShape(innateB), resourceShape(innateA));
  const surgeA = applyOne(a, 'phb-2024-feature-fighter-action-surge');
  const surgeB = applyOne(b, 'phb-2024-feature-fighter-action-surge');
  const actionShape = (c) => c.features.at(-1)?.grantsActions?.map((entry) => [entry.name, entry.actionCost]);
  assert.deepEqual(actionShape(surgeB), actionShape(surgeA));
  const rageA = applyOne(a, 'phb-2024-feature-barbarian-rage');
  const rageB = applyOne(b, 'phb-2024-feature-barbarian-rage');
  const effectShape = (effects) => (effects ?? []).map((effect) => {
    const { source, ...gameplay } = effect;
    return gameplay;
  });
  assert.deepEqual(effectShape(rageB.features.at(-1)?.effectTemplates), effectShape(rageA.features.at(-1)?.effectTemplates));
  const tagIds = (items, tag) => items.filter((item) => item.type === 'creatureStatBlock' && Array.isArray(item.normalizedJson.tags) && item.normalizedJson.tags.includes(tag)).map((item) => item.importItemId).sort();
  assert.deepEqual(tagIds(b, 'wild-shape-candidate'), tagIds(a, 'wild-shape-candidate'));
  assert.deepEqual(tagIds(b, 'find-familiar-form'), tagIds(a, 'find-familiar-form'));
  assert.ok(tagIds(b, 'wild-shape-candidate').includes('phb-2024-creature-wolf'));
  assert.ok(tagIds(b, 'find-familiar-form').includes('phb-2024-creature-owl'));
});

const failures = checks.filter((entry) => !entry.pass);
const report = {
  schemaVersion: 'dnd-combat-import-v2-phase09-functional-parity.v1',
  source: { v1: path.basename('phb-2024-full-consolidated-import-pack-v5-complete-invocations.json'), v2: path.basename('phb-2024-full-consolidated-import-pack-v2-canonical.json') },
  itemCount: { v1: a.length, v2: b.length },
  checks,
  passed: checks.length - failures.length,
  failed: failures.length,
  functionalParity: failures.length === 0
};
const output = path.join(root, 'artifacts', 'compendium-import-v2-phase09-functional-parity-report.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[compendium:import-v2:functional-parity] ${failures.length ? 'FAIL' : 'PASS'} — ${report.passed}/${checks.length}`);
for (const entry of checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.error ? ` — ${entry.error}` : ''}`);
console.log(`report=${path.relative(root, output)}`);
if (failures.length) process.exit(1);
