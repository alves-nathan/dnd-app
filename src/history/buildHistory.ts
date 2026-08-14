import {
  BuildHistoryDiff,
  BuildHistoryMetricDelta,
  BuildHistoryRotationDelta,
  BuildHistoryRowSnapshot,
  BuildHistorySnapshot,
  BuildSnapshotKind,
  Character,
  CombatScenario,
  DamageRange,
  RotationComparisonResult,
  RotationComparisonRow,
  RotationResourceSummary
} from '../types';
import { formatNumber, formatPercent } from '../utils/format';
import { createId } from '../utils/id';
import { getTotalLevel } from '../rules-engine/characters/derivedStats';
import { describeCombatScenario } from '../reports/rotationReport';

const cloneRange = (range: DamageRange): DamageRange => ({
  min: Number(formatNumber(range.min)),
  max: Number(formatNumber(range.max)),
  average: Number(formatNumber(range.average))
});

const cloneResources = (resources: RotationResourceSummary[]): RotationResourceSummary[] =>
  resources.map((resource) => ({
    resourceId: resource.resourceId,
    label: resource.label,
    amount: resource.amount,
    oncePerTurnKeys: [...resource.oncePerTurnKeys]
  }));

const rowSnapshot = (row: RotationComparisonRow): BuildHistoryRowSnapshot => ({
  rotationId: row.rotationId,
  rotationName: row.rotationName,
  actionCount: row.actionCount,
  attackCount: row.attackCount,
  total: cloneRange(row.total),
  weightedAverage: row.weightedAverage === undefined ? undefined : Number(formatNumber(row.weightedAverage)),
  guaranteed: cloneRange(row.guaranteed),
  hitDependent: cloneRange(row.hitDependent),
  conditioned: cloneRange(row.conditioned),
  saveDependent: cloneRange(row.saveDependent),
  resourcesConsumed: cloneResources(row.resourcesConsumed),
  warningCount: row.warningCount,
  errorCount: row.errorCount
});

export const summarizeCharacterForHistory = (character: Character): BuildHistorySnapshot['character'] => ({
  name: character.name,
  level: getTotalLevel(character),
  classes: character.classes.map((characterClass) => ({
    id: characterClass.id,
    name: characterClass.name,
    level: characterClass.level
  })),
  weaponCount: character.weapons.length,
  spellCount: character.spells.length,
  featureCount: character.features.length,
  featCount: character.feats.length,
  compendiumLinkCount: character.compendiumLinks?.filter((link) => link.status === 'active').length ?? 0
});

export const createBuildHistorySnapshot = (params: {
  character: Character;
  scenario: CombatScenario;
  comparison: RotationComparisonResult;
  name: string;
  kind?: BuildSnapshotKind;
  notes?: string;
  now?: string;
  id?: string;
}): BuildHistorySnapshot => {
  const rows = params.comparison.rows.map(rowSnapshot);
  const warnings = rows.reduce((sum, row) => sum + row.warningCount, 0);
  const errors = rows.reduce((sum, row) => sum + row.errorCount, 0);

  return {
    id: params.id ?? createId('snapshot'),
    characterId: params.character.id,
    name: params.name.trim() || 'Snapshot de build',
    kind: params.kind ?? 'manual',
    createdAt: params.now ?? new Date().toISOString(),
    notes: params.notes?.trim() || undefined,
    character: summarizeCharacterForHistory(params.character),
    scenario: {
      id: params.scenario.id,
      name: params.scenario.name,
      targetAC: params.scenario.combatState.targetAC,
      targetCount: params.scenario.combatState.targetCount,
      rollMode: params.scenario.combatState.rollMode,
      resistanceMultiplier: params.scenario.combatState.resistanceMultiplier,
      criticalGuaranteed: params.scenario.combatState.criticalGuaranteed,
      critRange: params.scenario.combatState.critRange
    },
    rows,
    winners: {
      bestByAverageRotationId: params.comparison.bestByAverageRotationId,
      bestByWeightedAverageRotationId: params.comparison.bestByWeightedAverageRotationId,
      bestByGuaranteedRotationId: params.comparison.bestByGuaranteedRotationId
    },
    issueCount: { warnings, errors }
  };
};

const classSummary = (snapshot: BuildHistorySnapshot): string =>
  snapshot.character.classes.map((item) => `${item.name} ${item.level}`).join(' / ') || '-';

const metricDelta = (before?: number, after?: number): BuildHistoryMetricDelta => {
  if (before === undefined && after === undefined) return {};
  if (before === undefined) return { after, delta: after };
  if (after === undefined) return { before, delta: -before, percentDelta: before === 0 ? undefined : -1 };
  const delta = Number(formatNumber(after - before));
  return {
    before,
    after,
    delta,
    percentDelta: before === 0 ? undefined : delta / before
  };
};

const resourceMap = (resources: RotationResourceSummary[]): Map<string, RotationResourceSummary> => {
  const result = new Map<string, RotationResourceSummary>();
  for (const resource of resources) result.set(resource.resourceId, resource);
  return result;
};

