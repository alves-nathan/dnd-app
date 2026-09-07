import type { AbilityScore, Character, CharacterSense, Spell, SpellSlotPool, Weapon } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { SKILLS } from '../characters/proficiencies';
import { buildWeaponAttackAction } from '../rules-engine/actions/buildActions';
import { getAbilityModifier, getProficiencyBonus, getSpellAttackBonus, getSpellSaveDC } from '../rules-engine/characters/derivedStats';
import { resolveCharacterCheck } from '../characters/customModifierRules';
import { getActiveSubclassItemForClass, getClassOrSubclassSpellcastingProfile, type ClassSpellcastingProfile, type SpellPreparationMode } from '../characters/spellcastingRules';
import { getEffectiveCharacterSenses } from '../characters/warlockSpecializedInvocations';
import { getCharacterAbilityUses } from '../characters/abilityUseRules';

export const ABILITY_ORDER: AbilityScore[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

export const ABILITY_LABELS: Record<AbilityScore, string> = {
  STR: 'Força',
  DEX: 'Destreza',
  CON: 'Constituição',
  INT: 'Inteligência',
  WIS: 'Sabedoria',
  CHA: 'Carisma'
};

export const SKILL_ABILITY: Record<(typeof SKILLS)[number], AbilityScore> = {
  Acrobatics: 'DEX',
  'Animal Handling': 'WIS',
  Arcana: 'INT',
  Athletics: 'STR',
  Deception: 'CHA',
  History: 'INT',
  Insight: 'WIS',
  Intimidation: 'CHA',
  Investigation: 'INT',
  Medicine: 'WIS',
  Nature: 'INT',
  Perception: 'WIS',
  Performance: 'CHA',
  Persuasion: 'CHA',
  Religion: 'INT',
  'Sleight of Hand': 'DEX',
  Stealth: 'DEX',
  Survival: 'WIS'
};

const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const has = (values: string[], value: string): boolean => values.some((entry) => normalize(entry) === normalize(value));
const signed = (value: number): string => `${value >= 0 ? '+' : ''}${value}`;

export interface CharacterSheetAbilityRow {
  ability: AbilityScore;
  label: string;
  score: number;
  modifier: number;
  savingThrow: number;
  savingThrowProficient: boolean;
}

export interface CharacterSheetSkillRow {
  skill: string;
  ability: AbilityScore;
  bonus: number;
  proficient: boolean;
  expertise: boolean;
  jackOfAllTrades: boolean;
  rollMode: 'normal' | 'advantage' | 'disadvantage';
}

export interface CharacterSheetWeaponRow {
  weaponId: string;
  name: string;
  attackBonus: number;
  attackAbility: AbilityScore;
  damage: string;
  damageType?: string;
  mastery?: string;
  range?: string;
  equipped: boolean;
  attacksCount: number;
  properties: string[];
}

export const getCharacterSheetAbilities = (character: Character): CharacterSheetAbilityRow[] => {
  const pb = getProficiencyBonus(character);
  return ABILITY_ORDER.map((ability) => {
    const proficient = character.proficiencies.savingThrows.includes(ability);
    const base = getAbilityModifier(character.abilities, ability) + (proficient ? pb : 0);
    const savingThrow = resolveCharacterCheck(character, 'savingThrow', base, { ability }).bonus;
    return {
      ability,
      label: ABILITY_LABELS[ability],
      score: character.abilities[ability],
      modifier: getAbilityModifier(character.abilities, ability),
      savingThrow,
      savingThrowProficient: proficient
    };
  });
};

const hasJackOfAllTrades = (character: Character): boolean => {
  const featureGrant = (character.features ?? []).some((feature) => {
    const name = normalize(feature.name);
    const id = normalize(stripReferencePrefix(feature.id));
    return name === 'jack of all trades' || id.includes('jack-of-all-trades');
  });
  if (featureGrant) return true;

  // Recovery fallback for older characters whose class progression is valid but
  // whose persisted feature collection predates the current reconciliation.
  return (character.classes ?? []).some((entry) => {
    const className = normalize(entry.name);
    const classId = normalize(stripReferencePrefix(entry.id));
    return entry.level >= 2 && (className === 'bard' || /(^|[-:_])bard$/.test(classId));
  });
};

export const getCharacterSheetSkills = (character: Character): CharacterSheetSkillRow[] => {
  const pb = getProficiencyBonus(character);
  const jackOfAllTradesAvailable = hasJackOfAllTrades(character);
  return SKILLS.map((skill) => {
    const ability = SKILL_ABILITY[skill];
    const proficient = has(character.proficiencies.skills, skill);
    const expertise = proficient && has(character.proficiencies.expertiseSkills ?? [], skill);
    const jackOfAllTrades = jackOfAllTradesAvailable && !proficient;
    const proficiencyBonus = expertise ? pb * 2 : proficient ? pb : jackOfAllTrades ? Math.floor(pb / 2) : 0;
    const base = getAbilityModifier(character.abilities, ability) + proficiencyBonus;
    const resolved = resolveCharacterCheck(character, 'skillCheck', base, { ability, skill });
    return { skill, ability, bonus: resolved.bonus, proficient, expertise, jackOfAllTrades, rollMode: resolved.rollMode };
  });
};

export const getPassivePerception = (character: Character): number => {
  const perception = getCharacterSheetSkills(character).find((entry) => entry.skill === 'Perception');
  return 10 + (perception?.bonus ?? getAbilityModifier(character.abilities, 'WIS'));
};

const numeric = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stripReferencePrefix = (value: string): string => value.replace(/^(catalog|compendium):/, '');

export const getCharacterWalkingSpeed = (character: Character, items: StoredCompendiumItem[]): number | undefined => {
  const speciesLink = (character.compendiumLinks ?? []).find((link) => link.status === 'active' && link.appliedAs === 'species');
  const candidates = [
    speciesLink?.itemId,
    speciesLink?.catalogEntityId,
    speciesLink?.importItemId
  ].filter((value): value is string => Boolean(value)).map(stripReferencePrefix);
  const speciesItem = items.find((item) => item.type === 'species' && (
    candidates.includes(stripReferencePrefix(item.id)) ||
    candidates.includes(stripReferencePrefix(item.importItemId)) ||
    normalize(item.name) === normalize(character.species?.name ?? '')
  ));
  if (!speciesItem) return undefined;
  const payload = asRecord(speciesItem.normalizedJson);
  const direct = numeric(payload.speed);
  if (direct !== undefined) return direct;
  const speed = asRecord(payload.speed);
  return numeric(speed.walk) ?? numeric(speed.value);
};

const attackBonusForWeapon = (character: Character, weapon: Weapon): CharacterSheetWeaponRow | undefined => {
  const action = buildWeaponAttackAction(character, weapon.id, { includeStowedWeapons: true });
  if (!action) return undefined;
  const base = getAbilityModifier(character.abilities, action.attackAbility ?? 'STR') + getProficiencyBonus(character) + (action.attackBonusExtra ?? 0);
  const attackBonus = resolveCharacterCheck(character, 'attackRoll', base, { action, ability: action.attackAbility ?? 'STR' }).bonus;
  return {
    weaponId: weapon.id,
    name: weapon.name,
    attackBonus,
    attackAbility: action.attackAbility ?? 'STR',
    damage: action.damage.raw,
    damageType: action.damageTypes?.join('/') ?? weapon.damageType,
    mastery: action.mastery?.label ?? weapon.mastery,
    range: action.range ? `${action.range.normal}${action.range.long ? `/${action.range.long}` : ''} ft` : undefined,
    equipped: weapon.equipped !== false,
    attacksCount: action.attacksCount ?? 1,
    properties: weapon.properties ?? []
  };
};

export const getCharacterSheetWeapons = (character: Character): CharacterSheetWeaponRow[] =>
  character.weapons
    .map((weapon) => attackBonusForWeapon(character, weapon))
    .filter((entry): entry is CharacterSheetWeaponRow => Boolean(entry))
    .sort((left, right) => Number(right.equipped) - Number(left.equipped) || left.name.localeCompare(right.name));

export const getHitDiceSummary = (character: Character): string => {
  if (!(character.hitDice ?? []).length) return '—';
  return (character.hitDice ?? []).map((pool) => `${pool.current}/${pool.max}d${pool.dieSides}`).join(' · ');
};

export const formatSignedBonus = signed;


export interface CharacterSheetSpellRow {
  id: string;
  name: string;
  level: number;
  prepared: boolean;
  concentration: boolean;
  ritualOnly: boolean;
  freeCasts: number;
  atWill: boolean;
  sourceLabel?: string;
}

export interface CharacterSheetSpellcastingSection {
  classEntityId: string;
  className: string;
  classLevel: number;
  ability?: AbilityScore;
  attackBonus?: number;
  saveDC?: number;
  preparationMode: SpellPreparationMode;
  cantripLimit: number;
  preparedSpellLimit: number;
  spellbookMinimumSpellCount: number;
  cantrips: CharacterSheetSpellRow[];
  leveledSpells: CharacterSheetSpellRow[];
  preparedCount: number;
  spellbookCount: number;
  spellbookPreparedCount: number;
  spellbookSpells: Array<{ name: string; level: number; prepared: boolean }>;
}

export interface CharacterSheetSpellSlotRow {
  key: string;
  label: string;
  level: number;
  current: number;
  max: number;
  recharge: SpellSlotPool['recharge'];
  poolKind: NonNullable<SpellSlotPool['poolKind']>;
}

export interface CharacterSheetExternalSpellSection {
  spells: CharacterSheetSpellRow[];
}

export interface CharacterSheetProficiencyGroup {
  label: string;
  values: string[];
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const rawItemId = (item: StoredCompendiumItem): string | undefined => {
  const value = record(item.rawJson).id;
  return typeof value === 'string' ? value : undefined;
};

const referenceIdentities = (reference: string): string[] => {
  const stripped = stripReferencePrefix(reference);
  const tail = stripped.includes(':') ? stripped.split(':').slice(-1)[0] ?? stripped : stripped;
  return Array.from(new Set([reference, stripped, tail]));
};

const referenceMatchesItem = (reference: string | undefined, item: StoredCompendiumItem): boolean => {
  if (!reference) return false;
  const references = referenceIdentities(reference);
  return [item.id, item.importItemId, rawItemId(item)]
    .filter((value): value is string => Boolean(value))
    .some((value) => referenceIdentities(value).some((identity) => references.includes(identity)));
};

const classItemForCharacterClass = (
  character: Character,
  classEntityId: string,
  className: string,
  items: StoredCompendiumItem[]
): StoredCompendiumItem | undefined => {
  const link = (character.compendiumLinks ?? []).find((entry) =>
    entry.status === 'active' && entry.appliedAs === 'class' && entry.appliedEntityId === classEntityId
  );
  const references = [link?.choiceId, link?.itemId, link?.importItemId, link?.catalogEntityId];
  return items.find((item) => item.type === 'class' && (
    references.some((reference) => referenceMatchesItem(reference, item)) ||
    normalize(item.name) === normalize(className)
  ));
};

const spellRow = (spell: Character['spells'][number]): CharacterSheetSpellRow => ({
  id: spell.id,
  name: spell.name,
  level: spell.level,
  prepared: Boolean(spell.prepared),
  concentration: Boolean(spell.concentration),
  ritualOnly: Boolean(spell.ritualOnly),
  freeCasts: spell.freeCastGrants?.length ?? (spell.freeCast ? 1 : 0),
  atWill: spell.invocationUsage === 'atWill',
  sourceLabel: spell.externalSpellGrantSources?.map((source) => source.sourceName).filter(Boolean).join(', ') || spell.spellcastingClassName
});

const spellBelongsToClass = (spell: Character['spells'][number], classEntityId: string, className: string): boolean =>
  spell.spellcastingClassId === classEntityId || normalize(spell.spellcastingClassName ?? '') === normalize(className);

const spellIsExternalOnlyForSheet = (spell: Spell): boolean =>
  Boolean(
    spell.externalSpellGrantOnly
    || spell.grantedByInvocationItemId
    || spell.invocationUsage
    || ((spell.externalSpellGrantSources?.length ?? 0) > 0 && spell.externalSpellGrantPreparedOnly)
  );

const abilityFromProfile = (profile: ClassSpellcastingProfile): AbilityScore | undefined =>
  ABILITY_ORDER.includes(profile.ability as AbilityScore) ? profile.ability as AbilityScore : undefined;

export const getCharacterSheetSpellcasting = (
  character: Character,
  items: StoredCompendiumItem[]
): CharacterSheetSpellcastingSection[] => character.classes.flatMap((classEntity) => {
  const classItem = classItemForCharacterClass(character, classEntity.id, classEntity.name, items);
  if (!classItem) return [];
  const subclassItem = getActiveSubclassItemForClass(character, classEntity.id, items);
  const profile = getClassOrSubclassSpellcastingProfile(classItem, classEntity.level, subclassItem, items);
  if (!profile) return [];
  const ability = abilityFromProfile(profile);
  const classSpells = character.spells.filter((spell) =>
    spellBelongsToClass(spell, classEntity.id, profile.className) && !spellIsExternalOnlyForSheet(spell)
  );
  const rows = classSpells.map(spellRow).sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));
  const spellbookEntries = (character.spellbookEntries ?? []).filter((entry) => entry.classEntityId === classEntity.id);
  return [{
    classEntityId: classEntity.id,
    className: profile.className,
    classLevel: classEntity.level,
    ability,
    attackBonus: ability ? getSpellAttackBonus(character, ability) : undefined,
    saveDC: ability ? getSpellSaveDC(character, ability) : undefined,
    preparationMode: profile.preparationMode,
    cantripLimit: profile.cantripLimit,
    preparedSpellLimit: profile.preparedSpellLimit,
    spellbookMinimumSpellCount: profile.spellbookMinimumSpellCount,
    cantrips: rows.filter((spell) => spell.level === 0),
    leveledSpells: rows.filter((spell) => spell.level > 0),
    preparedCount: rows.filter((spell) => spell.level > 0 && spell.prepared).length,
    spellbookCount: spellbookEntries.length,
    spellbookPreparedCount: spellbookEntries.filter((entry) => entry.prepared).length,
    spellbookSpells: spellbookEntries
      .map((entry) => ({ name: entry.spellName, level: entry.spellLevel, prepared: entry.prepared }))
      .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name))
  }];
});

