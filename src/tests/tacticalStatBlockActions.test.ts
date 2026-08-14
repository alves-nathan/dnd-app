import fs from 'node:fs';
import path from 'node:path';
import { createEmptyCharacter, defaultCombatState } from '../data/mockData';
import type { CompendiumImportItem } from '../compendium/importDomain';
import type { StoredCompendiumItem } from '../compendium/types';
import { projectCreatureStatBlockToTacticalTarget, statBlockActionDamageRange } from '../characters/tacticalStatBlockRules';
import { createCombatScenario } from '../rules-engine/turns/compareRotations';
import { createTacticalTarget } from '../rules-engine/turns/tacticalCombat';
import {
  ensureTacticalParticipants,
  rechargeTargetStatBlockResource,
  resolveTargetStatBlockAction,
  startTacticalTurn,
  targetParticipantId
} from '../rules-engine/turns/turnCycle';

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json'), 'utf8')) as { items: CompendiumImportItem[] };

const stored = (name: string): StoredCompendiumItem => {
  const item = fixture.items.find((entry) => entry.kind === 'creatureStatBlock' && entry.name === name);
  if (!item) throw new Error(`Missing creature fixture: ${name}`);
  return {
    id: `phb:${item.id}`,
    importItemId: item.id,
    packId: 'phb',
    sourceId: item.source.id,
    type: 'creatureStatBlock',
    name: item.name,
    summary: item.summary,
    version: item.source.version,
    rawJson: item,
    normalizedJson: item.payload as Record<string, unknown>,
    tags: [],
    status: 'validated',
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z'
  };
};

const scenarioWith = (characterId: string, target = createTacticalTarget({ id: 'target', name: 'Target' })) => ({
  ...createCombatScenario({
    id: 'scenario',
    characterId,
    name: 'Stat blocks',
    combatState: { ...defaultCombatState },
    now: '2026-08-11T00:00:00.000Z'
  }),
  actorPositionFeet: 0,
  targets: [target]
});

const rngSequence = (...values: number[]): (() => number) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
};

describe('tactical stat block actions', () => {
  it('projects a real creature stat block into target stats and structured actions', () => {
    const wolf = stored('Wolf');
    const projected = projectCreatureStatBlockToTacticalTarget(wolf, { positionFeet: 5 });
    expect(projected.target).toMatchObject({ name: 'Wolf', armorClass: 12, size: 'Medium', speedFeet: 40 });
    expect(projected.target.hitPoints).toMatchObject({ current: 11, max: 11 });
    expect(projected.actions).toHaveLength(1);
    expect(projected.actions[0]).toMatchObject({ name: 'Bite', type: 'attack', attackBonus: 4, reach: '5 ft', damageFormula: '1d6+2' });
    expect(projected.actions[0]?.conditionIds).toContain('prone');
    expect(statBlockActionDamageRange(projected.actions[0]!).average).toBeCloseTo(5.5);
  });

  it('rolls a stat block attack against character AC and applies average damage', () => {
    const character = { ...createEmptyCharacter('Hero'), abilities: { STR: 10, DEX: 14, CON: 10, INT: 10, WIS: 10, CHA: 10 }, hitPoints: { current: 20, max: 20, temporary: 0 } };
    const projection = projectCreatureStatBlockToTacticalTarget(stored('Wolf'), { positionFeet: 5 });
    const target = createTacticalTarget({ id: 'wolf', ...projection.target });
    let scenario = ensureTacticalParticipants(scenarioWith(character.id, target), character.name);
    scenario = startTacticalTurn({ scenario, character, participantId: targetParticipantId(target.id) }).scenario;

    const result = resolveTargetStatBlockAction({
      scenario,
      character,
      targetId: target.id,
      actionId: projection.actions[0]!.id,
      damageMode: 'average',
      rng: rngSequence(0.45)
    });

    expect(result.issues.filter((entry) => entry.severity === 'error')).toHaveLength(0);
    expect(result.characterArmorClass).toBe(12);
    expect(result.attackRoll).toBe(10);
    expect(result.attackTotal).toBe(14);
    expect(result.hit).toBe(true);
    expect(result.damage).toBe(5);
    expect(result.character.hitPoints?.current).toBe(15);
    expect(result.character.activeEffects.flatMap((effect) => effect.conditionIds ?? [])).toContain('prone');
  });

  it('resolves saving-throw actions and applies imported conditions on failure', () => {
    const character = { ...createEmptyCharacter('Hero'), hitPoints: { current: 20, max: 20, temporary: 0 } };
    const projection = projectCreatureStatBlockToTacticalTarget(stored('Quasit'), { positionFeet: 5 });
    const target = createTacticalTarget({ id: 'quasit', ...projection.target });
    let scenario = ensureTacticalParticipants(scenarioWith(character.id, target), character.name);
    scenario = startTacticalTurn({ scenario, character, participantId: targetParticipantId(target.id) }).scenario;
    const scare = projection.actions.find((action) => action.name === 'Scare')!;

    const result = resolveTargetStatBlockAction({
      scenario,
      character,
      targetId: target.id,
      actionId: scare.id,
      rng: rngSequence(0.2)
    });

    expect(result.saveRoll).toBe(5);
    expect(result.saveDC).toBe(10);
    expect(result.saveSuccess).toBe(false);
    expect(result.character.activeEffects.flatMap((effect) => effect.conditionIds ?? [])).toContain('frightened');
  });

  it('imports recharge resources and restores them with the d6 recharge roll', () => {
    const character = createEmptyCharacter('Hero');
    const projection = projectCreatureStatBlockToTacticalTarget(stored('Ape'), { positionFeet: 20 });
    const target = createTacticalTarget({ id: 'ape', ...projection.target, statBlockResources: projection.resources.map((resource) => ({ ...resource, current: 0 })) });
    const scenario = ensureTacticalParticipants(scenarioWith(character.id, target), character.name);
    const resource = target.statBlockResources?.[0];
    expect(resource).toMatchObject({ recharge: 'rechargeRoll', rechargeMin: 6, current: 0 });

    const result = rechargeTargetStatBlockResource({ scenario, targetId: target.id, resourceId: resource!.id, rng: () => 0.99 });
    expect(result.roll).toBe(6);
    expect(result.recharged).toBe(true);
    expect(result.scenario.targets?.[0]?.statBlockResources?.[0]?.current).toBe(1);
  });

  it('models imported target reactions and consumes the reaction availability', () => {
    const character = createEmptyCharacter('Hero');
    const projection = projectCreatureStatBlockToTacticalTarget(stored('Construct Spirit'), { positionFeet: 5 });
    const target = createTacticalTarget({ id: 'construct', ...projection.target });
    const scenario = ensureTacticalParticipants(scenarioWith(character.id, target), character.name);
    const reaction = projection.actions.find((action) => action.section === 'reaction')!;

    const result = resolveTargetStatBlockAction({ scenario, character, targetId: target.id, actionId: reaction.id });
    expect(result.issues).toHaveLength(0);
    expect(result.scenario.participants?.find((entry) => entry.id === targetParticipantId(target.id))?.reactionAvailable).toBe(false);
    expect(result.scenario.tacticalLog?.some((entry) => entry.kind === 'reaction' && entry.actionId === reaction.id)).toBe(true);
  });
});
