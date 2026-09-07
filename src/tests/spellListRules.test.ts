import type { StoredCompendiumItem } from '../compendium/types';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { getSelectableSpellCandidates, itemReferenceMatches } from '../characters/creationData';
import { getClassSpellcastingProfile, isSpellItemEligibleForProfile, spellItemLevel } from '../characters/spellcastingRules';
import {
  getClassSpellListReferences,
  getExplicitSpellListAdditionReferences,
  getSpeciesSpellListReferences
} from '../characters/spellListRules';
import { getSubclassSpellListReferences } from '../characters/subclassChoiceRules';

const allBundledItems = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-14T00:00:00.000Z'
  }).items
);
const enabledSourceIds = Array.from(new Set(allBundledItems.map((item) => item.sourceId)));
const selectableSpells = getSelectableSpellCandidates(allBundledItems, enabledSourceIds);

const findByImportId = (id: string): StoredCompendiumItem => {
  const item = allBundledItems.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};

const resolveSpellReference = (reference: string): StoredCompendiumItem | undefined =>
  selectableSpells.find((spell) => itemReferenceMatches(spell, reference));

describe('authoritative class spell-list resolution', () => {
  it('resolves every bundled base spell-list carrier, including Artificer', () => {
    const expectedMinimumReferences: Record<string, number> = {
      Bard: 140,
      Cleric: 117,
      Druid: 135,
      Paladin: 51,
      Ranger: 60,
      Sorcerer: 150,
      Warlock: 91,
      Wizard: 242,
      Artificer: 80
    };

    for (const [className, expectedMinimum] of Object.entries(expectedMinimumReferences)) {
      const classItem = allBundledItems.find((item) => item.type === 'class' && item.name === className);
      expect(classItem).toBeDefined();
      const references = getClassSpellListReferences(classItem, allBundledItems, 20);
      expect(references.length).toBeGreaterThanOrEqual(expectedMinimum);
      const unresolved = references.filter((reference) => !resolveSpellReference(reference));
      expect(unresolved).toEqual([]);
    }
  });

  it('offers the full Artificer carrier list instead of only spells whose payload says Artificer', () => {
    const artificer = findByImportId('forge-artificer-2025-class-artificer');
    const profile = getClassSpellcastingProfile(artificer, 3)!;
    const references = getClassSpellListReferences(artificer, allBundledItems, 3);
    const eligible = selectableSpells.filter((spell) => isSpellItemEligibleForProfile(spell, profile, references));
    const eligibleCantrips = eligible.filter((spell) => spellItemLevel(spell) === 0);
    const eligibleLevelOne = eligible.filter((spell) => spellItemLevel(spell) === 1);

    expect(eligibleCantrips.map((spell) => spell.name)).toEqual(expect.arrayContaining([
      'Acid Splash',
      'Fire Bolt',
      'Guidance',
      'Mage Hand',
      'Shocking Grasp',
      'Thorn Whip'
    ]));
    expect(eligibleLevelOne.map((spell) => spell.name)).toEqual(expect.arrayContaining([
      'Alarm',
      'Cure Wounds',
      'Detect Magic',
      'Faerie Fire',
      'Identify'
    ]));
    expect(eligibleCantrips.length).toBeGreaterThan(4);
    expect(eligibleLevelOne.length).toBeGreaterThan(1);
  });

  it('restores Xanathar Artificer spells when that optional source is installed', () => {
    const source = { id: 'xgte-2017', book: 'xgte', version: '2017', status: 'active' as const, confidence: 'exact' as const };
    const xgteSpells = buildPersistedCompendiumImport({
      id: 'xgte-artificer-compat-fixture',
      source,
      items: [
        { id: 'xgte-2017-spell-create-bonfire', kind: 'spell', name: 'Create Bonfire', source, payload: { level: 0, classes: ['Druid', 'Sorcerer', 'Warlock', 'Wizard'] } },
        { id: 'xgte-2017-spell-frostbite', kind: 'spell', name: 'Frostbite', source, payload: { level: 0, classes: ['Druid', 'Sorcerer', 'Warlock', 'Wizard'] } },
        { id: 'xgte-2017-spell-magic-stone', kind: 'spell', name: 'Magic Stone', source, payload: { level: 0, classes: ['Druid', 'Warlock'] } },
        { id: 'xgte-2017-spell-absorb-elements', kind: 'spell', name: 'Absorb Elements', source, payload: { level: 1, classes: ['Druid', 'Ranger', 'Sorcerer', 'Wizard'] } },
        { id: 'xgte-2017-spell-catapult', kind: 'spell', name: 'Catapult', source, payload: { level: 1, classes: ['Sorcerer', 'Wizard'] } },
        { id: 'xgte-2017-spell-snare', kind: 'spell', name: 'Snare', source, payload: { level: 1, classes: ['Druid', 'Ranger', 'Wizard'] } }
      ]
    }, { importedAt: '2026-08-14T00:00:00.000Z' }).items;
    const artificer = findByImportId('forge-artificer-2025-class-artificer');
    const profile = getClassSpellcastingProfile(artificer, 3)!;
    const combinedItems = [...allBundledItems, ...xgteSpells];
    const references = getClassSpellListReferences(artificer, combinedItems, 3);

    for (const spell of xgteSpells) {
      expect(references.some((reference) => itemReferenceMatches(spell, reference))).toBe(true);
      expect(isSpellItemEligibleForProfile(spell, profile, references)).toBe(true);
    }
  });

  it('does not fabricate optional cross-source references when Xanathar is absent', () => {
    const artificer = findByImportId('forge-artificer-2025-class-artificer');
    const references = getClassSpellListReferences(artificer, allBundledItems, 3);
    expect(references).not.toContain('xgte-2017-spell-absorb-elements');
    expect(references).not.toContain('xgte-2017-spell-create-bonfire');
  });

  it('keeps every base caster compatible with its authoritative list at level 20', () => {
    for (const className of ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard', 'Artificer']) {
      const classItem = allBundledItems.find((item) => item.type === 'class' && item.name === className)!;
      const profile = getClassSpellcastingProfile(classItem, 20)!;
      const references = getClassSpellListReferences(classItem, allBundledItems, 20);
      const eligibleReferences = references.filter((reference) => {
        const spell = resolveSpellReference(reference);
        return spell ? isSpellItemEligibleForProfile(spell, profile, references) : false;
      });
      expect(eligibleReferences.length).toBeGreaterThan(0);
    }
  });

  it('activates Bard Magical Secrets only after the feature is gained', () => {
    const bard = findByImportId('phb-2024-class-bard');
    const wizardOnly = findByImportId('phb-2024-spell-fireball');
    const level9 = getClassSpellListReferences(bard, allBundledItems, 9);
    const level10 = getClassSpellListReferences(bard, allBundledItems, 10);

    expect(level9.some((reference) => itemReferenceMatches(wizardOnly, reference))).toBe(false);
    expect(level10.some((reference) => itemReferenceMatches(wizardOnly, reference))).toBe(true);
  });
});

