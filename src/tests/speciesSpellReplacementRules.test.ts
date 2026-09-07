import type { Character, CharacterCompendiumLink, CharacterSpeciesChoice } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { createEmptyCharacter } from '../data/mockData';
import {
  getSpeciesChoiceRequirements,
  setSpeciesChoiceOption,
  setSpeciesChoiceSpellcastingAbility
} from '../characters/speciesChoiceRules';
import {
  getSpeciesSpellReplacementRequirements,
  markSpeciesSpellReplacementsUsed,
  normalizeSpeciesSpellReplacementChoices,
  setSpeciesSpellReplacement,
  speciesSpellReplacementAvailable,
  validateSpeciesSpellReplacementEdits
} from '../characters/speciesSpellReplacementRules';
import { reconcileExternalSpellGrants } from '../characters/externalSpellGrantRules';
import { useCharacterStore } from '../store/characterStore';

const items = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-16T00:00:00.000Z'
  }).items
);

const byImportId = (id: string): StoredCompendiumItem => {
  const item = items.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};

const activeSpeciesLink = (character: Character, species: StoredCompendiumItem): CharacterCompendiumLink => ({
  id: `link:species:${species.id}`,
  characterId: character.id,
  itemId: species.id,
  importItemId: species.importItemId,
  packId: species.packId,
  sourceId: species.sourceId,
  itemType: 'species',
  appliedAs: 'species',
  appliedEntityId: 'species-entity',
  appliedEntityName: species.name,
  status: 'active',
  addedAt: '2026-08-16T00:00:00.000Z'
});

const withSpecies = (
  speciesImportId: string,
  level: number,
  choices: CharacterSpeciesChoice[],
  lastLongRestAt?: string
): Character => {
  const base = createEmptyCharacter('Species replacement fixture');
  const species = byImportId(speciesImportId);
  return {
    ...base,
    level,
    lastLongRestAt,
    species: { id: 'species-entity', name: species.name, features: [] },
    compendiumLinks: [activeSpeciesLink(base, species)],
    buildChoices: { ...base.buildChoices!, speciesChoices: choices }
  };
};

