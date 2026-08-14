import type {
  Character,
  CharacterPactWeaponChoice,
  PactWeaponDamageType,
  RuleValidationIssue,
  Weapon
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { buildWeaponFromCompendiumItem } from '../compendium/mapper';
import { createId } from '../utils/id';
import {
  findEldritchInvocationById,
  isEldritchInvocationItem
} from './eldritchInvocationRules';

export const PACT_WEAPON_DAMAGE_TYPES: PactWeaponDamageType[] = [
  'normal',
  'necrotic',
  'psychic',
  'radiant'
];

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const issue = (code: string, message: string): RuleValidationIssue => ({
  severity: 'error',
  code,
  message
});

export const hasPactOfTheBlade = (
  character: Character,
  items: StoredCompendiumItem[]
): boolean => Object.entries(character.buildChoices?.eldritchInvocationCounts ?? {})
  .some(([itemId, count]) => {
    if (count <= 0) return false;
    const item = findEldritchInvocationById(items, itemId);
    if (!item || !isEldritchInvocationItem(item)) return false;
    const engineKey = normalize(asString(asRecord(item.normalizedJson).engineKey) ?? '');
    return normalize(item.name) === 'pact of the blade' || engineKey === 'warlock.pact-of-the-blade';
  });

const isConjurableMeleeWeaponItem = (item: StoredCompendiumItem): boolean => {
  if (item.type !== 'weapon' || item.status === 'disabled') return false;
  const payload = asRecord(item.normalizedJson);
  const type = normalize(asString(payload.weaponType) ?? '');
  const properties = Array.isArray(payload.properties)
    ? payload.properties.filter((entry): entry is string => typeof entry === 'string').map(normalize)
    : [];
  return type === 'melee'
    || type === 'finesse'
    || (type === 'thrown' && !properties.some((property) => property.includes('ranged')));
};

export interface PactWeaponCandidate {
  id: string;
  mode: 'bound' | 'conjured';
  name: string;
  weapon?: Weapon;
  item?: StoredCompendiumItem;
  description: string;
}

export const getPactWeaponCandidates = (
  character: Character,
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): PactWeaponCandidate[] => {
  const enabled = new Set(enabledSourceIds);
  const existing: PactWeaponCandidate[] = character.weapons
    .filter((weapon) => !weapon.pactWeapon || weapon.id === character.buildChoices?.pactWeapon?.weaponEntityId)
    .map((weapon) => ({
      id: `bound:${weapon.id}`,
      mode: 'bound',
      name: weapon.name,
      weapon,
      description: `Vincular a arma já existente na ficha${weapon.magicBonus ? ` (+${weapon.magicBonus})` : ''}.`
    }));
  const conjured: PactWeaponCandidate[] = items
    .filter((item) => enabled.has(item.sourceId))
    .filter(isConjurableMeleeWeaponItem)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => ({
      id: `conjured:${item.id}`,
      mode: 'conjured',
      name: item.name,
      item,
      description: item.summary ?? 'Conjurar esta arma corpo a corpo como arma de pacto.'
    }));
  return [...existing, ...conjured];
};

export const validatePactWeaponChoice = (
  character: Character,
  items: StoredCompendiumItem[]
): RuleValidationIssue[] => {
  if (!hasPactOfTheBlade(character, items)) return [];
  const choice = character.buildChoices?.pactWeapon;
  if (!choice) return [issue('PACT_WEAPON_REQUIRED', 'Pact of the Blade exige vincular ou conjurar uma arma de pacto.')];
  const weapon = character.weapons.find((entry) => entry.id === choice.weaponEntityId && entry.pactWeapon);
  if (!weapon) return [issue('PACT_WEAPON_ENTITY_MISSING', 'A arma de pacto selecionada não existe mais na ficha.')];
  if (!PACT_WEAPON_DAMAGE_TYPES.includes(choice.damageType)) {
    return [issue('PACT_WEAPON_DAMAGE_TYPE_INVALID', 'Escolha um tipo de dano válido para a arma de pacto.')];
  }
  return [];
};