const buildResourceChanges = (
  before: RotationResourceSummary[] = [],
  after: RotationResourceSummary[] = []
): BuildHistoryRotationDelta['resourceChanges'] => {
  const beforeMap = resourceMap(before);
  const afterMap = resourceMap(after);
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  return Array.from(ids)
    .map((resourceId) => {
      const previous = beforeMap.get(resourceId);
      const next = afterMap.get(resourceId);
      const beforeAmount = previous?.amount ?? 0;
      const afterAmount = next?.amount ?? 0;
      return {
        resourceId,
        label: next?.label ?? previous?.label ?? resourceId,
        before: beforeAmount,
        after: afterAmount,
        delta: afterAmount - beforeAmount
      };
    })
    .filter((change) => change.delta !== 0)
    .sort((left, right) => left.label.localeCompare(right.label));
};

const isMetricChanged = (delta: BuildHistoryMetricDelta): boolean =>
  delta.delta !== undefined && Math.abs(delta.delta) > 0.005;

const rotationStatus = (
  before?: BuildHistoryRowSnapshot,
  after?: BuildHistoryRowSnapshot,
  average?: BuildHistoryMetricDelta,
  weightedAverage?: BuildHistoryMetricDelta,
  guaranteedAverage?: BuildHistoryMetricDelta,
  warningDelta = 0,
  errorDelta = 0,
  resourceChanges: BuildHistoryRotationDelta['resourceChanges'] = []
): BuildHistoryRotationDelta['status'] => {
  if (!before && after) return 'added';
  if (before && !after) return 'removed';
  if (
    isMetricChanged(average ?? {}) ||
    isMetricChanged(weightedAverage ?? {}) ||
    isMetricChanged(guaranteedAverage ?? {}) ||
    warningDelta !== 0 ||
    errorDelta !== 0 ||
    resourceChanges.length > 0
  ) {
    return 'changed';
  }
  return 'unchanged';
};

const rowKey = (row: BuildHistoryRowSnapshot): string => row.rotationId || row.rotationName;

const buildRotationDelta = (
  before?: BuildHistoryRowSnapshot,
  after?: BuildHistoryRowSnapshot
): BuildHistoryRotationDelta => {
  const average = metricDelta(before?.total.average, after?.total.average);
  const weightedAverage = metricDelta(before?.weightedAverage, after?.weightedAverage);
  const guaranteedAverage = metricDelta(before?.guaranteed.average, after?.guaranteed.average);
  const hitDependentAverage = metricDelta(before?.hitDependent.average, after?.hitDependent.average);
  const conditionedAverage = metricDelta(before?.conditioned.average, after?.conditioned.average);
  const warningDelta = (after?.warningCount ?? 0) - (before?.warningCount ?? 0);
  const errorDelta = (after?.errorCount ?? 0) - (before?.errorCount ?? 0);
  const resourceChanges = buildResourceChanges(before?.resourcesConsumed, after?.resourcesConsumed);

  return {
    rotationId: after?.rotationId ?? before?.rotationId,
    rotationName: after?.rotationName ?? before?.rotationName ?? 'Rotação',
    status: rotationStatus(before, after, average, weightedAverage, guaranteedAverage, warningDelta, errorDelta, resourceChanges),
    average,
    weightedAverage,
    guaranteedAverage,
    hitDependentAverage,
    conditionedAverage,
    warningDelta,
    errorDelta,
    resourceChanges
  };
};

const winnerLabel: Record<keyof BuildHistorySnapshot['winners'], string> = {
  bestByAverageRotationId: 'melhor média bruta',
  bestByWeightedAverageRotationId: 'melhor média ponderada',
  bestByGuaranteedRotationId: 'melhor dano garantido'
};

export const compareBuildHistorySnapshots = (
  before: BuildHistorySnapshot,
  after: BuildHistorySnapshot
): BuildHistoryDiff => {
  const beforeRows = new Map(before.rows.map((row) => [rowKey(row), row]));
  const afterRows = new Map(after.rows.map((row) => [rowKey(row), row]));
  const keys = new Set([...beforeRows.keys(), ...afterRows.keys()]);
  const rotationDeltas = Array.from(keys)
    .map((key) => buildRotationDelta(beforeRows.get(key), afterRows.get(key)))
    .sort((left, right) => {
      const score = (delta: BuildHistoryRotationDelta) => Math.abs(delta.average.delta ?? 0) + Math.abs(delta.weightedAverage.delta ?? 0);
      return score(right) - score(left) || left.rotationName.localeCompare(right.rotationName);
    });

  const changedWinners = (Object.keys(winnerLabel) as Array<keyof BuildHistorySnapshot['winners']>)
    .filter((key) => before.winners[key] !== after.winners[key])
    .map((key) => winnerLabel[key]);

  return {
    beforeId: before.id,
    afterId: after.id,
    beforeName: before.name,
    afterName: after.name,
    levelDelta: after.character.level - before.character.level,
    classSummaryBefore: classSummary(before),
    classSummaryAfter: classSummary(after),
    addedRotations: rotationDeltas.filter((delta) => delta.status === 'added').map((delta) => delta.rotationName),
    removedRotations: rotationDeltas.filter((delta) => delta.status === 'removed').map((delta) => delta.rotationName),
    changedWinners,
    warningDelta: after.issueCount.warnings - before.issueCount.warnings,
    errorDelta: after.issueCount.errors - before.issueCount.errors,
    rotationDeltas
  };
};

