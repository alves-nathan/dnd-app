import { createEmptyCharacter, defaultCombatState } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import {
  actorMapPoint,
  pointInTerrainRegion,
  tacticalDistanceBetweenPoints,
  tacticalDistanceBetweenTargets,
  tacticalDistanceToTarget,
  tacticalMovementCostBetweenPoints,
  tacticalTargetsInsideArea
} from '../rules-engine/targeting/spatialMap';
import { createCombatScenario } from '../rules-engine/turns/compareRotations';
import { combatStateForTarget, createTacticalTarget, resolveTacticalRotation } from '../rules-engine/turns/tacticalCombat';
import { ensureTacticalParticipants, moveTargetDuringTurn, startTacticalTurn, targetParticipantId } from '../rules-engine/turns/turnCycle';
import type { AttackAction, CombatScenario, TacticalActionResolution, TacticalTerrainRegion, TurnRotation } from '../types';

const scenario = (mode: 'linear' | 'map2d' = 'map2d'): CombatScenario => ({
  ...createCombatScenario({ id: 'map', characterId: 'character', name: 'Mapa', combatState: { ...defaultCombatState }, now: '2026-08-11T00:00:00.000Z' }),
  spatialMode: mode,
  diagonalRule: 'fiveFeet',
  actorPositionFeet: 0,
  actorMapPosition: { xFeet: 0, yFeet: 0 },
  targets: [
    createTacticalTarget({ id: 'a', name: 'A', positionFeet: 10, mapPosition: { xFeet: 10, yFeet: 0 }, cover: 'half', lineOfSight: true, hitPoints: { current: 20, max: 20 } }),
    createTacticalTarget({ id: 'b', name: 'B', positionFeet: 25, mapPosition: { xFeet: 10, yFeet: 5 }, hitPoints: { current: 20, max: 20 } }),
    createTacticalTarget({ id: 'c', name: 'C', positionFeet: 40, mapPosition: { xFeet: 10, yFeet: 10 }, hitPoints: { current: 20, max: 20 } }),
    createTacticalTarget({ id: 'd', name: 'D', positionFeet: 60, mapPosition: { xFeet: 30, yFeet: 0 }, hitPoints: { current: 20, max: 20 } })
  ]
});

