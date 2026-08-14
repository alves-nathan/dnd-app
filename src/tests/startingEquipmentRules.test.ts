import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyStartingEquipmentSelections, createEquipmentSelection, getStartingEquipmentOptions, validateStartingEquipmentSelections } from '../characters/startingEquipmentRules';
import { createDefaultCharacter, createEmptyCharacter } from '../data/mockData';
import { buildAvailableActions } from '../rules-engine/actions/buildActions';
import { getArmorClass } from '../rules-engine/characters/derivedStats';

const source = { id: 'equipment-source', book: 'Equipment Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const pack = buildPersistedCompendiumImport({
  id: 'equipment-pack', source, items: [
    { id: 'soldier', kind: 'background', name: 'Soldier', source, payload: { equipmentOptions: { A: ['Spear', '20 GP'], B: ['50 GP'] } } },
    { id: 'warlock', kind: 'class', name: 'Warlock', source, payload: { level: 1 } },
    { id: 'spear', kind: 'weapon', name: 'Spear', source, payload: { damageFormula: '1d6 + STR', weaponType: 'melee' } }
  ]
});
const itemId = (id: string) => pack.items.find((entry) => entry.importItemId === id)!.id;

describe('starting equipment', () => {
  it('requires one option and applies items plus currency', () => {
    const background = pack.items.find((entry) => entry.importItemId === 'soldier')!;
    const options = getStartingEquipmentOptions(background, 'background');
    expect(validateStartingEquipmentSelections([options], [])).toHaveLength(1);
    const selection = createEquipmentSelection(options[0]!, pack.items);
    const character = applyStartingEquipmentSelections(createDefaultCharacter('Soldier'), [selection], pack.items);
    expect(character.weapons.some((weapon) => weapon.name === 'Spear')).toBe(true);
    expect(character.currency?.gp).toBe(20);
    expect(character.buildChoices?.equipmentSelections).toHaveLength(1);
    expect(selection.items?.find((entry) => entry.label === 'Spear')?.compendiumItemId).toBe(itemId('spear'));
    expect(character.weapons.find((weapon) => weapon.name === 'Spear')?.startingEquipmentSelectionId).toBe(selection.id);
  });

  it('provides class equipment and gold fallback for older PHB imports', () => {
    const warlock = pack.items.find((entry) => entry.importItemId === 'warlock')!;
    const options = getStartingEquipmentOptions(warlock, 'class');
    expect(options.map((option) => option.optionId)).toEqual(['A', 'B']);
    expect(options.find((option) => option.optionId === 'B')?.goldPieces).toBe(100);
    expect(options.find((option) => option.optionId === 'A')?.labels).toContain('Leather Armor');
  });

  it('replaces explicitly tagged starting items without removing manual equipment', () => {
    const background = pack.items.find((entry) => entry.importItemId === 'soldier')!;
    const options = getStartingEquipmentOptions(background, 'background');
    const itemSelection = createEquipmentSelection(options.find((option) => option.optionId === 'A')!, pack.items);
    let character = applyStartingEquipmentSelections(createDefaultCharacter('Soldier'), [itemSelection], pack.items);
    character = {
      ...character,
      equipment: [...character.equipment, { id: 'manual-rope', name: 'Manual Rope', quantity: 1 }]
    };
    const goldSelection = createEquipmentSelection(options.find((option) => option.optionId === 'B')!, pack.items);
    character = applyStartingEquipmentSelections(character, [goldSelection], pack.items);
    expect(character.weapons.some((weapon) => weapon.name === 'Spear')).toBe(false);
    expect(character.equipment.some((entry) => entry.id === 'manual-rope')).toBe(true);
    expect(character.currency?.gp).toBe(50);
  });

  it('uses explicitly selected class equipment in attack and Armor Class calculations even before bulk review', () => {
    const reviewSource = {
      id: 'phb-2024',
      book: 'PHB',
      version: '2024',
      status: 'needsReview' as const,
      confidence: 'importedNeedsReview' as const
    };
    const reviewPack = buildPersistedCompendiumImport({
      id: 'review-equipment-pack',
      source: reviewSource,
      items: [
        {
          id: 'fighter',
          kind: 'class',
          name: 'Fighter',
          source: reviewSource,
          payload: { equipmentOptions: { A: ['4 Handaxes', 'Leather Armor', 'Shield'] } }
        },
        { id: 'handaxe', kind: 'weapon', name: 'Handaxe', source: reviewSource, payload: { damageFormula: '1d6 + STR', weaponType: 'melee', attackAbility: 'STR', damageAbility: 'STR' } },
        { id: 'leather', kind: 'armor', name: 'Leather Armor', source: reviewSource, payload: { baseAC: 11 } },
        { id: 'shield', kind: 'armor', name: 'Shield', source: reviewSource, payload: { baseAC: 0, acBonus: 2, stacksWithArmor: true, armorCategory: 'shield' } }
      ]
    });
    const fighter = reviewPack.items.find((entry) => entry.importItemId === 'fighter')!;
    const option = getStartingEquipmentOptions(fighter, 'class')[0]!;
    const selection = createEquipmentSelection(option, reviewPack.items);
    const character = applyStartingEquipmentSelections(createEmptyCharacter('Equipped Fighter'), [selection], reviewPack.items);

    expect(character.weapons.some((weapon) => weapon.name === 'Handaxe')).toBe(true);
    expect(buildAvailableActions(character).some((action) => action.type === 'attack' && action.name === 'Handaxe')).toBe(true);
    expect(character.armor?.name).toBe('Leather Armor');
    expect(character.armorAccessories?.some((armor) => armor.name === 'Shield')).toBe(true);
    expect(getArmorClass(character)).toBe(15);
  });

});
