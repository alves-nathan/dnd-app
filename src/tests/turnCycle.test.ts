import { createEmptyCharacter, defaultCombatState } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { addActiveEffectToCharacter } from '../rules-engine/effects/activeEffects';
import { createCombatScenario } from '../rules-engine/turns/compareRotations';
import { createTacticalTarget } from '../rules-engine/turns/tacticalCombat';
import {
  actorParticipantId,
  eligibleWarCasterReactionSpells,
  endTacticalTurn,
  ensureTacticalParticipants,
  moveTargetDuringTurn,
  recordTargetAttack,
  resolvePendingReaction,
  setReadyAction,
  startTacticalTurn,
  targetParticipantId,
  triggerReadyAction
} from '../rules-engine/turns/turnCycle';
import type { ActiveEffect, Character, CombatScenario, Spell } from '../types';

const scenarioFor = (character: Character): CombatScenario => ensureTacticalParticipants({
  ...createCombatScenario({
    id: 'turn-scenario',
    characterId: character.id,
    name: 'Turn arena',
    combatState: { ...defaultCombatState, targetAC: 15 },
    now: '2026-07-16T00:00:00.000Z'
  }),
  round: 1,
  actorPositionFeet: 0,
  actorSpeedFeet: 30,
  targets: [createTacticalTarget({ id: 'goblin', name: 'Goblin', positionFeet: 5, speedFeet: 30 })],
  tacticalLog: []
}, character.name);

const concentrationEffect = (): ActiveEffect => ({
  id: 'hex-effect',
  name: 'Hex',
  kind: 'spell',
  sourceType: 'spell',
  status: 'active',
  concentration: true,
  conditionIds: ['hexed'],
  duration: { unit: 'manual', expiresOn: 'manual' },
  createdAt: '2026-07-16T00:00:00.000Z'
});

