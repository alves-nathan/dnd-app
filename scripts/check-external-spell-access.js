#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const compendiumDir = path.join(root, 'assets', 'compendium');
const files = fs.readdirSync(compendiumDir)
  .filter((name) => name.endsWith('-canonical.json'))
  .sort();

const items = files.flatMap((name) => {
  const parsed = JSON.parse(fs.readFileSync(path.join(compendiumDir, name), 'utf8'));
  return Array.isArray(parsed.items) ? parsed.items : [];
});
const byId = new Map(items.map((item) => [item.id, item]));
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const object = (value) => isObject(value) ? value : {};
const array = (value) => Array.isArray(value) ? value : [];
const strings = (value) => array(value).filter((entry) => typeof entry === 'string' && entry.trim());
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const speciesAccessKeys = new Set([
  'spellRefs', 'spellRefsNeedImport', 'spellRefsNeedsImport', 'spellcastingAbility', 'spellcastingAbilityChoice', 'freeCastEachSpell'
]);
const speciesMechanicAccessKeys = new Set([
  'knownCantrips', 'spellChoices', 'spellcastingAbilityChoice', 'spellChoice',
  'spellRefs', 'levelGranted', 'freeCasts', 'sharedNonCantripFreeCasts', 'usesFormula',
  'atWill', 'componentOverrides', 'spellRestrictions', 'spellListExpansionCondition', 'spellTable',
  'grantedSpells'
]);
const speciesIgnoredSpellKeys = new Set(['constructHealingSpellExceptions', 'cannotBeTargetOfSpellId', 'affectedSpells']);
const featAccessKeys = new Set([
  'spellChoices', 'spellcastingAbility', 'spellcastingAbilityChoice', 'spellListChoice',
  'cantripChoices', 'level1SpellChoices', 'spellChangeOnLevelUp', 'repeatableRequiresDifferentSpellList',
  'freeCast', 'freeCastEachSpell', 'level1SpellChoice', 'ritualSpellsPrepared', 'quickRitual',
  'spellGranted', 'alwaysPrepared', 'spellGrants', 'cantripGrants', 'spellsOfTheMark',
  'spellsOfTheMarkRule', 'spellChoice'
]);
const featIgnoredSpellKeys = new Set([
  'invocationSpellcastingAbilityChoice', 'spellDamageDieMinimumForChosenType', 'spellsIgnoreResistanceForChosenType',
  'increaseRangeForAttackRollSpells', 'spellAttackRollsIgnoreCover', 'reactiveSpell', 'dragonmarkSpellSlot',
  'toolAsSpellcastingFocus'
]);

const unknown = [];
const unresolvedRefs = [];
let speciesMagicFeatures = 0;
let speciesChoiceFeatures = 0;
let speciesReplacementTimingFeatures = 0;
let speciesReplacementTimingSupported = 0;
const unsupportedReplacementTiming = [];
let featMagicItems = 0;
let featGrantItems = 0;
let featExpandedListItems = 0;
let featRitualItems = 0;
let dragonmarkCantripGrantRefs = 0;
let directGrantRefs = 0;
let expandedListRefs = 0;

const checkRef = (owner, ref, category) => {
  if (typeof ref !== 'string' || !ref.trim()) return;
  if (!byId.has(ref)) unresolvedRefs.push({ owner, ref, category });
};

