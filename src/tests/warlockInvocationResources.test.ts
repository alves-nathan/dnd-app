import { buildPersistedCompendiumImport } from '../compendium/importer';
import type { Character } from '../types';
import { createEmptyCharacter, defaultCombatState } from '../data/mockData';
import { applyEldritchInvocationSelection } from '../characters/eldritchInvocationSelection';
import {
  applyEldritchInvocationChoices,
  validateEldritchInvocationChoices
} from '../characters/eldritchInvocationChoiceRules';
import { buildSpellAction } from '../rules-engine/actions/buildActions';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { analyzeTurnRotation } from '../rules-engine/turns/analyzeTurn';
import { buildPactChainCompanionAttackActions } from '../characters/pactChainCompanionRules';
import {
  reconcileCharacterHitDice,
  restoreHitDiceOnRest,
  useLifedrinkerHealing
} from '../characters/hitDiceRules';

const source = {
  id: 'warlock-next-source',
  book: 'Rules fixture',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const
};

const persisted = buildPersistedCompendiumImport({
  id: 'warlock-next-pack',
  source,
  items: [
    { id: 'armor-of-shadows', kind: 'feature', name: 'Armor of Shadows', source, payload: { sourceType: 'eldritchInvocation', engineKey: 'warlock.armor-of-shadows', levelGained: 1 } },
    { id: 'gift-of-depths', kind: 'feature', name: 'Gift of the Depths', source, payload: { sourceType: 'eldritchInvocation', engineKey: 'warlock.gift-of-the-depths', levelGained: 5 } },
    { id: 'pact-chain', kind: 'feature', name: 'Pact of the Chain', source, payload: { sourceType: 'eldritchInvocation', engineKey: 'warlock.pact-of-the-chain', levelGained: 1 } },
    { id: 'investment-chain', kind: 'feature', name: 'Investment of the Chain Master', source, payload: { sourceType: 'eldritchInvocation', engineKey: 'warlock.investment-of-the-chain-master', levelGained: 5, prerequisite: 'Pact of the Chain invocation' } },
    { id: 'mage-armor', kind: 'spell', name: 'Mage Armor', source, payload: { level: 1, castingTime: 'action', range: 'touch', duration: '8 hours', concentration: false, consumesSpellSlot: true } },
    { id: 'water-breathing', kind: 'spell', name: 'Water Breathing', source, payload: { level: 3, castingTime: 'action', range: '30 ft', duration: '24 hours', concentration: false, consumesSpellSlot: true } },
    {
      id: 'imp',
      kind: 'creatureStatBlock',
      name: 'Imp',
      source,
      payload: {
        size: 'Tiny', creatureType: 'Fiend', armorClass: { value: 13 }, hitPoints: { averageFormula: '10 (3d4+3)' },
        speed: { walk: 20, fly: 40 }, senses: 'Darkvision 120 ft.', languages: 'Common, Infernal',
        traits: [{ id: 'magic-resistance', name: 'Magic Resistance', summary: 'Advantage on saves against magic.' }],
        actions: [{ name: 'Sting', actionCost: 'bonusAction', type: 'attack', attackBonus: 5, reach: '5 ft', damageFormula: '1d4+3 + 2d6', damageType: 'piercing+poison' }]
      }
    }
  ]
});

const item = (importItemId: string) => persisted.items.find((entry) => entry.importItemId === importItemId)!;

const warlockCharacter = (): Character => ({
  ...createEmptyCharacter('Warlock fixture'),
  level: 5,
  classes: [{ id: 'warlock-class', name: 'Warlock', level: 5, hitDie: 8, source }]
});

