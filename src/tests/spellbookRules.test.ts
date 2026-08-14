import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import {
  getMinimumSpellbookSpellCount,
  getSpellbookEntriesForClass,
  learnSpellbookSpell,
  prepareSpellbookSpell,
  reconcileSpellbookEntries,
  removeSpellbookSpell,
  unprepareSpellbookSpell
} from '../characters/spellbookRules';
import { getClassSpellcastingProfile } from '../characters/spellcastingRules';
import { createEmptyCharacter } from '../data/mockData';

const source = { id: 'spellbook-source', book: 'Spellbook Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const pack = buildPersistedCompendiumImport({
  id: 'spellbook-pack',
  source,
  items: [
    {
      id: 'wizard', kind: 'class', name: 'Wizard', source,
      payload: {
        level: 1,
        spellcasting: {
          ability: 'INT',
          progression: 'fullCaster',
          preparationSource: 'spellbook',
          slotsByLevel: { '1': { '1': 2 }, '2': { '1': 3 } },
          cantripsKnownByLevel: [3, 3],
          preparedSpellsByLevel: [4, 5]
        }
      }
    },
    { id: 'magic-missile', kind: 'spell', name: 'Magic Missile', source, payload: { level: 1, classes: ['Wizard'] } },
    { id: 'shield', kind: 'spell', name: 'Shield', source, payload: { level: 1, classes: ['Wizard'] } }
  ]
});

const item = (id: string) => pack.items.find((entry) => entry.importItemId === id)!;

describe('wizard spellbook rules', () => {
  it('keeps learned, prepared and unprepared states separate and audited', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Wizard'), item('wizard')).character;
    const classEntityId = character.classes[0]!.id;
    const profile = getClassSpellcastingProfile(item('wizard'), 1)!;

    character = learnSpellbookSpell({
      character,
      spellItem: item('magic-missile'),
      profile,
      classEntityId,
      acquisition: 'starting',
      source: 'creation'
    });
    expect(getSpellbookEntriesForClass(character, classEntityId)).toHaveLength(1);
    expect(character.spells).toHaveLength(0);
    expect(character.spellChangeTransactions?.at(-1)?.kind).toBe('learned');

    character = prepareSpellbookSpell({ character, spellItem: item('magic-missile'), profile, classEntityId, source: 'manual' });
    expect(character.spells.map((spell) => spell.name)).toContain('Magic Missile');
    expect(character.spellbookEntries?.[0]?.prepared).toBe(true);
    expect(character.spellChangeTransactions?.at(-1)?.kind).toBe('prepared');

    character = unprepareSpellbookSpell({ character, spellItemId: item('magic-missile').id, classEntityId, className: 'Wizard', classLevel: 1, source: 'manual' });
    expect(character.spells).toHaveLength(0);
    expect(character.spellbookEntries?.[0]?.prepared).toBe(false);
    expect(character.spellChangeTransactions?.at(-1)?.kind).toBe('unprepared');
  });

  it('records copied spells and removes their spellbook entry explicitly', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Copyist'), item('wizard')).character;
    const classEntityId = character.classes[0]!.id;
    const profile = getClassSpellcastingProfile(item('wizard'), 1)!;
    character = learnSpellbookSpell({ character, spellItem: item('shield'), profile, classEntityId, acquisition: 'copied', source: 'manual' });
    const entry = character.spellbookEntries?.[0]!;
    expect(entry.acquisition).toBe('copied');
    expect(character.spellChangeTransactions?.at(-1)?.kind).toBe('copied');
    character = removeSpellbookSpell(character, entry.id);
    expect(character.spellbookEntries).toHaveLength(0);
    expect(character.spellChangeTransactions?.at(-1)?.kind).toBe('removed');
  });

  it('reconciles entries against active spellbook classes and computes progression minimums', () => {
    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Reconcile Wizard'), item('wizard')).character;
    const classEntityId = character.classes[0]!.id;
    const profile1 = getClassSpellcastingProfile(item('wizard'), 1)!;
    const profile2 = getClassSpellcastingProfile(item('wizard'), 2)!;
    expect(getMinimumSpellbookSpellCount(profile1)).toBe(6);
    expect(getMinimumSpellbookSpellCount(profile2)).toBe(8);
    character = learnSpellbookSpell({ character, spellItem: item('shield'), profile: profile1, classEntityId, acquisition: 'starting', source: 'creation' });
    const reconciled = reconcileSpellbookEntries(character, new Set(), pack.items);
    expect(reconciled.spellbookEntries).toHaveLength(0);
  });
});
