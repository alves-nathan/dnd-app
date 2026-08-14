import type {
  Armor,
  Character,
  CharacterEquipmentLoadout,
  RuleValidationIssue,
  Weapon
} from '../types';

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

export const weaponHandsRequired = (weapon: Weapon): 1 | 2 =>
  weapon.handsRequired ?? ((weapon.properties ?? []).some((property) => normalize(property) === 'two-handed') ? 2 : 1);

export const isShieldArmor = (armor: Armor): boolean =>
  normalize(armor.armorCategory ?? '') === 'shield' || normalize(armor.name).includes('shield');

const defaultLoadout = (character: Character): CharacterEquipmentLoadout => {
  const firstTwoHanded = character.weapons.find((weapon) => weapon.equipped !== false && weaponHandsRequired(weapon) === 2);
  const oneHanded = character.weapons.filter((weapon) => weapon.equipped !== false && weaponHandsRequired(weapon) === 1);
  const main = firstTwoHanded ?? oneHanded[0];
  const off = firstTwoHanded ? undefined : oneHanded[1];
  const armor = character.armor ?? (character.armors ?? []).find((entry) => entry.equipped !== false);
  const accessories = (character.armorAccessories ?? []).filter((entry) => entry.equipped !== false);
  return {
    mainHandWeaponId: main?.id,
    offHandWeaponId: off?.id,
    armorId: armor?.id,
    heldFocusEquipmentId: undefined,
    armorAccessoryIds: accessories.map((entry) => entry.id)
  };
};

export const getActiveLoadout = (character: Character): CharacterEquipmentLoadout => {
  const configured = character.buildChoices?.activeLoadout;
  const hasValidConfiguredEntity = Boolean(
    configured?.mainHandWeaponId && character.weapons.some((entry) => entry.id === configured.mainHandWeaponId)
    || configured?.offHandWeaponId && character.weapons.some((entry) => entry.id === configured.offHandWeaponId)
    || configured?.armorId && getOwnedArmors(character).some((entry) => entry.id === configured.armorId)
    || configured?.heldFocusEquipmentId && character.equipment.some((entry) => entry.id === configured.heldFocusEquipmentId)
    || configured?.armorAccessoryIds?.some((id) => (character.armorAccessories ?? []).some((entry) => entry.id === id))
  );
  return configured && (configured.explicit === true || hasValidConfiguredEntity)
    ? { ...configured, armorAccessoryIds: configured.armorAccessoryIds ?? [] }
    : defaultLoadout(character);
};

export const getOwnedArmors = (character: Character): Armor[] => {
  const candidates = [...(character.armors ?? []), ...(character.armor ? [character.armor] : [])];
  const seen = new Set<string>();
  return candidates.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
};

export const getEquippedArmor = (character: Character): Armor | undefined => {
  const loadout = getActiveLoadout(character);
  return getOwnedArmors(character).find((entry) => entry.id === loadout.armorId)
    ?? character.armor
    ?? getOwnedArmors(character).find((entry) => entry.equipped !== false);
};

export const getEquippedArmorAccessories = (character: Character): Armor[] => {
  const loadout = getActiveLoadout(character);
  if (character.buildChoices?.activeLoadout) {
    const active = new Set(loadout.armorAccessoryIds);
    return (character.armorAccessories ?? []).filter((entry) => active.has(entry.id));
  }
  return (character.armorAccessories ?? []).filter((entry) => entry.equipped !== false);
};

export const getEquippedWeapons = (character: Character): Weapon[] => {
  const loadout = getActiveLoadout(character);
  const ids = new Set([loadout.mainHandWeaponId, loadout.offHandWeaponId].filter((entry): entry is string => Boolean(entry)));
  if (character.buildChoices?.activeLoadout) return character.weapons.filter((weapon) => ids.has(weapon.id));
  return character.weapons.filter((weapon) => weapon.equipped !== false);
};

export const isWeaponEquipped = (character: Character, weaponId: string): boolean =>
  getEquippedWeapons(character).some((weapon) => weapon.id === weaponId);

