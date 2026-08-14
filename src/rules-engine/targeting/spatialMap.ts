import type {
  CombatScenario,
  TacticalAreaTemplate,
  TacticalDiagonalRule,
  TacticalMapPoint,
  TacticalTarget,
  TacticalTerrainRegion
} from '../../types';

const round1 = (value: number): number => Math.round(value * 10) / 10;
const nonNegative = (value: number | undefined): number => Math.max(0, Number.isFinite(value) ? value! : 0);

export const normalizeTacticalMapPoint = (point: Partial<TacticalMapPoint> | undefined, fallback: TacticalMapPoint): TacticalMapPoint => ({
  xFeet: Number.isFinite(point?.xFeet) ? Number(point!.xFeet) : fallback.xFeet,
  yFeet: Number.isFinite(point?.yFeet) ? Number(point!.yFeet) : fallback.yFeet
});

export const actorMapPoint = (scenario: CombatScenario): TacticalMapPoint =>
  normalizeTacticalMapPoint(scenario.actorMapPosition, { xFeet: scenario.actorPositionFeet ?? 0, yFeet: 0 });

export const targetMapPoint = (target: TacticalTarget): TacticalMapPoint =>
  normalizeTacticalMapPoint(target.mapPosition, { xFeet: target.positionFeet, yFeet: 0 });

export const tacticalDiagonalRule = (scenario: CombatScenario): TacticalDiagonalRule => scenario.diagonalRule ?? 'fiveFeet';

/**
 * Distância tática em pés. `fiveFeet` usa diagonais de 5 ft (métrica Chebyshev).
 * `alternating5_10` reproduz a variante de diagonais 5/10 em uma grade de 5 ft,
 * mantendo suporte a coordenadas fracionárias para edição manual.
 */
export const tacticalDistanceBetweenPoints = (
  a: TacticalMapPoint,
  b: TacticalMapPoint,
  rule: TacticalDiagonalRule = 'fiveFeet'
): number => {
  const dx = Math.abs(b.xFeet - a.xFeet);
  const dy = Math.abs(b.yFeet - a.yFeet);
  if (rule === 'euclidean') return round1(Math.hypot(dx, dy));
  if (rule === 'fiveFeet') return round1(Math.max(dx, dy));

  const diagonalSteps = Math.min(dx, dy) / 5;
  const straightSteps = Math.abs(dx - dy) / 5;
  const fullPairs = Math.floor(diagonalSteps / 2);
  const pairRemainder = diagonalSteps - fullPairs * 2;
  const diagonalCost = fullPairs * 15
    + (pairRemainder <= 1 ? pairRemainder * 5 : 5 + (pairRemainder - 1) * 10);
  return round1(diagonalCost + straightSteps * 5);
};

export const tacticalDistanceToTarget = (scenario: CombatScenario, target: TacticalTarget): number => {
  if (scenario.spatialMode !== 'map2d') return Math.abs(target.positionFeet - (scenario.actorPositionFeet ?? 0));
  return tacticalDistanceBetweenPoints(actorMapPoint(scenario), targetMapPoint(target), tacticalDiagonalRule(scenario));
};

export const tacticalDistanceBetweenTargets = (scenario: CombatScenario, a: TacticalTarget, b: TacticalTarget): number => {
  if (scenario.spatialMode !== 'map2d') return Math.abs(a.positionFeet - b.positionFeet);
  return tacticalDistanceBetweenPoints(targetMapPoint(a), targetMapPoint(b), tacticalDiagonalRule(scenario));
};

export const pointInTerrainRegion = (point: TacticalMapPoint, region: TacticalTerrainRegion): boolean => {
  if (region.shape === 'circle') {
    const radius = nonNegative(region.radiusFeet);
    return Math.hypot(point.xFeet - region.xFeet, point.yFeet - region.yFeet) <= radius;
  }
  const width = nonNegative(region.widthFeet);
  const height = nonNegative(region.heightFeet);
  return point.xFeet >= region.xFeet
    && point.xFeet <= region.xFeet + width
    && point.yFeet >= region.yFeet
    && point.yFeet <= region.yFeet + height;
};

export const terrainMultiplierAtPoint = (scenario: CombatScenario, point: TacticalMapPoint): number => {
  if (scenario.difficultTerrain) return 2;
  if (scenario.spatialMode !== 'map2d') return 1;
  return Math.max(1, ...(scenario.terrainRegions ?? [])
    .filter((region) => pointInTerrainRegion(point, region))
    .map((region) => Math.max(1, region.movementMultiplier || 2)));
};