const deltaText = (delta: BuildHistoryMetricDelta): string => {
  if (delta.before === undefined && delta.after === undefined) return '-';
  const prefix = delta.delta !== undefined && delta.delta > 0 ? '+' : '';
  const percent = delta.percentDelta === undefined ? '' : ` (${formatPercent(delta.percentDelta)})`;
  return `${delta.before ?? '-'} → ${delta.after ?? '-'} · ${prefix}${formatNumber(delta.delta ?? 0)}${percent}`;
};

const scenarioText = (snapshot: BuildHistorySnapshot): string => {
  const scenario: CombatScenario = {
    id: snapshot.scenario.id,
    characterId: snapshot.characterId,
    name: snapshot.scenario.name,
    combatState: {
      targetAC: snapshot.scenario.targetAC,
      targetCount: snapshot.scenario.targetCount,
      rollMode: snapshot.scenario.rollMode,
      resistanceMultiplier: snapshot.scenario.resistanceMultiplier,
      criticalGuaranteed: snapshot.scenario.criticalGuaranteed,
      critRange: snapshot.scenario.critRange
    },
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.createdAt
  };
  return describeCombatScenario(scenario);
};

export const buildHistorySnapshotMarkdown = (snapshot: BuildHistorySnapshot): string => {
  const lines = [
    `# Snapshot de build — ${snapshot.name}`,
    '',
    `Criado em: ${snapshot.createdAt}`,
    `Tipo: ${snapshot.kind}`,
    `Personagem: ${snapshot.character.name}`,
    `Nível: ${snapshot.character.level}`,
    `Classes: ${classSummary(snapshot)}`,
    `Cenário: ${snapshot.scenario.name} · ${scenarioText(snapshot)}`,
    snapshot.notes ? `Notas: ${snapshot.notes}` : undefined,
    '',
    '| Rotação | Média | Média ponderada | Garantido | Avisos/erros | Recursos |',
    '|---|---:|---:|---:|---:|---|',
    ...snapshot.rows.map((row) =>
      `| ${row.rotationName} | ${formatNumber(row.total.average)} | ${row.weightedAverage === undefined ? '-' : formatNumber(row.weightedAverage)} | ${formatNumber(row.guaranteed.average)} | ${row.warningCount}/${row.errorCount} | ${row.resourcesConsumed.length ? row.resourcesConsumed.map((resource) => `${resource.label} ×${resource.amount}`).join(', ') : '-'} |`
    ),
    '',
    `Avisos totais: ${snapshot.issueCount.warnings}`,
    `Erros totais: ${snapshot.issueCount.errors}`
  ].filter((line): line is string => line !== undefined);
  return lines.join('\n');
};

export const buildHistoryDiffMarkdown = (before: BuildHistorySnapshot, after: BuildHistorySnapshot): string => {
  const diff = compareBuildHistorySnapshots(before, after);
  const lines = [
    `# Diferença de build — ${diff.beforeName} → ${diff.afterName}`,
    '',
    `Período: ${before.createdAt} → ${after.createdAt}`,
    `Nível: ${before.character.level} → ${after.character.level} (${diff.levelDelta >= 0 ? '+' : ''}${diff.levelDelta})`,
    `Classes: ${diff.classSummaryBefore} → ${diff.classSummaryAfter}`,
    `Avisos: ${before.issueCount.warnings} → ${after.issueCount.warnings} (${diff.warningDelta >= 0 ? '+' : ''}${diff.warningDelta})`,
    `Erros: ${before.issueCount.errors} → ${after.issueCount.errors} (${diff.errorDelta >= 0 ? '+' : ''}${diff.errorDelta})`,
    diff.changedWinners.length ? `Vencedores alterados: ${diff.changedWinners.join(', ')}` : 'Vencedores alterados: nenhum',
    '',
    '| Rotação | Status | Média | Ponderada | Garantido | Acerto | Condicionado | Avisos/erros | Recursos |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|',
    ...diff.rotationDeltas.map((delta) =>
      `| ${delta.rotationName} | ${delta.status} | ${deltaText(delta.average)} | ${deltaText(delta.weightedAverage)} | ${deltaText(delta.guaranteedAverage)} | ${deltaText(delta.hitDependentAverage)} | ${deltaText(delta.conditionedAverage)} | ${delta.warningDelta >= 0 ? '+' : ''}${delta.warningDelta}/${delta.errorDelta >= 0 ? '+' : ''}${delta.errorDelta} | ${delta.resourceChanges.length ? delta.resourceChanges.map((resource) => `${resource.label}: ${resource.before}→${resource.after}`).join(', ') : '-'} |`
    )
  ];
  return lines.join('\n');
};
