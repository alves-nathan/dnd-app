import type {
  Character,
  CharacterCurrency,
  CharacterEquipmentSelection,
  CharacterEquipmentSelectionItem,
  Equipment,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createId } from '../utils/id';
import { equipmentAmmunitionType } from './ammunitionRules';
import { focusMetadataFromLabel } from './spellComponentRules';
import {
  getActiveLoadout,
  isShieldArmor,
  reconcileEquipmentLoadout,
  toggleArmorAccessory,
  weaponHandsRequired
} from './equipmentLoadoutRules';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();

const PHB_2024_CLASS_STARTING_EQUIPMENT: Record<string, Record<string, string[]>> = {
  "barbarian": {"A": ["Greataxe", "4 Handaxes", "Explorer's Pack", "15 GP"], "B": ["75 GP"]},
  "bard": {"A": ["Leather Armor", "2 Daggers", "Musical Instrument of your choice", "Entertainer's Pack", "19 GP"], "B": ["90 GP"]},
  "cleric": {"A": ["Chain Shirt", "Shield", "Mace", "Holy Symbol", "Priest's Pack", "7 GP"], "B": ["110 GP"]},
  "druid": {"A": ["Leather Armor", "Shield", "Sickle", "Druidic Focus (Quarterstaff)", "Explorer's Pack", "Herbalism Kit", "9 GP"], "B": ["50 GP"]},
  "fighter": {"A": ["Chain Mail", "Greatsword", "Flail", "8 Javelins", "Dungeoneer's Pack", "4 GP"], "B": ["Studded Leather Armor", "Scimitar", "Shortsword", "Longbow", "20 Arrows", "Quiver", "Dungeoneer's Pack", "11 GP"], "C": ["155 GP"]},
  "monk": {"A": ["Spear", "5 Daggers", "Artisan's Tools or Musical Instrument chosen for tool proficiency", "Explorer's Pack", "11 GP"], "B": ["50 GP"]},
  "paladin": {"A": ["Chain Mail", "Shield", "Longsword", "6 Javelins", "Holy Symbol", "Priest's Pack", "9 GP"], "B": ["150 GP"]},
  "ranger": {"A": ["Studded Leather Armor", "Scimitar", "Shortsword", "Longbow", "20 Arrows", "Quiver", "Druidic Focus (sprig of mistletoe)", "Explorer's Pack", "7 GP"], "B": ["150 GP"]},
  "rogue": {"A": ["Leather Armor", "2 Daggers", "Shortsword", "Shortbow", "20 Arrows", "Quiver", "Thieves' Tools", "Burglar's Pack", "8 GP"], "B": ["100 GP"]},
  "sorcerer": {"A": ["Spear", "2 Daggers", "Arcane Focus (crystal)", "Dungeoneer's Pack", "28 GP"], "B": ["50 GP"]},
  "warlock": {"A": ["Leather Armor", "Sickle", "2 Daggers", "Arcane Focus (orb)", "Book (occult lore)", "Scholar's Pack", "15 GP"], "B": ["100 GP"]},
  "wizard": {"A": ["2 Daggers", "Arcane Focus (Quarterstaff)", "Robe", "Spellbook", "Scholar's Pack", "5 GP"], "B": ["55 GP"]},
};

export interface StartingEquipmentOption {
  sourceKind: 'class' | 'background';
  sourceItemId: string;
  sourceName: string;
  optionId: string;
  labels: string[];
  itemIds?: string[];
  goldPieces: number;
}