for (const item of items) {
  if (item.kind === 'feature') {
    const payload = object(item.payload);
    const mechanics = object(payload.mechanics);
    const hasSpeciesOwner = typeof payload.speciesId === 'string' || typeof mechanics.speciesId === 'string';
    if (!hasSpeciesOwner) continue;

    const payloadSpellKeys = Object.keys(payload).filter((key) => /spell|cantrip|ritual/i.test(key));
    const mechanicSpellKeys = Object.keys(mechanics).filter((key) => /spell|cantrip|ritual/i.test(key));
    for (const key of payloadSpellKeys) {
      if (!speciesAccessKeys.has(key)) unknown.push({ owner: item.id, scope: 'species.payload', key });
    }
    for (const key of mechanicSpellKeys) {
      if (!speciesMechanicAccessKeys.has(key) && !speciesIgnoredSpellKeys.has(key)) unknown.push({ owner: item.id, scope: 'species.mechanics', key });
    }

    const magic = payloadSpellKeys.some((key) => speciesAccessKeys.has(key))
      || mechanicSpellKeys.some((key) => speciesMechanicAccessKeys.has(key));
    if (!magic) continue;
    speciesMagicFeatures += 1;

    for (const ref of strings(payload.spellRefs)) {
      directGrantRefs += 1;
      checkRef(item.id, ref, 'species spellRefs');
    }
    if (array(mechanics.spellChoices).length || Object.keys(object(mechanics.spellChoice)).length) speciesChoiceFeatures += 1;
    const spellChoice = object(mechanics.spellChoice);
    if (spellChoice.replacementTiming) {
      speciesReplacementTimingFeatures += 1;
      const timing = String(spellChoice.replacementTiming).toLowerCase();
      const sources = strings(spellChoice.sourceLists).concat(typeof spellChoice.sourceList === 'string' ? [spellChoice.sourceList] : []);
      const supported = timing.includes('long rest')
        && typeof spellChoice.initialSpellId === 'string'
        && sources.length > 0
        && (spellChoice.count === undefined || Number(spellChoice.count) === 1);
      if (supported) speciesReplacementTimingSupported += 1;
      else unsupportedReplacementTiming.push({ owner: item.id, scope: 'species.mechanics.spellChoice', replacementTiming: spellChoice.replacementTiming });
    }

    for (const optionKey of ['ancestryOptions', 'lineageOptions', 'legacyOptions', 'options']) {
      for (const option of Object.values(object(payload[optionKey]))) {
        const row = object(option);
        if (has(row, 'cantripReplacementOnLongRest')) {
          speciesReplacementTimingFeatures += 1;
          const replacement = row.cantripReplacementOnLongRest;
          const supported = typeof replacement === 'string' && replacement.replace(/cantrips?/gi, '').trim().length > 0;
          if (supported) speciesReplacementTimingSupported += 1;
          else unsupportedReplacementTiming.push({ owner: item.id, scope: `species.${optionKey}`, replacementTiming: replacement });
        }
        for (const [key, value] of Object.entries(row)) {
          if (/^level\d+SpellRefs$/i.test(key) || key === 'spellRefs') {
            for (const ref of strings(value)) {
              directGrantRefs += 1;
              checkRef(item.id, ref, `species ${optionKey}.${key}`);
            }
          }
        }
      }
    }
  }

  if (item.kind === 'feat') {
    const mechanics = object(object(item.payload).mechanics);
    const spellKeys = Object.keys(mechanics).filter((key) => /spell|cantrip|ritual/i.test(key));
    if (!spellKeys.length) continue;
    featMagicItems += 1;
    for (const key of spellKeys) {
      if (!featAccessKeys.has(key) && !featIgnoredSpellKeys.has(key)) unknown.push({ owner: item.id, scope: 'feat.mechanics', key });
    }

    let isGrant = false;
    for (const ref of strings(mechanics.cantripGrants)) {
      isGrant = true;
      dragonmarkCantripGrantRefs += 1;
      directGrantRefs += 1;
      checkRef(item.id, ref, 'feat cantripGrants');
    }
    const spellGranted = mechanics.spellGranted;
    if (typeof spellGranted === 'string') {
      isGrant = true;
      directGrantRefs += 1;
      checkRef(item.id, spellGranted, 'feat spellGranted');
    }
    for (const ref of strings(mechanics.alwaysPrepared)) {
      isGrant = true;
      directGrantRefs += 1;
      checkRef(item.id, ref, 'feat alwaysPrepared');
    }
    for (const grant of array(mechanics.spellGrants)) {
      const ref = object(grant).spellId || object(grant).spellRef;
      if (typeof ref === 'string') {
        isGrant = true;
        directGrantRefs += 1;
        checkRef(item.id, ref, 'feat spellGrants');
      }
    }
    if (isGrant) featGrantItems += 1;

    if (array(mechanics.spellsOfTheMark).length && isObject(mechanics.spellsOfTheMarkRule)) {
      featExpandedListItems += 1;
      for (const row of array(mechanics.spellsOfTheMark)) {
        for (const ref of strings(object(row).spellIds)) {
          expandedListRefs += 1;
          checkRef(item.id, ref, 'feat spellsOfTheMark');
        }
      }
    }
    if (isObject(mechanics.ritualSpellsPrepared)) featRitualItems += 1;
  }
}

const report = {
  status: unknown.length || unresolvedRefs.length || unsupportedReplacementTiming.length ? 'FAIL' : 'PASS',
  files: files.length,
  items: items.length,
  speciesMagicFeatures,
  speciesChoiceFeatures,
  speciesReplacementTimingFeatures,
  speciesReplacementTimingSupported,
  speciesReplacementTimingUnsupported: unsupportedReplacementTiming.length,
  unsupportedReplacementTiming,
  featMagicItems,
  featGrantItems,
  featExpandedListItems,
  featRitualItems,
  dragonmarkCantripGrantRefs,
  directGrantRefs,
  expandedListRefs,
  unknownShapes: unknown,
  unresolvedRefs
};

const reportPath = path.join(root, 'artifacts', 'external-spell-access-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

console.log(`[spell-access:external:audit] ${report.status}`);
console.log(`items=${report.items} speciesMagicFeatures=${speciesMagicFeatures} speciesChoices=${speciesChoiceFeatures} replacementTiming=${speciesReplacementTimingFeatures} replacementSupported=${speciesReplacementTimingSupported} replacementUnsupported=${unsupportedReplacementTiming.length}`);
console.log(`featMagicItems=${featMagicItems} featGrantItems=${featGrantItems} expandedListItems=${featExpandedListItems} ritualItems=${featRitualItems}`);
console.log(`directGrantRefs=${directGrantRefs} expandedListRefs=${expandedListRefs} unknownShapes=${unknown.length} unresolvedRefs=${unresolvedRefs.length}`);
if (unknown.length) console.error('unknownShapes=', JSON.stringify(unknown));
if (unresolvedRefs.length) console.error('unresolvedRefs=', JSON.stringify(unresolvedRefs));
if (unsupportedReplacementTiming.length) console.error('unsupportedReplacementTiming=', JSON.stringify(unsupportedReplacementTiming));
if (report.status !== 'PASS') process.exitCode = 1;