describe('optional tactical map', () => {
  it('preserves linear distance while map mode uses configurable diagonals', () => {
    const linear = scenario('linear');
    expect(tacticalDistanceToTarget(linear, linear.targets![1]!)).toBe(25);

    expect(tacticalDistanceBetweenPoints({ xFeet: 0, yFeet: 0 }, { xFeet: 10, yFeet: 10 }, 'fiveFeet')).toBe(10);
    expect(tacticalDistanceBetweenPoints({ xFeet: 0, yFeet: 0 }, { xFeet: 10, yFeet: 10 }, 'alternating5_10')).toBe(15);
    expect(tacticalDistanceBetweenPoints({ xFeet: 0, yFeet: 0 }, { xFeet: 10, yFeet: 10 }, 'euclidean')).toBe(14.1);
  });

  it('uses 2D distance while preserving target-specific cover and line of sight', () => {
    const map = scenario();
    const target = map.targets![0]!;
    expect(actorMapPoint(map)).toEqual({ xFeet: 0, yFeet: 0 });
    expect(tacticalDistanceToTarget(map, target)).toBe(10);
    expect(combatStateForTarget(map, target.id)).toMatchObject({ targetDistanceFeet: 10, cover: 'half', lineOfSight: true });
  });

  it('represents difficult terrain by region and charges only the crossed segment', () => {
    const terrain: TacticalTerrainRegion = {
      id: 'mud', label: 'Lama', shape: 'rectangle', xFeet: 5, yFeet: -5, widthFeet: 10, heightFeet: 10, movementMultiplier: 2
    };
    const map = { ...scenario(), terrainRegions: [terrain] };
    expect(pointInTerrainRegion({ xFeet: 10, yFeet: 0 }, terrain)).toBe(true);
    expect(pointInTerrainRegion({ xFeet: 20, yFeet: 0 }, terrain)).toBe(false);
    const movement = tacticalMovementCostBetweenPoints(map, { xFeet: 0, yFeet: 0 }, { xFeet: 20, yFeet: 0 });
    expect(movement.distanceFeet).toBe(20);
    expect(movement.crossesDifficultTerrain).toBe(true);
    expect(movement.difficultTerrainFeet).toBe(10);
    expect(movement.costFeet).toBe(30);
  });


  it('charges regional difficult terrain during target movement without changing linear mode', () => {
    const character = createEmptyCharacter('Mover');
    const terrain: TacticalTerrainRegion = {
      id: 'mud', label: 'Lama', shape: 'rectangle', xFeet: 5, yFeet: -5, widthFeet: 10, heightFeet: 10, movementMultiplier: 2
    };
    let map: CombatScenario = { ...scenario(), characterId: character.id, terrainRegions: [terrain], targets: [createTacticalTarget({ id: 'walker', name: 'Walker', positionFeet: 20, mapPosition: { xFeet: 20, yFeet: 0 }, speedFeet: 30 })] };
    map = ensureTacticalParticipants(map, character.name);
    map = startTacticalTurn({ scenario: map, character, participantId: targetParticipantId('walker') }).scenario;
    const moved = moveTargetDuringTurn({ scenario: map, characterName: character.name, targetId: 'walker', distanceFeet: 10, direction: 'towardActor' });
    expect(moved.issues).toHaveLength(0);
    expect(moved.scenario.targets?.[0]?.mapPosition).toEqual({ xFeet: 10, yFeet: 0 });
    expect(moved.scenario.participants?.find((participant) => participant.id === targetParticipantId('walker'))?.movementSpentFeet).toBe(15);
  });

  it('automatically determines conservative line, cone and radial area membership', () => {
    const map = scenario();
    expect(tacticalTargetsInsideArea(map, { shape: 'cone', sizeFeet: 15, origin: 'actor' }, 'a')).toMatchObject({ automatic: true, targetIds: ['a', 'b'] });
    expect(tacticalTargetsInsideArea(map, { shape: 'line', lengthFeet: 20, widthFeet: 5, origin: 'actor' }, 'a')).toMatchObject({ automatic: true, targetIds: ['a'] });
    expect(tacticalTargetsInsideArea(map, { shape: 'sphere', radiusFeet: 10, origin: 'point' }, 'a')).toMatchObject({ automatic: true, targetIds: ['a', 'b', 'c'] });
    expect(tacticalTargetsInsideArea(map, { shape: 'cube', sizeFeet: 15, origin: 'actor' }, 'a').automatic).toBe(false);
  });

  it('uses 2D adjacency for Cleave rather than stale linear positions', () => {
    const character = createEmptyCharacter('Cleave Map');
    const action: AttackAction = {
      id: 'cleave', type: 'attack', name: 'Greataxe', actionCost: 'action', sourceType: 'weapon',
      damage: parseDamageFormula('1d12 + STR'), attacksCount: 1,
      mastery: { property: 'cleave', label: 'Cleave', description: 'Secondary attack' }
    };
    const rotation: TurnRotation = {
      id: 'rotation', characterId: character.id, name: 'Cleave',
      actions: [{ id: 'cleave-action', name: 'Cleave', actionCost: 'action', action, targetId: 'a' }]
    };
    const map = scenario();
    const resolutions: TacticalActionResolution[] = [{
      actionId: 'cleave-action', targetId: 'a', confirmedHits: 1,
      targetResults: [{ targetId: 'a', confirmedHits: 1, damage: 8 }, { targetId: 'b', confirmedHits: 1, damage: 6 }]
    }];
    expect(tacticalDistanceBetweenTargets(map, map.targets![0]!, map.targets![1]!)).toBe(5);
    const result = resolveTacticalRotation({ character, rotation, scenario: map, resolutions });
    expect(result.issues.some((entry) => entry.code === 'TACTICAL_CLEAVE_TARGET_NOT_ADJACENT')).toBe(false);
    expect(result.scenario.targets?.find((target) => target.id === 'b')?.hitPoints?.current).toBe(14);
  });
});