export const validateEquipmentLoadout = (character: Character): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  const loadout = getActiveLoadout(character);
  const main = character.weapons.find((weapon) => weapon.id === loadout.mainHandWeaponId);
  const off = character.weapons.find((weapon) => weapon.id === loadout.offHandWeaponId);
  const accessories = getEquippedArmorAccessories(character);
  const shield = accessories.find(isShieldArmor);

  if (loadout.mainHandWeaponId && !main) issues.push({ severity: 'error', code: 'LOADOUT_MAIN_WEAPON_MISSING', message: 'A arma da mão principal não existe mais na ficha.' });
  if (loadout.offHandWeaponId && !off) issues.push({ severity: 'error', code: 'LOADOUT_OFFHAND_WEAPON_MISSING', message: 'A arma da mão secundária não existe mais na ficha.' });
  // Two-Handed is validated at the moment of the attack. A character can carry
  // a two-handed weapon in one hand while the other hand holds a shield/focus.
  if (off && weaponHandsRequired(off) === 2) issues.push({ severity: 'error', code: 'LOADOUT_OFFHAND_TWO_HANDED', message: `${off.name} exige duas mãos e não pode ocupar apenas a mão secundária.` });
  const heldFocus = loadout.heldFocusEquipmentId ? character.equipment.find((entry) => entry.id === loadout.heldFocusEquipmentId) : undefined;
  if (loadout.heldFocusEquipmentId && !heldFocus) issues.push({ severity: 'error', code: 'LOADOUT_FOCUS_MISSING', message: 'O foco segurado não existe mais no inventário.' });
  if (heldFocus && heldFocus.quantity <= 0) issues.push({ severity: 'error', code: 'LOADOUT_FOCUS_EMPTY', message: 'O foco segurado está com quantidade zero no inventário.' });
  if (heldFocus && heldFocus.spellcastingFocus !== true && heldFocus.materialComponent !== true) issues.push({ severity: 'error', code: 'LOADOUT_ITEM_IS_NOT_FOCUS', message: `${heldFocus.name} não está identificado como foco de conjuração.` });
  if (loadout.heldFocusEquipmentId && (off || shield)) issues.push({ severity: 'error', code: 'LOADOUT_FOCUS_OFFHAND_CONFLICT', message: 'O foco segurado ocupa a mão secundária e não pode ser usado junto de arma secundária ou escudo.' });
  if (off && shield) issues.push({ severity: 'error', code: 'LOADOUT_OFFHAND_SHIELD_CONFLICT', message: `A mão secundária não pode usar ${off.name} e ${shield.name} ao mesmo tempo.` });
  if (accessories.filter(isShieldArmor).length > 1) issues.push({ severity: 'error', code: 'LOADOUT_MULTIPLE_SHIELDS', message: 'Somente um escudo pode conceder bônus de CA ao mesmo tempo.' });
  return issues;
};

const updateLoadout = (character: Character, loadout: CharacterEquipmentLoadout): Character => ({
  ...character,
  armor: getOwnedArmors(character).find((entry) => entry.id === loadout.armorId),
  armors: getOwnedArmors(character).map((entry) => ({ ...entry, equipped: entry.id === loadout.armorId })),
  armorAccessories: (character.armorAccessories ?? []).map((entry) => ({ ...entry, equipped: loadout.armorAccessoryIds.includes(entry.id) })),
  weapons: character.weapons.map((entry) => ({ ...entry, equipped: entry.id === loadout.mainHandWeaponId || entry.id === loadout.offHandWeaponId })),
  buildChoices: {
    ...(character.buildChoices ?? {
      speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: []
    }),
    activeLoadout: { ...loadout, explicit: true }
  }
});

export const equipWeapon = (
  character: Character,
  weaponId: string,
  hand: 'main' | 'off'
): { character: Character; issues: RuleValidationIssue[] } => {
  const weapon = character.weapons.find((entry) => entry.id === weaponId);
  if (!weapon) return { character, issues: [{ severity: 'error', code: 'LOADOUT_WEAPON_NOT_FOUND', message: 'Arma não encontrada na ficha.' }] };
  const current = getActiveLoadout(character);
  const next: CharacterEquipmentLoadout = { ...current, armorAccessoryIds: [...current.armorAccessoryIds] };
  if (weaponHandsRequired(weapon) === 2) {
    // Two-Handed only requires two hands when the attack is made. Keeping an
    // off-hand item in the loadout is valid for carrying, but that attack will
    // be blocked until the other hand is freed.
    next.mainHandWeaponId = weapon.id;
  } else if (hand === 'main') {
    next.mainHandWeaponId = weapon.id;
  } else {
    next.offHandWeaponId = weapon.id;
    next.heldFocusEquipmentId = undefined;
    next.armorAccessoryIds = next.armorAccessoryIds.filter((id) => !isShieldArmor((character.armorAccessories ?? []).find((entry) => entry.id === id) ?? { id, name: '', baseAC: 0 }));
  }
  const updated = updateLoadout(character, next);
  return { character: updated, issues: validateEquipmentLoadout(updated) };
};

export const stowWeapon = (character: Character, weaponId: string): Character => {
  const current = getActiveLoadout(character);
  return updateLoadout(character, {
    ...current,
    mainHandWeaponId: current.mainHandWeaponId === weaponId ? undefined : current.mainHandWeaponId,
    offHandWeaponId: current.offHandWeaponId === weaponId ? undefined : current.offHandWeaponId,
    armorAccessoryIds: [...current.armorAccessoryIds]
  });
};

