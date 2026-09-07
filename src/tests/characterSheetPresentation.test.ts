import { createEmptyCharacter } from '../data/mockData';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  getCharacterSheetAbilities,
  getCharacterSheetSkills,
  getCharacterSheetWeapons,
  getCharacterSheetSpellcasting,
  getCharacterSheetExternalSpells,
  getCharacterSheetSpellSlots,
  getCharacterSheetProficiencyGroups,
  getCharacterSheetSenses,
  getCharacterSheetFeatGroups,
  getCharacterSheetResourceUses,
  getHitDiceSummary,
  getPassivePerception
} from '../ui/characterSheetPresentation';

const damage = (raw: string) => ({ raw, components: [{ id: 'die', kind: 'dice' as const, operation: 'add' as const, dice: { count: 1, sides: 8 }, sourceType: 'weapon' as const, application: 'onHit' as const }] });

describe('character sheet presentation', () => {
  it('derives ability modifiers, proficient saves, skills, expertise and passive perception', () => {
    const character = {
      ...createEmptyCharacter('Sheet'),
      level: 5,
      classes: [{ id: 'rogue', name: 'Rogue', level: 5 }],
      abilities: { STR: 10, DEX: 18, CON: 14, INT: 12, WIS: 16, CHA: 8 },
      proficiencies: {
        skills: ['Perception', 'Stealth'],
        expertiseSkills: ['Perception'],
        tools: [], weapons: [], armor: [], languages: [], savingThrows: ['DEX' as const]
      }
    };

    const dex = getCharacterSheetAbilities(character).find((entry) => entry.ability === 'DEX');
    expect(dex).toMatchObject({ score: 18, modifier: 4, savingThrow: 7, savingThrowProficient: true });

    const skills = getCharacterSheetSkills(character);
    expect(skills.find((entry) => entry.skill === 'Stealth')).toMatchObject({ ability: 'DEX', bonus: 7, proficient: true, expertise: false });
    expect(skills.find((entry) => entry.skill === 'Perception')).toMatchObject({ ability: 'WIS', bonus: 9, proficient: true, expertise: true });
    expect(getPassivePerception(character)).toBe(19);
  });

  it('applies Jack of All Trades to non-proficient Bard skills without stacking on proficiency or Expertise', () => {
    const character = {
      ...createEmptyCharacter('Bard'),
      level: 7,
      classes: [{ id: 'phb-2024-class-bard', name: 'Bard', level: 7 }],
      abilities: { STR: 9, DEX: 16, CON: 14, INT: 10, WIS: 10, CHA: 18 },
      proficiencies: {
        skills: ['Acrobatics', 'Performance'],
        expertiseSkills: ['Performance'],
        tools: [], weapons: [], armor: [], languages: [], savingThrows: ['DEX' as const, 'CHA' as const]
      }
    };

    const skills = getCharacterSheetSkills(character);
    expect(skills.find((entry) => entry.skill === 'Athletics')).toMatchObject({ bonus: 0, proficient: false, expertise: false, jackOfAllTrades: true });
    expect(skills.find((entry) => entry.skill === 'Arcana')).toMatchObject({ bonus: 1, proficient: false, expertise: false, jackOfAllTrades: true });
    expect(skills.find((entry) => entry.skill === 'Sleight of Hand')).toMatchObject({ bonus: 4, proficient: false, expertise: false, jackOfAllTrades: true });
    expect(skills.find((entry) => entry.skill === 'Acrobatics')).toMatchObject({ bonus: 6, proficient: true, expertise: false, jackOfAllTrades: false });
    expect(skills.find((entry) => entry.skill === 'Performance')).toMatchObject({ bonus: 10, proficient: true, expertise: true, jackOfAllTrades: false });
    expect(getPassivePerception(character)).toBe(11);
  });

  it('projects weapon attack bonus, damage, mastery and hit dice for read-first combat display', () => {
    const character = {
      ...createEmptyCharacter('Fighter'),
      level: 5,
      classes: [{ id: 'fighter', name: 'Fighter', level: 5 }],
      abilities: { STR: 18, DEX: 12, CON: 16, INT: 10, WIS: 10, CHA: 10 },
      weapons: [{ id: 'longsword', name: 'Longsword', weaponType: 'melee' as const, damage: damage('1d8 + STR'), damageType: 'slashing', equipped: true, mastery: 'Sap', properties: ['Versatile'] }],
      hitDice: [{ id: 'fighter-hd', classEntityId: 'fighter', className: 'Fighter', dieSides: 10, current: 3, max: 5 }]
    };
    const weapon = getCharacterSheetWeapons(character)[0];
    expect(weapon).toMatchObject({ name: 'Longsword', attackBonus: 7, attackAbility: 'STR', mastery: 'Sap', damageType: 'slashing', equipped: true });
    expect(getHitDiceSummary(character)).toBe('3/5d10');
  });



  it('projects spellcasting attack/DC, slots, spellbook/external grants, proficiencies and senses', () => {
    const character = {
      ...createEmptyCharacter('Caster'),
      level: 5,
      classes: [{ id: 'bard-entity', name: 'Bard', level: 5 }],
      abilities: { STR: 10, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 18 },
      proficiencies: {
        skills: ['Persuasion'], expertiseSkills: [], tools: ['Lute'], weapons: ['Simple weapons'], armor: ['Light armor'], languages: ['Common', 'Elvish'], savingThrows: ['DEX' as const, 'CHA' as const]
      },
      spells: [
        { id: 'vicious-mockery', name: 'Vicious Mockery', level: 0, school: 'Enchantment', castingTime: 'action' as const, prepared: true, spellcastingClassId: 'bard-entity', spellcastingClassName: 'Bard', spellcastingAbility: 'CHA' as const },
        { id: 'dissonant-whispers', name: 'Dissonant Whispers', level: 1, school: 'Enchantment', castingTime: 'action' as const, prepared: true, spellcastingClassId: 'bard-entity', spellcastingClassName: 'Bard', spellcastingAbility: 'CHA' as const },
        { id: 'sleep-racial', name: 'Sleep', level: 1, school: 'Enchantment', castingTime: 'action' as const, prepared: true, externalSpellGrantOnly: true, externalSpellGrantSources: [{ id: 'racial-sleep', kind: 'species' as const, sourceItemId: 'pallid-elf', sourceName: 'Pallid Elf' }] },
        { id: 'mage-armor-invocation', name: 'Mage Armor', level: 1, school: 'Abjuration', castingTime: 'action' as const, prepared: true, spellcastingClassId: 'bard-entity', spellcastingClassName: 'Bard', grantedByInvocationItemId: 'armor-of-shadows', invocationUsage: 'atWill' as const, externalSpellGrantOnly: true, externalSpellGrantSources: [{ id: 'invocation-mage-armor', kind: 'feature' as const, sourceItemId: 'armor-of-shadows', sourceName: 'Armor of Shadows' }] }
      ],
      spellSlots: [
        { level: 1 as const, max: 4, current: 3, recharge: 'longRest' as const, poolKind: 'spellcasting' as const },
        { level: 2 as const, max: 3, current: 2, recharge: 'longRest' as const, poolKind: 'spellcasting' as const }
      ],
      senses: [{ id: 'darkvision', name: 'Darkvision', kind: 'darkvision' as const, rangeFeet: 60 }],
      compendiumLinks: [{
        id: 'class-link', characterId: 'character-sheet-caster', itemId: 'phb-2024-class-bard', importItemId: 'phb-2024-class-bard', packId: 'phb', sourceId: 'phb-2024', itemType: 'class' as const, appliedAs: 'class' as const, appliedEntityId: 'bard-entity', appliedEntityName: 'Bard', status: 'active' as const, addedAt: '2026-08-19T00:00:00.000Z', choiceId: 'catalog:phb-2024-class-bard'
      }]
    };
    const items = [{
      id: 'phb-2024-class-bard', importItemId: 'phb-2024-class-bard', type: 'class', name: 'Bard', sourceId: 'phb-2024', packId: 'phb', status: 'validated', reviewStatus: 'validated', normalizedJson: { spellcasting: { ability: 'CHA', progression: 'fullCaster', cantripsKnownByLevel: [2, 2, 2, 3, 3], preparedSpellsByLevel: [4, 5, 6, 7, 8], slotsByLevel: { '5': { '1': 4, '2': 3, '3': 2 } } } }, rawJson: { id: 'phb-2024-class-bard' }
    }] as any;

    const sections = getCharacterSheetSpellcasting(character, items);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ className: 'Bard', ability: 'CHA', attackBonus: 7, saveDC: 15, cantripLimit: 3, preparedSpellLimit: 8, preparedCount: 1 });
    expect(sections[0].cantrips.map((spell) => spell.name)).toEqual(['Vicious Mockery']);
    expect(getCharacterSheetExternalSpells(character, sections).spells.map((spell) => spell.name)).toEqual(['Mage Armor', 'Sleep']);
    expect(getCharacterSheetSpellSlots(character).map((slot) => `${slot.level}:${slot.current}/${slot.max}`)).toEqual(['1:3/4', '2:2/3']);
    expect(getCharacterSheetProficiencyGroups(character).find((group) => group.label === 'Idiomas')?.values).toEqual(['Common', 'Elvish']);
    expect(getCharacterSheetSenses(character)).toEqual([expect.objectContaining({ name: 'Darkvision', rangeFeet: 60 })]);
  });

  it('recovers senses from persisted features and separates granted feats from primary feat count', () => {
    const character = {
      ...createEmptyCharacter('Feature presentation'),
      features: [{ id: 'dragonborn-darkvision', name: 'Darkvision', sourceType: 'classFeature' as const, summary: 'Darkvision 60 ft.' }],
      feats: [
        { id: 'fighting-initiate', name: 'Fighting Initiate', source: { id: 'tcoe', book: 'Tasha', version: '2020', status: 'active' as const, confidence: 'exact' as const } },
        { id: 'archery', name: 'Archery', source: { id: 'phb', book: 'PHB', version: '2024', status: 'active' as const, confidence: 'exact' as const }, grantedByFeatEntityId: 'fighting-initiate' }
      ]
    };

    expect(getCharacterSheetSenses(character)).toEqual([expect.objectContaining({ name: 'Darkvision', rangeFeet: 60 })]);
    expect(getCharacterSheetFeatGroups(character).primary.map((feat) => feat.name)).toEqual(['Fighting Initiate']);
    expect(getCharacterSheetFeatGroups(character).granted.map((feat) => feat.name)).toEqual(['Archery']);
  });

  it('keeps the main sheet read-first and exposes core consultation sections before editor navigation', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(process.cwd(), 'app/characters/[id]/index.tsx'), 'utf8');
    expect(source).toContain('>Ficha rápida</Text>');
    expect(source).toContain('title="Atributos e salvamentos"');
    expect(source).toContain('title="Perícias"');
    expect(source).toContain('title="Combate"');
    expect(source).toContain('label="Percepção passiva"');
    expect(source).toContain('◐ Jack of All Trades');
    expect(source).toContain('title="Conjuração e magias"');
    expect(source).toContain('title={`Feats e features');
    expect(source).toContain('title="Proficiências, idiomas e sentidos"');
    expect(source).toContain('title="Equipamento e inventário"');
    expect(source).toContain('title={`Efeitos ativos');
    expect(source).toContain('Companions e familiares');
    expect(source).toContain("completion < 1 ? (");
  });
  it('shows shared-resource feature uses without inventing a duplicate resource pool', () => {
    const source = { id: 'sheet-resource-use', book: 'Sheet Resource Use', version: '2024', status: 'active' as const, confidence: 'exact' as const };
    const pack = buildPersistedCompendiumImport({
      id: 'sheet-resource-use-pack',
      source,
      items: [{
        id: 'mantle-of-inspiration',
        kind: 'feature',
        name: 'Mantle of Inspiration',
        summary: 'Gasta Bardic Inspiration para dar Temporary HP e permitir movimento seguro a aliados.',
        source,
        payload: { actionCost: 'bonusAction', consumes: [{ resourceId: 'bardic-inspiration', amount: 1 }] }
      }]
    });
    const featureItem = pack.items[0]!;
    const character = {
      ...createEmptyCharacter('Glamour'),
      resources: [{ id: 'bardic-inspiration', name: 'Bardic Inspiration', max: 4, current: 4, recharge: 'shortRest' as const, source }],
      features: [{ id: 'mantle-local', name: 'Mantle of Inspiration', sourceType: 'classFeature' as const, summary: featureItem.summary, source }],
      compendiumLinks: [{
        id: 'mantle-link', characterId: 'glamour', itemId: featureItem.id, importItemId: featureItem.importItemId, packId: featureItem.packId, sourceId: featureItem.sourceId, itemType: 'feature' as const,
        appliedAs: 'feature' as const, appliedEntityId: 'mantle-local', appliedEntityName: 'Mantle of Inspiration', status: 'active' as const, addedAt: '2026-01-01T00:00:00.000Z'
      }]
    };

    expect(getCharacterSheetResourceUses(character, pack.items)).toEqual([expect.objectContaining({
      name: 'Mantle of Inspiration',
      actionLabel: 'Ação bônus',
      costs: ['1 Bardic Inspiration']
    })]);
  });

});
