import type {
  Character,
  Equipment,
  RuleValidationIssue,
  SpellAction,
  SpellcastingFocusKind
} from '../types';
import { getActiveLoadout, getEquippedArmorAccessories, isShieldArmor } from './equipmentLoadoutRules';

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ')
  .trim()
  .toLowerCase();

export interface FocusMetadata {
  spellcastingFocus: boolean;
  spellcastingFocusKind?: SpellcastingFocusKind;
  focusRequiresHand?: boolean;
  materialComponent?: boolean;
}

export const focusMetadataFromLabel = (label: string): FocusMetadata => {
  const value = normalize(label);
  if (value.includes('component pouch') || value.includes('bolsa de componentes')) {
    return { spellcastingFocus: true, spellcastingFocusKind: 'componentPouch', focusRequiresHand: false, materialComponent: true };
  }
  if (value.includes('arcane focus') || value.includes('foco arcano')) {
    return { spellcastingFocus: true, spellcastingFocusKind: 'arcane', focusRequiresHand: true, materialComponent: true };
  }
  if (value.includes('druidic focus') || value.includes('foco druidico')) {
    return { spellcastingFocus: true, spellcastingFocusKind: 'druidic', focusRequiresHand: true, materialComponent: true };
  }
  if (value.includes('holy symbol') || value.includes('simbolo sagrado')) {
    return { spellcastingFocus: true, spellcastingFocusKind: 'holySymbol', focusRequiresHand: false, materialComponent: true };
  }
  if (value.includes('musical instrument') || value.includes('instrumento musical')) {
    return { spellcastingFocus: true, spellcastingFocusKind: 'musicalInstrument', focusRequiresHand: true, materialComponent: true };
  }
  return { spellcastingFocus: false };
};

export const equipmentFocusMetadata = (equipment: Equipment): FocusMetadata => {
  if (equipment.spellcastingFocus || equipment.materialComponent) {
    return {
      spellcastingFocus: Boolean(equipment.spellcastingFocus),
      spellcastingFocusKind: equipment.spellcastingFocusKind,
      focusRequiresHand: equipment.focusRequiresHand,
      materialComponent: equipment.materialComponent
    };
  }
  return focusMetadataFromLabel([equipment.name, ...(equipment.tags ?? [])].join(' '));
};

const featNamed = (character: Character, name: string): boolean =>
  character.feats.some((feat) => normalize(feat.name) === normalize(name));

export const hasWarCaster = (character: Character): boolean => featNamed(character, 'War Caster');

const spellClassFocusKinds = (className?: string): SpellcastingFocusKind[] => {
  switch (normalize(className ?? '')) {
    case 'bard': return ['musicalInstrument'];
    case 'cleric':
    case 'paladin': return ['holySymbol'];
    case 'druid':
    case 'ranger': return ['druidic'];
    case 'sorcerer':
    case 'warlock':
    case 'wizard': return ['arcane'];
    default: return ['arcane', 'druidic', 'holySymbol', 'musicalInstrument', 'weapon', 'other'];
  }
};

export interface SpellHandState {
  mainHandWeaponId?: string;
  offHandWeaponId?: string;
  shieldEquipped: boolean;
  heldFocusEquipmentId?: string;
}

const freeHandCount = (state: SpellHandState): number => {
  let occupied = 0;
  if (state.mainHandWeaponId) occupied += 1;
  if (state.offHandWeaponId || state.shieldEquipped || state.heldFocusEquipmentId) occupied += 1;
  return Math.max(0, 2 - occupied);
};

const hasMatchingHeldWeaponFocus = (character: Character, state: SpellHandState, accepted: SpellcastingFocusKind[]): boolean => {
  const heldIds = new Set([state.mainHandWeaponId, state.offHandWeaponId].filter((id): id is string => Boolean(id)));
  return character.weapons.some((weapon) =>
    heldIds.has(weapon.id) && weapon.spellcastingFocus === true && accepted.includes(weapon.spellcastingFocusKind ?? 'weapon')
  );
};

