import type {
  Character,
  CharacterHealingTransaction,
  CharacterHitDiePool,
  CharacterHitDieTransaction,
  RestType,
  RuleValidationIssue
} from '../types';
import { getAbilityModifier } from '../rules-engine/characters/derivedStats';
import { createId } from '../utils/id';

const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

const defaultHitDieForClass = (name: string): number => {
  const normalized = normalize(name);
  if (normalized === 'barbarian') return 12;
  if (['fighter', 'paladin', 'ranger'].includes(normalized)) return 10;
  if (['bard', 'cleric', 'druid', 'monk', 'rogue', 'warlock'].includes(normalized)) return 8;
  return 6;
};

export const reconcileCharacterHitDice = (character: Character): Character => {
  const previousByClass = new Map((character.hitDice ?? []).map((pool) => [pool.classEntityId, pool]));
  const hitDice: CharacterHitDiePool[] = character.classes.map((entry) => {
    const previous = previousByClass.get(entry.id);
    const max = Math.max(0, Math.floor(entry.level));
    const spent = previous ? Math.max(0, previous.max - previous.current) : 0;
    return {
      id: previous?.id ?? `hit-dice-${entry.id}`,
      classEntityId: entry.id,
      className: entry.name,
      dieSides: Math.max(4, Math.floor(entry.hitDie ?? previous?.dieSides ?? defaultHitDieForClass(entry.name))),
      max,
      current: Math.max(0, max - Math.min(max, spent))
    };
  });
  return { ...character, hitDice };
};

const hasLifedrinker = (character: Character): boolean =>
  character.features.some((feature) => normalize(feature.name) === 'lifedrinker');

export interface LifedrinkerHealingResult {
  character: Character;
  ok: boolean;
  amount: number;
  dieRoll?: number;
  issues: RuleValidationIssue[];
}

const error = (code: string, message: string): RuleValidationIssue => ({ severity: 'error', code, message });

export const useLifedrinkerHealing = (params: {
  character: Character;
  hitDiePoolId?: string;
  random?: () => number;
}): LifedrinkerHealingResult => {
  const character = reconcileCharacterHitDice(params.character);
  const issues: RuleValidationIssue[] = [];
  if (!hasLifedrinker(character)) issues.push(error('LIFEDRINKER_NOT_AVAILABLE', 'Lifedrinker não está ativo na ficha.'));
  if (!character.buildChoices?.pactWeapon) issues.push(error('LIFEDRINKER_PACT_WEAPON_REQUIRED', 'Configure uma Pact Weapon antes de usar a cura de Lifedrinker.'));
  const pool = params.hitDiePoolId
    ? (character.hitDice ?? []).find((entry) => entry.id === params.hitDiePoolId)
    : (character.hitDice ?? []).find((entry) => entry.current > 0);
  if (!pool || pool.current <= 0) issues.push(error('LIFEDRINKER_HIT_DIE_UNAVAILABLE', 'Nenhum Hit Die está disponível para a cura de Lifedrinker.'));
  if (issues.length || !pool) return { character, ok: false, amount: 0, issues };

  const random = params.random ?? Math.random;
  const dieRoll = Math.max(1, Math.min(pool.dieSides, Math.floor(random() * pool.dieSides) + 1));
  const constitutionModifier = getAbilityModifier(character.abilities, 'CON');
  const amount = Math.max(0, dieRoll + constitutionModifier);
  const beforePool = pool.current;
  const afterPool = beforePool - 1;
  const hitPointsBefore = character.hitPoints?.current;
  const hitPointsAfter = character.hitPoints && character.hitPoints.max > 0
    ? Math.min(character.hitPoints.max, character.hitPoints.current + amount)
    : undefined;
  const createdAt = new Date().toISOString();
  const hitDieTransaction: CharacterHitDieTransaction = {
    id: createId('hitdietx'),
    characterId: character.id,
    poolId: pool.id,
    classEntityId: pool.classEntityId,
    dieSides: pool.dieSides,
    amount: -1,
    before: beforePool,
    after: afterPool,
    reason: 'Cura de Lifedrinker após acerto com Pact Weapon',
    restType: 'manual',
    createdAt
  };
  const healingTransaction: CharacterHealingTransaction = {
    id: createId('healtx'),
    characterId: character.id,
    source: 'lifedrinker',
    hitDiePoolId: pool.id,
    dieRoll,
    constitutionModifier,
    amount,
    hitPointsBefore,
    hitPointsAfter,
    createdAt,
    notes: character.hitPoints?.max ? undefined : 'Cura calculada e registrada; defina PV máximo/atual para aplicá-la automaticamente.'
  };

  return {
    ok: true,
    amount,
    dieRoll,
    issues: [],
    character: {
      ...character,
      hitDice: (character.hitDice ?? []).map((entry) => entry.id === pool.id ? { ...entry, current: afterPool } : entry),
      hitPoints: hitPointsAfter !== undefined && character.hitPoints
        ? { ...character.hitPoints, current: hitPointsAfter }
        : character.hitPoints,
      hitDieTransactions: [...(character.hitDieTransactions ?? []), hitDieTransaction],
      healingTransactions: [...(character.healingTransactions ?? []), healingTransaction]
    }
  };
};

export const restoreHitDiceOnRest = (character: Character, restType: RestType): Character => {
  const reconciled = reconcileCharacterHitDice(character);
  if (restType !== 'longRest') return reconciled;
  const transactions: CharacterHitDieTransaction[] = [];
  const createdAt = new Date().toISOString();
  const hitDice = (reconciled.hitDice ?? []).map((pool) => {
    if (pool.current >= pool.max) return pool;
    transactions.push({
      id: createId('hitdietx'),
      characterId: character.id,
      poolId: pool.id,
      classEntityId: pool.classEntityId,
      dieSides: pool.dieSides,
      amount: pool.max - pool.current,
      before: pool.current,
      after: pool.max,
      reason: 'Recuperação de Hit Dice no descanso longo',
      restType,
      createdAt
    });
    return { ...pool, current: pool.max };
  });
  return {
    ...reconciled,
    hitDice,
    hitDieTransactions: [...(reconciled.hitDieTransactions ?? []), ...transactions]
  };
};