export const getCharacterSheetExternalSpells = (
  character: Character,
  spellcastingSections: CharacterSheetSpellcastingSection[]
): CharacterSheetExternalSpellSection => {
  const classSpellIds = new Set(spellcastingSections.flatMap((section) => [...section.cantrips, ...section.leveledSpells].map((spell) => spell.id)));
  return {
    spells: character.spells
      .filter((spell) => !classSpellIds.has(spell.id))
      .map(spellRow)
      .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name))
  };
};

const spellSlotPoolLabel = (slot: SpellSlotPool): string => {
  if (slot.poolKind === 'pactMagic') return `Pact Magic · nível ${slot.level}`;
  if (slot.poolKind === 'manual') return `Slot manual · nível ${slot.level}`;
  return `Nível ${slot.level}`;
};

export const getCharacterSheetSpellSlots = (character: Character): CharacterSheetSpellSlotRow[] =>
  (character.spellSlots ?? [])
    .map((slot, index) => ({
      key: slot.id ?? `${slot.poolKind ?? 'spellcasting'}:${slot.sourceClassId ?? 'shared'}:${slot.level}:${index}`,
      label: spellSlotPoolLabel(slot),
      level: slot.level,
      current: slot.current,
      max: slot.max,
      recharge: slot.recharge,
      poolKind: slot.poolKind ?? 'spellcasting'
    }))
    .sort((left, right) => left.level - right.level || left.poolKind.localeCompare(right.poolKind));

