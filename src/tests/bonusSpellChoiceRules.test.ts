import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import type { StoredCompendiumItem } from '../compendium/types';
import { resolveCharacterSpellAccess } from '../characters/characterSpellAccess';
import {
  getBonusSpellChoiceCandidates,
  toggleBonusSpellChoiceSpell,
  validateBonusSpellChoices
} from '../characters/bonusSpellChoiceRules';
import { getClassSpellcastingProfile, spellItemLevel } from '../characters/spellcastingRules';

const items = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-15T00:00:00.000Z'
  }).items
);
const selectableSpells = items.filter((item) => item.type === 'spell' && item.status !== 'disabled');

const byImportId = (id: string): StoredCompendiumItem => {
  const item = items.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Item ausente: ${id}`);
  return item;
};
const findClass = (name: string): StoredCompendiumItem => {
  const item = items.find((candidate) => candidate.type === 'class' && candidate.name === name);
  if (!item) throw new Error(`Classe ausente: ${name}`);
  return item;
};

describe('bonus spell choice rules', () => {
  it('limits Acolyte of Nature to one Druid cantrip and keeps it outside the Cleric normal count', () => {
    const cleric = findClass('Cleric');
    const nature = byImportId('phb-2014-subclass-cleric-nature-domain');
    const resolution = resolveCharacterSpellAccess({ classItem: cleric, classLevel: 3, subclassItem: nature, items });
    const requirement = resolution.activeBonusChoiceRequirements.find((entry) => entry.source.name === 'Acolyte of Nature')!;
    const profile = getClassSpellcastingProfile(cleric, 3)!;
    const candidates = getBonusSpellChoiceCandidates(requirement, profile, selectableSpells, items);

    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.every((spell) => spellItemLevel(spell) === 0)).toBe(true);

    const choices = toggleBonusSpellChoiceSpell([], requirement, candidates[0]!.id);
    expect(validateBonusSpellChoices({
      requirements: [requirement], choices, profiles: [profile], selectableSpells, allItems: items
    })).toEqual([]);
  });

  it('level-gates Lore Bard Magical Discoveries and rejects reuse of a normal Bard selection', () => {
    const bard = findClass('Bard');
    const lore = byImportId('phb-2024-subclass-bard-college-of-lore');
    const resolution = resolveCharacterSpellAccess({ classItem: bard, classLevel: 6, subclassItem: lore, items });
    const requirement = resolution.activeBonusChoiceRequirements.find((entry) => entry.source.name === 'Magical Discoveries')!;
    const profile = getClassSpellcastingProfile(bard, 6)!;
    const candidates = getBonusSpellChoiceCandidates(requirement, profile, selectableSpells, items);
    expect(candidates.every((spell) => spellItemLevel(spell) <= profile.maxSpellLevel)).toBe(true);

    const first = candidates[0]!;
    const second = candidates.find((spell) => spell.id !== first.id)!;
    let choices = toggleBonusSpellChoiceSpell([], requirement, first.id);
    choices = toggleBonusSpellChoiceSpell(choices, requirement, second.id);
    expect(validateBonusSpellChoices({
      requirements: [requirement], choices, profiles: [profile], selectableSpells, allItems: items
    })).toEqual([]);

    expect(validateBonusSpellChoices({
      requirements: [requirement],
      choices,
      profiles: [profile],
      selectableSpells,
      allItems: items,
      normalSpellAssignments: { [first.id]: bard.id }
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'BONUS_SPELL_DUPLICATES_NORMAL_SELECTION' })
    ]));
  });

  it('activates Thaumaturge, Magician, Blessed Warrior and Druidic Warrior with the correct source lists', () => {
    const cases = [
      { className: 'Cleric', level: 1, optionId: 'thaumaturge', count: 1, source: 'Cleric' },
      { className: 'Druid', level: 1, optionId: 'magician', count: 1, source: 'Druid' },
      { className: 'Paladin', level: 2, optionId: 'blessed-warrior', count: 2, source: 'cleric' },
      { className: 'Ranger', level: 2, optionId: 'druidic-warrior', count: 2, source: 'druid' }
    ];

    for (const testCase of cases) {
      const classItem = findClass(testCase.className);
      const discovery = resolveCharacterSpellAccess({ classItem, classLevel: testCase.level, items });
      const dormant = discovery.bonusChoiceRequirements.find((entry) => entry.activation.optionId === testCase.optionId)!;
      expect(dormant).toBeDefined();
      const active = resolveCharacterSpellAccess({
        classItem,
        classLevel: testCase.level,
        items,
        classFeatureChoices: [{
          classItemId: classItem.id,
          featureItemId: dormant.activation.featureItemId!,
          optionId: testCase.optionId
        }]
      }).activeBonusChoiceRequirements.find((entry) => entry.activation.optionId === testCase.optionId)!;
      expect(active).toMatchObject({ count: testCase.count, spellLevel: 0, countsAgainstNormalLimit: false });
      expect(active.sourceClassNames).toContain(testCase.source);
      const profile = getClassSpellcastingProfile(classItem, testCase.level)!;
      const candidates = getBonusSpellChoiceCandidates(active, profile, selectableSpells, items);
      expect(candidates.length).toBeGreaterThan(1);
      expect(candidates.every((spell) => spellItemLevel(spell) === 0)).toBe(true);
    }
  });

  it('accepts source-list membership encoded directly on spell classes when no classSpellList carrier exists', () => {
    const synthetic = buildPersistedCompendiumImport({
      id: 'bonus-direct-class-pack',
      source: { id: 'bonus-direct-class-source', book: 'Bonus Direct Class Test', version: '2024', status: 'active', confidence: 'exact' },
      items: [
        {
          id: 'bard', kind: 'class', name: 'Bard',
          source: { id: 'bonus-direct-class-source', book: 'Bonus Direct Class Test', version: '2024', status: 'active', confidence: 'exact' },
          payload: {
            level: 1,
            progression: [{ level: 1, featureIds: ['bonus-cantrip-feature'] }],
            spellcasting: { progression: 'fullCaster', slotsByLevel: { '1': { '1': 2 } }, cantripsKnownByLevel: [1], preparedSpellsByLevel: [1] }
          }
        },
        {
          id: 'bonus-cantrip-feature', kind: 'feature', name: 'Bonus Cantrip Feature',
          source: { id: 'bonus-direct-class-source', book: 'Bonus Direct Class Test', version: '2024', status: 'active', confidence: 'exact' },
          payload: { levelGained: 1, mechanics: { cantripChoiceCount: 1, spellList: 'Bard' } }
        },
        {
          id: 'bonus-cantrip', kind: 'spell', name: 'Bonus Cantrip',
          source: { id: 'bonus-direct-class-source', book: 'Bonus Direct Class Test', version: '2024', status: 'active', confidence: 'exact' },
          payload: { level: 0, classes: ['Bard'] }
        }
      ]
    }, { importedAt: '2026-08-15T00:00:00.000Z' });
    const syntheticClass = synthetic.items.find((item) => item.importItemId === 'bard')!;
    const syntheticSpell = synthetic.items.find((item) => item.importItemId === 'bonus-cantrip')!;
    const resolution = resolveCharacterSpellAccess({ classItem: syntheticClass, classLevel: 1, items: synthetic.items });
    const requirement = resolution.activeBonusChoiceRequirements.find((entry) => entry.source.name === 'Bonus Cantrip Feature')!;
    const profile = getClassSpellcastingProfile(syntheticClass, 1)!;
    const candidates = getBonusSpellChoiceCandidates(requirement, profile, [syntheticSpell], synthetic.items);

    expect(candidates.map((spell) => spell.id)).toContain(syntheticSpell.id);
  });

});
