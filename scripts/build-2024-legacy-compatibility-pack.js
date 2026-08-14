#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const sourcePath = path.join(root, 'artifacts', 'compendium', 'integration', 'v2', 'tcoe-2020-full-consolidated-import-pack-v2-canonical.json');
const phbPath = path.join(root, 'assets', 'compendium', 'phb-2024-full-consolidated-import-pack-v2-canonical.json');
const forgePath = path.join(root, 'assets', 'compendium', 'forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json');
const targetPath = path.join(root, 'assets', 'compendium', 'tcoe-2020-2024-compatible-import-pack-v2-canonical.json');
const checksumPath = `${targetPath}.sha256`;
const reportPath = path.join(root, 'artifacts', 'compendium', 'integration', 'tasha-2024-compatibility-report.json');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const normalizeName = (value) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');
const clone = (value) => JSON.parse(JSON.stringify(value));
const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const source = readJson(sourcePath);
const phb = readJson(phbPath);
const forge = readJson(forgePath);
const phbById = new Map(phb.items.map((item) => [item.id, item]));
const forgeById = new Map(forge.items.map((item) => [item.id, item]));

const indexByKindName = (pack) => {
  const index = new Map();
  for (const item of pack.items) {
    const key = `${item.kind}:${normalizeName(item.name)}`;
    const entries = index.get(key) ?? [];
    entries.push(item);
    index.set(key, entries);
  }
  return index;
};
const phbByKindName = indexByKindName(phb);
const forgeByKindName = indexByKindName(forge);

const sourceById = new Map(source.items.map((item) => [item.id, item]));
const suppressed = new Map();
const aliases = new Map();
const adaptations = [];

const suppress = (itemOrId, reason, replacementId) => {
  const item = typeof itemOrId === 'string' ? sourceById.get(itemOrId) : itemOrId;
  if (!item || suppressed.has(item.id)) return;
  suppressed.set(item.id, { id: item.id, kind: item.kind, name: item.name, reason, replacementId });
  if (replacementId) aliases.set(item.id, replacementId);
};

// 2024-first rule: the 2025 Artificer is installed and supersedes the 2020 Artificer branch.
const legacyArtificerClassId = 'tcoe-2020-class-artificer';
aliases.set(legacyArtificerClassId, 'forge-artificer-2025-class-artificer');
suppress(legacyArtificerClassId, 'Superseded by Forge of the Artificer 2025 Artificer.', 'forge-artificer-2025-class-artificer');
const legacyArtificerSubclassIds = new Set(source.items
  .filter((item) => item.kind === 'subclass' && item.payload?.classId === legacyArtificerClassId)
  .map((item) => item.id));
for (const item of source.items) {
  const payload = asObject(item.payload);
  const ownedByLegacyArtificer = payload.classId === legacyArtificerClassId
    || legacyArtificerSubclassIds.has(payload.subclassId);
  if (ownedByLegacyArtificer || legacyArtificerSubclassIds.has(item.id)) {
    const matches = forgeByKindName.get(`${item.kind}:${normalizeName(item.name)}`) ?? [];
    const replacement = matches.length === 1 ? matches[0].id : undefined;
    suppress(item, 'Superseded by the 2025 Artificer rules branch.', replacement);
  }
}
for (const item of source.items) {
  if (item.kind !== 'creatureStatBlock') continue;
  if (!['Steel Defender', 'Homunculus Servant'].includes(item.name)) continue;
  const matches = forgeByKindName.get(`${item.kind}:${normalizeName(item.name)}`) ?? [];
  suppress(item, 'Superseded by Forge of the Artificer 2025 companion stat block.', matches.length === 1 ? matches[0].id : undefined);
}

