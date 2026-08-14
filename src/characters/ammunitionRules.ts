import type { Character, RuleValidationIssue, TurnRotation } from '../types';
import { turnActionAttackCount } from './interactionEconomyRules';

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const inferredAmmoType = (name: string): string | undefined => {
  const value = normalize(name);
  if (value.includes('arrow')) return 'arrow';
  if (value.includes('bolt') && !value.includes('sling')) return 'bolt';
  if (value.includes('sling bullet')) return 'sling-bullet';
  if (value.includes('bullet')) return 'firearm-bullet';
  if (value.includes('needle')) return 'needle';
  return undefined;
};

export const equipmentAmmunitionType = (name: string, explicit?: string): string | undefined => explicit ?? inferredAmmoType(name);

export const ammunitionCount = (character: Character, type: string): number =>
  character.equipment
    .filter((entry) => equipmentAmmunitionType(entry.name, entry.ammunitionType) === type)
    .reduce((sum, entry) => sum + Math.max(0, entry.quantity), 0);

export const rotationAmmunitionCosts = (rotation: TurnRotation): Array<{ type: string; amount: number; label: string }> => {
  const grouped = new Map<string, { type: string; amount: number; label: string }>();
  for (const entry of rotation.actions) {
    if (entry.action.type !== 'attack' || !entry.action.ammunitionType) continue;
    const amount = Math.max(1, entry.action.ammunitionPerAttack ?? 1)
      * Math.max(1, turnActionAttackCount(entry));
    const current = grouped.get(entry.action.ammunitionType) ?? {
      type: entry.action.ammunitionType,
      amount: 0,
      label: entry.action.ammunitionType
    };
    current.amount += amount;
    grouped.set(current.type, current);
  }
  return Array.from(grouped.values());
};

export const checkRotationAmmunition = (rotation: TurnRotation, character: Character): {
  ok: boolean;
  issues: RuleValidationIssue[];
  costs: Array<{ type: string; amount: number; label: string }>;
} => {
  const costs = rotationAmmunitionCosts(rotation);
  const issues: RuleValidationIssue[] = [];
  for (const cost of costs) {
    const available = ammunitionCount(character, cost.type);
    if (available < cost.amount) issues.push({
      severity: 'error',
      code: 'AMMUNITION_INSUFFICIENT',
      message: `Munição insuficiente: ${cost.label} exige ${cost.amount}, mas a ficha possui ${available}.`
    });
  }
  return { ok: issues.length === 0, issues, costs };
};

export const spendRotationAmmunition = (character: Character, rotation: TurnRotation): Character => {
  const costs = rotationAmmunitionCosts(rotation);
  let equipment = [...character.equipment];
  for (const cost of costs) {
    let remaining = cost.amount;
    equipment = equipment.map((entry) => {
      if (remaining <= 0 || equipmentAmmunitionType(entry.name, entry.ammunitionType) !== cost.type) return entry;
      const used = Math.min(remaining, Math.max(0, entry.quantity));
      remaining -= used;
      return { ...entry, quantity: entry.quantity - used };
    });
  }
  return { ...character, equipment };
};
