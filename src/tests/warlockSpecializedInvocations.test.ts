import { createEmptyCharacter } from '../data/mockData';
import { findEldritchInvocationById } from '../characters/eldritchInvocationRules';
import {
  activateOneWithShadows,
  advanceGazeOfTwoMindsTurn,
  breakOneWithShadowsForRotation,
  gazeCastingOriginIssues,
  getEffectiveCharacterSenses,
  inscribeGiftOfProtectorsName,
  maintainGazeOfTwoMinds,
  reconcileWarlockSpecializedInvocations,
  restoreGiftOfProtectorsOnRest,
  startGazeOfTwoMinds,
  triggerGiftOfProtectors
} from '../characters/warlockSpecializedInvocations';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { buildSpellAction } from '../rules-engine/actions/buildActions';
import { validateTurnRotation } from '../rules-engine/turns/validateTurn';
import type { Character, TurnRotation } from '../types';

const builtin = (slug: string) => {
  const id = `builtin:phb-2024-feature-warlock-${slug}`;
  return findEldritchInvocationById([], id)!;
};

const withInvocationCounts = (slugs: string[], charisma = 18): Character => {
  const character = createEmptyCharacter('Specialized Warlock');
  return {
    ...character,
    abilities: { ...character.abilities, CHA: charisma },
    buildChoices: {
      ...character.buildChoices!,
      eldritchInvocationCounts: Object.fromEntries(slugs.map((slug) => [builtin(slug).id, 1]))
    }
  };
};