// Most Tasha optional class features belong to the 2014 class implementations. 2024 classes use
// their own feature set. Warlock Eldritch Invocations are the exception: options that were not
// reprinted in PHB 2024 remain valid legacy choices on the 2024 Warlock chassis. Reprinted
// invocations resolve to the PHB 2024 version instead of creating duplicates. Pact of the
// Talisman is adapted below as an invocation-style Pact option so its dependent Tasha
// invocations remain selectable without restoring the entire 2014 Pact Boon feature.
const tashaPactOfTheTalismanId = 'tcoe-2020-feature-warlock-pact-of-the-talisman';
const tashaInvocationOptionHubId = 'tcoe-2020-feature-warlock-eldritch-invocation-options';
for (const item of source.items) {
  const payload = asObject(item.payload);
  if (item.kind !== 'feature'
      || typeof payload.classId !== 'string'
      || !payload.classId.startsWith('phb-2014-class-')
      || payload.subclassId) continue;

  const isWarlockInvocation = payload.classId === 'phb-2014-class-warlock'
    && String(payload.sourceType ?? '').toLowerCase() === 'eldritchinvocation';
  if (isWarlockInvocation) {
    const displayName = String(item.name ?? '').replace(/^Eldritch Invocation:\s*/i, '');
    const replacements = phbByKindName.get(`feature:${normalizeName(displayName)}`) ?? [];
    const replacement = replacements.find((candidate) => String(candidate.payload?.sourceType ?? '').toLowerCase() === 'eldritchinvocation');
    if (replacement) {
      suppress(item, 'Eldritch Invocation was reprinted in PHB 2024; the 2024 version takes precedence.', replacement.id);
    }
    continue;
  }

  if (item.id === tashaPactOfTheTalismanId) continue;
  if (item.id === tashaInvocationOptionHubId) {
    suppress(item, 'Invocation option hub is represented by the individual selectable invocation records in the 2024-first projection.');
    continue;
  }

  let replacement;
  const sameClassFeatureCandidate = `phb-2024-${item.id.replace(/^tcoe-2020-/, '')}`;
  if (phbById.has(sameClassFeatureCandidate)) replacement = sameClassFeatureCandidate;
  suppress(item, 'Tasha optional class feature is scoped to the 2014 class implementation; 2024 class rules take precedence.', replacement);
}
for (const id of ['tcoe-2020-feature-ranger-beast-master-primal-companion']) {
  suppress(id, '2014 Beast Master optional replacement is superseded by the 2024 Beast Master implementation.', 'phb-2024-feature-ranger-beast-master-primal-companion');
}
for (const name of ['Beast of the Land', 'Beast of the Sea', 'Beast of the Sky']) {
  const item = source.items.find((entry) => entry.kind === 'creatureStatBlock' && entry.name === name);
  const matches = phbByKindName.get(`creatureStatBlock:${normalizeName(name)}`) ?? [];
  if (item) suppress(item, '2024 Beast Master provides the current companion stat block.', matches.length === 1 ? matches[0].id : undefined);
}

// Character-origin customizations that directly modify the old species/ASI model are superseded by 2024 character creation.
for (const id of [
  'tcoe-2020-feature-customizing-your-origin',
  'tcoe-2020-feature-origin-ability-score-increases',
  'tcoe-2020-feature-origin-languages',
  'tcoe-2020-feature-origin-proficiency-swaps'
]) suppress(id, '2024 character creation/background/species rules take precedence over the 2020 origin-customization layer.');

// Subclasses explicitly updated in the 2024 PHB must use the 2024 version with a 2024 class.
const renamedSubclassReplacements = new Map([
  ['tcoe-2020-subclass-circle-of-stars', 'phb-2024-subclass-druid-circle-of-the-stars'],
  ['tcoe-2020-subclass-way-of-mercy', 'phb-2024-subclass-monk-warrior-of-mercy'],
  ['tcoe-2020-subclass-aberrant-mind', 'phb-2024-subclass-sorcerer-aberrant-sorcery'],
  ['tcoe-2020-subclass-clockwork-soul', 'phb-2024-subclass-sorcerer-clockwork-sorcery']
]);
const supersededSubclassIds = new Set();
for (const item of source.items.filter((entry) => entry.kind === 'subclass' && String(entry.payload?.classId ?? '').startsWith('phb-2014-class-'))) {
  const exactMatches = phbByKindName.get(`subclass:${normalizeName(item.name)}`) ?? [];
  const replacement = renamedSubclassReplacements.get(item.id) ?? (exactMatches.length === 1 ? exactMatches[0].id : undefined);
  if (!replacement) continue;
  supersededSubclassIds.add(item.id);
  suppress(item, 'Subclass has a 2024 PHB version; the 2024 version replaces the legacy Tasha version.', replacement);
}
for (const item of source.items) {
  if (item.kind === 'feature' && supersededSubclassIds.has(item.payload?.subclassId)) {
    const replacementSubclassId = aliases.get(item.payload.subclassId);
    const replacementSubclass = replacementSubclassId ? phbById.get(replacementSubclassId) : undefined;
    let replacement;
    if (replacementSubclass) {
      const candidates = phbByKindName.get(`feature:${normalizeName(item.name)}`) ?? [];
      const owned = candidates.filter((candidate) => candidate.payload?.subclassId === replacementSubclassId);
      if (owned.length === 1) replacement = owned[0].id;
    }
    suppress(item, 'Feature belongs to a Tasha subclass replaced by its 2024 PHB version.', replacement);
  }
}