export interface TacticalMovementCost {
  distanceFeet: number;
  costFeet: number;
  difficultTerrainFeet: number;
  crossesDifficultTerrain: boolean;
}

/**
 * Calcula custo ao longo de um segmento reto. Terrenos regionais são amostrados em
 * segmentos de no máximo 2,5 ft, evitando transformar o mapa opcional em um pathfinder.
 */
export const tacticalMovementCostBetweenPoints = (
  scenario: CombatScenario,
  start: TacticalMapPoint,
  end: TacticalMapPoint
): TacticalMovementCost => {
  const distanceFeet = tacticalDistanceBetweenPoints(start, end, tacticalDiagonalRule(scenario));
  if (distanceFeet <= 0) return { distanceFeet: 0, costFeet: 0, difficultTerrainFeet: 0, crossesDifficultTerrain: false };
  if (scenario.difficultTerrain) return { distanceFeet, costFeet: round1(distanceFeet * 2), difficultTerrainFeet: distanceFeet, crossesDifficultTerrain: true };
  if (scenario.spatialMode !== 'map2d' || !(scenario.terrainRegions?.length)) {
    return { distanceFeet, costFeet: distanceFeet, difficultTerrainFeet: 0, crossesDifficultTerrain: false };
  }

  const euclidean = Math.hypot(end.xFeet - start.xFeet, end.yFeet - start.yFeet);
  const sampleCount = Math.max(1, Math.min(400, Math.ceil(euclidean / 2.5)));
  let weightedMultiplier = 0;
  let difficultSamples = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const t = (index + 0.5) / sampleCount;
    const point = {
      xFeet: start.xFeet + (end.xFeet - start.xFeet) * t,
      yFeet: start.yFeet + (end.yFeet - start.yFeet) * t
    };
    const multiplier = terrainMultiplierAtPoint(scenario, point);
    weightedMultiplier += multiplier;
    if (multiplier > 1) difficultSamples += 1;
  }
  const averageMultiplier = weightedMultiplier / sampleCount;
  const difficultFraction = difficultSamples / sampleCount;
  return {
    distanceFeet,
    costFeet: round1(distanceFeet * averageMultiplier),
    difficultTerrainFeet: round1(distanceFeet * difficultFraction),
    crossesDifficultTerrain: difficultSamples > 0
  };
};

const vector = (from: TacticalMapPoint, to: TacticalMapPoint): TacticalMapPoint => ({ xFeet: to.xFeet - from.xFeet, yFeet: to.yFeet - from.yFeet });

/** Move um ponto exatamente a `distanceFeet` na métrica tática escolhida. */
export const moveMapPointRelativeTo = (
  start: TacticalMapPoint,
  reference: TacticalMapPoint,
  distanceFeet: number,
  direction: 'toward' | 'away',
  rule: TacticalDiagonalRule
): TacticalMapPoint => {
  const desired = nonNegative(distanceFeet);
  if (desired === 0) return { ...start };
  let delta = vector(start, reference);
  if (Math.abs(delta.xFeet) < 1e-9 && Math.abs(delta.yFeet) < 1e-9) delta = { xFeet: 1, yFeet: 0 };
  if (direction === 'away') delta = { xFeet: -delta.xFeet, yFeet: -delta.yFeet };
  const euclideanLength = Math.hypot(delta.xFeet, delta.yFeet) || 1;
  const unit = { xFeet: delta.xFeet / euclideanLength, yFeet: delta.yFeet / euclideanLength };

  let scale: number;
  if (rule === 'euclidean') {
    scale = desired;
  } else if (rule === 'fiveFeet') {
    scale = desired / Math.max(Math.abs(unit.xFeet), Math.abs(unit.yFeet));
  } else if (Math.abs(unit.xFeet) < 1e-9 || Math.abs(unit.yFeet) < 1e-9) {
    scale = desired;
  } else {
    let low = 0;
    let high = Math.max(desired * 3, 5);
    for (let index = 0; index < 36; index += 1) {
      const middle = (low + high) / 2;
      const candidate = { xFeet: start.xFeet + unit.xFeet * middle, yFeet: start.yFeet + unit.yFeet * middle };
      const measured = tacticalDistanceBetweenPoints(start, candidate, rule);
      if (measured <= desired) low = middle;
      else high = middle;
    }
    scale = low;
  }
  return {
    xFeet: round1(start.xFeet + unit.xFeet * scale),
    yFeet: round1(start.yFeet + unit.yFeet * scale)
  };
};

