import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER,
  createCustomBackgroundCompendiumItem,
  createDefaultCustomBackgroundChoice,
  ensureCustomBackgroundCashEquipmentSelection,
  getCustomBackgroundEquipmentCandidates,
  getCustomBackgroundEquipmentSpentCopper,
  setCustomBackgroundEquipmentPurchaseCount,
  validateCustomBackgroundEquipmentSelection,
  validateCustomBackgroundOrigin,
  validateCustomBackgroundProficiencies
} from '../characters/customBackgroundRules';
import { backgroundSuggestions } from '../characters/creationData';
import { buildProficiencySelection } from '../characters/proficiencyRules';
import { applyStartingEquipmentSelections } from '../characters/startingEquipmentRules';
import { createEmptyCharacter } from '../data/mockData';

const source = { id: 'custom-source', book: 'Custom Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const pack = buildPersistedCompendiumImport({
  id: 'custom-background-pack',
  source,
  items: [
    { id: 'rope', kind: 'equipment', name: 'Rope', source, payload: { cost: '1 GP' } },
    { id: 'healer-kit', kind: 'equipment', name: "Healer's Kit", source, payload: { cost: '5 GP' } },
    { id: 'spear', kind: 'weapon', name: 'Spear', source, payload: { cost: '1 GP', weaponCategory: 'simple', damageFormula: '1d6 + STR' } },
    { id: 'plate', kind: 'armor', name: 'Plate Armor', source, payload: { cost: '1500 GP', baseAC: 18 } },
    { id: 'sword', kind: 'weapon', name: 'Longsword', source, payload: { cost: '15 GP', weaponCategory: 'martial', damageFormula: '1d8 + STR' } }
  ]
});

describe('custom background rules', () => {
  it('requires three abilities, two skills, and one tool and exposes them through the synthetic background', () => {
    const empty = createDefaultCustomBackgroundChoice();
    expect(validateCustomBackgroundOrigin(empty).some((issue) => issue.code === 'CUSTOM_BACKGROUND_ABILITY_COUNT')).toBe(true);
    expect(validateCustomBackgroundProficiencies(empty).some((issue) => issue.code === 'CUSTOM_BACKGROUND_SKILL_COUNT')).toBe(true);

    const choice = {
      name: 'Sailor of the Flooded World',
      abilityScoreOptions: ['DEX', 'WIS', 'CHA'] as const,
      skillProficiencies: ['Acrobatics', 'Survival'],
      toolProficiency: "Navigator's Tools"
    };
    expect(validateCustomBackgroundOrigin({ ...choice, abilityScoreOptions: [...choice.abilityScoreOptions] })).toEqual([]);
    expect(validateCustomBackgroundProficiencies({ ...choice, abilityScoreOptions: [...choice.abilityScoreOptions] })).toEqual([]);
    const synthetic = createCustomBackgroundCompendiumItem({ ...choice, abilityScoreOptions: [...choice.abilityScoreOptions] });
    const suggestions = backgroundSuggestions(synthetic);
    expect(suggestions.abilityOptions).toEqual(['DEX', 'WIS', 'CHA']);
    expect(suggestions.proficiencies.skills).toEqual(['Acrobatics', 'Survival']);
    expect(suggestions.proficiencies.tools).toEqual(["Navigator's Tools"]);
    const proficiencies = buildProficiencySelection({
      backgroundItem: synthetic,
      allItems: [],
      classSkillChoices: [],
      classToolChoices: [],
      expertiseSkills: []
    });
    expect(proficiencies.ok).toBe(true);
    expect(proficiencies.proficiencies.skills).toEqual(['Acrobatics', 'Survival']);
    expect(proficiencies.proficiencies.tools).toEqual(["Navigator's Tools"]);
  });

  it('offers general equipment from active sources and keeps the package within 50 GP', () => {
    const candidates = getCustomBackgroundEquipmentCandidates(pack.items, [source.id]);
    expect(candidates.map((candidate) => candidate.item.name)).toEqual(expect.arrayContaining(['Rope', "Healer's Kit", 'Spear']));
    expect(candidates.some((candidate) => candidate.item.name === 'Spear')).toBe(true);
    expect(candidates.some((candidate) => candidate.item.name === 'Longsword' || candidate.item.type === 'armor')).toBe(false);

    const rope = candidates.find((candidate) => candidate.item.name === 'Rope')!;
    let selections = ensureCustomBackgroundCashEquipmentSelection([]);
    expect(validateCustomBackgroundEquipmentSelection(selections, candidates)).toEqual([]);
    selections = setCustomBackgroundEquipmentPurchaseCount(selections, rope, 3, candidates);
    expect(getCustomBackgroundEquipmentSpentCopper(selections, candidates)).toBe(300);
    expect(selections[0]?.currency?.gp).toBe(47);
    const rejected = setCustomBackgroundEquipmentPurchaseCount(selections, rope, 60, candidates);
    expect(rejected).toEqual(selections);
    expect(getCustomBackgroundEquipmentSpentCopper(rejected, candidates)).toBeLessThanOrEqual(CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER);
  });

  it('preserves an explicit cash-only package without creating fake equipment labels', () => {
    const staleBackgroundSelection = {
      id: 'old-background', sourceKind: 'background' as const, sourceItemId: 'old-background', optionId: 'A', labels: ['Old Gear'], items: []
    };
    const selections = ensureCustomBackgroundCashEquipmentSelection([staleBackgroundSelection]);
    expect(selections.some((selection) => selection.sourceItemId === 'old-background')).toBe(false);
    const character = applyStartingEquipmentSelections(createEmptyCharacter('Custom'), selections, pack.items);
    expect(character.currency?.gp).toBe(50);
    expect(character.equipment).toHaveLength(0);
    expect(character.weapons).toHaveLength(0);
  });
});