// Feats and spells reprinted in PHB 2024 use the PHB 2024 version.
for (const kind of ['feat', 'spell']) {
  for (const item of source.items.filter((entry) => entry.kind === kind)) {
    const matches = phbByKindName.get(`${kind}:${normalizeName(item.name)}`) ?? [];
    if (matches.length === 1) suppress(item, `${kind === 'feat' ? 'Feat' : 'Spell'} was reprinted in PHB 2024; 2024 version takes precedence.`, matches[0].id);
  }
}
// Summon/companion stat blocks whose spells were reprinted also use the 2024 stat block.
for (const item of source.items.filter((entry) => entry.kind === 'creatureStatBlock')) {
  const matches = phbByKindName.get(`creatureStatBlock:${normalizeName(item.name)}`) ?? [];
  if (matches.length === 1) suppress(item, 'Creature/stat block has a PHB 2024 replacement used by the 2024 rules.', matches[0].id);
}

// 2024 Cleric compatibility: subclass Divine Strike/Potent Spellcasting do not stack with Blessed Strikes.
for (const item of source.items) {
  if (item.kind !== 'feature' || item.payload?.classId !== 'phb-2014-class-cleric') continue;
  if (!item.payload?.subclassId) continue;
  if (item.name === 'Divine Strike' || item.name === 'Potent Spellcasting') {
    suppress(item, '2024 Cleric Blessed Strikes replaces the older subclass Divine Strike/Potent Spellcasting branch.', 'phb-2024-feature-cleric-blessed-strikes');
  }
}
// Twilight's old armor/weapon proficiencies are entirely covered by the 2024 Cleric chassis.
suppress('tcoe-2020-feature-twilight-domain-bonus-proficiencies', '2024 Cleric Divine Order/base proficiencies replace the legacy subclass weapon/armor proficiency package.');

// Build exact-prefix aliases for old PHB IDs whenever the same stable suffix exists in PHB 2024.
const addPhbPrefixAlias = (value) => {
  if (typeof value !== 'string' || !value.startsWith('phb-2014-')) return;
  const candidate = `phb-2024-${value.slice('phb-2014-'.length)}`;
  if (phbById.has(candidate)) aliases.set(value, candidate);
};
const visitStrings = (value, callback) => {
  if (typeof value === 'string') { callback(value); return; }
  if (Array.isArray(value)) { value.forEach((entry) => visitStrings(entry, callback)); return; }
  if (value && typeof value === 'object') Object.values(value).forEach((entry) => visitStrings(entry, callback));
};
visitStrings(source, addPhbPrefixAlias);

// Known renamed 2024 concepts used by retained legacy data.
aliases.set('phb-2014-feature-monk-ki', 'phb-2024-feature-monk-monks-focus');
aliases.set('phb-2014-subclass-ranger-beast-master', 'phb-2024-subclass-ranger-beast-master');
// Stable legacy spell IDs used a few different apostrophe/sluggification conventions. Resolve them
// to the exact IDs present in the installed PHB 2024 pack rather than retaining false PHB 2014 deps.
for (const [legacyId, currentId] of Object.entries({
  'phb-2014-spell-evards-black-tentacles': 'phb-2024-spell-evard-s-black-tentacles',
  'phb-2014-spell-leomund-s-tiny-hut': 'phb-2024-spell-leomunds-tiny-hut',
  'phb-2014-spell-mordenkainen-s-private-sanctum': 'phb-2024-spell-mordenkainens-private-sanctum',
  'phb-2014-spell-nystul-s-magic-aura': 'phb-2024-spell-nystuls-magic-aura',
  'phb-2014-spell-otilukes-resilient-sphere': 'phb-2024-spell-otiluke-s-resilient-sphere',
  'phb-2014-spell-rary-s-telepathic-bond': 'phb-2024-spell-rarys-telepathic-bond',
  'phb-2014-spell-tasha-s-hideous-laughter': 'phb-2024-spell-tashas-hideous-laughter',
  'phb-2014-spell-tenser-s-floating-disk': 'phb-2024-spell-tensers-floating-disk'
})) {
  if (!phbById.has(currentId)) throw new Error(`Expected PHB 2024 compatibility target is missing: ${currentId}`);
  aliases.set(legacyId, currentId);
}