describe('spell-list additions from character options', () => {
  const source = { id: 'spell-list-options', book: 'Fixture', version: '2024', status: 'active' as const, confidence: 'exact' as const };
  const fixture = buildPersistedCompendiumImport({
    id: 'spell-list-options-pack',
    source,
    items: [
      {
        id: 'wizard', kind: 'class', name: 'Wizard', source,
        payload: { spellcasting: { ability: 'INT', progression: 'fullCaster', cantripsKnownByLevel: [3], preparedSpellsByLevel: [4], slotsByLevel: { '1': { '1': 2 } } } }
      },
      { id: 'healing-word', kind: 'spell', name: 'Healing Word', source, payload: { level: 1, classes: ['Cleric'] } },
      { id: 'species', kind: 'species', name: 'Test Species', source, payload: { featureIds: ['species-list-expansion'] } },
      {
        id: 'species-list-expansion', kind: 'feature', name: 'Arcane Heritage', source,
        payload: { sourceType: 'speciesFeature', speciesId: 'species', levelGained: 1, mechanics: { spellListAdditions: [{ classNames: ['Wizard'], spellIds: ['healing-word'] }] } }
      },
      { id: 'subclass', kind: 'subclass', name: 'Test Tradition', source, payload: { classId: 'wizard', featureIds: ['subclass-expanded-list'], progression: [{ level: 3, featureIds: ['subclass-expanded-list'] }] } },
      {
        id: 'subclass-expanded-list', kind: 'feature', name: 'Expanded Spell List', source,
        payload: { levelGained: 3, mechanics: { addedToWizardSpellListBySpellLevel: { '1': ['healing-word'] } } }
      }
    ]
  }, { importedAt: '2026-08-14T00:00:00.000Z' }).items;
  const fixtureItem = (id: string) => fixture.find((item) => item.importItemId === id)!;

  it('accepts explicit species spell-list additions without treating innate grants as list additions', () => {
    const references = getSpeciesSpellListReferences(fixtureItem('species'), [], fixture, 1, 'Wizard');
    expect(references).toContain('healing-word');
    expect(getExplicitSpellListAdditionReferences({ spellRefs: ['not-a-list-addition'] }, 'Wizard')).toEqual([]);

    const profile = getClassSpellcastingProfile(fixtureItem('wizard'), 1)!;
    expect(isSpellItemEligibleForProfile(fixtureItem('healing-word'), profile, references)).toBe(true);
  });

  it('accepts generic subclass additions for any class name', () => {
    const references = getSubclassSpellListReferences(fixtureItem('subclass'), [], fixture, 3);
    expect(references).toContain('healing-word');
  });
});