const hasWornHolySymbol = (character: Character, accepted: SpellcastingFocusKind[]): boolean => {
  if (!accepted.includes('holySymbol')) return false;
  return character.equipment.some((equipment) => {
    const metadata = equipmentFocusMetadata(equipment);
    return metadata.spellcastingFocusKind === 'holySymbol' && metadata.focusRequiresHand !== true && equipment.quantity > 0;
  }) || getEquippedArmorAccessories(character).some((armor) => isShieldArmor(armor) && normalize(armor.name).includes('holy'));
};

const heldFocusMatches = (character: Character, state: SpellHandState, accepted: SpellcastingFocusKind[]): boolean => {
  if (!state.heldFocusEquipmentId) return false;
  const equipment = character.equipment.find((entry) => entry.id === state.heldFocusEquipmentId && entry.quantity > 0);
  if (!equipment) return false;
  const metadata = equipmentFocusMetadata(equipment);
  return metadata.spellcastingFocus === true && accepted.includes(metadata.spellcastingFocusKind ?? 'other');
};

const hasComponentPouch = (character: Character): boolean => character.equipment.some((equipment) => {
  const metadata = equipmentFocusMetadata(equipment);
  return equipment.quantity > 0 && metadata.spellcastingFocusKind === 'componentPouch';
});

const materialHasCost = (description?: string): boolean => Boolean(description && /\b\d+[\s,]*(?:gp|sp|cp|ep|pp)\b/i.test(description));

const inventoryContainsMaterial = (character: Character, description?: string): boolean => {
  if (!description) return false;
  const normalizedDescription = normalize(description);
  return [...character.equipment, ...character.magicItems].some((item) => {
    const name = normalize(item.name);
    return item.quantity > 0 && name.length >= 3 && (normalizedDescription.includes(name) || name.includes(normalizedDescription));
  });
};

export const validateSpellComponents = (
  character: Character,
  action: SpellAction,
  state: SpellHandState
): RuleValidationIssue[] => {
  const components = action.components;
  if (!components) return [];
  const issues: RuleValidationIssue[] = [];
  const freeHands = freeHandCount(state);
  const accepted = spellClassFocusKinds(action.spellcastingClassName);
  const costlyMaterial = components.material && materialHasCost(action.materialDescription ?? components.materialDescription);

  let materialSatisfied = !components.material;
  if (components.material) {
    if (costlyMaterial) {
      materialSatisfied = inventoryContainsMaterial(character, action.materialDescription ?? components.materialDescription);
      if (!materialSatisfied) issues.push({
        severity: 'error',
        code: 'SPELL_COSTLY_MATERIAL_MISSING',
        message: `${action.name} exige o material específico "${action.materialDescription ?? components.materialDescription}". Um foco ou bolsa de componentes não substitui esse custo.`
      });
    } else {
      materialSatisfied = heldFocusMatches(character, state, accepted)
        || hasMatchingHeldWeaponFocus(character, state, accepted)
        || hasWornHolySymbol(character, accepted)
        || (hasComponentPouch(character) && freeHands > 0);
      if (!materialSatisfied) issues.push({
        severity: 'error',
        code: 'SPELL_MATERIAL_COMPONENT_UNAVAILABLE',
        message: `${action.name} exige componente material. Segure um foco compatível, use um símbolo sagrado vestível ou mantenha uma mão livre para acessar a bolsa de componentes.`
      });
    }
  }

  if (components.somatic) {
    const materialHandCanGesture = components.material && materialSatisfied;
    const warCasterAllows = hasWarCaster(character) && Boolean(state.mainHandWeaponId || state.offHandWeaponId || state.shieldEquipped);
    if (freeHands <= 0 && !materialHandCanGesture && !warCasterAllows) issues.push({
      severity: 'error',
      code: 'SPELL_SOMATIC_HAND_UNAVAILABLE',
      message: `${action.name} exige componente somático. Libere uma mão${state.shieldEquipped ? ', guarde uma arma/escudo' : ''} ou obtenha War Caster.`
    });
  }

  return issues;
};

export const currentSpellHandState = (character: Character): SpellHandState => {
  const loadout = getActiveLoadout(character);
  return {
    mainHandWeaponId: loadout.mainHandWeaponId,
    offHandWeaponId: loadout.offHandWeaponId,
    heldFocusEquipmentId: loadout.heldFocusEquipmentId,
    shieldEquipped: getEquippedArmorAccessories(character).some(isShieldArmor)
  };
};
