import { AbilityScore, AbilityScores, Character } from '../../types';
import { getEquippedArmor, getEquippedArmorAccessories } from '../../characters/equipmentLoadoutRules';
import { resolveCustomNumericModifiers } from '../../characters/customModifierRules';

export const abilityModifier = (score: number): number => Math.floor((score - 10) / 2);

export const getAbilityModifier = (abilities: AbilityScores, ability: AbilityScore): number => abilityModifier(abilities[ability]);

export const getTotalLevel = (character: Character): number => {
  const classTotal = character.classes.reduce((sum, cls) => sum + cls.level, 0);
  return classTotal || character.level || 1;
};

export const getProficiencyBonus = (character: Pick<Character, 'level' | 'classes' | 'proficiencyBonusOverride'>): number => {
  if (character.proficiencyBonusOverride !== undefined) return character.proficiencyBonusOverride;
  const totalLevel = character.classes.reduce((sum, cls) => sum + cls.level, 0) || character.level || 1;
  return 2 + Math.floor((Math.max(totalLevel, 1) - 1) / 4);
};

export const getArmorClass = (character: Character): number => {
  const dex = getAbilityModifier(character.abilities, 'DEX');
  const equippedArmor = getEquippedArmor(character);
  const baseArmorClass = equippedArmor
    ? equippedArmor.baseAC + (
        equippedArmor.dexCap === undefined
          ? dex
          : Math.min(dex, equippedArmor.dexCap)
      )
    : 10 + dex;
  const accessoryBonus = getEquippedArmorAccessories(character)
    .filter((armor) => armor.stacksWithArmor !== false)
    .reduce((sum, armor) => sum + (armor.acBonus ?? armor.baseAC ?? 0), 0);
  const base = baseArmorClass + accessoryBonus;
  const custom = resolveCustomNumericModifiers(character, 'armorClass', { ability: 'DEX' });
  return Math.floor((base + custom.add) * custom.multiplier);
};

export const getInitiative = (character: Character): number => {
  const base = getAbilityModifier(character.abilities, 'DEX');
  const custom = resolveCustomNumericModifiers(character, 'initiative', { ability: 'DEX' });
  return Math.floor((base + custom.add) * custom.multiplier);
};

export const getSpellAttackBonus = (character: Character, spellAbility: AbilityScore): number => {
  const base = getProficiencyBonus(character) + getAbilityModifier(character.abilities, spellAbility);
  const custom = resolveCustomNumericModifiers(character, 'spellAttackRoll', { ability: spellAbility, actionType: 'spell' });
  return Math.floor((base + custom.add) * custom.multiplier);
};

export const getSpellSaveDC = (character: Character, spellAbility: AbilityScore): number => {
  const base = 8 + getProficiencyBonus(character) + getAbilityModifier(character.abilities, spellAbility);
  const custom = resolveCustomNumericModifiers(character, 'spellSaveDC', { ability: spellAbility, actionType: 'spell' });
  return Math.floor((base + custom.add) * custom.multiplier);
};