// Legacy Tasha references that now have authoritative equivalents in the installed PHB 2024 pack.
// These include both runtime creature dependencies (Fungal Infestation -> Zombie) and documentation
// references used by DM tools. Keeping them on 2024 IDs removes unnecessary MM/DMG 2014 dependencies.
for (const [legacyId, currentId] of Object.entries({
  'mm-2014-creature-cat': 'phb-2024-creature-cat',
  'mm-2014-creature-giant-spider': 'phb-2024-creature-giant-spider',
  'mm-2014-creature-skeleton': 'phb-2024-creature-skeleton',
  'mm-2014-creature-zombie': 'phb-2024-creature-zombie',
  'dmg-2014-magic-item-potion-of-healing': 'phb-2024-magic-item-potion-of-healing',
  'dmg-2014-rule-exhaustion': 'phb-2024-condition-exhaustion'
})) {
  if (!phbById.has(currentId)) throw new Error(`Expected PHB 2024 compatibility target is missing: ${currentId}`);
  aliases.set(legacyId, currentId);
}
// Martial Adept is a legacy-only PHB 2014 option. Tasha's added maneuvers remain available through
// Battle Master / other retained maneuver-granting rules, so this optional cross-link is omitted from
// the 2024-first projection instead of forcing the whole PHB 2014 catalog to be installed.
const omittedOptionalLegacyReferences = new Set(['phb-2014-feat-martial-adept']);

const remapSubclassLevel = (classId, level) => {
  if (level === undefined || level === null) return level;
  if (classId === 'phb-2014-class-cleric' && (level === 1 || level === 2)) return 3;
  if (classId === 'phb-2014-class-druid' && level === 2) return 3;
  if (classId === 'phb-2014-class-sorcerer' && level === 1) return 3;
  if (classId === 'phb-2014-class-warlock' && level === 1) return 3;
  if (classId === 'phb-2014-class-wizard' && level === 2) return 3;
  return level;
};

const rewriteValue = (value) => {
  if (typeof value === 'string') {
    if (aliases.has(value)) return aliases.get(value);
    if (suppressed.has(value)) return undefined;
    if (omittedOptionalLegacyReferences.has(value)) return undefined;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(rewriteValue).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      const rewrittenKey = aliases.has(key)
        ? aliases.get(key)
        : (suppressed.has(key) || omittedOptionalLegacyReferences.has(key) ? undefined : key);
      if (rewrittenKey === undefined) continue;
      const rewritten = rewriteValue(entry);
      if (rewritten !== undefined) result[rewrittenKey] = rewritten;
    }
    return result;
  }
  return value;
};

