import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { CompendiumImportInput } from '../compendium/schemas';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { createDefaultCharacter, createEmptyCharacter } from '../data/mockData';
import { validateCharacterRules } from '../rules-engine/validators/ruleValidation';
import { characterCompletion, nextCharacterStep } from '../ui/characterPresentation';
import { getCharacterDisplayName } from '../ui/characterIdentity';

const importedItem = (packId: string, sourceId: string, kind: CompendiumImportInput['items'][number]['kind'], name: string) => {
  const source = { id: sourceId, book: `Source ${sourceId}`, page: '1', version: '2024', status: 'active' as const, confidence: 'exact' as const };
  return buildPersistedCompendiumImport({ id: packId, source, items: [{ id: `${packId}-${kind}`, kind, name, source, payload: {} }] }).items[0]!;
};

describe('character journey presentation', () => {
  it('allows an unnamed character and provides a stable display label', () => {
    const character = createEmptyCharacter('');
    expect(validateCharacterRules(character).issues.some((issue) => issue.code === 'CHARACTER_NAME_REQUIRED')).toBe(false);
    expect(getCharacterDisplayName(character)).toMatch(/^Personagem /);
  });

  it('starts a clean character in the compendium-first base step', () => {
    const character = createEmptyCharacter('Kael');

    expect(character.classes).toHaveLength(0);
    expect(character.weapons).toHaveLength(0);
    expect(character.spells).toHaveLength(0);
    expect(characterCompletion(character)).toBeCloseTo(1 / 6);
    expect(nextCharacterStep(character).key).toBe('class');
  });

  it('marks a character with complete essentials and a rotation as ready', () => {
    const character = {
      ...createDefaultCharacter('Soren'),
      species: { id: 'species', name: 'Human', features: [] },
      background: { id: 'background', name: 'Guard', features: [] },
      proficiencies: { skills: ['Athletics'], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] }
    };

    expect(characterCompletion(character)).toBe(1);
    expect(nextCharacterStep(character).key).toBe('ready');
  });

  it('replaces singleton origins while keeping the old link as non-blocking history', () => {
    const character = createDefaultCharacter('Seraphiel');
    const first = applyCompendiumItemToCharacter(character, importedItem('pack-a', 'source-a', 'species', 'First Species'));
    const second = applyCompendiumItemToCharacter(first.character, importedItem('pack-b', 'source-b', 'species', 'Second Species'));

    expect(second.ok).toBe(true);
    expect(second.character.species?.name).toBe('Second Species');
    expect(second.character.compendiumLinks?.map((link) => link.status)).toEqual(['removed', 'active']);
    expect(validateCharacterRules(second.character).issues.filter((issue) => issue.code.startsWith('COMPENDIUM_LINK'))).toHaveLength(0);
  });
});