describe('invocation spell grants, companion and Lifedrinker resources', () => {
  it('grants at-will and once-per-long-rest spells without spell slots', () => {
    const armor = item('armor-of-shadows');
    const gift = item('gift-of-depths');
    const selectedCounts = { [armor.id]: 1, [gift.id]: 1 };
    const selected = applyEldritchInvocationSelection(warlockCharacter(), selectedCounts, persisted.items).character;
    const result = applyEldritchInvocationChoices(selected, [], persisted.items);

    const mageArmor = result.character.spells.find((spell) => spell.name === 'Mage Armor')!;
    const waterBreathing = result.character.spells.find((spell) => spell.name === 'Water Breathing')!;
    expect(mageArmor.freeCast).toBe(true);
    expect(mageArmor.invocationUsage).toBe('atWill');
    expect(waterBreathing.invocationUsage).toBe('oncePerLongRest');
    expect(waterBreathing.consumes).toHaveLength(1);
    expect(result.character.resources.find((resource) => resource.id === waterBreathing.consumes?.[0]?.resourceId)).toMatchObject({ max: 1, current: 1, recharge: 'longRest' });

    const mageAction = buildSpellAction(result.character, mageArmor.id)!;
    const waterAction = buildSpellAction(result.character, waterBreathing.id)!;
    expect(mageAction.consumesSpellSlot).toBe(false);
    expect(waterAction.consumesSpellSlot).toBe(false);
    expect(waterAction.consumes).toHaveLength(1);
  });

  it('creates a persistent Pact of the Chain companion and applies Investment', () => {
    const chain = item('pact-chain');
    const investment = item('investment-chain');
    const imp = item('imp');
    const selectedCounts = { [chain.id]: 1, [investment.id]: 1 };
    const choices = [
      { id: 'chain-choice', invocationItemId: chain.id, instanceIndex: 0, familiarCreatureItemId: imp.id, familiarVariant: 'special' as const },
      { id: 'investment-choice', invocationItemId: investment.id, instanceIndex: 0, chainMasterMovementMode: 'swim' as const, chainMasterDamageType: 'necrotic' as const }
    ];

    expect(validateEldritchInvocationChoices(selectedCounts, choices, persisted.items, [source.id])).toEqual([]);
    const selected = applyEldritchInvocationSelection(warlockCharacter(), selectedCounts, persisted.items).character;
    const result = applyEldritchInvocationChoices(selected, choices, persisted.items);
    const companion = result.character.companions?.[0]!;

    expect(companion).toMatchObject({ name: 'Imp', armorClass: 13, command: 'bonusAction', canAttack: true });
    expect(companion.hitPoints).toEqual({ current: 10, max: 10 });
    expect(companion.speed).toMatchObject({ walk: 20, fly: 40, swim: 40 });
    expect(companion.actions[0]).toMatchObject({ name: 'Sting', attackBonus: 5, damageFormula: '1d4+3 + 2d6' });
    const attacks = buildPactChainCompanionAttackActions(companion);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({
      name: 'Imp · Sting',
      attackBonusOverride: 5,
      actionCost: 'bonusAction',
      attacksCount: 1
    });
    expect(attacks[0]?.damage.components).toHaveLength(3);
    expect(companion.investment?.usesWarlockSpellSaveDC).toBe(true);
  });


  it('replaces one Warlock attack when a non-Investment familiar attacks', () => {
    const companion = {
      id: 'chain-companion',
      name: 'Sprite',
      sourceCreatureItemId: 'sprite-item',
      grantedByInvocationItemId: 'pact-chain',
      variant: 'special' as const,
      armorClass: 15,
      hitPoints: { current: 2, max: 2 },
      speed: { walk: 10, fly: 40 },
      traits: [],
      actions: [{ id: 'shortbow', name: 'Shortbow', actionCost: 'action' as const, type: 'attack' as const, attackBonus: 6, range: '40/160 ft', damageFormula: '1d6+4', damageType: 'piercing' }],
      resources: [],
      activeEffects: [],
      transactions: [],
      initiative: 'own' as const,
      command: 'forgoOneAttack' as const,
      canAttack: true,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };
    const character = { ...warlockCharacter(), companions: [companion] };
    const familiarAction = buildPactChainCompanionAttackActions(companion)[0]!;
    const ownAction = {
      id: 'warlock-own-attack',
      type: 'attack' as const,
      name: 'Warlock attacks',
      actionCost: 'action' as const,
      sourceType: 'weapon' as const,
      attackAbility: 'STR' as const,
      attacksCount: 2,
      damage: parseDamageFormula('1d8 + STR', { defaultSourceType: 'weapon' })
    };
    const result = analyzeTurnRotation({
      id: 'chain-rotation',
      characterId: character.id,
      name: 'Warlock and familiar',
      actions: [
        { id: 'own-turn-action', name: ownAction.name, actionCost: ownAction.actionCost, action: ownAction },
        { id: 'familiar-turn-action', name: familiarAction.name, actionCost: familiarAction.actionCost, action: familiarAction }
      ]
    }, character, defaultCombatState);

    expect(result.validation.ok).toBe(true);
    expect(result.attackCount).toBe(2);
    expect(result.actions.map((entry) => entry.attacksCount)).toEqual([1, 1]);
  });

  it('spends one Hit Die for Lifedrinker healing and restores it on a long rest', () => {
    let character = warlockCharacter();
    character = {
      ...character,
      abilities: { ...character.abilities, CON: 14 },
      hitPoints: { current: 5, max: 20, temporary: 0 },
      features: [{ id: 'lifedrinker-feature', name: 'Lifedrinker', sourceType: 'classFeature', source }],
      buildChoices: {
        ...character.buildChoices!,
        pactWeapon: { mode: 'conjured', weaponEntityId: 'pact-weapon', damageType: 'necrotic', invokedAt: new Date(0).toISOString() }
      }
    };
    character = reconcileCharacterHitDice(character);
    const pool = character.hitDice?.[0]!;
    const healed = useLifedrinkerHealing({ character, hitDiePoolId: pool.id, random: () => 0 });

    expect(healed.ok).toBe(true);
    expect(healed.dieRoll).toBe(1);
    expect(healed.amount).toBe(3);
    expect(healed.character.hitPoints?.current).toBe(8);
    expect(healed.character.hitDice?.[0]?.current).toBe(4);
    expect(healed.character.healingTransactions).toHaveLength(1);

    const rested = restoreHitDiceOnRest(healed.character, 'longRest');
    expect(rested.hitDice?.[0]?.current).toBe(5);
  });
});