const retained = [];
for (const original of source.items) {
  if (suppressed.has(original.id)) continue;
  const item = clone(original);
  const originalPayload = asObject(original.payload);
  item.payload = rewriteValue(item.payload);

  if (item.id === tashaPactOfTheTalismanId) {
    item.payload.sourceType = 'eldritchInvocation';
    item.payload.classId = 'phb-2024-class-warlock';
    item.payload.levelGained = 3;
    item.payload.prerequisite = 'Level 3+ Warlock';
    const talismanMechanics = { ...asObject(item.payload.mechanics) };
    delete talismanMechanics.optionForFeatureId;
    item.payload.mechanics = {
      ...talismanMechanics,
      compatibilityTarget: '2024-warlock-invocation',
      legacySource: true,
      legacyPactBoonAsInvocation: true
    };
    item.payload.references = (item.payload.references ?? []).filter((reference) => reference !== 'phb-2014-feature-warlock-pact-boon');
    item.payload.tags = [...new Set([...(item.payload.tags ?? []), '2024-compatible', 'legacy-adapted', 'eldritch-invocation'])];
    item.payload.extractionNotes = [
      ...(item.payload.extractionNotes ?? []),
      '2024 compatibility projection: Pact of the Talisman is represented as a level-3 Eldritch Invocation-style Pact option so Tasha talisman invocations remain usable on the 2024 Warlock chassis.'
    ];
    adaptations.push({ id: item.id, type: 'warlock-pact-talisman-as-invocation', fromClassId: originalPayload.classId, toClassId: item.payload.classId, level: 3 });
  } else if (item.kind === 'feature' && String(originalPayload.sourceType ?? '').toLowerCase() === 'eldritchinvocation' && originalPayload.classId === 'phb-2014-class-warlock') {
    item.payload.classId = 'phb-2024-class-warlock';
    item.payload.mechanics = {
      ...asObject(item.payload.mechanics),
      compatibilityTarget: '2024-warlock-invocation',
      legacySource: true
    };
    item.payload.tags = [...new Set([...(item.payload.tags ?? []), '2024-compatible', 'legacy-adapted', 'eldritch-invocation'])];
    item.payload.extractionNotes = [
      ...(item.payload.extractionNotes ?? []),
      '2024 compatibility projection: legacy-only Tasha Eldritch Invocation retained and attached to the 2024 Warlock chassis.'
    ];
    adaptations.push({ id: item.id, type: 'warlock-invocation-owner', fromClassId: originalPayload.classId, toClassId: item.payload.classId });
  }

  // Legacy subclass owners use the 2024 class chassis and 2024 subclass unlock timing.
  if (item.kind === 'subclass' && typeof originalPayload.classId === 'string' && originalPayload.classId.startsWith('phb-2014-class-')) {
    const progression = Array.isArray(item.payload.progression) ? item.payload.progression : [];
    const grouped = new Map();
    for (const originalRow of Array.isArray(originalPayload.progression) ? originalPayload.progression : []) {
      const level = remapSubclassLevel(originalPayload.classId, originalRow.level);
      const featureIds = (originalRow.featureIds ?? [])
        .map((id) => rewriteValue(id))
        .filter(Boolean);
      if (!featureIds.length) continue;
      const current = grouped.get(level) ?? [];
      for (const id of featureIds) if (!current.includes(id)) current.push(id);
      grouped.set(level, current);
    }
    item.payload.progression = [...grouped.entries()]
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([level, featureIds]) => ({ level: Number(level), featureIds }));
    item.payload.featureIds = (item.payload.featureIds ?? []).filter((id) => !suppressed.has(id));
    item.payload.mechanics = { ...asObject(item.payload.mechanics), compatibilityTarget: '2024-class-chassis', legacySource: true };
    item.payload.tags = [...new Set([...(item.payload.tags ?? []), '2024-compatible', 'legacy-adapted'])];
    adaptations.push({ id: item.id, type: 'subclass-owner-and-progression', fromClassId: originalPayload.classId, toClassId: item.payload.classId });
  }

  if (item.kind === 'feature' && originalPayload.subclassId && typeof originalPayload.classId === 'string' && originalPayload.classId.startsWith('phb-2014-class-')) {
    const previousLevel = originalPayload.levelGained;
    const nextLevel = remapSubclassLevel(originalPayload.classId, previousLevel);
    if (nextLevel !== previousLevel) item.payload.levelGained = nextLevel;
    item.payload.mechanics = { ...asObject(item.payload.mechanics), compatibilityTarget: '2024-class-chassis', legacySource: true };
    item.payload.tags = [...new Set([...(item.payload.tags ?? []), '2024-compatible', 'legacy-adapted'])];
    adaptations.push({ id: item.id, type: 'subclass-feature-owner', fromClassId: originalPayload.classId, toClassId: item.payload.classId, fromLevel: previousLevel, toLevel: nextLevel });
  }

  // Order Domain keeps its skill choice, but its heavy-armor proficiency is handled by the 2024 Cleric chassis.
  if (item.id === 'tcoe-2020-feature-order-domain-bonus-proficiencies') {
    const mechanics = asObject(item.payload.mechanics);
    delete mechanics.armorProficiencies;
    item.payload.mechanics = { ...mechanics, compatibilityTarget: '2024-class-chassis', legacySource: true };
    item.payload.extractionNotes = [
      ...(item.payload.extractionNotes ?? []),
      '2024 compatibility projection: legacy heavy-armor proficiency omitted; the unique Intimidation/Persuasion skill choice is retained.'
    ];
    adaptations.push({ id: item.id, type: 'cleric-proficiency-trim', retained: ['skillChoice'], removed: ['armorProficiencies'] });
  }

  // Older species remain usable, but 2024 backgrounds own ability-score increases.
  if (item.id === 'tcoe-2020-species-custom-lineage') {
    for (const key of ['abilityScoreOptions', 'abilityScoreIncreaseRule', 'abilityScoreIncrease', 'abilityScores']) delete item.payload[key];
    const mechanics = asObject(item.payload.mechanics);
    for (const key of ['abilityScoreIncrease', 'abilityScoreOptions', 'abilityScoreIncreaseRule']) delete mechanics[key];
    item.payload.mechanics = { ...mechanics, compatibilityTarget: '2024-character-creation', ignoreLegacySpeciesAbilityScoreIncrease: true };
    item.payload.tags = [...new Set([...(item.payload.tags ?? []), '2024-compatible', 'legacy-species'])];
    item.payload.extractionNotes = [
      ...(item.payload.extractionNotes ?? []),
      '2024 compatibility projection: species ability-score increase is ignored; ability-score increases come from the selected background.'
    ];
    adaptations.push({ id: item.id, type: 'legacy-species-asi-removed' });
  }

  retained.push(item);
}