export const getStartingEquipmentOptions = (
  item: StoredCompendiumItem | undefined,
  sourceKind: 'class' | 'background'
): StartingEquipmentOption[] => {
  if (!item) return [];
  const payload = asRecord(item.normalizedJson);
  const explicitOptions = asRecord(payload.equipmentOptions ?? payload.startingEquipment);
  const fallbackKey = normalize(item.name).replace(/\s+/g, '');
  const options = Object.keys(explicitOptions).length
    ? explicitOptions
    : sourceKind === 'class'
      ? asRecord(PHB_2024_CLASS_STARTING_EQUIPMENT[fallbackKey])
      : {};
  return Object.entries(options).flatMap(([optionId, raw]) => {
    const structured = asRecord(raw);
    const itemIds = asStringArray(structured.itemIds);
    const labels = Array.isArray(raw)
      ? asStringArray(raw)
      : [
          ...asStringArray(structured.items),
          ...(Array.isArray(structured.currency)
            ? structured.currency.flatMap((entry) => {
                const currency = asRecord(entry);
                const amount = typeof currency.amount === 'number' && Number.isFinite(currency.amount) ? currency.amount : undefined;
                const unit = typeof currency.unit === 'string' ? currency.unit.toUpperCase() : undefined;
                return amount !== undefined && unit ? [`${amount} ${unit}`] : [];
              })
            : [])
        ];
    if (!labels.length && !itemIds.length) return [];
    const goldPieces = labels.reduce((sum, label) => {
      const match = label.match(/^\s*(\d+(?:[.,]\d+)?)\s*GP\s*$/i);
      return sum + (match ? Number(match[1]?.replace(',', '.')) : 0);
    }, 0);
    return [{
      sourceKind,
      sourceItemId: item.id,
      sourceName: item.name,
      optionId,
      labels,
      itemIds: itemIds.length ? itemIds : undefined,
      goldPieces
    }];
  });
};

export const parseEquipmentLabel = (label: string): { name: string; quantity: number; goldPieces: number } => {
  const gp = label.match(/^\s*(\d+)\s*GP\s*$/i);
  if (gp) return { name: '', quantity: 0, goldPieces: Number(gp[1]) };
  const quantityMatch = label.match(/^\s*(\d+)\s+(.+)$/);
  if (quantityMatch) return { name: quantityMatch[2].trim(), quantity: Number(quantityMatch[1]), goldPieces: 0 };
  const oneMatch = label.match(/^\s*(?:one|chosen)\s+(.+)$/i);
  if (oneMatch) return { name: oneMatch[1].trim(), quantity: 1, goldPieces: 0 };
  return { name: label.trim(), quantity: 1, goldPieces: 0 };
};

const singularizeEquipmentName = (value: string): string => {
  if (/axes$/i.test(value)) return value.replace(/axes$/i, 'axe');
  if (/knives$/i.test(value)) return value.replace(/knives$/i, 'knife');
  if (/ves$/i.test(value)) return value.replace(/ves$/i, 'f');
  if (/ies$/i.test(value)) return value.replace(/ies$/i, 'y');
  if (/sses$/i.test(value)) return value.replace(/es$/i, '');
  if (/s$/i.test(value) && !/ss$/i.test(value)) return value.replace(/s$/i, '');
  return value;
};

const equipmentNameCandidates = (name: string): string[] => {
  const cleaned = name
    .replace(/\b(?:chosen|of your choice|your choice)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parenthetical = Array.from(cleaned.matchAll(/\(([^)]+)\)/g))
    .map((match) => match[1]?.trim())
    .filter((entry): entry is string => Boolean(entry));
  const withoutParenthetical = cleaned.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const rawCandidates = [cleaned, withoutParenthetical, ...parenthetical];
  return Array.from(new Set(rawCandidates.flatMap((candidate) => [candidate, singularizeEquipmentName(candidate)])))
    .map(normalize)
    .filter(Boolean);
};

export const resolveStartingEquipmentCompendiumItem = (
  name: string,
  items: StoredCompendiumItem[]
): StoredCompendiumItem | undefined => {
  const candidates = equipmentNameCandidates(name);
  const eligible = items.filter((item) => ['weapon', 'armor', 'equipment'].includes(item.type));
  for (const candidate of candidates) {
    const exact = eligible.find((item) => normalize(item.name) === candidate);
    if (exact) return exact;
    const ammunitionAlias = eligible.find((item) =>
      item.type === 'equipment' && normalize(item.name).endsWith(candidate)
    );
    if (ammunitionAlias) return ammunitionAlias;
  }
  return undefined;
};