export const moveTargetAwayFromActor = (scenario: CombatScenario, target: TacticalTarget, distanceFeet: number): TacticalTarget => {
  if (scenario.spatialMode !== 'map2d') {
    const actor = scenario.actorPositionFeet ?? 0;
    const direction = target.positionFeet >= actor ? 1 : -1;
    return { ...target, positionFeet: Math.max(0, target.positionFeet + direction * nonNegative(distanceFeet)) };
  }
  return {
    ...target,
    mapPosition: moveMapPointRelativeTo(targetMapPoint(target), actorMapPoint(scenario), distanceFeet, 'away', tacticalDiagonalRule(scenario))
  };
};

const unitDirection = (origin: TacticalMapPoint, reference: TacticalMapPoint): { x: number; y: number } => {
  const dx = reference.xFeet - origin.xFeet;
  const dy = reference.yFeet - origin.yFeet;
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
};

const projection = (origin: TacticalMapPoint, direction: { x: number; y: number }, point: TacticalMapPoint) => {
  const px = point.xFeet - origin.xFeet;
  const py = point.yFeet - origin.yFeet;
  return {
    forward: px * direction.x + py * direction.y,
    perpendicular: Math.abs(px * -direction.y + py * direction.x)
  };
};

export interface TacticalAreaMembership {
  automatic: boolean;
  targetIds: string[];
  reason?: string;
}

/**
 * Geometria 2D deliberadamente conservadora. Shapes cujo posicionamento/orientação
 * não pode ser inferido de actor + alvo de referência permanecem manuais.
 */
export const tacticalTargetsInsideArea = (
  scenario: CombatScenario,
  area: TacticalAreaTemplate,
  referenceTargetId?: string
): TacticalAreaMembership => {
  if (scenario.spatialMode !== 'map2d') return { automatic: false, targetIds: [], reason: 'O cenário está no modo linear.' };
  const targets = scenario.targets ?? [];
  const reference = targets.find((target) => target.id === referenceTargetId) ?? targets[0];
  if (!reference && area.origin !== 'actor') return { automatic: false, targetIds: [], reason: 'Selecione um alvo/ponto de referência.' };
  const actor = actorMapPoint(scenario);
  const referencePoint = reference ? targetMapPoint(reference) : actor;
  const rule = tacticalDiagonalRule(scenario);

  const radialCenter = area.origin === 'actor' || area.shape === 'emanation' ? actor : referencePoint;
  const radius = area.radiusFeet ?? area.sizeFeet;
  const length = area.lengthFeet ?? area.sizeFeet;
  const size = area.sizeFeet;

  const inside = (target: TacticalTarget): boolean => {
    const point = targetMapPoint(target);
    if (area.shape === 'sphere' || area.shape === 'cylinder' || area.shape === 'emanation') {
      return radius !== undefined && tacticalDistanceBetweenPoints(radialCenter, point, rule) <= radius;
    }
    if (area.shape === 'line') {
      if (length === undefined) return false;
      const direction = unitDirection(actor, referencePoint);
      const p = projection(actor, direction, point);
      return p.forward >= 0 && p.forward <= length && p.perpendicular <= (area.widthFeet ?? 5) / 2;
    }
    if (area.shape === 'cone') {
      if (size === undefined) return false;
      const direction = unitDirection(actor, referencePoint);
      const p = projection(actor, direction, point);
      return p.forward >= 0 && p.forward <= size && p.perpendicular <= p.forward / 2;
    }
    if (area.shape === 'square' && size !== undefined && area.origin !== 'actor') {
      return Math.abs(point.xFeet - referencePoint.xFeet) <= size / 2 && Math.abs(point.yFeet - referencePoint.yFeet) <= size / 2;
    }
    return false;
  };

  const supported = ['sphere', 'cylinder', 'emanation', 'line', 'cone'].includes(area.shape)
    || (area.shape === 'square' && area.origin !== 'actor');
  if (!supported) return { automatic: false, targetIds: [], reason: `${area.shape} requer posicionamento/orientação manual neste mapa.` };
  return { automatic: true, targetIds: targets.filter(inside).map((target) => target.id) };
};