const countsByKind = retained.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] ?? 0) + 1;
  return acc;
}, {});

const allRetainedIds = new Set(retained.map((item) => item.id));
const embeddedIds = new Set();
const collectEmbeddedIds = (value) => {
  if (Array.isArray(value)) { value.forEach(collectEmbeddedIds); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'id' && typeof entry === 'string' && entry.startsWith('tcoe-2020-')) embeddedIds.add(entry);
    collectEmbeddedIds(entry);
  }
};
retained.forEach((item) => collectEmbeddedIds(item.payload));
const unresolvedInternal = [];
for (const item of retained) {
  visitStrings(item.payload, (value) => {
    if (value.startsWith('tcoe-2020-') && !allRetainedIds.has(value) && !embeddedIds.has(value)) unresolvedInternal.push({ itemId: item.id, referenceId: value });
  });
}
const uniqueUnresolvedInternal = [...new Map(unresolvedInternal.map((entry) => [`${entry.itemId}:${entry.referenceId}`, entry])).values()];

const externalIdSet = new Set();
visitStrings(retained, (value) => {
  if (/^(phb-2014|phb-2024|dmg-2014|mm-2014|xgte-2017|forge-artificer-2025)-/.test(value) && !allRetainedIds.has(value)) externalIdSet.add(value);
});
const externalBySource = {};
for (const id of [...externalIdSet].sort()) {
  const sourceKey = id.startsWith('phb-2014-') ? 'phb2014'
    : id.startsWith('phb-2024-') ? 'phb2024'
    : id.startsWith('dmg-2014-') ? 'dmg2014'
    : id.startsWith('mm-2014-') ? 'mm2014'
    : id.startsWith('xgte-2017-') ? 'xgte2017'
    : id.startsWith('forge-artificer-2025-') ? 'forge2025'
    : 'other';
  (externalBySource[sourceKey] ??= []).push(id);
}