const resolveEquipmentItem = resolveStartingEquipmentCompendiumItem;

const itemByReference = (reference: string | undefined, allItems: StoredCompendiumItem[]): StoredCompendiumItem | undefined => {
  if (!reference) return undefined;
  return allItems.find((item) => {
    const raw = asRecord(item.rawJson);
    return item.id === reference || item.importItemId === reference || raw.id === reference;
  });
};

const resolveSelectionItems = (
  labels: string[],
  allItems: StoredCompendiumItem[],
  itemIds: string[] = []
): CharacterEquipmentSelectionItem[] =>
  labels.map((label, index) => {
    const parsed = parseEquipmentLabel(label);
    const compendiumItem = itemByReference(itemIds[index], allItems)
      ?? (parsed.name ? resolveEquipmentItem(parsed.name, allItems) : undefined);
    return {
      label,
      quantity: parsed.quantity,
      goldPieces: parsed.goldPieces,
      compendiumItemId: compendiumItem?.id,
      compendiumItemType: compendiumItem && ['weapon', 'armor', 'equipment'].includes(compendiumItem.type)
        ? (compendiumItem.type as 'weapon' | 'armor' | 'equipment')
        : undefined
    };
  });

export const createEquipmentSelection = (
  option: StartingEquipmentOption,
  allItems: StoredCompendiumItem[] = []
): CharacterEquipmentSelection => ({
  id: createId('equipmentChoice'),
  sourceKind: option.sourceKind,
  sourceItemId: option.sourceItemId,
  optionId: option.optionId,
  labels: [...option.labels],
  goldPieces: option.goldPieces,
  items: resolveSelectionItems(option.labels, allItems, option.itemIds)
});

export const validateStartingEquipmentSelections = (
  requiredGroups: StartingEquipmentOption[][],
  selections: CharacterEquipmentSelection[]
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  for (const group of requiredGroups.filter((options) => options.length)) {
    const sourceItemId = group[0]?.sourceItemId;
    const selection = selections.find((entry) => entry.sourceItemId === sourceItemId);
    if (!selection || !group.some((option) => option.optionId === selection.optionId)) {
      issues.push({
        severity: 'error',
        code: 'STARTING_EQUIPMENT_OPTION_REQUIRED',
        message: `Escolha uma opção de equipamento inicial para ${group[0]?.sourceName ?? 'a origem'}.`
      });
    }
  }
  return issues;
};

const removePreviouslyAppliedSelections = (character: Character): Character => {
  const removedEntityIds = new Set<string>();
  character.weapons
    .filter((entry) => Boolean(entry.startingEquipmentSelectionId))
    .forEach((entry) => removedEntityIds.add(entry.id));
  character.equipment
    .filter((entry) => Boolean(entry.startingEquipmentSelectionId))
    .forEach((entry) => removedEntityIds.add(entry.id));
  if (character.armor?.startingEquipmentSelectionId) removedEntityIds.add(character.armor.id);
  (character.armors ?? []).filter((entry) => Boolean(entry.startingEquipmentSelectionId)).forEach((entry) => removedEntityIds.add(entry.id));
  (character.armorAccessories ?? [])
    .filter((entry) => Boolean(entry.startingEquipmentSelectionId))
    .forEach((entry) => removedEntityIds.add(entry.id));

  return {
    ...character,
    weapons: character.weapons.filter((entry) => !entry.startingEquipmentSelectionId),
    equipment: character.equipment.filter((entry) => !entry.startingEquipmentSelectionId),
    armor: character.armor?.startingEquipmentSelectionId ? undefined : character.armor,
    armors: (character.armors ?? []).filter((entry) => !entry.startingEquipmentSelectionId),
    armorAccessories: (character.armorAccessories ?? []).filter((entry) => !entry.startingEquipmentSelectionId),
    compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
      removedEntityIds.has(link.appliedEntityId) && link.status === 'active'
        ? { ...link, status: 'removed' as const }
        : link
    )
  };
};

