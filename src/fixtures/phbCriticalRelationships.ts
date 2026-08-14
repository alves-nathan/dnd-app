import type { CompendiumImportInput } from '../compendium/schemas';

export const phbCriticalRelationshipsFixture: CompendiumImportInput = {
  id: 'phb-critical-relationships-fixture-v1',
  source: {
    id: 'phb-critical-fixture-source',
    book: 'PHB 2024 critical relationships fixture',
    page: 'fixture',
    version: '2024',
    status: 'active',
    confidence: 'exact',
    notes: 'Reduced permanent fixture for class, subclass, feat, background, spellbook and mastery relationships.'
  },
  items: [
    {
      id: 'fighter',
      kind: 'class',
      name: 'Fighter',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: {
        level: 1,
        hitDie: 10,
        savingThrowProficiencies: ['STR', 'CON'],
        skillChoiceCount: 2,
        skillProficiencies: ['Acrobatics', 'Animal Handling', 'Athletics', 'History', 'Insight', 'Intimidation', 'Perception', 'Persuasion', 'Survival'],
        weaponProficiencies: ['simple', 'martial'],
        armorTraining: ['light', 'medium', 'heavy', 'shields'],
        progression: [
          { level: 1, featureIds: ['fighter-second-wind', 'fighter-weapon-mastery'] },
          { level: 3, featureIds: ['fighter-subclass-choice'] },
          { level: 4, featureIds: ['fighter-ability-score-improvement'] }
        ]
      }
    },
    {
      id: 'fighter-second-wind',
      kind: 'feature',
      name: 'Second Wind',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: {
        classId: 'fighter',
        sourceType: 'classFeature',
        actionCost: 'bonusAction',
        resource: { id: 'second-wind', name: 'Second Wind', max: 2, recharge: 'shortRest' }
      }
    },
    {
      id: 'fighter-weapon-mastery',
      kind: 'feature',
      name: 'Weapon Mastery',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: { classId: 'fighter', sourceType: 'classFeature', requiresChoice: true, choiceType: 'weaponMastery' }
    },
    {
      id: 'fighter-subclass-choice',
      kind: 'feature',
      name: 'Fighter Subclass',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: { classId: 'fighter', sourceType: 'classFeature', requiresChoice: true, choiceType: 'subclass' }
    },
    {
      id: 'fighter-ability-score-improvement',
      kind: 'feature',
      name: 'Ability Score Improvement',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: { classId: 'fighter', sourceType: 'classFeature', featChoice: true, requiresChoice: true, choiceType: 'generalFeat' }
    },
    {
      id: 'champion',
      kind: 'subclass',
      name: 'Champion',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: {
        classId: 'fighter',
        progression: [{ level: 3, featureIds: ['champion-improved-critical'] }]
      }
    },
    {
      id: 'champion-improved-critical',
      kind: 'feature',
      name: 'Improved Critical',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: { subclassId: 'champion', classId: 'fighter', sourceType: 'classFeature' }
    },
    {
      id: 'ability-score-improvement-feat',
      kind: 'feat',
      name: 'Ability Score Improvement',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: { category: 'general', prerequisite: 'Level 4+', repeatable: true, asiMode: true }
    },
    {
      id: 'acolyte',
      kind: 'background',
      name: 'Acolyte',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: {
        abilityScoreOptions: ['INT', 'WIS', 'CHA'],
        featIds: ['magic-initiate-cleric'],
        skillProficiencies: ['Insight', 'Religion'],
        toolProficiencies: ['Calligrapher Supplies'],
        equipmentOptions: [
          { id: 'acolyte-equipment', labels: ['Holy Symbol', 'Prayer Book'], goldPieces: 8 },
          { id: 'acolyte-gold', labels: [], goldPieces: 50 }
        ]
      }
    },
    {
      id: 'magic-initiate-cleric',
      kind: 'feat',
      name: 'Magic Initiate (Cleric)',
      summary: 'Origin Feat fixture.',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: {
        category: 'origin',
        repeatable: true,
        spellListOptions: ['Cleric'],
        spellcastingAbilityOptions: ['INT', 'WIS', 'CHA'],
        cantripChoiceCount: 2,
        level1SpellChoiceCount: 1
      }
    },
    {
      id: 'wizard',
      kind: 'class',
      name: 'Wizard',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: {
        level: 1,
        hitDie: 6,
        savingThrowProficiencies: ['INT', 'WIS'],
        progression: [{ level: 1, featureIds: ['wizard-spellcasting'] }],
        spellcasting: {
          ability: 'INT',
          progression: 'full',
          preparationSource: 'spellbook',
          cantripsKnownByLevel: [3, 3, 3, 4],
          preparedSpellsByLevel: [4, 5, 6, 7],
          slotsByLevel: {
            '1': { '1': 2 },
            '2': { '1': 3 },
            '3': { '1': 4, '2': 2 },
            '4': { '1': 4, '2': 3 }
          }
        }
      }
    },
    {
      id: 'wizard-spellcasting',
      kind: 'feature',
      name: 'Spellcasting',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: { classId: 'wizard', sourceType: 'classFeature' }
    },
    {
      id: 'fire-bolt',
      kind: 'spell',
      name: 'Fire Bolt',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: { level: 0, school: 'Evocation', classes: ['Wizard'], damageFormula: '1d10', range: '120 feet', castingTime: 'action' }
    },
    {
      id: 'magic-missile',
      kind: 'spell',
      name: 'Magic Missile',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: { level: 1, school: 'Evocation', classes: ['Wizard'], damageFormula: '3d4 + 3', range: '120 feet', castingTime: 'action', targets: 3 }
    },
    {
      id: 'longsword',
      kind: 'weapon',
      name: 'Longsword',
      source: {
        id: 'phb-critical-fixture-source', book: 'PHB 2024 critical relationships fixture', page: 'fixture', version: '2024', status: 'active', confidence: 'exact'
      },
      payload: { damageFormula: '1d8 + STR', weaponType: 'melee', properties: ['versatile'], mastery: 'Sap' }
    }
  ]
};
