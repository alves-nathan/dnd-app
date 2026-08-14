import {
  createE2ETacticalMobileCharacter,
  createE2ETacticalMobileScenario,
  E2E_TACTICAL_READY_SPELL_ID,
  E2E_TACTICAL_TARGET_ID,
  E2E_TACTICAL_WAR_CASTER_SPELL_ID
} from '../fixtures/e2eTacticalMobile';
import { buildAvailableActions } from '../rules-engine/actions/buildActions';
import {
  actorParticipantId,
  eligibleWarCasterReactionSpells,
  endTacticalTurn,
  moveTargetDuringTurn,
  recordTargetAttack,
  resolvePendingReaction,
  setReadyAction,
  startTacticalTurn,
  targetParticipantId,
  triggerReadyAction
} from '../rules-engine/turns/turnCycle';

const reset = () => {
  const character = createE2ETacticalMobileCharacter();
  return { character, scenario: createE2ETacticalMobileScenario(character) };
};

describe('tactical mobile closure contracts', () => {
  it('advances the round after character and target complete their turns', () => {
    let { character, scenario } = reset();
    let result = startTacticalTurn({ scenario, character, participantId: actorParticipantId(character.id) });
    expect(result.issues).toHaveLength(0);
    ({ scenario, character } = result);
    result = endTacticalTurn({ scenario, character });
    ({ scenario, character } = result);
    expect(scenario.round).toBe(1);

    result = startTacticalTurn({ scenario, character, participantId: targetParticipantId(E2E_TACTICAL_TARGET_ID) });
    expect(result.issues).toHaveLength(0);
    ({ scenario, character } = result);
    result = endTacticalTurn({ scenario, character });
    expect(result.issues).toHaveLength(0);
    expect(result.scenario.round).toBe(2);
    expect(result.scenario.participants?.every((participant) => !participant.hasActed)).toBe(true);
  });

  it('consumes Sap on the next target attack and resolves concentration failure', () => {
    let { character, scenario } = reset();
    const started = startTacticalTurn({ scenario, character, participantId: targetParticipantId(E2E_TACTICAL_TARGET_ID) });
    ({ scenario, character } = started);
    const result = recordTargetAttack({
      scenario,
      character,
      targetId: E2E_TACTICAL_TARGET_ID,
      attackName: 'E2E Club',
      hit: true,
      damage: 12,
      concentrationSave: 'failure'
    });

    expect(result.issues).toHaveLength(0);
    expect(result.rollMode).toBe('disadvantage');
    expect(result.concentrationDC).toBe(10);
    expect(result.character.hitPoints?.current).toBe(20);
    expect(result.character.activeEffects.some((effect) => effect.status === 'active' && effect.concentration)).toBe(false);
    expect(result.scenario.targets?.[0]?.effects.some((effect) => effect.kind === 'sap')).toBe(false);
  });

  it('creates an opportunity reaction and allows a War Caster spell', () => {
    let { character, scenario } = reset();
    const started = startTacticalTurn({ scenario, character, participantId: targetParticipantId(E2E_TACTICAL_TARGET_ID) });
    ({ scenario, character } = started);
    const moved = moveTargetDuringTurn({
      scenario,
      characterName: character.name,
      targetId: E2E_TACTICAL_TARGET_ID,
      distanceFeet: 10,
      direction: 'awayFromActor'
    });
    const spellActionId = `spell_${E2E_TACTICAL_WAR_CASTER_SPELL_ID}`;

    expect(moved.issues).toHaveLength(0);
    expect(moved.opportunityProvoked).toBe(true);
    expect(moved.scenario.pendingReaction?.kind).toBe('opportunityAttack');
    expect(eligibleWarCasterReactionSpells(character).some((action) => action.id === spellActionId)).toBe(true);

    const resolved = resolvePendingReaction({ scenario: moved.scenario, character, actionId: spellActionId, hit: true, damage: 7 });
    expect(resolved.issues).toHaveLength(0);
    expect(resolved.scenario.targets?.[0]?.hitPoints?.current).toBe(23);
    expect(resolved.scenario.participants?.find((participant) => participant.kind === 'character')?.reactionAvailable).toBe(false);
    expect(resolved.scenario.pendingReaction).toBeUndefined();
  });

  it('commits a Ready spell slot at preparation and does not refund it on trigger', () => {
    let { character, scenario } = reset();
    const started = startTacticalTurn({ scenario, character, participantId: actorParticipantId(character.id) });
    ({ scenario, character } = started);
    const spellActionId = `spell_${E2E_TACTICAL_READY_SPELL_ID}`;
    expect(buildAvailableActions(character).some((action) => action.id === spellActionId)).toBe(true);

    const prepared = setReadyAction({
      scenario,
      character,
      actionId: spellActionId,
      trigger: 'O alvo se move',
      targetId: E2E_TACTICAL_TARGET_ID,
      selectedSlotLevel: 1
    });
    expect(prepared.issues).toHaveLength(0);
    expect(prepared.character.spellSlots.find((slot) => slot.level === 1)?.current).toBe(0);
    expect(prepared.character.activeEffects.some((effect) => effect.status === 'active' && effect.concentration && effect.name === 'Ready: E2E Arcane Lance')).toBe(true);
    expect(prepared.character.activeEffects.some((effect) => effect.name === 'E2E Concentration')).toBe(false);

    const ready = prepared.scenario.readyActions?.[0];
    expect(ready?.resourcesCommitted).toBe(true);
    const triggered = triggerReadyAction({
      scenario: prepared.scenario,
      character: prepared.character,
      readyActionId: ready!.id,
      targetId: E2E_TACTICAL_TARGET_ID
    });
    expect(triggered.issues).toHaveLength(0);

    const resolved = resolvePendingReaction({
      scenario: triggered.scenario,
      character: prepared.character,
      actionId: spellActionId,
      hit: true,
      damage: 9
    });
    expect(resolved.issues).toHaveLength(0);
    expect(resolved.character.spellSlots.find((slot) => slot.level === 1)?.current).toBe(0);
    expect(resolved.character.activeEffects.some((effect) => effect.name === 'Ready: E2E Arcane Lance' && effect.status === 'active')).toBe(false);
    expect(resolved.scenario.targets?.[0]?.hitPoints?.current).toBe(21);
    expect(resolved.scenario.readyActions).toHaveLength(0);
    expect(resolved.scenario.pendingReaction).toBeUndefined();
  });
  it('keeps the native Android closure runner focused on flows 91 through 94', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.resolve(__dirname, '../..');
    const runner = fs.readFileSync(path.join(root, 'scripts/run-tactical-mobile-closure-native.js'), 'utf8');
    const artifactRunner = fs.readFileSync(path.join(root, 'scripts/e2e/run-maestro-with-artifacts.sh'), 'utf8');
    expect(runner).toContain('TACTICAL_MOBILE_CLOSURE_FLOWS');
    expect(runner).toContain("MAESTRO_INCLUDE_TAGS: 'tactical-mobile-closure'");
    expect(runner).toContain("'android-latest.json'");
    expect(artifactRunner).toContain('FLOW_ARGS=("$@")');
    expect(artifactRunner).toContain('MAESTRO_HOST');
    expect(artifactRunner).toContain('MAESTRO_INCLUDE_TAGS');
  });

  it('resolves Maestro from its default installer directory even when PATH is stale', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.resolve(__dirname, '../..');
    const tools = fs.readFileSync(path.join(root, 'scripts/lib/mobile-tools.js'), 'utf8');
    expect(tools).toContain("'.maestro', 'bin'");
    expect(tools).toContain('maestroCandidates');
  });

});
