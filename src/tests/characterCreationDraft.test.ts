import { abilityScoresFromValues, STANDARD_ARRAY, standardArrayState } from '../characters/abilityGeneration';
import {
  type CharacterCreationDraft,
  CharacterCreationDraftRepository,
  CHARACTER_CREATION_DRAFT_VERSION,
  sanitizeCharacterCreationDraft
} from '../characters/creationDraft';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

describe('character creation draft', () => {
  const draft: CharacterCreationDraft = {
    version: CHARACTER_CREATION_DRAFT_VERSION,
    updatedAt: '2026-07-14T12:00:00.000Z',
    step: 6,
    name: '',
    targetLevel: '5',
    classSearch: 'fighter',
    selectedClassLevels: { fighter: 3, wizard: 2 },
    startingClassItemId: 'fighter',
    selectedSpeciesId: 'human',
    speciesChoices: [
      {
        speciesItemId: 'human',
        featureItemId: 'human-versatile',
        choiceKind: 'option',
        optionId: 'skilled'
      }
    ],
    selectedBackgroundId: 'sage',
    backgroundChoices: [],
    selectedSubclassByClass: { fighter: 'champion' },
    subclassChoices: [{ subclassItemId: 'champion', choiceId: 'stance', optionId: 'guard' }],
    selectedOriginFeatId: 'skilled',
    selectedFeatCounts: { 'ability-score-improvement': 1 },
    selectedInvocationCounts: { 'agonizing-blast': 1 },
    eldritchInvocationChoices: [{ id: 'choice-agonizing', invocationItemId: 'agonizing-blast', instanceIndex: 0, targetCantripItemId: 'eldritch-blast', originFeatItemId: 'lucky', familiarCreatureItemId: 'imp', familiarVariant: 'special', lifedrinkerDamageType: 'radiant' }],
    featChoiceDrafts: {},
    equipmentSelections: [],
    higherLevelStartingBenefits: {
      startingLevel: 5,
      rolledD10: 5,
      baseGold: 500,
      goldMultiplier: 25,
      bonusGold: 625,
      magicItemAllowance: { common: 1 },
      generatedAt: '2026-07-14T12:00:00.000Z'
    },
    bonusMode: 'twoOne' as const,
    bonusAbilities: ['STR', 'INT'],
    abilityMethod: 'standardArray' as const,
    abilityGeneration: standardArrayState(),
    abilityValueAssignments: {},
    baseAbilities: abilityScoresFromValues([...STANDARD_ARRAY]),
    classSkillChoices: ['Athletics', 'History'],
    classToolChoicesText: '',
    expertiseSkills: [],
    languagesText: 'Common, Elvish',
    spellSearch: 'magic',
    activeSpellClassItemId: 'wizard',
    spellAssignments: { 'magic-missile': 'wizard' },
    spellbookAssignments: { 'magic-missile': 'wizard' }
  };

  it('roundtrips a resumable wizard draft', async () => {
    const storage = createMemoryKeyValueStorage();
    const repository = new CharacterCreationDraftRepository(storage);
    await repository.save(draft);
    expect(await repository.load()).toEqual(sanitizeCharacterCreationDraft({ ...draft, bonusAbilities: ['STR', 'INT'] }));
    await repository.clear();
    expect(await repository.load()).toBeUndefined();
  });

  it('sanitizes corrupt or out-of-range fields', () => {
    const sanitized = sanitizeCharacterCreationDraft({
      ...draft,
      step: 99,
      selectedClassLevels: { fighter: -4, wizard: '2' },
      abilityMethod: 'unknown',
      bonusAbilities: ['STR', 'INVALID']
    });
    expect(sanitized?.step).toBe(7);
    expect(sanitized?.selectedClassLevels).toEqual({ fighter: 0 });
    expect(sanitized?.abilityMethod).toBe('standardArray');
    expect(sanitized?.bonusAbilities).toEqual(['STR']);
    expect(sanitized?.speciesChoices).toHaveLength(1);
    expect(sanitized?.subclassChoices).toEqual([{ subclassItemId: 'champion', choiceId: 'stance', optionId: 'guard' }]);
    expect(sanitized?.eldritchInvocationChoices[0]).toEqual(expect.objectContaining({ targetCantripItemId: 'eldritch-blast', originFeatItemId: 'lucky', familiarCreatureItemId: 'imp', familiarVariant: 'special', lifedrinkerDamageType: 'radiant' }));
  });
  it('persists and sanitizes a custom background definition', () => {
    const sanitized = sanitizeCharacterCreationDraft({
      ...draft,
      selectedBackgroundId: 'custom-background',
      customBackground: {
        name: 'Ocean Salvager',
        abilityScoreOptions: ['DEX', 'WIS', 'CHA', 'STR'],
        skillProficiencies: ['Survival', 'Perception', 'Arcana'],
        toolProficiency: "Navigator's Tools"
      }
    });
    expect(sanitized?.customBackground).toEqual({
      name: 'Ocean Salvager',
      abilityScoreOptions: ['DEX', 'WIS', 'CHA'],
      skillProficiencies: ['Survival', 'Perception'],
      toolProficiency: "Navigator's Tools"
    });
  });

});