describe('specialized Warlock invocations', () => {
  it('reconciles Devil\'s Sight and Witch Sight without duplicating senses', () => {
    const initial = withInvocationCounts(['devils-sight', 'witch-sight']);
    const first = reconcileWarlockSpecializedInvocations(initial, []);
    const second = reconcileWarlockSpecializedInvocations(first, []);

    expect(first.senses).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'darkvision', rangeFeet: 120, magicalDarkness: true }),
      expect.objectContaining({ kind: 'truesight', rangeFeet: 30 })
    ]));
    expect(second.senses).toHaveLength(first.senses?.length ?? 0);
  });

  it('limits Gift of the Protectors names and restores its shared use on a long rest', () => {
    let character = reconcileWarlockSpecializedInvocations(
      withInvocationCounts(['pact-of-the-tome', 'gift-of-the-protectors'], 18),
      []
    );
    for (const name of ['A', 'B', 'C', 'D', 'E']) character = inscribeGiftOfProtectorsName(character, name);

    expect(character.buildChoices?.giftOfProtectors?.maxNames).toBe(4);
    expect(character.buildChoices?.giftOfProtectors?.names).toEqual(['A', 'B', 'C', 'D']);

    character = triggerGiftOfProtectors(character, 'A');
    const resourceId = character.buildChoices?.giftOfProtectors?.resourceId!;
    expect(character.resources.find((resource) => resource.id === resourceId)?.current).toBe(0);

    const rested = restoreGiftOfProtectorsOnRest(character, 'longRest');
    expect(rested.resources.find((resource) => resource.id === resourceId)?.current).toBe(1);
    expect(rested.protectionTransactions?.at(-1)?.action).toBe('recovered');
  });

  it('tracks Gaze of Two Minds duration, borrowed senses and alternate casting origin', () => {
    const gaze = builtin('gaze-of-two-minds');
    let character = startGazeOfTwoMinds(createEmptyCharacter('Gaze Warlock'), {
      invocationItemId: gaze.id,
      targetName: 'Scout',
      targetSenses: 'Darkvision 60 ft',
      distanceFeet: 70,
      samePlane: true,
      spellOrigin: 'gazeTarget'
    });

    expect(gazeCastingOriginIssues(character, 'gazeTarget').map((entry) => entry.code)).toContain('GAZE_CASTING_DISTANCE');
    expect(getEffectiveCharacterSenses(character)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'borrowed', name: 'Sentidos de Scout' })
    ]));

    character = startGazeOfTwoMinds(character, {
      invocationItemId: gaze.id,
      targetName: 'Scout',
      targetSenses: 'Darkvision 60 ft',
      distanceFeet: 30,
      samePlane: true,
      spellOrigin: 'gazeTarget'
    });
    expect(gazeCastingOriginIssues(character, 'gazeTarget')).toEqual([]);

    character = advanceGazeOfTwoMindsTurn(character);
    expect(character.buildChoices?.gazeOfTwoMinds?.active).toBe(true);
    character = maintainGazeOfTwoMinds(character);
    expect(character.buildChoices?.gazeOfTwoMinds?.remainingTurnWindows).toBe(2);
    character = advanceGazeOfTwoMindsTurn(advanceGazeOfTwoMindsTurn(character));
    expect(character.buildChoices?.gazeOfTwoMinds?.active).toBe(false);
  });


  it('exposes the Gaze target as a validated spell origin while it is within 60 feet', () => {
    const gaze = builtin('gaze-of-two-minds');
    const base = createEmptyCharacter('Gaze Caster');
    let character: Character = {
      ...base,
      spells: [{
        id: 'gaze-spell',
        name: 'Test Spell',
        level: 0,
        castingTime: 'action',
        range: '60 ft',
        damage: parseDamageFormula('1d8', { defaultSourceType: 'spell' }),
        source: { id: 'manual', book: 'Manual', status: 'active', confidence: 'manual' }
      }]
    };
    character = startGazeOfTwoMinds(character, {
      invocationItemId: gaze.id,
      targetName: 'Scout',
      distanceFeet: 30,
      samePlane: true,
      spellOrigin: 'gazeTarget'
    });
    const action = buildSpellAction(character, 'gaze-spell')!;
    expect(action.gazeCastingOriginAvailable).toBe(true);

    const rotation: TurnRotation = {
      id: 'gaze-spell-rotation',
      characterId: character.id,
      name: 'Cast through Gaze',
      actions: [{ id: 'gaze-turn-action', name: action.name, actionCost: action.actionCost, action, spellOrigin: 'gazeTarget' }]
    };
    expect(validateTurnRotation(rotation, character).ok).toBe(true);

    const tooFar = startGazeOfTwoMinds(character, {
      invocationItemId: gaze.id,
      targetName: 'Scout',
      distanceFeet: 80,
      samePlane: true,
      spellOrigin: 'gazeTarget'
    });
    const tooFarAction = buildSpellAction(tooFar, 'gaze-spell')!;
    const invalid = validateTurnRotation({
      ...rotation,
      actions: [{ ...rotation.actions[0]!, action: tooFarAction }]
    }, tooFar);
    expect(invalid.issues.map((entry) => entry.code)).toContain('GAZE_CASTING_DISTANCE');
  });

  it('activates One with Shadows only in dim light or darkness and ends it after an attack', () => {
    const shadows = builtin('one-with-shadows');
    const character = createEmptyCharacter('Shadow Warlock');
    expect(activateOneWithShadows(character, shadows.id, 'bright').issues.map((entry) => entry.code)).toContain('ONE_WITH_SHADOWS_LIGHT_REQUIRED');

    const activated = activateOneWithShadows(character, shadows.id, 'dim').character;
    const effectId = activated.buildChoices?.oneWithShadows?.activeEffectId;
    expect(activated.activeEffects.some((effect) => effect.id === effectId && effect.status === 'active')).toBe(true);

    const rotation: TurnRotation = {
      id: 'shadow-attack-rotation',
      characterId: activated.id,
      name: 'Attack breaks invisibility',
      actions: [{
        id: 'shadow-attack',
        name: 'Attack',
        actionCost: 'action',
        action: {
          id: 'attack-action',
          type: 'attack',
          name: 'Attack',
          actionCost: 'action',
          sourceType: 'weapon',
          attackAbility: 'STR',
          attacksCount: 1,
          damage: parseDamageFormula('1d6 + STR', { defaultSourceType: 'weapon' })
        }
      }]
    };
    const ended = breakOneWithShadowsForRotation(activated, rotation);
    expect(ended.activeEffects.find((effect) => effect.id === effectId)?.status).not.toBe('active');
  });
});