const clearPactWeaponFlags = (character: Character): Character => {
  const priorChoice = character.buildChoices?.pactWeapon;
  const priorConjuredId = priorChoice?.mode === 'conjured' ? priorChoice.weaponEntityId : undefined;
  return {
    ...character,
    weapons: character.weapons
      .filter((weapon) => weapon.id !== priorConjuredId)
      .map((weapon) => ({
        ...weapon,
        pactWeapon: undefined,
        pactWeaponMode: undefined,
        pactWeaponSourceItemId: undefined,
        pactWeaponDamageType: undefined
      })),
    buildChoices: character.buildChoices
      ? { ...character.buildChoices, pactWeapon: undefined }
      : character.buildChoices
  };
};

export const clearPactWeapon = (character: Character): Character => clearPactWeaponFlags(character);

export interface SetPactWeaponInput {
  mode: 'bound' | 'conjured';
  weaponEntityId?: string;
  sourceWeaponItemId?: string;
  damageType: PactWeaponDamageType;
}

export interface SetPactWeaponResult {
  character: Character;
  issues: RuleValidationIssue[];
}

export const setPactWeapon = (
  character: Character,
  input: SetPactWeaponInput,
  items: StoredCompendiumItem[]
): SetPactWeaponResult => {
  if (!hasPactOfTheBlade(character, items)) {
    return { character, issues: [issue('PACT_OF_THE_BLADE_REQUIRED', 'Escolha Pact of the Blade antes de invocar uma arma de pacto.')] };
  }
  if (!PACT_WEAPON_DAMAGE_TYPES.includes(input.damageType)) {
    return { character, issues: [issue('PACT_WEAPON_DAMAGE_TYPE_INVALID', 'Tipo de dano da arma de pacto inválido.')] };
  }

  let next = clearPactWeaponFlags(character);
  let weapon: Weapon | undefined;
  let sourceWeaponItemId: string | undefined;

  if (input.mode === 'bound') {
    weapon = next.weapons.find((entry) => entry.id === input.weaponEntityId);
    if (!weapon) return { character, issues: [issue('PACT_WEAPON_BOUND_WEAPON_MISSING', 'A arma escolhida para vínculo não existe na ficha.')] };
  } else {
    const item = items.find((entry) => entry.id === input.sourceWeaponItemId && isConjurableMeleeWeaponItem(entry));
    if (!item) return { character, issues: [issue('PACT_WEAPON_SOURCE_ITEM_MISSING', 'Escolha uma arma corpo a corpo válida do compêndio.')] };
    const built = buildWeaponFromCompendiumItem(next, item, createId('pactWeapon'));
    if (built.issues.some((entry) => entry.severity === 'error')) return { character, issues: built.issues };
    weapon = built.weapon;
    sourceWeaponItemId = item.id;
    next = { ...next, weapons: [...next.weapons, weapon] };
  }

  const invokedAt = new Date().toISOString();
  const pactWeapon: Weapon = {
    ...weapon,
    pactWeapon: true,
    pactWeaponMode: input.mode,
    pactWeaponSourceItemId: sourceWeaponItemId,
    pactWeaponDamageType: input.damageType
  };
  next = {
    ...next,
    weapons: next.weapons.map((entry) => entry.id === pactWeapon.id ? pactWeapon : entry),
    buildChoices: {
      ...(next.buildChoices ?? {
        speciesChoices: [],
        classSkillChoices: [],
        classToolChoices: [],
        expertiseSkills: [],
        languages: [],
        spellAssignments: {},
        spellbookAssignments: {},
        equipmentSelections: [],
        eldritchInvocationCounts: {},
        eldritchInvocationChoices: []
      }),
      pactWeapon: {
        mode: input.mode,
        weaponEntityId: pactWeapon.id,
        sourceWeaponItemId,
        damageType: input.damageType,
        invokedAt
      } satisfies CharacterPactWeaponChoice
    }
  };
  return { character: next, issues: [] };
};
