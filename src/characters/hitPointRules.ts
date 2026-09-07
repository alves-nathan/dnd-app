import type { Character, CharacterHitPointMethod, CharacterHitPointState } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { getAbilityModifier } from '../rules-engine/characters/derivedStats';

export interface CharacterHitPointClassPlan {
  classEntityId: string;
  className: string;
  hitDie: number;
  levels: number;
  higherLevelRollsRequired: number;
  startingClass: boolean;
}

export interface CharacterHitPointBonus {
  sourceName: string;
  amount: number;
}

export interface CharacterHitPointCalculation {
  complete: boolean;
  max?: number;
  baseMax?: number;
  permanentBonus: number;
  bonuses: CharacterHitPointBonus[];
  constitutionModifier: number;
  firstLevelHitPoints?: number;
  classPlans: CharacterHitPointClassPlan[];
  missingRolls: Record<string, number>;
  issues: string[];
}

const cleanRef = (value?: string): string => (value ?? '')
  .replace(/^catalog:/, '')
  .replace(/^compendium:/, '')
  .trim();

const referencesMatch = (left?: string, right?: string): boolean => {
  const a = cleanRef(left);
  const b = cleanRef(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`:${b}`) || b.endsWith(`:${a}`);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const numberFromHitPointBonus = (value: unknown, characterLevel: number): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/×/g, '*');
  let match = /^([+-]?\d+)\s*\*\s*character\s*level$/i.exec(text)
    ?? /^character\s*level\s*\*\s*([+-]?\d+)$/i.exec(text);
  if (match) return Number(match[1]) * characterLevel;
  match = /^\+?([0-9]+)\s+per\s+character\s+level$/i.exec(text);
  if (match) return Number(match[1]) * characterLevel;
  match = /^\+?([0-9]+)\s+per\s+level$/i.exec(text);
  if (match) return Number(match[1]) * characterLevel;
  return undefined;
};

const itemForCharacterLink = (items: StoredCompendiumItem[], references: Array<string | undefined>): StoredCompendiumItem | undefined =>
  items.find((item) => references.some((reference) => referencesMatch(reference, item.id) || referencesMatch(reference, item.importItemId)));

export const getCharacterHitPointMaximumBonuses = (
  character: Character,
  items: StoredCompendiumItem[] = []
): CharacterHitPointBonus[] => {
  if (!items.length) return [];
  const totalLevel = Math.max(0, character.classes.reduce((sum, entry) => sum + Math.max(0, entry.level), 0) || character.level);
  const seen = new Set<string>();
  const bonuses: CharacterHitPointBonus[] = [];

  for (const link of character.compendiumLinks ?? []) {
    if (link.status !== 'active' || (link.appliedAs !== 'feat' && link.appliedAs !== 'feature')) continue;
    const item = itemForCharacterLink(items, [link.itemId, link.importItemId, link.choiceId, link.catalogEntityId]);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    const payload = item.normalizedJson;
    const mechanics = asRecord(payload.mechanics);
    const value = mechanics.hitPointMaximumBonus
      ?? mechanics.hitPointMaximumBonusFormula
      ?? payload.hitPointMaximumBonus
      ?? payload.hitPointMaximumBonusFormula;
    const amount = numberFromHitPointBonus(value, totalLevel);
    if (amount === undefined || amount === 0) continue;
    bonuses.push({ sourceName: item.name, amount });
  }

  return bonuses;
};

const startingClassEntityId = (character: Character): string | undefined => {
  const startingRef = character.buildChoices?.startingClassItemId;
  if (startingRef) {
    const link = (character.compendiumLinks ?? []).find((candidate) =>
      candidate.status === 'active' &&
      candidate.appliedAs === 'class' &&
      [candidate.itemId, candidate.importItemId, candidate.choiceId, candidate.catalogEntityId]
        .some((reference) => referencesMatch(reference, startingRef))
    );
    if (link) return link.appliedEntityId;
  }
  return character.classes[0]?.id;
};

export const getCharacterHitPointClassPlans = (character: Character): CharacterHitPointClassPlan[] => {
  const startingId = startingClassEntityId(character);
  return character.classes.map((entry) => {
    const startingClass = entry.id === startingId;
    return {
      classEntityId: entry.id,
      className: entry.name,
      hitDie: Math.max(0, Math.floor(entry.hitDie ?? 0)),
      levels: Math.max(0, Math.floor(entry.level)),
      higherLevelRollsRequired: Math.max(0, Math.floor(entry.level) - (startingClass ? 1 : 0)),
      startingClass
    };
  });
};

export const fixedHitPointDieValue = (dieSides: number): number => Math.floor(Math.max(0, dieSides) / 2) + 1;

const clampRoll = (value: number, dieSides: number): number =>
  Math.max(1, Math.min(Math.max(1, dieSides), Math.floor(Number(value) || 0)));

