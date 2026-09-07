import { buildPersistedCompendiumImport } from '../compendium/importer';
import { buildProficiencySelection, getClassProficiencyRequirement, reconcileClassSkillChoices } from '../characters/proficiencyRules';

const source = { id: 'prof-source', book: 'Rules', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const persisted = buildPersistedCompendiumImport({
  id: 'prof-pack',
  source,
  items: [
    {
      id: 'rogue', kind: 'class', name: 'Rogue', source,
      payload: {
        level: 1,
        skillProficienciesChoice: ['Acrobatics', 'Athletics', 'Stealth', 'Perception', 'Investigation'],
        savingThrowProficiencies: ['DEX', 'INT'],
        weaponProficiencies: ['simple'], armorTraining: ['light'], toolProficiencies: ['thievesTools'],
        progression: [{ level: 1, featureIds: ['expertise'] }]
      }
    },
    { id: 'expertise', kind: 'feature', name: 'Expertise', source, payload: { sourceType: 'classFeature', classId: 'rogue', levelGained: 1, expertiseSkillChoicesByLevel: { '1': 2 } } },
    { id: 'criminal', kind: 'background', name: 'Criminal', source, payload: { skillProficiencies: ['Sleight of Hand', 'Stealth'], toolProficiencies: ["Thieves' Tools"] } },
    { id: 'bard', kind: 'class', name: 'Bard', source, payload: { skillProficienciesChoice: ['Acrobatics', 'Arcana', 'Performance'], savingThrowProficiencies: ['DEX', 'CHA'], weaponProficiencies: ['simple'], armorTraining: ['light'], toolProficiencies: ['musicalInstrument:3'] } },
    { id: 'artisan', kind: 'background', name: 'Artisan', source, payload: { skillProficiencies: ['Investigation', 'Persuasion'], toolProficiencies: ["one Artisan's Tools"] } },
    { id: 'ranger', kind: 'class', name: 'Ranger', source, payload: { skillProficienciesChoice: ['Athletics', 'Nature', 'Perception'], savingThrowProficiencies: ['STR', 'DEX'], weaponProficiencies: ['simple', 'martial'], armorTraining: ['light', 'medium', 'shields'], toolProficiencies: [], progression: [{ level: 2, featureIds: ['deft-explorer'] }] } },
    { id: 'deft-explorer', kind: 'feature', name: 'Deft Explorer', source, payload: { sourceType: 'classFeature', classId: 'ranger', levelGained: 2, expertiseSkillChoices: 1, languageChoices: 2 } },
    { id: 'wizard-2024', kind: 'class', name: 'Wizard', source, payload: { hitDie: 6, skillProficienciesChoice: ['Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Religion'], savingThrowProficiencies: ['INT', 'WIS'], weaponProficiencies: ['simple'], armorTraining: [], toolProficiencies: [] } },
    { id: 'wizard-legacy-carrier', kind: 'class', name: 'Wizard', source: { ...source, id: 'legacy-prof-source', version: '2014' }, payload: { hitDie: 6 } },
    { id: 'sage', kind: 'background', name: 'Sage', source, payload: { skillProficiencies: ['Arcana', 'History'], toolProficiencies: ["Calligrapher's Supplies"] } }
  ]
});
const item = (id: string) => persisted.items.find((entry) => entry.importItemId === id)!;

describe('proficiency rules', () => {
  it('derives exact class skill and expertise choices', () => {
    const requirement = getClassProficiencyRequirement(item('rogue'), 1, persisted.items);
    expect(requirement.skillChoiceCount).toBe(4);
    expect(requirement.expertiseChoiceCount).toBe(2);
  });

  it('builds valid proficiencies from background and class choices', () => {
    const result = buildProficiencySelection({
      startingClassItem: item('rogue'), startingClassLevel: 1, backgroundItem: item('criminal'), allItems: persisted.items,
      classSkillChoices: ['Acrobatics', 'Athletics', 'Perception', 'Investigation'], classToolChoices: [],
      expertiseSkills: ['Stealth', 'Perception']
    });
    expect(result.ok).toBe(true);
    expect(result.proficiencies.skills).toEqual(expect.arrayContaining(['Sleight of Hand', 'Stealth', 'Acrobatics', 'Athletics', 'Perception', 'Investigation']));
    expect(result.proficiencies.expertiseSkills).toEqual(['Stealth', 'Perception']);
  });


  it('applies background skills automatically and requires class choices to use different skills', () => {
    const result = buildProficiencySelection({
      startingClassItem: item('rogue'),
      startingClassLevel: 1,
      backgroundItem: item('criminal'),
      allItems: persisted.items,
      classSkillChoices: ['Stealth', 'Acrobatics', 'Athletics', 'Perception'],
      classToolChoices: [],
      expertiseSkills: ['Stealth', 'Perception']
    });
    expect(result.proficiencies.skills).toEqual(expect.arrayContaining(['Sleight of Hand', 'Stealth']));
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'CLASS_SKILL_ALREADY_GRANTED_BY_BACKGROUND')).toBe(true);
  });

  it('rejects incomplete class choices', () => {
    const result = buildProficiencySelection({
      startingClassItem: item('rogue'), startingClassLevel: 1, allItems: persisted.items,
      classSkillChoices: ['Stealth'], classToolChoices: [], expertiseSkills: []
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'CLASS_SKILL_CHOICE_COUNT')).toBe(true);
  });



  it('reconciles resumed class-skill choices against skills already granted by origin', () => {
    const requirement = getClassProficiencyRequirement(item('wizard-2024'), 1, persisted.items);
    const reconciled = reconcileClassSkillChoices({
      currentChoices: ['Arcana', 'History', 'Investigation'],
      requirement,
      unavailableSkills: ['Arcana', 'History']
    });

    expect(reconciled).toEqual(['Investigation']);

    const result = buildProficiencySelection({
      startingClassItem: item('wizard-2024'),
      startingClassLevel: 1,
      backgroundItem: item('sage'),
      allItems: persisted.items,
      classSkillChoices: ['Investigation', 'Medicine'],
      classToolChoices: [],
      expertiseSkills: []
    });

    expect(result.ok).toBe(true);
    expect(result.proficiencies.skills).toEqual(expect.arrayContaining(['Arcana', 'History', 'Investigation', 'Medicine']));
  });

  it('falls back to the current same-named class chassis when a legacy class carrier omits proficiencies', () => {
    const requirement = getClassProficiencyRequirement(item('wizard-legacy-carrier'), 1, persisted.items);

    expect(requirement.className).toBe('Wizard');
    expect(requirement.skillChoiceCount).toBe(2);
    expect(requirement.skillOptions).toEqual(expect.arrayContaining(['Arcana', 'History', 'Investigation', 'Medicine']));
    expect(requirement.savingThrows).toEqual(['INT', 'WIS']);
    expect(requirement.weapons).toEqual(['simple']);
  });

  it('requires explicit selections for class and background tool families', () => {
    const result = buildProficiencySelection({
      startingClassItem: item('bard'),
      backgroundItem: item('artisan'),
      allItems: persisted.items,
      classSkillChoices: ['Acrobatics', 'Arcana', 'Performance'],
      classToolChoices: ['Bagpipes', 'Lute', 'Viol'],
      backgroundToolChoices: ["Smith's Tools"],
      expertiseSkills: []
    });
    expect(result.ok).toBe(true);
    expect(result.requirement?.toolOptions).toContain('Bagpipes');
    expect(result.backgroundRequirement?.toolOptions).toContain("Smith's Tools");
    expect(result.proficiencies.tools).toEqual(expect.arrayContaining(['Bagpipes', 'Lute', 'Viol', "Smith's Tools"]));
    expect(result.proficiencies.tools).not.toContain("one Artisan's Tools");
  });

  it('derives selectable language choices granted by class progression', () => {
    const requirement = getClassProficiencyRequirement(item('ranger'), 2, persisted.items);
    expect(requirement.languageChoiceCount).toBe(2);
    expect(requirement.languageOptions).toEqual(expect.arrayContaining(['Elvish', 'Sylvan', 'Undercommon']));
  });

  it('validates the two selected standard languages and adds Common automatically', () => {
    const result = buildProficiencySelection({
      startingClassItem: item('rogue'),
      backgroundItem: item('criminal'),
      allItems: persisted.items,
      classSkillChoices: ['Acrobatics', 'Athletics', 'Perception', 'Investigation'],
      classToolChoices: [],
      expertiseSkills: ['Stealth', 'Perception'],
      languages: ['Elvish', 'Draconic'],
      fixedLanguages: ['Common'],
      requiredLanguageChoiceCount: 2,
      allowedLanguageOptions: ['Elvish', 'Draconic', 'Dwarvish']
    });
    expect(result.ok).toBe(true);
    expect(result.proficiencies.languages).toEqual(['Common', 'Elvish', 'Draconic']);

    const incomplete = buildProficiencySelection({
      startingClassItem: item('rogue'),
      allItems: persisted.items,
      classSkillChoices: ['Acrobatics', 'Athletics', 'Perception', 'Investigation'],
      classToolChoices: [],
      expertiseSkills: ['Acrobatics', 'Athletics'],
      languages: ['Elvish'],
      fixedLanguages: ['Common'],
      requiredLanguageChoiceCount: 2,
      allowedLanguageOptions: ['Elvish', 'Draconic']
    });
    expect(incomplete.issues.some((issue) => issue.code === 'LANGUAGE_CHOICE_COUNT')).toBe(true);
  });
});
