import { createEmptyCharacter } from '../data/mockData';
import {
  applyCustomProficiencyModifiers,
  resolveCharacterCheck,
  resolveCustomNumericModifiers,
  resolveCustomRollModifiers
} from '../characters/customModifierRules';
import type { Character, CustomCharacterModifierRule, Feature } from '../types';

const withRules = (rules: CustomCharacterModifierRule[]): Character => {
  const character = createEmptyCharacter('Modifier Tester');
  const feature: Feature = {
    id: 'custom-feature',
    name: 'Custom Engine Feature',
    sourceType: 'manual',
    custom: true,
    customRules: { modifiers: rules }
  };
  return {
    ...character,
    level: 5,
    classes: [{ id: 'class-1', name: 'Wizard', level: 5 }],
    abilities: { ...character.abilities, INT: 18, CHA: 16 },
    features: [feature]
  };
};

describe('generic custom feat/feature modifiers', () => {
  it('can grant and remove proficiencies declaratively', () => {
    const character = withRules([
      { id: 'grant-arcana', target: 'proficiency', operation: 'grantProficiency', selector: { proficiencyKind: 'skill', proficiencyValues: ['Arcana'] } },
      { id: 'grant-thieves', target: 'proficiency', operation: 'grantProficiency', selector: { proficiencyKind: 'tool', proficiencyValues: ["Thieves' Tools"] } },
      { id: 'remove-stealth', target: 'proficiency', operation: 'removeProficiency', selector: { proficiencyKind: 'skill', proficiencyValues: ['Stealth'] } }
    ]);
    character.proficiencies.skills = ['Stealth'];
    const next = applyCustomProficiencyModifiers(character);
    expect(next.proficiencies.skills).toContain('Arcana');
    expect(next.proficiencies.skills).not.toContain('Stealth');
    expect(next.proficiencies.tools).toContain("Thieves' Tools");
  });

  it('supports negative, proficiency-bonus and ability-modifier terms on specific checks', () => {
    const character = withRules([
      {
        id: 'arcana-bonus',
        target: 'skillCheck',
        operation: 'add',
        selector: { skills: ['Arcana'] },
        value: { flat: -2, proficiencyBonusMultiplier: 2, abilityModifierMultiplier: 1, ability: 'INT' }
      },
      { id: 'arcana-advantage', target: 'skillCheck', operation: 'advantage', selector: { skills: ['Arcana'] } }
    ]);
    // Level 5 PB +3, INT 18 => +4: -2 + 2×3 + 4 = +8.
    const result = resolveCharacterCheck(character, 'skillCheck', 7, { skill: 'Arcana', ability: 'INT' });
    expect(result.bonus).toBe(15);
    expect(result.rollMode).toBe('advantage');
  });

  it('filters spell modifiers by spell, school and damage type', () => {
    const character = withRules([
      {
        id: 'fire-evocation',
        target: 'spellDamage',
        operation: 'add',
        selector: { spellNames: ['Fireball'], spellSchools: ['Evocation'], damageTypes: ['fire'] },
        value: { proficiencyBonusMultiplier: 1, abilityModifierMultiplier: 1, ability: 'INT' }
      }
    ]);
    const fireball = resolveCustomNumericModifiers(character, 'spellDamage', {
      actionType: 'spell', spellName: 'Fireball', spellSchool: 'Evocation', damageTypes: ['fire'], ability: 'INT'
    });
    expect(fireball.add).toBe(7); // PB +3 + INT +4
    expect(resolveCustomNumericModifiers(character, 'spellDamage', {
      actionType: 'spell', spellName: 'Fireball', spellSchool: 'Evocation', damageTypes: ['cold'], ability: 'INT'
    }).add).toBe(0);
  });

  it('supports vulnerability-like damage-taken multipliers and negative outgoing modifiers', () => {
    const character = withRules([
      { id: 'fire-vulnerability', target: 'damageTaken', operation: 'multiply', selector: { damageTypes: ['fire'] }, value: { multiplier: 2 } },
      { id: 'weak-force', target: 'damageDealt', operation: 'add', selector: { damageTypes: ['force'] }, value: { flat: -3 } }
    ]);
    expect(resolveCustomNumericModifiers(character, 'damageTaken', { damageTypes: ['fire'] }).multiplier).toBe(2);
    expect(resolveCustomNumericModifiers(character, 'damageDealt', { damageTypes: ['force'] }).add).toBe(-3);
  });

  it('cancels advantage and disadvantage when both apply', () => {
    const character = withRules([
      { id: 'adv', target: 'savingThrow', operation: 'advantage', selector: { abilities: ['WIS'] } },
      { id: 'dis', target: 'savingThrow', operation: 'disadvantage', selector: { abilities: ['WIS'] } }
    ]);
    expect(resolveCustomRollModifiers(character, 'savingThrow', { ability: 'WIS' }).rollMode).toBe('normal');
  });
});
