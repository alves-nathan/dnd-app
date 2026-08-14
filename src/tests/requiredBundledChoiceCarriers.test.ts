import { initializeBundledCatalog } from '../catalog/bundledCatalog';
import { listCharacterChoices } from '../catalog/characterChoiceBridge';
import { ContentPolicyService } from '../catalog/contentPolicyService';
import { mergeRequiredBundledChoiceCarriers, requiredBundledChoiceCarriers } from '../catalog/requiredBundledChoiceCarriers';
import type { StoredCompendiumItem } from '../compendium/types';

describe('required bundled mechanical choice carriers', () => {
  it('provides all twelve PHB 2024 classes even when the persisted compendium is empty', () => {
    const snapshot = initializeBundledCatalog();
    const filterState = new ContentPolicyService(snapshot).createDefaultState();
    const carriers = requiredBundledChoiceCarriers();
    const classes = listCharacterChoices({
      snapshot,
      filterState,
      compendiumItems: carriers,
      enabledSourceIds: ['phb-2024']
    }, { kinds: ['class'], includeUnavailable: true });

    expect(classes.choices).toHaveLength(12);
    expect(classes.choices.every((choice) => choice.available)).toBe(true);
    expect(classes.choices.every((choice) => choice.compendiumItemId?.startsWith('bundled-fallback:'))).toBe(true);
    expect(classes.choices.map((choice) => choice.name)).toEqual(expect.arrayContaining([
      'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk',
      'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard'
    ]));
  });

  it('never shadows a persisted canonical item with the non-persistent fallback', () => {
    const fallbackClass = requiredBundledChoiceCarriers().find((item) => item.importItemId === 'phb-2024-class-wizard');
    expect(fallbackClass).toBeDefined();
    const persisted: StoredCompendiumItem = {
      ...fallbackClass!,
      id: 'persisted:wizard',
      name: 'Wizard persisted',
      normalizedJson: { ...fallbackClass!.normalizedJson, persistedMarker: true }
    };
    const merged = mergeRequiredBundledChoiceCarriers([persisted]);
    const wizardRows = merged.filter((item) => item.importItemId === 'phb-2024-class-wizard');
    expect(wizardRows).toHaveLength(1);
    expect(wizardRows[0]?.id).toBe('persisted:wizard');
  });
});
