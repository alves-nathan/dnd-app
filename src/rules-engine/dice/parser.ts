import { AbilityScore, DamageComponent, DamageFormula, DamageSourceType } from '../../types';
import { createId } from '../../utils/id';

const ABILITIES: AbilityScore[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const abilitySet = new Set<string>(ABILITIES);

export interface ParseDamageOptions {
  defaultSourceType?: DamageSourceType;
  application?: DamageComponent['application'];
}

const normalizeFormula = (formula: string): string =>
  formula
    .replace(/−/g, '-')
    .replace(/\s+/g, '')
    .replace(/-/g, '+-')
    .replace(/^\+/, '');

export const parseDamageFormula = (raw: string, options: ParseDamageOptions = {}): DamageFormula => {
  const sourceType = options.defaultSourceType ?? 'manual';
  const application = options.application ?? 'onHit';
  const components: DamageComponent[] = [];
  const unresolvedTokens: string[] = [];
  const cleaned = normalizeFormula(raw);

  if (!cleaned) {
    return { raw, components, unresolvedTokens: ['empty'] };
  }

  for (const token of cleaned.split('+').filter(Boolean)) {
    const operation = token.startsWith('-') ? 'subtract' : 'add';
    const normalizedToken = token.replace(/^-/, '').trim();
    const upper = normalizedToken.toUpperCase();
    const diceMatch = /^(\d*)D(\d+)(?:R(?:<=)?(\d+))?$/i.exec(normalizedToken);

    if (diceMatch) {
      const count = diceMatch[1] ? Number(diceMatch[1]) : 1;
      const sides = Number(diceMatch[2]);
      const reroll = diceMatch[3] ? Number(diceMatch[3]) : undefined;
      components.push({
        id: createId('dmg'),
        kind: 'dice',
        operation,
        dice: { count, sides, rerollLessThanOrEqual: reroll },
        sourceType,
        application,
        criticalBehavior: 'doubleDice',
        label: `${operation === 'subtract' ? '-' : ''}${count}d${sides}${reroll ? `r<=${reroll}` : ''}`
      });
      continue;
    }

    if (abilitySet.has(upper)) {
      components.push({
        id: createId('dmg'),
        kind: 'abilityModifier',
        ability: upper as AbilityScore,
        operation,
        sourceType: 'abilityModifier',
        application,
        criticalBehavior: 'notDoubled',
        label: upper
      });
      continue;
    }

    if (upper === 'PB' || upper === 'PROF' || upper === 'PROFICIENCY') {
      components.push({
        id: createId('dmg'),
        kind: 'proficiencyBonus',
        operation,
        sourceType,
        application,
        criticalBehavior: 'notDoubled',
        label: 'PB'
      });
      continue;
    }

    if (/^\d+(?:\.\d+)?$/.test(normalizedToken)) {
      components.push({
        id: createId('dmg'),
        kind: 'flat',
        value: Number(normalizedToken),
        operation,
        sourceType,
        application,
        criticalBehavior: 'notDoubled',
        label: normalizedToken
      });
      continue;
    }

    if (/^[A-Z_][A-Z0-9_]*$/i.test(normalizedToken)) {
      components.push({
        id: createId('dmg'),
        kind: 'customVariable',
        variableKey: upper,
        operation,
        sourceType,
        application,
        criticalBehavior: 'notDoubled',
        label: upper
      });
      continue;
    }

    unresolvedTokens.push(normalizedToken);
  }

  return { raw, components, unresolvedTokens: unresolvedTokens.length ? unresolvedTokens : undefined };
};
