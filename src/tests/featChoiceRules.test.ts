import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  applyFeatChoiceEffects,
  emptyFeatChoice,
  getFeatChoiceSchema,
  isWeaponItemEligibleForMastery,
  validateFeatChoice,
  validateFeatChoiceUniqueness
} from '../characters/featChoiceRules';
import { createEmptyCharacter } from '../data/mockData';

const source = { id: 'feat-choice-source', book: 'Feat Choice Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };

const pack = buildPersistedCompendiumImport({
  id: 'feat-choice-pack',
  source,
  items: [
    {
      id: 'asi', kind: 'feat', name: 'Ability Score Improvement', source,
      payload: { category: 'General', mechanics: { abilityScoreOptions: [{ amount: 2, max: 20 }, { amount: 1, targets: 2, max: 20 }] } }
    },
    {
      id: 'skilled', kind: 'feat', name: 'Skilled', source,
      payload: { category: 'Origin', mechanics: { proficiencyChoice: { count: 3, options: ['skills', 'tools'] } } }
    },
    {
      id: 'musician', kind: 'feat', name: 'Musician', source,
      payload: { category: 'Origin', mechanics: { toolProficiencyChoice: { count: 3, options: 'Musical Instruments' } } }
    },
    {
      id: 'crafter', kind: 'feat', name: 'Crafter', source,
      payload: { category: 'Origin', mechanics: { toolProficiencyChoice: { count: 3, options: "Artisan's Tools from Fast Crafting table" } } }
    },
    {
      id: 'magic-initiate', kind: 'feat', name: 'Magic Initiate', source,
      payload: { category: 'Origin', repeatable: true, mechanics: { spellListChoice: ['Wizard', 'Cleric', 'Druid'], cantripChoices: 2, level1SpellChoices: 1, spellcastingAbilityChoice: ['INT', 'WIS', 'CHA'], repeatableRequiresDifferentSpellList: true, freeCast: { spellLevel: 1, uses: 1, recharge: 'longRest' } } }
    },
    { id: 'light', kind: 'spell', name: 'Light', source, payload: { level: 0, classes: ['Wizard'] } },
    { id: 'mage-hand', kind: 'spell', name: 'Mage Hand', source, payload: { level: 0, classes: ['Wizard'] } },
    { id: 'shield', kind: 'spell', name: 'Shield', source, payload: { level: 1, classes: ['Wizard'] } },
    { id: 'guidance', kind: 'spell', name: 'Guidance', source, payload: { level: 0, classes: ['Cleric', 'Druid'] } },
    { id: 'produce-flame', kind: 'spell', name: 'Produce Flame', source, payload: { level: 0, classes: ['Druid'] } },
    { id: 'healing-word', kind: 'spell', name: 'Healing Word', source, payload: { level: 1, classes: ['Cleric', 'Druid'] } },
    { id: 'eldritch-blast', kind: 'spell', name: 'Eldritch Blast', source, payload: { level: 0, classes: ['Warlock'] } },
    {
      id: 'elemental-adept', kind: 'feat', name: 'Elemental Adept', source,
      payload: { category: 'General', repeatable: true, abilityScoreIncrease: [{ abilities: ['INT'], amount: 1, max: 20 }], mechanics: { damageTypeChoice: ['fire', 'cold'], repeatableRequiresDifferentDamageType: true } }
    },
    {
      id: 'weapon-master', kind: 'feat', name: 'Weapon Master', source,
      payload: { category: 'General', abilityScoreIncrease: [{ abilities: ['STR', 'DEX'], amount: 1, max: 20 }], mechanics: { masteryPropertyChoice: { count: 1, weaponRequirement: 'simpleOrMartialWeaponWithProficiency', changeOnLongRest: true } } }
    },
    { id: 'spear', kind: 'weapon', name: 'Spear', source, payload: { weaponCategory: 'simple', weaponType: 'melee', damageFormula: '1d6 + STR', mastery: 'sap' } },
    {
      id: 'keen-mind', kind: 'feat', name: 'Keen Mind', source,
      payload: { category: 'General', abilityScoreIncrease: [{ abilities: ['INT'], amount: 1, max: 20 }], mechanics: { skillUpgradeChoice: ['Arcana', 'History'], ifNotProficientGainProficiencyElseExpertise: true } }
    }
  ]
});

const item = (id: string) => pack.items.find((entry) => entry.importItemId === id)!;

describe('feat internal choices', () => {
  it('applies ASI mechanically and enforces the cap', () => {
    const feat = item('asi');
    const character = { ...createEmptyCharacter('ASI'), abilityGeneration: { method: 'manual' as const, generatedValues: [18, 14, 12, 10, 10, 10] }, abilities: { STR: 18, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 10 } };
    const choice = { ...emptyFeatChoice(feat.id, 'feat-entity'), abilityScoreIncreases: { STR: 2 } };
    expect(validateFeatChoice(feat, choice, character.abilities, pack.items)).toEqual([]);
    const result = applyFeatChoiceEffects(character, feat, choice, pack.items);
    expect(result.abilities.STR).toBe(20);
    expect(validateFeatChoice(feat, { ...choice, abilityScoreIncreases: { STR: 2 } }, { ...character.abilities, STR: 19 }, pack.items).some((issue) => issue.code === 'FEAT_ABILITY_MAX_EXCEEDED')).toBe(true);
  });

  it('treats Skilled as three choices total between skills and tools', () => {
    const feat = item('skilled');
    const schema = getFeatChoiceSchema(feat);
    expect(schema.mixedSkillToolChoiceCount).toBe(3);
    const choice = { ...emptyFeatChoice(feat.id, 'skilled-entity'), skills: ['Arcana', 'History'], tools: ['Thieves Tools'] };
    expect(validateFeatChoice(feat, choice, createEmptyCharacter().abilities, pack.items)).toEqual([]);
  });

  it('offers rule-driven tool variants for Musician and Crafter', () => {
    const musician = getFeatChoiceSchema(item('musician'));
    expect(musician.toolChoiceCount).toBe(3);
    expect(musician.toolOptions).toEqual(expect.arrayContaining(['Bagpipes', 'Lute', 'Viol']));
    expect(musician.toolOptions).not.toContain("Smith's Tools");

    const crafter = getFeatChoiceSchema(item('crafter'));
    expect(crafter.toolChoiceCount).toBe(3);
    expect(crafter.toolOptions).toEqual(expect.arrayContaining(["Smith's Tools", "Calligrapher's Supplies"]));
    expect(crafter.toolOptions).not.toContain('Bagpipes');
  });

  it('validates Magic Initiate spell levels and applies the selected spells', () => {
    const feat = item('magic-initiate');
    const choice = {
      ...emptyFeatChoice(feat.id, 'magic-initiate-entity'),
      spellList: 'Wizard',
      spellcastingAbility: 'INT' as const,
      spellItemIds: [item('light').id, item('mage-hand').id, item('shield').id]
    };
    expect(validateFeatChoice(feat, choice, createEmptyCharacter().abilities, pack.items)).toEqual([]);
    const result = applyFeatChoiceEffects(createEmptyCharacter('Mage'), feat, choice, pack.items);
    expect(result.spells.map((spell) => spell.name).sort()).toEqual(['Light', 'Mage Hand', 'Shield']);
  });

  it('allows Magic Initiate to combine Cleric, Druid and Wizard spells while rejecting other lists', () => {
    const feat = item('magic-initiate');
    expect(getFeatChoiceSchema(feat).allowCombinedSpellLists).toBe(true);
    const combinedChoice = {
      ...emptyFeatChoice(feat.id, 'magic-combined'),
      spellList: 'all',
      spellcastingAbility: 'WIS' as const,
      spellItemIds: [item('guidance').id, item('produce-flame').id, item('shield').id]
    };
    expect(validateFeatChoice(feat, combinedChoice, createEmptyCharacter().abilities, pack.items)).toEqual([]);

    const invalidChoice = {
      ...combinedChoice,
      spellItemIds: [item('guidance').id, item('eldritch-blast').id, item('shield').id]
    };
    expect(validateFeatChoice(feat, invalidChoice, createEmptyCharacter().abilities, pack.items)
      .some((issue) => issue.code === 'FEAT_SPELL_LIST_MISMATCH')).toBe(true);
  });

  it('enforces unique choices between repeatable feat instances', () => {
    const magicInitiate = item('magic-initiate');
    const firstMagicChoice = { ...emptyFeatChoice(magicInitiate.id, 'mi-1'), spellList: 'Wizard' };
    const repeatedMagicChoice = { ...emptyFeatChoice(magicInitiate.id, 'mi-2'), spellList: 'Wizard' };
    expect(validateFeatChoiceUniqueness(magicInitiate, repeatedMagicChoice, [firstMagicChoice]).some((issue) => issue.code === 'FEAT_REPEATABLE_SPELL_LIST_DUPLICATE')).toBe(true);

    const elemental = item('elemental-adept');
    const firstElement = { ...emptyFeatChoice(elemental.id, 'ea-1'), damageType: 'fire' };
    const repeatedElement = { ...emptyFeatChoice(elemental.id, 'ea-2'), damageType: 'fire' };
    expect(validateFeatChoiceUniqueness(elemental, repeatedElement, [firstElement]).some((issue) => issue.code === 'FEAT_REPEATABLE_DAMAGE_TYPE_DUPLICATE')).toBe(true);
  });

  it('applies Weapon Master selections only for proficient weapons', () => {
    const feat = item('weapon-master');
    const weapon = item('spear');
    const character = {
      ...createEmptyCharacter('Master'),
      proficiencies: { ...createEmptyCharacter().proficiencies, weapons: ['simple'] }
    };
    expect(isWeaponItemEligibleForMastery(character, weapon)).toBe(true);
    const choice = {
      ...emptyFeatChoice(feat.id, 'weapon-master-entity'),
      abilityScoreIncreases: { STR: 1 },
      weaponMasterySelections: [{ id: '', sourceKind: 'feat' as const, weaponItemId: weapon.id, weaponName: weapon.name, mastery: 'sap' }]
    };
    expect(validateFeatChoice(feat, choice, character.abilities, pack.items, character)).toEqual([]);
    const result = applyFeatChoiceEffects(character, feat, choice, pack.items);
    expect(result.weaponMasteries?.[0]).toMatchObject({ weaponItemId: weapon.id, mastery: 'sap', changeOnLongRest: true });
  });

  it('upgrades a known skill to Expertise and creates Magic Initiate free-cast resource', () => {
    const keen = item('keen-mind');
    const trained = {
      ...createEmptyCharacter('Scholar'),
      proficiencies: { ...createEmptyCharacter().proficiencies, skills: ['Arcana'] }
    };
    const keenChoice = { ...emptyFeatChoice(keen.id, 'keen-entity'), abilityScoreIncreases: { INT: 1 }, skillUpgrade: 'Arcana' };
    const upgraded = applyFeatChoiceEffects(trained, keen, keenChoice, pack.items);
    expect(upgraded.proficiencies.expertiseSkills).toContain('Arcana');

    const magicInitiate = item('magic-initiate');
    const magicChoice = {
      ...emptyFeatChoice(magicInitiate.id, 'magic-resource-entity'),
      spellList: 'Wizard',
      spellcastingAbility: 'INT' as const,
      spellItemIds: [item('light').id, item('mage-hand').id, item('shield').id]
    };
    const magicResult = applyFeatChoiceEffects(createEmptyCharacter('Initiate'), magicInitiate, magicChoice, pack.items);
    expect(magicResult.resources.some((resource) => resource.id === 'feat_free_cast_magic-resource-entity' && resource.max === 1)).toBe(true);
    expect(magicResult.spells.find((spell) => spell.name === 'Shield')?.grantedByFeatEntityId).toBe('magic-resource-entity');
  });

});