const compatible = {
  ...source,
  id: 'tcoe-2020-2024-compatible-import-pack-v2',
  source: {
    ...source.source,
    notes: `${source.source?.notes ?? ''} Derived 2024-first compatibility projection: PHB 2024/Forge 2025 supersede reprinted content; eligible legacy subclasses are attached to the 2024 class chassis.`.trim()
  },
  metadata: {
    ...source.metadata,
    edition: '2024+legacy',
    extractionScope: '2024-first-legacy-compatibility-projection',
    itemRecords: retained.length,
    itemsByKind: Object.fromEntries(Object.entries(countsByKind).sort(([a], [b]) => a.localeCompare(b))),
    validation: {
      status: uniqueUnresolvedInternal.length ? 'NEEDS_REVIEW_INTERNAL_REFERENCES' : 'READY_FOR_RUNTIME_PREVIEW',
      uniqueItemIds: new Set(retained.map((item) => item.id)).size,
      duplicateItemIds: retained.length - new Set(retained.map((item) => item.id)).size,
      brokenInternalEntityReferences: uniqueUnresolvedInternal.length
    },
    compatibility: {
      profile: '2024-first+legacy',
      derivedFromPackId: source.id,
      targetCorePackId: phb.id,
      targetArtificerPackId: forge.id,
      policy: [
        'PHB 2024 replaces PHB 2014 core material where a 2024 version exists.',
        'Tasha/Xanathar subclasses, spells, and feats reprinted in PHB 2024 use the PHB 2024 version.',
        'Tasha optional class features are not projected onto 2024 classes, except legacy-only Warlock invocations and Pact of the Talisman adapted to the 2024 invocation chassis.',
        'Legacy subclasses without a 2024 replacement use the 2024 base class and 2024 subclass unlock timing.',
        'Legacy species ignore species ability-score increases when used with 2024 character creation.',
        'Forge of the Artificer 2025 supersedes the Tasha 2020 Artificer branch.'
      ],
      suppressedCount: suppressed.size,
      retainedCount: retained.length,
      adaptedCount: adaptations.length,
      aliasCount: aliases.size
    },
    references: {
      externalUniqueEntityIds: externalIdSet.size,
      externalUniqueBySource: Object.fromEntries(Object.entries(externalBySource).map(([key, values]) => [key, values.length])),
      unresolvedTashaInternalReferences: uniqueUnresolvedInternal.length
    },
    externalDependencies: {
      policy: '2024 IDs are preferred automatically when the same stable PHB suffix exists; legacy-only references that are not required by the 2024-first profile are omitted rather than forcing PHB 2014 installation.',
      omittedOptionalLegacyReferences: [...omittedOptionalLegacyReferences].sort(),
      ...externalBySource
    }
  },
  items: retained
};
// Source-audit-only metadata is stale after projection and is intentionally removed.
delete compatible.metadata.crossSourceDeduplication;
delete compatible.metadata.batchSha256;

const outputText = pretty(compatible);
const digest = sha256(outputText);
const checksumText = `${digest}  ${path.basename(targetPath)}\n`;
const report = {
  schemaVersion: 'dnd-combat-2024-legacy-compatibility-report.v1',
  sourcePackId: source.id,
  outputPackId: compatible.id,
  sourceItems: source.items.length,
  retainedItems: retained.length,
  suppressedItems: suppressed.size,
  itemsByKind: compatible.metadata.itemsByKind,
  suppressed: [...suppressed.values()].sort((a, b) => a.id.localeCompare(b.id)),
  adaptations,
  aliases: [...aliases.entries()].map(([from, to]) => ({ from, to })).sort((a, b) => a.from.localeCompare(b.from)),
  unresolvedInternalReferences: uniqueUnresolvedInternal,
  externalDependencies: externalBySource,
  omittedOptionalLegacyReferences: [...omittedOptionalLegacyReferences].sort(),
  sha256: digest
};

if (uniqueUnresolvedInternal.length) {
  console.error(`Compatibility projection has ${uniqueUnresolvedInternal.length} unresolved internal Tasha reference(s).`);
  console.error(pretty(uniqueUnresolvedInternal.slice(0, 20)));
  process.exit(1);
}

if (checkOnly) {
  if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8') !== outputText) throw new Error('Tasha 2024-compatible pack is stale; run npm run compendium:legacy:2024:adapt.');
  if (!fs.existsSync(checksumPath) || fs.readFileSync(checksumPath, 'utf8') !== checksumText) throw new Error('Tasha 2024-compatible checksum is stale.');
  if (!fs.existsSync(reportPath)) throw new Error('Tasha 2024 compatibility report is missing.');
  const existingReport = readJson(reportPath);
  const stableExisting = { ...existingReport }; delete stableExisting.generatedAt;
  if (JSON.stringify(stableExisting) !== JSON.stringify(report)) throw new Error('Tasha 2024 compatibility report is stale.');
} else {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(targetPath, outputText);
  fs.writeFileSync(checksumPath, checksumText);
  fs.writeFileSync(reportPath, pretty(report));
}

console.log(`PASS: Tasha 2020 projected to 2024-first legacy profile: ${retained.length}/${source.items.length} items retained; ${suppressed.size} superseded/incompatible items omitted; ${Object.keys(externalBySource).includes('phb2014') ? externalBySource.phb2014.length : 0} unresolved PHB 2014 soft refs remain.`);