export const equipArmor = (character: Character, armorId?: string): Character => {
  const current = getActiveLoadout(character);
  return updateLoadout(character, { ...current, armorId, armorAccessoryIds: [...current.armorAccessoryIds] });
};

export const toggleArmorAccessory = (character: Character, armorId: string): { character: Character; issues: RuleValidationIssue[] } => {
  const accessory = (character.armorAccessories ?? []).find((entry) => entry.id === armorId);
  if (!accessory) return { character, issues: [{ severity: 'error', code: 'LOADOUT_ACCESSORY_NOT_FOUND', message: 'Acessório defensivo não encontrado.' }] };
  const current = getActiveLoadout(character);
  const enabled = current.armorAccessoryIds.includes(armorId);
  let nextIds = enabled ? current.armorAccessoryIds.filter((id) => id !== armorId) : [...current.armorAccessoryIds, armorId];
  let next = { ...current, armorAccessoryIds: nextIds };
  if (!enabled && isShieldArmor(accessory)) {
    next = { ...next, offHandWeaponId: undefined, heldFocusEquipmentId: undefined };
    const main = character.weapons.find((weapon) => weapon.id === next.mainHandWeaponId);
    nextIds = next.armorAccessoryIds.filter((id) => id === armorId || !isShieldArmor((character.armorAccessories ?? []).find((entry) => entry.id === id) ?? { id, name: '', baseAC: 0 }));
    next.armorAccessoryIds = nextIds;
  }
  const updated = updateLoadout(character, next);
  return { character: updated, issues: validateEquipmentLoadout(updated) };
};


export const setHeldSpellcastingFocus = (
  character: Character,
  equipmentId?: string
): { character: Character; issues: RuleValidationIssue[] } => {
  const equipment = equipmentId ? character.equipment.find((entry) => entry.id === equipmentId) : undefined;
  if (equipmentId && !equipment) {
    return { character, issues: [{ severity: 'error', code: 'LOADOUT_FOCUS_NOT_FOUND', message: 'Foco de conjuração não encontrado no inventário.' }] };
  }
  if (equipment && equipment.spellcastingFocus !== true && equipment.materialComponent !== true) {
    return { character, issues: [{ severity: 'error', code: 'LOADOUT_ITEM_IS_NOT_FOCUS', message: `${equipment.name} não está identificado como foco de conjuração.` }] };
  }
  if (equipment && equipment.quantity <= 0) {
    return { character, issues: [{ severity: 'error', code: 'LOADOUT_FOCUS_EMPTY', message: `${equipment.name} não possui unidades disponíveis.` }] };
  }
  const current = getActiveLoadout(character);
  const next: CharacterEquipmentLoadout = {
    ...current,
    heldFocusEquipmentId: equipmentId,
    offHandWeaponId: equipmentId ? undefined : current.offHandWeaponId,
    armorAccessoryIds: equipmentId
      ? current.armorAccessoryIds.filter((id) => !isShieldArmor((character.armorAccessories ?? []).find((entry) => entry.id === id) ?? { id, name: '', baseAC: 0 }))
      : [...current.armorAccessoryIds]
  };
  const updated = updateLoadout(character, next);
  return { character: updated, issues: validateEquipmentLoadout(updated) };
};

export const reconcileEquipmentLoadout = (character: Character): Character => {
  const current = getActiveLoadout(character);
  const weaponIds = new Set(character.weapons.map((entry) => entry.id));
  const armorIds = new Set(getOwnedArmors(character).map((entry) => entry.id));
  const accessoryIds = new Set((character.armorAccessories ?? []).map((entry) => entry.id));
  const clean: CharacterEquipmentLoadout = {
    mainHandWeaponId: current.mainHandWeaponId && weaponIds.has(current.mainHandWeaponId) ? current.mainHandWeaponId : undefined,
    offHandWeaponId: current.offHandWeaponId && weaponIds.has(current.offHandWeaponId) ? current.offHandWeaponId : undefined,
    armorId: current.armorId && armorIds.has(current.armorId) ? current.armorId : undefined,
    heldFocusEquipmentId: current.heldFocusEquipmentId && character.equipment.some((entry) => entry.id === current.heldFocusEquipmentId) ? current.heldFocusEquipmentId : undefined,
    armorAccessoryIds: current.armorAccessoryIds.filter((id) => accessoryIds.has(id))
  };
  let updated = updateLoadout(character, clean);
  if (validateEquipmentLoadout(updated).some((issue) => issue.severity === 'error')) {
    const fallbackCharacter: Character = {
      ...character,
      buildChoices: character.buildChoices ? { ...character.buildChoices, activeLoadout: undefined } : undefined
    };
    const fallback = defaultLoadout(fallbackCharacter);
    updated = updateLoadout(character, fallback);
  }
  return updated;
};