const tagAppliedEntity = (
  before: Character,
  after: Character,
  selectionId: string,
  itemType: StoredCompendiumItem['type'],
  appliedEntityId?: string,
  quantity = 1,
  sourceLabel = ''
): Character => {
  if (!appliedEntityId) return after;
  const focus = focusMetadataFromLabel(sourceLabel);
  if (itemType === 'weapon') {
    return {
      ...after,
      weapons: after.weapons.map((entry) =>
        entry.id === appliedEntityId
          ? { ...entry, quantity: Math.max(1, quantity), startingEquipmentSelectionId: selectionId, spellcastingFocus: focus.spellcastingFocus || entry.spellcastingFocus, spellcastingFocusKind: focus.spellcastingFocus ? (focus.spellcastingFocusKind ?? 'weapon') : entry.spellcastingFocusKind }
          : entry
      )
    };
  }
  if (itemType === 'armor') {
    return {
      ...after,
      armor: after.armor?.id === appliedEntityId ? { ...after.armor, startingEquipmentSelectionId: selectionId } : after.armor,
      armors: (after.armors ?? []).map((entry) => entry.id === appliedEntityId ? { ...entry, startingEquipmentSelectionId: selectionId } : entry),
      armorAccessories: (after.armorAccessories ?? []).map((entry) =>
        entry.id === appliedEntityId
          ? { ...entry, startingEquipmentSelectionId: selectionId }
          : entry
      )
    };
  }
  if (itemType === 'equipment') {
    return {
      ...after,
      equipment: after.equipment.map((entry) =>
        entry.id === appliedEntityId
          ? { ...entry, quantity: Math.max(1, quantity), startingEquipmentSelectionId: selectionId, spellcastingFocus: focus.spellcastingFocus || entry.spellcastingFocus, spellcastingFocusKind: focus.spellcastingFocusKind ?? entry.spellcastingFocusKind, focusRequiresHand: focus.focusRequiresHand ?? entry.focusRequiresHand, materialComponent: focus.materialComponent ?? entry.materialComponent }
          : entry
      )
    };
  }
  void before;
  return after;
};

