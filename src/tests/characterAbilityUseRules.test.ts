import { buildPersistedCompendiumImport } from '../compendium/importer';
import { getCharacterAbilityUses } from '../characters/abilityUseRules';
import { createEmptyCharacter } from '../data/mockData';
import type { Character } from '../types';

const source = { id: 'ability-use', book: 'Ability Use', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const items = buildPersistedCompendiumImport({
  id: 'ability-use-pack', source,
  items: [
    { id: 'beguiling', kind: 'feature', name: 'Beguiling Magic', summary: 'Triggered magic.', source, payload: { sourceType: 'subclassFeature', resource: { id: 'glamour-beguiling-magic', recharge: 'longRest' } } },
    { id: 'mantle-inspiration', kind: 'feature', name: 'Mantle of Inspiration', source, payload: { sourceType: 'subclassFeature', actionCost: 'bonusAction', consumes: [{ resourceId: 'bardic-inspiration', amount: 1 }] } },
    { id: 'mantle-majesty', kind: 'feature', name: 'Mantle of Majesty', source, payload: { sourceType: 'subclassFeature', actionCost: 'bonusAction', resource: { id: 'mantle-of-majesty', recharge: 'manual' } } },
    { id: 'variable', kind: 'feature', name: 'Variable Spend', source, payload: { sourceType: 'classFeature', consumes: [{ resourceId: 'sorcery-points', amount: '1-5' }] } }
  ]
}).items;

const character = (): Character => {
  const base = createEmptyCharacter('Glamour');
  const features = items.map((item, index) => ({ id: `feature-${index}`, name: item.name, sourceType: 'classFeature' as const, source }));
  return {
    ...base,
    features,
    resources: [
      { id: 'glamour-beguiling-magic', name: 'Beguiling Magic', max: 1, current: 1, recharge: 'longRest' },
      { id: 'bardic-inspiration', name: 'Bardic Inspiration', max: 4, current: 4, recharge: 'longRest' },
      { id: 'mantle-of-majesty', name: 'Mantle of Majesty', max: 1, current: 1, recharge: 'manual' },
      { id: 'sorcery-points', name: 'Sorcery Points', max: 5, current: 5, recharge: 'longRest' }
    ],
    compendiumLinks: items.map((item, index) => ({
      id: `link-${index}`, characterId: base.id, itemId: item.id, importItemId: item.importItemId,
      packId: 'ability-use-pack', sourceId: source.id, itemType: 'feature' as const,
      appliedAs: 'feature' as const, appliedEntityId: `feature-${index}`, appliedEntityName: item.name,
      status: 'active' as const, addedAt: '2026-01-01T00:00:00.000Z'
    }))
  };
};

describe('character ability use projection', () => {
  it('makes Glamour Bard fixed consumers executable without inventing duplicate pools', () => {
    const uses = getCharacterAbilityUses(character(), items);
    expect(uses.find((entry) => entry.name === 'Mantle of Inspiration')).toEqual(expect.objectContaining({ executable: true, costLabels: ['1 Bardic Inspiration'], actionLabel: 'Ação bônus' }));
    expect(uses.find((entry) => entry.name === 'Beguiling Magic')).toEqual(expect.objectContaining({ executable: true, costLabels: ['1 Beguiling Magic'] }));
    expect(uses.find((entry) => entry.name === 'Mantle of Majesty')).toEqual(expect.objectContaining({ executable: true, costLabels: ['1 Mantle of Majesty'], actionLabel: 'Ação bônus' }));
  });

  it('keeps variable costs manual instead of guessing an amount', () => {
    const variable = getCharacterAbilityUses(character(), items).find((entry) => entry.name === 'Variable Spend');
    expect(variable).toEqual(expect.objectContaining({ executable: false }));
    expect(variable?.issues.some((entry) => entry.code === 'ABILITY_VARIABLE_RESOURCE_COST')).toBe(true);
  });
});
