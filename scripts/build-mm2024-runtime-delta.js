#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const phbPath = path.join(root, 'assets', 'compendium', 'phb-2024-full-consolidated-import-pack-v2-canonical.json');
const targetPath = path.join(root, 'assets', 'compendium', 'mm-2024-runtime-dependency-delta-v2-canonical.json');
const checksumPath = `${targetPath}.sha256`;
const reportPath = path.join(root, 'artifacts', 'compendium', 'integration', 'mm-2024-runtime-dependency-delta-report.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const pretty = (v) => `${JSON.stringify(v, null, 2)}\n`;
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const phb = readJson(phbPath);
const phbIds = new Set(phb.items.map((item) => item.id));

const spellId = (slug) => {
  const id = `phb-2024-spell-${slug}`;
  if (!phbIds.has(id)) throw new Error(`MM 2024 runtime delta requires missing PHB 2024 spell ${id}.`);
  return id;
};

const mageSpellRefs = [
  'detect-magic', 'light', 'mage-armor', 'mage-hand', 'prestidigitation',
  'fireball', 'invisibility', 'cone-of-cold', 'fly', 'misty-step', 'counterspell', 'shield'
].map(spellId);

const items = [
  {
    id: 'mm-2024-creature-mage',
    kind: 'creatureStatBlock',
    name: 'Mage',
    summary: 'Current-rules Mage base stat block used by legacy adventures that reference the generic Mage NPC.',
    source: {
      id: 'mm-2024',
      book: 'monster-manual',
      page: '199',
      version: '2024-core/2025-release',
      status: 'needsReview',
      confidence: 'importedNeedsReview',
      rulesEra: '2024',
      contentType: 'official',
      notes: 'Mechanical data reconciled against the current D&D Beyond Mage entry / 2024 Basic Rules. Long descriptive text is intentionally omitted.'
    },
    payload: {
      size: 'Medium or Small',
      creatureType: 'Humanoid (Wizard)',
      alignment: 'Neutral',
      armorClass: { value: 15, details: 'Mage Armor included' },
      hitPoints: { average: 81, formula: '18d8' },
      speed: { walk: 30 },
      challenge: '6',
      proficiencyBonus: 3,
      abilities: { STR: 9, DEX: 14, CON: 11, INT: 17, WIS: 12, CHA: 11 },
      savingThrows: { INT: 6, WIS: 4 },
      skills: { Arcana: 6, History: 6, Perception: 4 },
      vulnerabilities: [],
      immunities: { damage: [], conditions: [] },
      senses: { passivePerception: 14 },
      languages: 'Common plus three other languages',
      traits: [],
      actions: [
        {
          name: 'Multiattack',
          actionCost: 'action',
          mechanics: { attackSequence: [{ count: 3, attack: 'Arcane Burst' }] },
          summary: 'Makes three Arcane Burst attacks.'
        },
        {
          name: 'Arcane Burst',
          actionCost: 'action',
          attack: { mode: 'meleeOrRanged', basis: 'spell', attackBonus: 6, reachFeet: 5, rangeFeet: 120 },
          damage: [{ average: 16, formula: '3d8 + 3', type: 'force' }],
          summary: 'Spell attack usable in melee or at range.'
        },
        {
          name: 'Spellcasting',
          actionCost: 'action',
          mechanics: {
            ability: 'INT',
            saveDC: 14,
            atWill: [
              spellId('detect-magic'), spellId('light'), spellId('mage-armor'), spellId('mage-hand'), spellId('prestidigitation')
            ],
            twicePerDayEach: [spellId('fireball'), spellId('invisibility')],
            oncePerDayEach: [spellId('cone-of-cold'), spellId('fly')],
            spellOverrides: { [spellId('fireball')]: { castAtLevel: 4 } }
          },
          summary: 'Uses Intelligence for its listed spells.'
        }
      ],
      bonusActions: [
        {
          name: 'Misty Step (3/Day)',
          actionCost: 'bonusAction',
          mechanics: { uses: 3, recharge: 'longRest', castsSpellId: spellId('misty-step'), ability: 'INT' },
          summary: 'Casts Misty Step using the same spellcasting ability.'
        }
      ],
      reactions: [
        {
          name: 'Protective Magic (3/Day)',
          actionCost: 'reaction',
          mechanics: {
            uses: 3,
            recharge: 'longRest',
            castsOneOfSpellIds: [spellId('counterspell'), spellId('shield')],
            ability: 'INT',
            trigger: 'Uses the selected spell in response to that spell’s trigger.'
          },
          summary: 'Uses Counterspell or Shield as a reaction.'
        }
      ],
      legendaryActions: [],
      mechanics: {
        rulesEra: '2024',
        initiativeBonus: 2,
        initiativeScore: 12,
        spellRefs: mageSpellRefs,
        gear: ['Wand']
      },
      engineKey: 'creature.mage',
      tags: ['monster-manual-2024', 'runtime-base-creature', 'generic-npc'],
      extractionNotes: [
        'Runtime dependency closure record for legacy adventure variants.',
        'Only mechanics needed by the app are preserved; lore and long source prose are omitted.'
      ]
    }
  },
  {
    id: 'mm-2024-creature-flumph',
    kind: 'creatureStatBlock',
    name: 'Flumph',
    summary: 'Current-rules Flumph base stat block used by the named Flapjack variant in Light of Xaryxis.',
    source: {
      id: 'mm-2024',
      book: 'monster-manual',
      page: '122',
      version: '2024-core/2025-release',
      status: 'needsReview',
      confidence: 'importedNeedsReview',
      rulesEra: '2024',
      contentType: 'official',
      notes: 'Current Monster Manual identity is confirmed by D&D Beyond. Mechanical values were cross-checked against current licensed/2024 compendium listings; keep needsReview until manually checked against an owned MM source.'
    },
    payload: {
      size: 'Small',
      creatureType: 'Aberration',
      alignment: 'Lawful Good',
      armorClass: { value: 12 },
      hitPoints: { average: 7, formula: '2d6' },
      speed: { walk: 5, fly: 30 },
      challenge: '1/8',
      proficiencyBonus: 2,
      abilities: { STR: 6, DEX: 15, CON: 10, INT: 14, WIS: 14, CHA: 11 },
      savingThrows: {},
      skills: { Arcana: 4, History: 4, Religion: 4 },
      vulnerabilities: ['psychic'],
      immunities: { damage: [], conditions: [] },
      senses: { darkvision: 60, passivePerception: 12 },
      languages: 'Understands Undercommon but cannot speak; telepathy 60 ft.',
      traits: [
        {
          id: 'advanced-telepathy',
          name: 'Advanced Telepathy',
          mechanics: { perceivesTelepathicCommunicationWithinFeet: 60 },
          summary: 'Perceives telepathic communication occurring within 60 feet.'
        },
        {
          id: 'prone-deficiency',
          name: 'Prone Deficiency',
          mechanics: {
            triggerCondition: 'prone',
            oddDieResultCondition: 'incapacitated',
            recoverySave: { ability: 'DEX', dc: 10, timing: 'endOfEachTurn' }
          },
          summary: 'Being knocked prone can leave the flumph incapacitated until it succeeds on a Dexterity save.'
        },
        {
          id: 'telepathic-shroud',
          name: 'Telepathic Shroud',
          mechanics: { thoughtsUnreadable: true, cannotBeLocatedOrRemotelyObservedByMagic: true },
          summary: 'Its thoughts cannot be read, and magic cannot locate or remotely observe it.'
        }
      ],
      actions: [
        {
          name: 'Tentacle',
          actionCost: 'action',
          attack: { mode: 'melee', basis: 'weapon', attackBonus: 4, reachFeet: 5 },
          damage: [{ average: 4, formula: '1d4 + 2', type: 'acid' }],
          summary: 'Melee tentacle attack dealing Acid damage.'
        },
        {
          name: 'Stench Spray (1/Day)',
          actionCost: 'action',
          saves: [{ dc: 10, ability: 'DEX' }],
          mechanics: {
            uses: 1,
            recharge: 'longRest',
            rangeFeet: 15,
            targetCount: 1,
            failedSave: {
              condition: 'Poisoned',
              stenchDurationFormulaHours: '1d4',
              emanationFeet: 5,
              emanationCondition: 'Poisoned'
            },
            removal: 'Bathing during a Short Rest or Long Rest removes the stench.'
          },
          summary: 'Coats one nearby creature in a foul stench that poisons it and creatures close to it.'
        }
      ],
      bonusActions: [],
      reactions: [],
      legendaryActions: [],
      mechanics: { rulesEra: '2024', initiativeBonus: 2, initiativeScore: 12, hover: true, spellRefs: [] },
      engineKey: 'creature.flumph',
      tags: ['monster-manual-2024', 'runtime-base-creature', 'underdark'],
      extractionNotes: [
        'Runtime dependency closure record for the Spelljammer Flapjack variant.',
        'Stat block is mechanical/paraphrased; narrative description and assistance tables are intentionally omitted.'
      ]
    }
  }
];

const pack = {
  templateVersion: 'dnd-combat-import.v2',
  id: 'mm-2024-runtime-dependency-delta-v1',
  source: {
    id: 'mm-2024',
    book: 'monster-manual',
    page: '122, 199',
    version: '2024-core/2025-release',
    status: 'needsReview',
    confidence: 'importedNeedsReview',
    rulesEra: '2024',
    contentType: 'official',
    notes: 'Minimal current-rules monster delta created only to satisfy runtime base-creature dependencies of already imported legacy adventures. It is not a full Monster Manual import.'
  },
  metadata: {
    contentSystem: 'D&D',
    edition: '2024+legacy',
    language: 'en',
    extractionScope: 'runtime dependency delta only: Mage + Flumph',
    schemaTarget: 'dnd-combat-math-current',
    itemRecords: items.length,
    itemsByKind: { creatureStatBlock: items.length },
    compatibility: {
      profile: '2024-first+legacy',
      purpose: 'Close Spelljammer external base-creature dependencies without importing MM 2014 or the full current Monster Manual.',
      replacesLegacyReferences: {
        'mm-2014-creature-mage': 'mm-2024-creature-mage',
        'mm-2014-creature-flumph': 'mm-2024-creature-flumph'
      }
    },
    validation: {
      status: 'READY_FOR_RUNTIME_PREVIEW',
      uniqueItemIds: items.length,
      duplicateItemIds: 0,
      brokenExternalReferences: 0
    },
    externalDependencies: { phb2024: mageSpellRefs }
  },
  items
};

const ids = pack.items.map((item) => item.id);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate item IDs in MM 2024 runtime delta.');
const engineKeys = pack.items.map((item) => item.payload.engineKey);
if (new Set(engineKeys).size !== engineKeys.length) throw new Error('Duplicate engine keys in MM 2024 runtime delta.');

const outputText = pretty(pack);
const digest = sha256(outputText);
const checksumText = `${digest}  ${path.basename(targetPath)}\n`;
const report = {
  schemaVersion: 'dnd-combat-mm2024-runtime-delta-report.v1',
  packId: pack.id,
  itemCount: pack.items.length,
  itemIds: ids,
  legacyMappings: pack.metadata.compatibility.replacesLegacyReferences,
  externalDependencies: pack.metadata.externalDependencies,
  validationStatus: pack.metadata.validation.status,
  sha256: digest
};

if (checkOnly) {
  if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8') !== outputText) throw new Error('MM 2024 runtime delta is stale.');
  if (!fs.existsSync(checksumPath) || fs.readFileSync(checksumPath, 'utf8') !== checksumText) throw new Error('MM 2024 runtime delta checksum is stale.');
  if (!fs.existsSync(reportPath) || JSON.stringify(readJson(reportPath)) !== JSON.stringify(report)) throw new Error('MM 2024 runtime delta report is stale.');
} else {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(targetPath, outputText);
  fs.writeFileSync(checksumPath, checksumText);
  fs.writeFileSync(reportPath, pretty(report));
}

console.log(`PASS: MM 2024 runtime dependency delta materialized with ${items.length} creatures; Mage and Flumph are available as current-rules base stat blocks.`);