export const getCharacterSheetProficiencyGroups = (character: Character): CharacterSheetProficiencyGroup[] => [
  { label: 'Salvamentos', values: character.proficiencies.savingThrows },
  { label: 'Armaduras', values: character.proficiencies.armor },
  { label: 'Armas', values: character.proficiencies.weapons },
  { label: 'Ferramentas', values: character.proficiencies.tools },
  { label: 'Idiomas', values: character.proficiencies.languages }
].filter((group) => group.values.length > 0);

const senseRangeFromText = (text: string, label: string): number | undefined => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const afterLabel = new RegExp(`${escaped}[^0-9]{0,80}(\\d+)\\s*(?:ft|feet|pés|pes)`, 'i').exec(text);
  if (afterLabel) return Number(afterLabel[1]);
  const anyRange = /(\d+)\s*(?:ft|feet|pés|pes)/i.exec(text);
  return anyRange ? Number(anyRange[1]) : undefined;
};

const sensesFromFeatures = (character: Character): CharacterSense[] => {
  const result: CharacterSense[] = [];
  const definitions: Array<{ label: string; name: string; kind: CharacterSense['kind'] }> = [
    { label: 'darkvision', name: 'Darkvision', kind: 'darkvision' },
    { label: 'truesight', name: 'Truesight', kind: 'truesight' },
    { label: 'blindsight', name: 'Blindsight', kind: 'special' },
    { label: 'tremorsense', name: 'Tremorsense', kind: 'special' }
  ];

  for (const feature of character.features ?? []) {
    const text = `${feature.name} ${feature.summary ?? ''}`;
    const normalizedText = normalize(text);
    for (const definition of definitions) {
      if (!normalizedText.includes(definition.label)) continue;
      result.push({
        id: `feature-sense:${feature.id}:${definition.label}`,
        name: definition.name,
        kind: definition.kind,
        rangeFeet: senseRangeFromText(text, definition.name),
        notes: `Concedido por ${feature.name}.`
      });
    }
  }
  return result;
};