describe('complete tactical turn cycle', () => {
  it('advances the round only after every participant ends a turn', () => {
    const character = createEmptyCharacter('Aria');
    let scenario = scenarioFor(character);

    const actorStart = startTacticalTurn({ scenario, character, participantId: actorParticipantId(character.id) });
    expect(actorStart.issues).toHaveLength(0);
    const actorEnd = endTacticalTurn(actorStart);
    scenario = actorEnd.scenario;
    expect(scenario.round).toBe(1);
    expect(scenario.participants?.find((entry) => entry.kind === 'character')?.hasActed).toBe(true);

    const targetStart = startTacticalTurn({ scenario, character: actorEnd.character, participantId: targetParticipantId('goblin') });
    const targetEnd = endTacticalTurn(targetStart);
    expect(targetEnd.scenario.round).toBe(2);
    expect(targetEnd.scenario.participants?.every((entry) => entry.hasActed === false)).toBe(true);
  });

  it('consumes Sap on the real target attack and clears failed concentration after damage', () => {
    let character = addActiveEffectToCharacter({
      ...createEmptyCharacter('Warlock'),
      hitPoints: { current: 20, max: 20, temporary: 0 }
    }, concentrationEffect());
    let scenario = scenarioFor(character);
    scenario = {
      ...scenario,
      targets: scenario.targets?.map((target) => ({
        ...target,
        effects: [{
          id: 'sap', kind: 'sap', label: 'Sap', sourceCharacterId: character.id,
          expiry: 'startOfSourceTurn', remainingUses: 1, appliedRound: 1,
          appliedAt: '2026-07-16T00:00:00.000Z'
        }]
      }))
    };
    const started = startTacticalTurn({ scenario, character, participantId: targetParticipantId('goblin') });
    const result = recordTargetAttack({
      scenario: started.scenario,
      character: started.character,
      targetId: 'goblin',
      attackName: 'Scimitar',
      hit: true,
      damage: 12,
      concentrationSave: 'failure'
    });

    character = result.character;
    expect(result.rollMode).toBe('disadvantage');
    expect(result.concentrationDC).toBe(10);
    expect(character.hitPoints?.current).toBe(8);
    expect(character.activeEffects.some((effect) => effect.concentration)).toBe(false);
    expect(result.scenario.targets?.[0]?.effects.some((effect) => effect.kind === 'sap')).toBe(false);
  });

  it('creates an opportunity reaction when a target leaves reach and resolves a War Caster spell', () => {
    const spell: Spell = {
      id: 'spell-shocking-grasp',
      name: 'Shocking Grasp',
      level: 1,
      castingTime: 'action',
      range: 'Touch',
      components: { verbal: true, somatic: true, material: false },
      damage: parseDamageFormula('1d8', { defaultSourceType: 'spell' }),
      targeting: { targets: 1 },
      concentration: false
    };
    let character: Character = {
      ...createEmptyCharacter('War Caster'),
      feats: [{ id: 'war-caster', name: 'War Caster' }],
      spells: [spell],
      spellSlots: [{ id: 'slot-1', level: 1, max: 1, current: 1, recharge: 'longRest', poolKind: 'spellcasting' }]
    };
    let scenario = scenarioFor(character);
    const started = startTacticalTurn({ scenario, character, participantId: targetParticipantId('goblin') });
    const moved = moveTargetDuringTurn({
      scenario: started.scenario,
      characterName: character.name,
      targetId: 'goblin',
      distanceFeet: 10,
      direction: 'awayFromActor'
    });
    scenario = moved.scenario;
    expect(moved.opportunityProvoked).toBe(true);
    expect(scenario.pendingReaction?.kind).toBe('opportunityAttack');

    const eligible = eligibleWarCasterReactionSpells(character);
    expect(eligible.map((action) => action.name)).toContain('Shocking Grasp');
    const resolved = resolvePendingReaction({
      scenario,
      character,
      actionId: eligible[0]!.id,
      selectedSlotLevel: 1,
      hit: true,
      damage: 6
    });
    character = resolved.character;
    expect(resolved.issues.filter((entry) => entry.severity === 'error')).toHaveLength(0);
    expect(character.spellSlots[0]?.current).toBe(0);
    expect(resolved.scenario.pendingReaction).toBeUndefined();
    expect(resolved.scenario.participants?.find((entry) => entry.kind === 'character')?.reactionAvailable).toBe(false);
  });

  it('prepares and triggers Ready using the same action', () => {
    const spell: Spell = {
      id: 'spell-fire-bolt',
      name: 'Fire Bolt',
      level: 0,
      castingTime: 'action',
      range: '120 ft',
      components: { verbal: true, somatic: true, material: false },
      damage: parseDamageFormula('1d10', { defaultSourceType: 'spell' }),
      targeting: { targets: 1 }
    };
    const character: Character = { ...createEmptyCharacter('Wizard'), spells: [spell] };
    let scenario = scenarioFor(character);
    scenario = startTacticalTurn({ scenario, character, participantId: actorParticipantId(character.id) }).scenario;
    const ready = setReadyAction({ scenario, character, actionId: `spell_${spell.id}`, trigger: 'Quando o Goblin atacar', targetId: 'goblin' });
    expect(ready.issues).toHaveLength(0);
    const triggered = triggerReadyAction({ scenario: ready.scenario, character, readyActionId: ready.scenario.readyActions![0]!.id, targetId: 'goblin' });
    expect(triggered.issues).toHaveLength(0);
    expect(triggered.scenario.pendingReaction?.kind).toBe('ready');

    const resolved = resolvePendingReaction({
      scenario: triggered.scenario,
      character,
      actionId: `spell_${spell.id}`,
      hit: true,
      damage: 5
    });
    expect(resolved.issues.filter((entry) => entry.severity === 'error')).toHaveLength(0);
    expect(resolved.scenario.readyActions).toHaveLength(0);
  });
  it('commits a readied spell slot immediately and holds the spell with concentration until release', () => {
    const spell: Spell = {
      id: 'spell-guiding-bolt',
      name: 'Guiding Bolt',
      level: 1,
      castingTime: 'action',
      range: '120 ft',
      components: { verbal: true, somatic: true, material: false },
      damage: parseDamageFormula('4d6', { defaultSourceType: 'spell' }),
      targeting: { targets: 1 }
    };
    let character: Character = {
      ...createEmptyCharacter('Cleric'),
      spells: [spell],
      spellSlots: [{ id: 'slot-ready', level: 1, max: 1, current: 1, recharge: 'longRest', poolKind: 'spellcasting' }]
    };
    let scenario = startTacticalTurn({ scenario: scenarioFor(character), character, participantId: actorParticipantId(character.id) }).scenario;
    const ready = setReadyAction({ scenario, character, actionId: `spell_${spell.id}`, trigger: 'Quando o alvo avançar', targetId: 'goblin', selectedSlotLevel: 1 });
    character = ready.character;
    scenario = ready.scenario;
    expect(character.spellSlots[0]?.current).toBe(0);
    expect(character.activeEffects.some((effect) => effect.name === 'Ready: Guiding Bolt' && effect.concentration)).toBe(true);

    const triggered = triggerReadyAction({ scenario, character, readyActionId: scenario.readyActions![0]!.id, targetId: 'goblin' });
    const resolved = resolvePendingReaction({ scenario: triggered.scenario, character, actionId: `spell_${spell.id}`, hit: true, damage: 10 });
    expect(resolved.character.spellSlots[0]?.current).toBe(0);
    expect(resolved.character.activeEffects.some((effect) => effect.name === 'Ready: Guiding Bolt')).toBe(false);
  });

});
