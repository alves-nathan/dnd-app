import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { resourcePoolsFromAutomaticFeature, reconcileAutomaticFeatureResourceUpdates } from '../compendium/automaticFeatureApplication';
import { applyRest } from '../rules-engine/resources/resourceManager';
import { createEmptyCharacter } from '../data/mockData';
import type { Character } from '../types';

const source = { id: 'resource-test', book: 'Resource Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };

const characterWithClass = (name: string, level: number, hitDie: number): Character => ({
  ...createEmptyCharacter(name),
  level,
  classes: [{ id: `${name}-local`, name, level, hitDie }],
  compendiumLinks: [{
    id: `${name}-link`, characterId: 'char', itemId: `phb-2024-class-${name.toLowerCase()}`, importItemId: `phb-2024-class-${name.toLowerCase()}`, packId: 'phb', sourceId: 'phb', itemType: 'class',
    appliedAs: 'class', appliedEntityId: `${name}-local`, appliedEntityName: name, status: 'active', addedAt: '2026-01-01T00:00:00.000Z'
  }]
});

const item = (id: string, name: string, payload: Record<string, unknown>, summary?: string) => buildPersistedCompendiumImport({
  id: `pack-${id}`, source, items: [{ id, kind: 'feature', name, summary, source, payload }]
}).items[0]!;

describe('automatic feature resource reconciliation', () => {
  it('materializes implicit one-use resources such as Glamour Bard features', () => {
    const character = characterWithClass('Bard', 7, 8);
    const beguiling = item('beguiling', 'Beguiling Magic', {
      classId: 'phb-2024-class-bard', engineKey: 'subclass.bard.college_of_glamour.beguiling_magic',
      resource: { id: 'glamour-beguiling-magic', recharge: 'longRest' }
    }, 'Após conjurar Enchantment/Illusion, pode afetar uma criatura.');
    const majesty = item('majesty', 'Mantle of Majesty', {
      classId: 'phb-2024-class-bard',
      resource: { id: 'mantle-of-majesty', recharge: 'manual', recoveryRules: [{ trigger: 'longRest', amount: 'all' }, { trigger: 'custom', amount: 'all', condition: 'longRestOrLevel3Slot' }] }
    });

    expect(resourcePoolsFromAutomaticFeature(character, beguiling)[0]).toEqual(expect.objectContaining({ max: 1, recharge: 'longRest' }));
    expect(resourcePoolsFromAutomaticFeature(character, beguiling)[0]?.notes).toContain('Após conjurar Enchantment/Illusion');
    expect(resourcePoolsFromAutomaticFeature(character, beguiling)[0]?.notes).toContain('Bardic Inspiration');
    const mantle = resourcePoolsFromAutomaticFeature(character, majesty)[0]!;
    expect(mantle.max).toBe(1);
    expect(mantle.recoveryRules).toEqual([{ trigger: 'longRest', amount: 'all' }]);
    expect(mantle.notes).toContain('nível 3+');
  });

  it('does not invent a separate resource for Mantle of Inspiration shared Bardic Inspiration cost', () => {
    const character = characterWithClass('Bard', 7, 8);
    const mantle = item('inspiration', 'Mantle of Inspiration', {
      classId: 'phb-2024-class-bard', consumes: [{ resourceId: 'bardic-inspiration', amount: 1 }]
    });
    expect(resourcePoolsFromAutomaticFeature(character, mantle)).toEqual([]);
  });

  it('supports class-level maps and safe arithmetic formulas', () => {
    const fighter = characterWithClass('Fighter', 7, 10);
    const superiority = item('superiority', 'Combat Superiority', {
      classId: 'phb-2024-class-fighter', resource: { id: 'battle-master-superiority-dice', maxByFighterLevel: { '3': 4, '7': 5, '15': 6 }, recharge: 'shortRest' }
    });
    expect(resourcePoolsFromAutomaticFeature(fighter, superiority)[0]?.max).toBe(5);

    const paladin = characterWithClass('Paladin', 5, 10);
    const layOnHands = item('loh', 'Lay On Hands', {
      classId: 'phb-2024-class-paladin', resource: { id: 'paladin-lay-on-hands-pool', max: { kind: 'custom', formula: '5 * PaladinLevel' }, recharge: 'longRest' }
    });
    expect(resourcePoolsFromAutomaticFeature(paladin, layOnHands)[0]?.max).toBe(25);

    const warlock = characterWithClass('Warlock', 5, 8);
    const healingLight = item('healing-light', 'Healing Light', {
      classId: 'phb-2024-class-warlock', resource: { id: 'healing-light', max: { kind: 'custom', formula: '1 + WarlockLevel' }, recharge: 'longRest' }
    });
    expect(resourcePoolsFromAutomaticFeature(warlock, healingLight)[0]?.max).toBe(6);
  });

  it('supports top-level uses formulas and legacy nested uses', () => {
    const ranger = { ...characterWithClass('Ranger', 10, 10), abilities: { ...createEmptyCharacter().abilities, WIS: 18 } };
    const tireless = item('tireless', 'Tireless', { classId: 'phb-2024-class-ranger', usesFormula: 'WIS', minimumUses: 1, recharge: 'longRest' });
    expect(resourcePoolsFromAutomaticFeature(ranger, tireless)[0]?.max).toBe(4);

    const shifter = item('shifter', 'Shifting', { mechanics: { usesFormula: 'PB', recharge: 'longRest' } });
    expect(resourcePoolsFromAutomaticFeature({ ...ranger, level: 10 }, shifter)[0]?.max).toBe(4);

    const genie = item('genie', "Genie's Vessel", { mechanics: { bottledRespite: { uses: 1, recharge: 'longRest' } } });
    expect(resourcePoolsFromAutomaticFeature(ranger, genie)[0]).toEqual(expect.objectContaining({ max: 1, recharge: 'longRest' }));
  });


  it('supports legacy string-based usage formulas such as PB and ability modifier minimums', () => {
    const warlock = { ...characterWithClass('Warlock', 12, 8), abilities: { ...createEmptyCharacter().abilities, CHA: 18 } };
    const bond = item('bond-talisman', 'Bond of the Talisman', {
      classId: 'phb-2024-class-warlock', mechanics: { uses: 'PB', recharge: 'longRest' }
    });
    expect(resourcePoolsFromAutomaticFeature(warlock, bond)[0]).toEqual(expect.objectContaining({ max: 4, recharge: 'longRest' }));

    const inspiration = item('infectious-inspiration', 'Infectious Inspiration', {
      classId: 'phb-2024-class-bard', mechanics: { uses: 'CHA modifier (minimum 1)', recharge: 'longRest' }
    });
    expect(resourcePoolsFromAutomaticFeature({ ...warlock, classes: [{ id: 'bard-local', name: 'Bard', level: 12, hitDie: 8 }] }, inspiration)[0]?.max).toBe(4);
  });

  it('repairs missing resources on already-linked features without resetting spent uses', () => {
    const character = characterWithClass('Bard', 7, 8);
    const featureItem = item('beguiling-repair', 'Beguiling Magic', { classId: 'phb-2024-class-bard', resource: { id: 'beguiling', recharge: 'longRest' } });
    let next = reconcileAutomaticFeatureResourceUpdates(character, featureItem);
    expect(next.resources.find((resource) => resource.id === 'beguiling')?.current).toBe(1);
    next = { ...next, resources: next.resources.map((resource) => resource.id === 'beguiling' ? { ...resource, current: 0 } : resource) };
    next = reconcileAutomaticFeatureResourceUpdates(next, featureItem);
    expect(next.resources.find((resource) => resource.id === 'beguiling')?.current).toBe(0);
  });

  it('applies partial/full declarative recovery rules on rests', () => {
    const character = {
      ...createEmptyCharacter('Rest'),
      resources: [{ id: 'rage', name: 'Rage', max: 4, current: 1, recharge: 'manual' as const, recoveryRules: [{ trigger: 'shortRest' as const, amount: 1 }, { trigger: 'longRest' as const, amount: 'all' as const }] }]
    };
    const afterShort = applyRest(character, 'shortRest').character;
    expect(afterShort.resources[0]?.current).toBe(2);
    const afterLong = applyRest(afterShort, 'longRest').character;
    expect(afterLong.resources[0]?.current).toBe(4);
  });
});