export const getCharacterSheetSenses = (character: Character): CharacterSense[] => {
  const explicit = getEffectiveCharacterSenses(character);
  const merged = [...explicit, ...sensesFromFeatures(character)];
  return merged.filter((sense, index) => {
    const key = `${normalize(sense.name)}:${sense.rangeFeet ?? ''}`;
    return merged.findIndex((candidate) => `${normalize(candidate.name)}:${candidate.rangeFeet ?? ''}` === key) === index;
  });
};

export interface CharacterSheetFeatGroups {
  primary: Character['feats'];
  granted: Character['feats'];
}

export const getCharacterSheetFeatGroups = (character: Character): CharacterSheetFeatGroups => ({
  primary: character.feats.filter((feat) => !feat.grantedByFeatEntityId),
  granted: character.feats.filter((feat) => Boolean(feat.grantedByFeatEntityId))
});

export interface CharacterSheetResourceUse {
  id: string;
  name: string;
  description?: string;
  actionLabel?: string;
  costs: string[];
}

/** Read-first projection of executable/manual shared-resource feature uses. */
export const getCharacterSheetResourceUses = (
  character: Character,
  items: StoredCompendiumItem[]
): CharacterSheetResourceUse[] =>
  getCharacterAbilityUses(character, items)
    .filter((use) => use.kind === 'sharedConsumer')
    .map((use) => ({
    id: use.id,
    name: use.name,
    description: use.description,
    actionLabel: use.actionLabel,
    costs: use.costLabels
  }));
