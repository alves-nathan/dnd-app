import { createEmptyCharacter } from '../data/mockData';
import { applyCharacterHitPointConfiguration, calculateCharacterHitPoints, fixedHitPointDieValue } from '../characters/hitPointRules';
import type { Character } from '../types';
import { buildPersistedCompendiumImport } from '../compendium/importer';

const bard7 = (): Character => ({
  ...createEmptyCharacter('Bard'),
  level: 7,
  classes: [{ id: 'bard-local', name: 'Bard', level: 7, hitDie: 8 }],
  buildChoices: { ...createEmptyCharacter().buildChoices!, startingClassItemId: 'phb-2024-class-bard' },
  compendiumLinks: [{
    id: 'bard-link', characterId: 'bard', itemId: 'phb-2024-class-bard', importItemId: 'phb-2024-class-bard', packId: 'phb', sourceId: 'phb', itemType: 'class',
    appliedAs: 'class', appliedEntityId: 'bard-local', appliedEntityName: 'Bard', status: 'active', addedAt: '2026-01-01T00:00:00.000Z'
  }],
  abilities: { STR: 9, DEX: 16, CON: 14, INT: 10, WIS: 10, CHA: 18 }
});

describe('character hit point methods', () => {
  it('uses 2024 first-level max die and fixed higher-level value', () => {
    expect(fixedHitPointDieValue(8)).toBe(5);
    const result = calculateCharacterHitPoints(bard7(), { method: 'fixed' });
    expect(result.complete).toBe(true);
    expect(result.firstLevelHitPoints).toBe(10);
    expect(result.max).toBe(52);
  });

  it('supports full Hit Dice and stored RAW rolls', () => {
    expect(calculateCharacterHitPoints(bard7(), { method: 'maximum' }).max).toBe(70);
    expect(calculateCharacterHitPoints(bard7(), {
      method: 'rolled',
      rolledByClass: { 'bard-local': [4, 5, 6, 7, 8, 1] }
    }).max).toBe(53);
  });

  it('keeps rolled mode incomplete until every higher-level roll exists', () => {
    const result = calculateCharacterHitPoints(bard7(), { method: 'rolled', rolledByClass: { 'bard-local': [8, 8] } });
    expect(result.complete).toBe(false);
    expect(result.missingRolls['bard-local']).toBe(4);
  });

  it('supports manual maximum and preserves damage by delta when recalculated', () => {
    let character = applyCharacterHitPointConfiguration(bard7(), { method: 'fixed' });
    expect(character.hitPoints?.current).toBe(52);
    character = { ...character, hitPoints: { ...character.hitPoints!, current: 40 } };
    character = { ...character, abilities: { ...character.abilities, CON: 16 } };
    character = applyCharacterHitPointConfiguration(character, character.hitPoints!);
    expect(character.hitPoints?.max).toBe(59);
    expect(character.hitPoints?.current).toBe(47);

    character = applyCharacterHitPointConfiguration(character, { method: 'manual', manualMax: 77 });
    expect(character.hitPoints?.max).toBe(77);
  });

  it('adds permanent HP bonuses from active feats and species features without changing manual mode', () => {
    const source = { id: 'hp-test', book: 'HP Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };
    const items = buildPersistedCompendiumImport({
      id: 'hp-test-pack', source, items: [
        { id: 'phb-2024-feat-tough', kind: 'feat', name: 'Tough', source, payload: { mechanics: { hitPointMaximumBonusFormula: '2 * characterLevel' } } },
        { id: 'phb-2024-feature-dwarf-dwarven-toughness', kind: 'feature', name: 'Dwarven Toughness', source, payload: { hitPointMaximumBonus: '+1 per character level' } }
      ]
    }).items;
    const base = bard7();
    const character: Character = {
      ...base,
      compendiumLinks: [
        ...(base.compendiumLinks ?? []),
        { id: 'tough-link', characterId: base.id, itemId: 'phb-2024-feat-tough', importItemId: 'phb-2024-feat-tough', packId: 'hp-test-pack', sourceId: 'hp-test', itemType: 'feat', appliedAs: 'feat', appliedEntityId: 'tough-feat', appliedEntityName: 'Tough', status: 'active', addedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'dwarf-link', characterId: base.id, itemId: 'phb-2024-feature-dwarf-dwarven-toughness', importItemId: 'phb-2024-feature-dwarf-dwarven-toughness', packId: 'hp-test-pack', sourceId: 'hp-test', itemType: 'feature', appliedAs: 'feature', appliedEntityId: 'dwarf-feature', appliedEntityName: 'Dwarven Toughness', status: 'active', addedAt: '2026-01-01T00:00:00.000Z' }
      ]
    };
    const fixed = calculateCharacterHitPoints(character, { method: 'fixed' }, items);
    expect(fixed.baseMax).toBe(52);
    expect(fixed.permanentBonus).toBe(21);
    expect(fixed.max).toBe(73);
    expect(fixed.bonuses.map((entry) => entry.sourceName)).toEqual(['Tough', 'Dwarven Toughness']);

    const manual = calculateCharacterHitPoints(character, { method: 'manual', manualMax: 60 }, items);
    expect(manual.max).toBe(60);
    expect(manual.permanentBonus).toBe(0);
  });
});