export const applyStartingEquipmentSelections = (
  character: Character,
  selections: CharacterEquipmentSelection[],
  allItems: StoredCompendiumItem[]
): Character => {
  const previousSelections = character.buildChoices?.equipmentSelections ?? [];
  const coinKeys: Array<keyof CharacterCurrency> = ['cp', 'sp', 'ep', 'gp', 'pp'];
  const emptyCurrency = (): CharacterCurrency => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  const currencyForSelection = (selection: CharacterEquipmentSelection): CharacterCurrency => {
    const result = emptyCurrency();
    if (selection.currency) {
      for (const key of coinKeys) result[key] = Math.max(0, Number(selection.currency[key] ?? 0));
      return result;
    }
    result.gp = Math.max(0, Number(selection.goldPieces ?? 0));
    return result;
  };
  const sumSelectionCurrency = (entries: CharacterEquipmentSelection[]): CharacterCurrency =>
    entries.reduce((total, selection) => {
      const amount = currencyForSelection(selection);
      for (const key of coinKeys) total[key] += amount[key];
      return total;
    }, emptyCurrency());
  const previousSelectionCurrency = sumSelectionCurrency(previousSelections);
  const manualCurrency = emptyCurrency();
  for (const key of coinKeys) {
    manualCurrency[key] = Math.max(0, Number(character.currency?.[key] ?? 0) - previousSelectionCurrency[key]);
  }

  let next = removePreviouslyAppliedSelections(character);

  const normalizedSelections = selections.map((selection) => ({
    ...selection,
    items: selection.items !== undefined ? selection.items : resolveSelectionItems(selection.labels, allItems)
  }));

  for (const selection of normalizedSelections) {
    const sourceItem = allItems.find((item) => item.id === selection.sourceItemId);
    for (const selectedItem of selection.items ?? []) {
      if (!selectedItem.quantity || selectedItem.goldPieces > 0) continue;

      const compendiumItem = selectedItem.compendiumItemId
        ? allItems.find((item) => item.id === selectedItem.compendiumItemId)
        : undefined;
      const parsed = parseEquipmentLabel(selectedItem.label);
      const resolved = compendiumItem ?? (parsed.name ? resolveEquipmentItem(parsed.name, allItems) : undefined);

      if (resolved && resolved.status !== 'disabled') {
        const explicitlyApproved: StoredCompendiumItem = resolved.status === 'validated'
          ? resolved
          : {
              ...resolved,
              status: 'validated',
              reviewDecision: 'approved',
              reviewedBy: 'Escolha explícita de equipamento inicial',
              reviewedAt: new Date().toISOString()
            };
        const result = applyCompendiumItemToCharacter(next, explicitlyApproved);
        if (result.ok) {
          next = tagAppliedEntity(next, result.character, selection.id, resolved.type, result.link?.appliedEntityId, selectedItem.quantity, selectedItem.label);
          continue;
        }
      }

      const focus = focusMetadataFromLabel(selectedItem.label);
      const equipment: Equipment = {
        id: createId('equipment'),
        name: parsed.name || selectedItem.label,
        quantity: Math.max(1, selectedItem.quantity),
        ammunitionType: equipmentAmmunitionType(parsed.name || selectedItem.label),
        tags: equipmentAmmunitionType(parsed.name || selectedItem.label) ? ['ammunition'] : undefined,
        spellcastingFocus: focus.spellcastingFocus,
        spellcastingFocusKind: focus.spellcastingFocusKind,
        focusRequiresHand: focus.focusRequiresHand,
        materialComponent: focus.materialComponent,
        source: sourceItem?.rawJson.source,
        startingEquipmentSelectionId: selection.id
      };
      next = { ...next, equipment: [...next.equipment, equipment] };
    }
  }

  const selectedCurrency = sumSelectionCurrency(normalizedSelections);
  let reconciled = reconcileEquipmentLoadout({
    ...next,
    currency: {
      cp: manualCurrency.cp + selectedCurrency.cp,
      sp: manualCurrency.sp + selectedCurrency.sp,
      ep: manualCurrency.ep + selectedCurrency.ep,
      gp: manualCurrency.gp + selectedCurrency.gp,
      pp: manualCurrency.pp + selectedCurrency.pp
    },
    buildChoices: {
      ...(next.buildChoices ?? {
        speciesChoices: [],
        classSkillChoices: [],
        classToolChoices: [],
        expertiseSkills: [],
        languages: [],
        spellAssignments: {},
        spellbookAssignments: {},
        equipmentSelections: []
      }),
      equipmentSelections: normalizedSelections
    }
  });

  // Starting equipment should be immediately usable. Equip the first shield
  // granted by the selected options when the active hands allow it. This is
  // intentionally limited to newly applied starting equipment so a later
  // explicit decision to stow a shield is preserved by normal reconciliation.
  const startingShield = (reconciled.armorAccessories ?? []).find(
    (entry) => Boolean(entry.startingEquipmentSelectionId) && isShieldArmor(entry)
  );
  if (startingShield) {
    const loadout = getActiveLoadout(reconciled);
    const mainWeapon = reconciled.weapons.find((entry) => entry.id === loadout.mainHandWeaponId);
    const canEquipShield = !loadout.offHandWeaponId && (!mainWeapon || weaponHandsRequired(mainWeapon) === 1);
    if (canEquipShield && !loadout.armorAccessoryIds.includes(startingShield.id)) {
      reconciled = toggleArmorAccessory(reconciled, startingShield.id).character;
    }
  }

  return reconciled;
};
