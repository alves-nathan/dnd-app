import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createEmptyCharacter } from '../data/mockData';
import { applyEldritchInvocationSelection } from '../characters/eldritchInvocationSelection';
import {
  applyEldritchInvocationChoices,
  emptyEldritchInvocationChoice,
  getPactTomeCantripCandidates,
  getPactTomeRitualCandidates,
  validateEldritchInvocationChoices
} from '../characters/eldritchInvocationChoiceRules';

const source = { id: 'tome-source', book: 'Tome Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const imported = buildPersistedCompendiumImport({
  id: 'tome-pack', source, items: [
    { id: 'warlock', kind: 'class', name: 'Warlock', source, payload: { level: 1 } },
    { id: 'pact-tome', kind: 'feature', name: 'Pact of the Tome', source, payload: { sourceType: 'eldritchInvocation', classId: 'warlock', levelGained: 1, engineKey: 'warlock.pact-of-the-tome' } },
    { id: 'cleric-cantrip', kind: 'spell', name: 'Cleric Spark', source, payload: { level: 0, classes: ['Cleric'], castingTime: 'action' } },
    { id: 'druid-cantrip', kind: 'spell', name: 'Druid Spark', source, payload: { level: 0, classes: ['Druid'], castingTime: 'action' } },
    { id: 'wizard-cantrip', kind: 'spell', name: 'Wizard Spark', source, payload: { level: 0, classes: ['Wizard'], castingTime: 'action' } },
    { id: 'cleric-ritual', kind: 'spell', name: 'Cleric Ritual', source, payload: { level: 1, classes: ['Cleric'], ritual: true, castingTime: 'action or ritual' } },
    { id: 'wizard-ritual', kind: 'spell', name: 'Wizard Ritual', source, payload: { level: 1, classes: ['Wizard'], ritual: true, castingTime: '1 minute or ritual' } }
  ]
});
const item = (id: string) => imported.items.find((entry) => entry.importItemId === id)!;

describe('Pact of the Tome choices', () => {
  it('offers cantrips and level-1 rituals from every spell list', () => {
    expect(getPactTomeCantripCandidates(imported.items, [source.id]).map((entry) => entry.name)).toEqual([
      'Cleric Spark', 'Druid Spark', 'Wizard Spark'
    ]);
    expect(getPactTomeRitualCandidates(imported.items, [source.id]).map((entry) => entry.name)).toEqual([
      'Cleric Ritual', 'Wizard Ritual'
    ]);
  });

  it('requires exactly three cantrips and two rituals and applies them as Warlock Tome spells', () => {
    const pactTome = item('pact-tome');
    const counts = { [pactTome.id]: 1 };
    const choice = {
      ...emptyEldritchInvocationChoice(pactTome.id),
      cantripItemIds: [item('cleric-cantrip').id, item('druid-cantrip').id, item('wizard-cantrip').id],
      ritualSpellItemIds: [item('cleric-ritual').id, item('wizard-ritual').id]
    };
    expect(validateEldritchInvocationChoices(counts, [choice], imported.items, [source.id])).toEqual([]);

    let character = applyCompendiumItemToCharacter(createEmptyCharacter('Tome Warlock'), item('warlock')).character;
    character = applyEldritchInvocationSelection(character, counts, imported.items).character;
    const applied = applyEldritchInvocationChoices(character, [choice], imported.items);
    expect(applied.appliedSpellCount).toBe(5);
    expect(applied.character.spells).toHaveLength(5);
    expect(applied.character.spells.filter((spell) => spell.ritualOnly)).toHaveLength(2);
    expect(applied.character.spells.every((spell) => spell.grantedByInvocationItemId === pactTome.id)).toBe(true);
    expect(applied.character.spells.every((spell) => spell.spellcastingClassName === 'Warlock')).toBe(true);
  });
});
