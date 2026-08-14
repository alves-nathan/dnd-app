import type { Character, SpellSlotLevel, SpellSlotPool } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { getClassSpellcastingProfile } from './spellcastingRules';
import { toSpellSlotLevel } from '../rules-engine/resources/spellSlotManager';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const valueAtLevel = (value: unknown, level: number): number =>
  Array.isArray(value) ? Math.max(0, asNumber(value[Math.max(0, level - 1)]) ?? 0) : 0;

export const spellSlotPoolKey = (slot: SpellSlotPool): string =>
  `${slot.poolKind ?? 'manual'}:${slot.sourceClassId ?? 'shared'}:${slot.level}`;

const classBindings = (character: Character, items: StoredCompendiumItem[]) =>
  character.classes.flatMap((classEntity) => {
    const link = (character.compendiumLinks ?? []).find(
      (entry) => entry.appliedAs === 'class' && entry.appliedEntityId === classEntity.id && entry.status === 'active'
    );
    const item = items.find((candidate) => candidate.id === link?.itemId);
    return item ? [{ entity: classEntity, item }] : [];
  });

const slotsForClassLevel = (item: StoredCompendiumItem, classLevel: number): Record<string, unknown> => {
  const spellcasting = asRecord(asRecord(item.normalizedJson).spellcasting);
  return asRecord(asRecord(spellcasting.slotsByLevel)[String(classLevel)]);
};

const canonicalMulticlassSlots = (items: StoredCompendiumItem[], casterLevel: number): Record<string, unknown> => {
  const fullCaster = items.find((item) => {
    if (item.type !== 'class') return false;
    const spellcasting = asRecord(asRecord(item.normalizedJson).spellcasting);
    return spellcasting.progression === 'fullCaster' && Object.keys(asRecord(spellcasting.slotsByLevel)).length > 0;
  });
  return fullCaster ? slotsForClassLevel(fullCaster, Math.max(1, Math.min(20, casterLevel))) : {};
};

export interface DerivedSpellSlots {
  pools: SpellSlotPool[];
  effectiveCasterLevel: number;
  regularCasterClassCount: number;
  pactCasterClassCount: number;
}

export const deriveCharacterSpellSlots = (
  character: Character,
  items: StoredCompendiumItem[]
): DerivedSpellSlots => {
  const bindings = classBindings(character, items);
  const regular = bindings.filter(({ item, entity }) => {
    const profile = getClassSpellcastingProfile(item, entity.level);
    return profile && profile.progression !== 'pactMagic';
  });
  const pact = bindings.filter(({ item, entity }) => getClassSpellcastingProfile(item, entity.level)?.progression === 'pactMagic');
  const contributions = regular.map(({ item, entity }) => {
    const progression = getClassSpellcastingProfile(item, entity.level)?.progression;
    if (progression === 'fullCaster') return entity.level;
    if (progression === 'halfCaster') return Math.ceil(entity.level / 2);
    if (progression === 'thirdCaster') return Math.floor(entity.level / 3);
    return 0;
  });
  const effectiveCasterLevel = contributions.reduce((sum, value) => sum + value, 0);

  const regularSlots = regular.length === 1
    ? slotsForClassLevel(regular[0]!.item, regular[0]!.entity.level)
    : effectiveCasterLevel > 0
      ? canonicalMulticlassSlots(items, effectiveCasterLevel)
      : {};

  const pools: SpellSlotPool[] = Object.entries(regularSlots).flatMap(([levelText, count]) => {
    const level = toSpellSlotLevel(Number(levelText));
    const max = asNumber(count) ?? 0;
    return level && max > 0
      ? [{ id: `spellcasting-shared-${level}`, level, max, current: max, recharge: 'longRest' as const, poolKind: 'spellcasting' as const }]
      : [];
  });

  for (const { item, entity } of pact) {
    const spellcasting = asRecord(asRecord(item.normalizedJson).spellcasting);
    const max = valueAtLevel(spellcasting.pactSlotsByLevel, entity.level);
    const level = toSpellSlotLevel(valueAtLevel(spellcasting.pactSlotLevelByLevel, entity.level));
    if (!level || max <= 0) continue;
    pools.push({
      id: `pact-${entity.id}-${level}`,
      level,
      max,
      current: max,
      recharge: 'shortRest',
      poolKind: 'pactMagic',
      sourceClassId: entity.id,
      sourceClassName: entity.name,
      source: entity.source
    });
  }

  return { pools, effectiveCasterLevel, regularCasterClassCount: regular.length, pactCasterClassCount: pact.length };
};

export const reconcileCharacterSpellSlots = (
  character: Character,
  items: StoredCompendiumItem[],
  options: { refill?: boolean } = {}
): Character => {
  const derived = deriveCharacterSpellSlots(character, items).pools;
  const existingByKey = new Map((character.spellSlots ?? []).map((slot) => [spellSlotPoolKey(slot), slot]));
  const spellSlots = derived.map((slot) => {
    const existing = existingByKey.get(spellSlotPoolKey(slot));
    if (!existing || options.refill) return slot;
    const spent = Math.max(0, existing.max - existing.current);
    return { ...slot, current: Math.max(0, slot.max - spent) };
  });
  return { ...character, spellSlots };
};
