import { appendSpellChangeTransaction } from '../characters/spellChangeAudit';
import { createEmptyCharacter } from '../data/mockData';

describe('spell change audit', () => {
  it('records a level-up replacement with old and new spell references', () => {
    const character = createEmptyCharacter('Auditor');
    const updated = appendSpellChangeTransaction(character, {
      classEntityId: 'class-1',
      className: 'Bard',
      classLevel: 3,
      kind: 'replaced',
      spellItemId: 'new-spell',
      spellName: 'New Spell',
      replacedSpellItemId: 'old-spell',
      replacedSpellName: 'Old Spell',
      source: 'levelUp'
    });
    expect(updated.spellChangeTransactions).toHaveLength(1);
    expect(updated.spellChangeTransactions?.[0]).toMatchObject({
      kind: 'replaced',
      source: 'levelUp',
      spellItemId: 'new-spell',
      replacedSpellItemId: 'old-spell'
    });
  });
});
