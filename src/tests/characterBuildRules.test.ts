import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  getFeatCategory,
  getProgressionFeatChoiceRequirements,
  validateFeatPrerequisites,
  validateMulticlassPrerequisites
} from '../characters/characterBuildRules';
import { emptyCharacterProficiencies } from '../characters/proficiencies';
import { createDefaultCharacter } from '../data/mockData';

const source = { id: 'rules-source', book: 'Rules', version: '2024', status: 'active' as const, confidence: 'exact' as const };

const persisted = buildPersistedCompendiumImport({
  id: 'rules-pack',
  source,
  items: [
    { id: 'fighter', kind: 'class', name: 'Fighter', source, payload: { level: 1, progression: [{ level: 1, featureIds: ['fighting-style'] }, { level: 4, featureIds: ['asi'] }] } },
    { id: 'wizard', kind: 'class', name: 'Wizard', source, payload: { level: 1, spellcasting: { ability: 'INT', progression: 'fullCaster' } } },
    { id: 'fighting-style', kind: 'feature', name: 'Fighting Style', source, payload: { sourceType: 'classFeature', classId: 'fighter', levelGained: 1, featCategory: 'fightingStyle' } },
    { id: 'asi', kind: 'feature', name: 'Ability Score Improvement', source, payload: { sourceType: 'classFeature', classId: 'fighter', levelGained: 4, featChoice: true } },
    { id: 'archery', kind: 'feat', name: 'Archery', source, payload: { category: 'fightingStyle', prerequisite: 'Fighting Style Feature', repeatable: false } },
    { id: 'gwm', kind: 'feat', name: 'Great Weapon Master', source, payload: { category: 'general', prerequisite: 'Level 4+, Strength 13+', repeatable: false } }
  ]
});

const item = (importId: string) => persisted.items.find((entry) => entry.importItemId === importId)!;

describe('character build rules', () => {
  it('validates multiclass ability prerequisites', () => {
    const issues = validateMulticlassPrerequisites(
      [item('fighter'), item('wizard')],
      { STR: 13, DEX: 10, CON: 10, INT: 12, WIS: 10, CHA: 10 }
    );
    expect(issues.some((issue) => issue.code === 'MULTICLASS_ABILITY_PREREQUISITE')).toBe(true);

    expect(validateMulticlassPrerequisites(
      [item('fighter'), item('wizard')],
      { STR: 13, DEX: 10, CON: 10, INT: 13, WIS: 10, CHA: 10 }
    )).toHaveLength(0);
  });

  it('validates feat level and ability prerequisites', () => {
    const feat = item('gwm');
    const issues = validateFeatPrerequisites({
      featItem: feat,
      totalLevel: 3,
      abilities: { STR: 12, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      proficiencies: emptyCharacterProficiencies(),
      classEntries: [{ item: item('fighter'), level: 3 }],
      allItems: persisted.items,
      character: createDefaultCharacter('Rules')
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['FEAT_LEVEL_PREREQUISITE', 'FEAT_ABILITY_PREREQUISITE']));
  });

  it('classifies imported Fighting Style feats from the payload category', () => {
    expect(getFeatCategory(item('archery'))).toBe('fightingStyle');
  });

  it('derives fighting style and ASI choice counts from class progression', () => {
    expect(getProgressionFeatChoiceRequirements([{ item: item('fighter'), level: 4 }], persisted.items)).toEqual({
      general: 1,
      fightingStyle: 1,
      epicBoon: 0
    });
  });
});
