import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  getClassSpellcastingProfile,
  isSpellItemEligibleForProfile,
  validateSpellAssignments
} from '../characters/spellcastingRules';

const source = { id: 'spell-rules-source', book: 'Rules', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const persisted = buildPersistedCompendiumImport({
  id: 'spell-rules-pack', source,
  items: [
    { id: 'wizard', kind: 'class', name: 'Wizard', source, payload: { level: 1, spellcasting: { ability: 'INT', progression: 'fullCaster', cantripsKnownByLevel: [3, 3, 3], preparedSpellsByLevel: [4, 5, 6], slotsByLevel: { '1': { '1': 2 }, '2': { '1': 3 }, '3': { '1': 4, '2': 2 } } } } },
    { id: 'fire-bolt', kind: 'spell', name: 'Fire Bolt', source, payload: { level: 0, classes: ['Wizard'] } },
    { id: 'magic-missile', kind: 'spell', name: 'Magic Missile', source, payload: { level: 1, classes: ['Wizard'] } },
    { id: 'misty-step', kind: 'spell', name: 'Misty Step', source, payload: { level: 2, classes: ['Wizard'] } },
    { id: 'fireball', kind: 'spell', name: 'Fireball', source, payload: { level: 3, classes: ['Wizard'] } },
    { id: 'cure-wounds', kind: 'spell', name: 'Cure Wounds', source, payload: { level: 1, classes: ['Cleric'] } }
  ]
});
const item = (id: string) => persisted.items.find((entry) => entry.importItemId === id)!;

describe('spellcasting rules', () => {
  it('derives limits and maximum spell level', () => {
    const profile = getClassSpellcastingProfile(item('wizard'), 3)!;
    expect(profile.cantripLimit).toBe(3);
    expect(profile.preparedSpellLimit).toBe(6);
    expect(profile.maxSpellLevel).toBe(2);
    expect(isSpellItemEligibleForProfile(item('misty-step'), profile)).toBe(true);
    expect(isSpellItemEligibleForProfile(item('fireball'), profile)).toBe(false);
    expect(isSpellItemEligibleForProfile(item('cure-wounds'), profile)).toBe(false);
  });

  it('validates exact spell counts per class', () => {
    const profile = getClassSpellcastingProfile(item('wizard'), 1)!;
    const assignments: Record<string, string> = {
      [item('fire-bolt').id]: profile.classItemId,
      [item('magic-missile').id]: profile.classItemId
    };
    const result = validateSpellAssignments({ assignments, spellItems: persisted.items, profiles: [profile], requireExact: true });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'CANTRIP_SELECTION_COUNT')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'PREPARED_SPELL_SELECTION_COUNT')).toBe(true);
  });

  it('allows incomplete creation choices while preserving the class limits', () => {
    const profile = getClassSpellcastingProfile(item('wizard'), 1)!;
    const result = validateSpellAssignments({
      assignments: {},
      spellbookAssignments: {},
      spellItems: persisted.items,
      profiles: [profile],
      requireExact: false
    });

    expect(result.ok).toBe(true);
    expect(result.issues.some((issue) => [
      'CANTRIP_SELECTION_COUNT',
      'PREPARED_SPELL_SELECTION_COUNT',
      'SPELLBOOK_SELECTION_COUNT'
    ].includes(issue.code))).toBe(false);
  });
});
