import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createDefaultCharacter } from '../data/mockData';
import { deriveCharacterSpellSlots, reconcileCharacterSpellSlots } from '../characters/spellSlotProgression';

const source = { id: 'slot-source', book: 'Slot Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const fullSlots = {
  '1': { '1': 2 },
  '2': { '1': 3 },
  '3': { '1': 4, '2': 2 },
  '4': { '1': 4, '2': 3 },
  '5': { '1': 4, '2': 3, '3': 2 }
};
const pack = buildPersistedCompendiumImport({
  id: 'slot-pack', source, items: [
    { id: 'wizard', kind: 'class', name: 'Wizard', source, payload: { level: 1, spellcasting: { progression: 'fullCaster', slotsByLevel: fullSlots, cantripsKnownByLevel: [3,3,3,4,4], preparedSpellsByLevel: [4,5,6,7,9] } } },
    { id: 'paladin', kind: 'class', name: 'Paladin', source, payload: { level: 1, spellcasting: { progression: 'halfCaster', slotsByLevel: { '1': { '1': 2 }, '2': { '1': 2 }, '3': { '1': 3 }, '4': { '1': 3 }, '5': { '1': 4, '2': 2 } }, preparedSpellsByLevel: [2,3,4,5,6] } } },
    { id: 'warlock', kind: 'class', name: 'Warlock', source, payload: { level: 1, spellcasting: { progression: 'pactMagic', pactSlotsByLevel: [1,2,2,2,2], pactSlotLevelByLevel: [1,1,2,2,3], cantripsKnownByLevel: [2,2,2,3,3], preparedSpellsByLevel: [2,3,4,5,6] } } }
  ]
});
const byImportId = (id: string) => pack.items.find((entry) => entry.importItemId === id)!;

describe('multiclass spell slot progression', () => {
  it('combines regular caster levels and keeps Pact Magic separate', () => {
    let character = createDefaultCharacter('Multicaster');
    for (const id of ['wizard', 'paladin', 'warlock']) character = applyCompendiumItemToCharacter(character, byImportId(id)).character;
    character = {
      ...character,
      classes: character.classes.map((entry) => entry.name === 'Wizard' ? { ...entry, level: 3 } : entry.name === 'Paladin' ? { ...entry, level: 4 } : { ...entry, level: 2 }),
      level: 9
    };
    const result = deriveCharacterSpellSlots(character, pack.items);
    expect(result.effectiveCasterLevel).toBe(5);
    expect(result.pools.some((pool) => pool.poolKind === 'spellcasting' && pool.level === 3 && pool.max === 2)).toBe(true);
    expect(result.pools.some((pool) => pool.poolKind === 'pactMagic' && pool.level === 1 && pool.max === 2)).toBe(true);
  });

  it('preserves spent slots during reconciliation', () => {
    let character = createDefaultCharacter('Caster');
    character = applyCompendiumItemToCharacter(character, byImportId('wizard')).character;
    character = { ...character, spellSlots: [{ id: 'spellcasting-shared-1', level: 1, max: 2, current: 1, recharge: 'longRest', poolKind: 'spellcasting' }] };
    expect(reconcileCharacterSpellSlots(character, pack.items).spellSlots[0]?.current).toBe(1);
  });
});