describe('species spell replacements after Long Rest', () => {
  it('keeps High Elf Prestidigitation initially and gates Wizard-cantrip replacement behind a new Long Rest', () => {
    const elf = byImportId('phb-2024-species-elf');
    const lineage = getSpeciesChoiceRequirements(elf, items, 5).find((entry) => entry.kind === 'lineage')!;
    let choices = setSpeciesChoiceOption([], lineage, 'high-elf');
    choices = setSpeciesChoiceSpellcastingAbility(choices, lineage, 'INT');

    const requirements = getSpeciesSpellReplacementRequirements(elf, items, 5, choices);
    expect(requirements).toHaveLength(1);
    const requirement = requirements[0]!;
    expect(requirement.sourceClassNames).toEqual(['Wizard']);
    expect(requirement.candidateSpells.some((spell) => spell.name === 'Fire Bolt')).toBe(true);
    expect(requirement.currentSpellItemId).toBe(byImportId('phb-2024-spell-prestidigitation').id);

    const fireBolt = byImportId('phb-2024-spell-fire-bolt');
    const edited = setSpeciesSpellReplacement(choices, requirement, fireBolt.id);
    const withoutRest = withSpecies('phb-2024-species-elf', 5, choices);
    expect(speciesSpellReplacementAvailable(withoutRest, choices, requirement)).toBe(false);
    expect(validateSpeciesSpellReplacementEdits(withoutRest, requirements, choices, edited))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SPECIES_SPELL_REPLACEMENT_REST_REQUIRED' })]));

    const rested = withSpecies('phb-2024-species-elf', 5, choices, '2026-08-16T12:00:00.000Z');
    expect(speciesSpellReplacementAvailable(rested, choices, requirement)).toBe(true);
    expect(validateSpeciesSpellReplacementEdits(rested, requirements, choices, edited)).toEqual([]);
    const persisted = markSpeciesSpellReplacementsUsed(rested, requirements, choices, edited);
    expect(persisted.find((choice) => choice.featureItemId === lineage.featureItemId)?.replacementUsedAt)
      .toBe('2026-08-16T12:00:00.000Z');

    const granted = reconcileExternalSpellGrants({ ...rested, buildChoices: { ...rested.buildChoices!, speciesChoices: persisted } }, items).character;
    expect(granted.spells.some((spell) => spell.name === 'Fire Bolt')).toBe(true);
    expect(granted.spells.some((spell) => spell.name === 'Prestidigitation')).toBe(false);
    expect(granted.spells.some((spell) => spell.name === 'Detect Magic')).toBe(true);
    expect(granted.spells.some((spell) => spell.name === 'Misty Step')).toBe(true);

    const sameRestRequirements = getSpeciesSpellReplacementRequirements(elf, items, 5, persisted);
    const rayOfFrost = byImportId('phb-2024-spell-ray-of-frost');
    const secondEdit = setSpeciesSpellReplacement(persisted, sameRestRequirements[0]!, rayOfFrost.id);
    expect(validateSpeciesSpellReplacementEdits(
      { ...rested, buildChoices: { ...rested.buildChoices!, speciesChoices: persisted } },
      sameRestRequirements,
      persisted,
      secondEdit
    )).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SPECIES_SPELL_REPLACEMENT_REST_REQUIRED' })]));

    const nextRest = { ...rested, lastLongRestAt: '2026-08-17T12:00:00.000Z', buildChoices: { ...rested.buildChoices!, speciesChoices: persisted } };
    expect(validateSpeciesSpellReplacementEdits(nextRest, sameRestRequirements, persisted, secondEdit)).toEqual([]);
  });

  it('migrates a pre-FIX45 Khoravar cantrip choice into Friends plus a persisted Long-Rest replacement', () => {
    const khoravar = byImportId('forge-artificer-2025-species-khoravar');
    const feyGift = getSpeciesChoiceRequirements(khoravar, items, 1).find((entry) => entry.kind === 'spell')!;
    const guidance = byImportId('phb-2024-spell-guidance');
    const legacyChoice: CharacterSpeciesChoice = {
      speciesItemId: khoravar.id,
      featureItemId: feyGift.featureItemId,
      choiceKind: 'spell',
      optionId: guidance.id,
      spellcastingAbility: 'CHA'
    };

    const normalized = normalizeSpeciesSpellReplacementChoices(khoravar, items, 1, [legacyChoice]);
    expect(normalized[0]).not.toBe(legacyChoice);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.optionId).toBe(byImportId('phb-2024-spell-friends').id);
    expect(normalized[0]?.replacementSpellItemId).toBe(guidance.id);
    expect(normalized[0]?.spellcastingAbility).toBe('CHA');
  });

  it('forces Khoravar Fey Gift to start with Friends, then permits a Cleric/Druid/Wizard cantrip after Long Rest', () => {
    const khoravar = byImportId('forge-artificer-2025-species-khoravar');
    const feyGift = getSpeciesChoiceRequirements(khoravar, items, 1).find((entry) => entry.kind === 'spell')!;
    expect(feyGift.options.map((option) => option.label)).toEqual(['Friends']);
    let choices = setSpeciesChoiceOption([], feyGift, feyGift.options[0]!.id);
    choices = setSpeciesChoiceSpellcastingAbility(choices, feyGift, 'CHA');

    const requirements = getSpeciesSpellReplacementRequirements(khoravar, items, 1, choices);
    expect(requirements).toHaveLength(1);
    const requirement = requirements[0]!;
    expect(requirement.sourceClassNames).toEqual(['Cleric', 'Druid', 'Wizard']);
    expect(requirement.candidateSpells.some((spell) => spell.name === 'Guidance')).toBe(true);

    const rested = withSpecies('forge-artificer-2025-species-khoravar', 1, choices, '2026-08-16T12:00:00.000Z');
    const guidance = byImportId('phb-2024-spell-guidance');
    const edited = setSpeciesSpellReplacement(choices, requirement, guidance.id);
    expect(validateSpeciesSpellReplacementEdits(rested, requirements, choices, edited)).toEqual([]);
    const persisted = markSpeciesSpellReplacementsUsed(rested, requirements, choices, edited);
    const granted = reconcileExternalSpellGrants({ ...rested, buildChoices: { ...rested.buildChoices!, speciesChoices: persisted } }, items).character;
    expect(granted.spells.some((spell) => spell.name === 'Guidance')).toBe(true);
    expect(granted.spells.some((spell) => spell.name === 'Friends')).toBe(false);
  });
});

describe('species spell replacement rest workflow', () => {
  it('records a new replacement opportunity only when the character store completes a Long Rest', () => {
    useCharacterStore.setState({ characters: [] });
    const character = useCharacterStore.getState().addCharacter('Rest marker');
    expect(useCharacterStore.getState().characters.find((entry) => entry.id === character.id)?.lastLongRestAt).toBeUndefined();

    useCharacterStore.getState().applyRest(character.id, 'shortRest');
    expect(useCharacterStore.getState().characters.find((entry) => entry.id === character.id)?.lastLongRestAt).toBeUndefined();

    useCharacterStore.getState().applyRest(character.id, 'longRest');
    expect(useCharacterStore.getState().characters.find((entry) => entry.id === character.id)?.lastLongRestAt).toEqual(expect.any(String));
  });
});
