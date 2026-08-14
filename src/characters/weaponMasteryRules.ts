import type { AttackAction, Character, Weapon, WeaponMasteryApplication } from '../types';
import { getAbilityModifier, getProficiencyBonus } from '../rules-engine/characters/derivedStats';

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const descriptions: Record<WeaponMasteryApplication['property'], string> = {
  cleave: 'Após acertar em corpo a corpo, pode atacar outro alvo próximo uma vez por turno; o dano secundário não soma modificador positivo.',
  graze: 'Ao errar contra uma criatura, causa dano igual ao modificador usado no ataque.',
  nick: 'O ataque extra da propriedade Light pode integrar a Ação de Ataque em vez de usar ação bônus, uma vez por turno.',
  push: 'Ao acertar, pode empurrar uma criatura Large ou menor em até 10 pés.',
  sap: 'Ao acertar, o alvo tem desvantagem no próximo ataque antes do início do seu próximo turno.',
  slow: 'Ao causar dano, reduz a Speed do alvo em 10 pés até o início do seu próximo turno.',
  topple: 'Ao acertar, força salvaguarda de Constituição; em falha, o alvo fica Prone.',
  vex: 'Ao acertar e causar dano, concede vantagem no próximo ataque contra o mesmo alvo.'
};

export const weaponMasteryIsSelected = (character: Character, weapon: Weapon): boolean => {
  const link = (character.compendiumLinks ?? []).find((entry) => entry.appliedEntityId === weapon.id && entry.status === 'active');
  return (character.weaponMasteries ?? []).some((selection) =>
    (selection.weaponItemId && (selection.weaponItemId === link?.itemId || selection.weaponItemId === weapon.pactWeaponSourceItemId))
    || normalize(selection.weaponName) === normalize(weapon.name)
  );
};

export const weaponMasteryApplication = (
  character: Character,
  weapon: Weapon,
  attackAbility: AttackAction['attackAbility']
): WeaponMasteryApplication | undefined => {
  const property = normalize(weapon.mastery ?? '') as WeaponMasteryApplication['property'];
  if (!Object.prototype.hasOwnProperty.call(descriptions, property) || !weaponMasteryIsSelected(character, weapon)) return undefined;
  return {
    property,
    label: property.charAt(0).toUpperCase() + property.slice(1),
    description: descriptions[property],
    oncePerTurnKey: ['cleave', 'nick'].includes(property) ? `weapon-mastery-${property}` : undefined,
    saveAbility: property === 'topple' ? 'CON' : undefined,
    saveDC: property === 'topple' && attackAbility
      ? 8 + getAbilityModifier(character.abilities, attackAbility) + getProficiencyBonus(character)
      : undefined,
    forcedMovementFt: property === 'push' ? 10 : undefined,
    maxTargetSize: property === 'push' ? 'Large' : undefined
  };
};

export const masteryRuleNotes = (mastery?: WeaponMasteryApplication): string[] => mastery
  ? [
      `${mastery.label}: ${mastery.description}`,
      ...(mastery.saveDC ? [`CD ${mastery.saveDC} de ${mastery.saveAbility}.`] : [])
    ]
  : [];