export const calculateCharacterHitPoints = (
  character: Character,
  state: Pick<CharacterHitPointState, 'method' | 'manualMax' | 'rolledByClass'>,
  items: StoredCompendiumItem[] = []
): CharacterHitPointCalculation => {
  const method: CharacterHitPointMethod = state.method ?? 'manual';
  const constitutionModifier = getAbilityModifier(character.abilities, 'CON');
  const classPlans = getCharacterHitPointClassPlans(character);
  const issues: string[] = [];
  const missingRolls: Record<string, number> = {};
  const bonuses = method === 'manual' ? [] : getCharacterHitPointMaximumBonuses(character, items);
  const permanentBonus = bonuses.reduce((sum, entry) => sum + entry.amount, 0);

  if (method === 'manual') {
    const manualMax = Math.max(0, Math.floor(Number(state.manualMax) || 0));
    return {
      complete: manualMax > 0,
      max: manualMax > 0 ? manualMax : undefined,
      permanentBonus: 0,
      bonuses: [],
      constitutionModifier,
      classPlans,
      missingRolls,
      issues: manualMax > 0 ? [] : ['Informe o PV máximo manual.']
    };
  }

  const invalid = classPlans.filter((plan) => plan.levels > 0 && plan.hitDie <= 0);
  if (invalid.length) {
    issues.push(`Hit Die ausente para: ${invalid.map((plan) => plan.className).join(', ')}.`);
    return { complete: false, permanentBonus, bonuses, constitutionModifier, classPlans, missingRolls, issues };
  }

  const starting = classPlans.find((plan) => plan.startingClass && plan.levels > 0) ?? classPlans.find((plan) => plan.levels > 0);
  if (!starting) {
    issues.push('Nenhuma classe com nível foi encontrada.');
    return { complete: false, permanentBonus, bonuses, constitutionModifier, classPlans, missingRolls, issues };
  }

  const firstLevelHitPoints = Math.max(1, starting.hitDie + constitutionModifier);
  let total = firstLevelHitPoints;

  for (const plan of classPlans) {
    if (plan.higherLevelRollsRequired <= 0) continue;
    if (method === 'fixed') {
      total += plan.higherLevelRollsRequired * Math.max(1, fixedHitPointDieValue(plan.hitDie) + constitutionModifier);
      continue;
    }
    if (method === 'maximum') {
      total += plan.higherLevelRollsRequired * Math.max(1, plan.hitDie + constitutionModifier);
      continue;
    }

    const rolls = state.rolledByClass?.[plan.classEntityId] ?? [];
    const validRolls = rolls.slice(0, plan.higherLevelRollsRequired).map((roll) => clampRoll(roll, plan.hitDie));
    if (validRolls.length < plan.higherLevelRollsRequired) {
      missingRolls[plan.classEntityId] = plan.higherLevelRollsRequired - validRolls.length;
    }
    total += validRolls.reduce((sum, roll) => sum + Math.max(1, roll + constitutionModifier), 0);
  }

  const complete = Object.keys(missingRolls).length === 0;
  if (!complete) issues.push('Registre uma rolagem para cada nível acima do 1º.');
  const max = complete ? total + permanentBonus : undefined;
  return { complete, max, baseMax: complete ? total : undefined, permanentBonus, bonuses, constitutionModifier, firstLevelHitPoints, classPlans, missingRolls, issues };
};

export const applyCharacterHitPointConfiguration = (
  character: Character,
  configuration: Pick<CharacterHitPointState, 'method' | 'manualMax' | 'rolledByClass'>,
  items: StoredCompendiumItem[] = []
): Character => {
  const calculation = calculateCharacterHitPoints(character, configuration, items);
  if (!calculation.complete || calculation.max === undefined) return character;
  const previous = character.hitPoints ?? { current: 0, max: 0, temporary: 0 };
  const delta = calculation.max - previous.max;
  const current = previous.max > 0
    ? Math.max(0, Math.min(calculation.max, previous.current + delta))
    : calculation.max;
  return {
    ...character,
    hitPoints: {
      ...previous,
      ...configuration,
      max: calculation.max,
      current,
      temporary: Math.max(0, previous.temporary ?? 0)
    }
  };
};

export const reconcileCharacterHitPoints = (character: Character, items: StoredCompendiumItem[] = []): Character => {
  const state = character.hitPoints;
  if (!state?.method || state.method === 'manual') return character;
  return applyCharacterHitPointConfiguration(character, state, items);
};

export const rollMissingCharacterHitPoints = (character: Character): CharacterHitPointState['rolledByClass'] => {
  const plans = getCharacterHitPointClassPlans(character);
  const existing = character.hitPoints?.rolledByClass ?? {};
  const next: NonNullable<CharacterHitPointState['rolledByClass']> = { ...existing };
  for (const plan of plans) {
    const current = [...(next[plan.classEntityId] ?? [])].slice(0, plan.higherLevelRollsRequired);
    while (current.length < plan.higherLevelRollsRequired) current.push(1 + Math.floor(Math.random() * Math.max(1, plan.hitDie)));
    next[plan.classEntityId] = current;
  }
  return next;
};
