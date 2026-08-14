import type { StoredCompendiumItem } from '../compendium/types';
import {
  getSubclassChoiceRequirements,
  getSubclassSpellListReferences,
  setSubclassChoiceOption,
  validateSubclassChoices
} from '../characters/subclassChoiceRules';

const toStoredItems = (pack: any, packId: string): StoredCompendiumItem[] => pack.items.map((item: any) => ({
  id: item.id,
  importItemId: item.id,
  packId,
  sourceId: item.source?.id ?? 'unknown',
  type: item.kind,
  name: item.name,
  summary: item.summary,
  rawJson: item,
  normalizedJson: item.payload ?? {},
  tags: item.payload?.tags ?? item.tags ?? [],
  status: 'validated',
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z'
}));

describe('subclass internal choice rules', () => {
  it('requires and describes the Genie patron kind from imported Tasha mechanics', () => {
    const pack = require('../../assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json');
    const items = toStoredItems(pack, 'tasha');
    const genie = items.find((item) => item.id === 'tcoe-2020-subclass-the-genie');
    const requirements = getSubclassChoiceRequirements(genie, items, 3);

    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.choiceId).toBe('genie-kind');
    expect(requirements[0]?.options.map((option) => option.id)).toEqual(['dao', 'djinni', 'efreeti', 'marid']);
    expect(requirements[0]?.options.find((option) => option.id === 'efreeti')?.summary).toContain('Genie’s Wrath: fire');
    expect(requirements[0]?.options.find((option) => option.id === 'efreeti')?.summary).toContain('resistência a fire');
    expect(requirements[0]?.options.find((option) => option.id === 'dao')?.summary).toContain('Wall of Stone');

    expect(validateSubclassChoices(requirements, [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUBCLASS_INTERNAL_CHOICE_REQUIRED' })
    ]));
    const selected = setSubclassChoiceOption([], requirements[0]!, 'efreeti');
    expect(validateSubclassChoices(requirements, selected)).toEqual([]);
    expect(selected).toEqual([{ subclassItemId: genie?.id, choiceId: 'genie-kind', optionId: 'efreeti' }]);

    const efreetiSpells = getSubclassSpellListReferences(genie, selected, items, 3);
    expect(efreetiSpells).toEqual(expect.arrayContaining([
      'phb-2024-spell-detect-evil-and-good',
      'phb-2024-spell-burning-hands',
      'phb-2024-spell-fireball'
    ]));
    expect(efreetiSpells).not.toContain('phb-2024-spell-wall-of-stone');

    const daoSelected = setSubclassChoiceOption([], requirements[0]!, 'dao');
    expect(getSubclassSpellListReferences(genie, daoSelected, items, 3)).toEqual(expect.arrayContaining([
      'phb-2024-spell-sanctuary',
      'phb-2024-spell-wall-of-stone'
    ]));
  });

  it('detects the Armorer armor model as a mutable subclass configuration', () => {
    const pack = require('../../assets/compendium/forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json');
    const items = toStoredItems(pack, 'forge');
    const armorer = items.find((item) => item.id === 'forge-artificer-2025-subclass-armorer');
    const requirements = getSubclassChoiceRequirements(armorer, items, 3);

    expect(requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        choiceId: 'armor-model',
        mutable: true,
        options: expect.arrayContaining([
          expect.objectContaining({ id: 'dreadnaught' }),
          expect.objectContaining({ id: 'guardian' }),
          expect.objectContaining({ id: 'infiltrator' })
        ])
      })
    ]));
  });
  it('detects rest-refreshable subclass configuration only when its feature is unlocked', () => {
    const pack = require('../../assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json');
    const items = toStoredItems(pack, 'phb');
    const hunter = items.find((item) => item.id === 'phb-2024-subclass-ranger-hunter');

    const level3 = getSubclassChoiceRequirements(hunter, items, 3);
    expect(level3).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Hunter's Prey",
        mutable: true,
        options: expect.arrayContaining([
          expect.objectContaining({ id: 'colossus-slayer' }),
          expect.objectContaining({ id: 'horde-breaker' }),
          expect.objectContaining({ id: 'retaliator' })
        ])
      })
    ]));
    expect(level3.some((requirement) => requirement.title === 'Defensive Tactics')).toBe(false);

    const level7 = getSubclassChoiceRequirements(hunter, items, 7);
    expect(level7.some((requirement) => requirement.title === 'Defensive Tactics')).toBe(true);
  });

});
