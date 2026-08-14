import {
  Character,
  CombatScenario,
  DamageRange,
  RotationComparisonResult,
  RotationComparisonRow,
  RotationResourceSummary,
  RuleValidationIssue
} from '../types';
import { getArmorClass, getInitiative, getProficiencyBonus, getTotalLevel } from '../rules-engine/characters/derivedStats';
import { formatNumber, formatPercent } from '../utils/format';

export type RotationReportFormat = 'markdown' | 'json';

export interface RotationReportOptions {
  generatedAt?: string;
  includeActionBreakdown?: boolean;
  includeWarnings?: boolean;
  includeResources?: boolean;
  notes?: string;
}

export interface RotationReportExport {
  filename: string;
  mimeType: 'text/markdown' | 'application/json';
  content: string;
}

export interface RotationReportScenarioSummary {
  id: string;
  name: string;
  targetAC?: number;
  targetCount: number;
  rollMode: string;
  resistanceMultiplier: number;
  critRange?: number;
  criticalGuaranteed?: boolean;
  notes?: string;
}

export interface RotationReportRowSummary {
  rotationId: string;
  rotationName: string;
  actionCount: number;
  attackCount: number;
  total: DamageRange;
  weightedAverage?: number;
  guaranteed: DamageRange;
  hitDependent: DamageRange;
  conditioned: DamageRange;
  saveDependent: DamageRange;
  resourcesConsumed: RotationResourceSummary[];
  warningCount: number;
  errorCount: number;
  isBestByAverage: boolean;
  isBestByWeightedAverage: boolean;
  isBestByGuaranteed: boolean;
}

export interface RotationReportJson {
  schemaVersion: 1;
  generatedAt: string;
  app: 'dnd-combat-math-mvp';
  character: {
    id: string;
    name: string;
    level: number;
    armorClass: number;
    initiative: number;
    proficiencyBonus: number;
    classes: Array<{ id: string; name: string; level: number }>;
  };
  scenario: RotationReportScenarioSummary;
  winners: {
    bestByAverageRotationId?: string;
    bestByWeightedAverageRotationId?: string;
    bestByGuaranteedRotationId?: string;
  };
  rows: RotationReportRowSummary[];
  issues: Array<RuleValidationIssue & { rotationId: string; rotationName: string }>;
  notes?: string;
}

const safeName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'relatorio';

const scenarioSummary = (scenario: CombatScenario): RotationReportScenarioSummary => ({
  id: scenario.id,
  name: scenario.name,
  targetAC: scenario.combatState.targetAC,
  targetCount: scenario.combatState.targetCount,
  rollMode: scenario.combatState.rollMode,
  resistanceMultiplier: scenario.combatState.resistanceMultiplier,
  critRange: scenario.combatState.critRange,
  criticalGuaranteed: scenario.combatState.criticalGuaranteed,
  notes: scenario.notes
});

export const describeCombatScenario = (scenario: CombatScenario): string => {
  const state = scenario.combatState;
  const ac = state.targetAC === undefined ? 'CA não informada' : `CA ${state.targetAC}`;
  const targets = `${state.targetCount} alvo${state.targetCount === 1 ? '' : 's'}`;
  const roll = state.rollMode === 'advantage' ? 'vantagem' : state.rollMode === 'disadvantage' ? 'desvantagem' : 'rolagem normal';
  const mitigation = state.resistanceMultiplier === 0
    ? 'imunidade'
    : state.resistanceMultiplier === 0.5
      ? 'resistência'
      : state.resistanceMultiplier === 2
        ? 'vulnerabilidade'
        : 'sem ajuste de resistência';
  const crit = state.criticalGuaranteed ? 'crítico garantido' : `crítico ${state.critRange ?? 20}+`;
  return `${ac}; ${targets}; ${roll}; ${mitigation}; ${crit}`;
};

const rangeJson = (range: DamageRange): DamageRange => ({
  min: Number(formatNumber(range.min)),
  max: Number(formatNumber(range.max)),
  average: Number(formatNumber(range.average))
});

const rowSummary = (row: RotationComparisonRow, comparison: RotationComparisonResult): RotationReportRowSummary => ({
  rotationId: row.rotationId,
  rotationName: row.rotationName,
  actionCount: row.actionCount,
  attackCount: row.attackCount,
  total: rangeJson(row.total),
  weightedAverage: row.weightedAverage === undefined ? undefined : Number(formatNumber(row.weightedAverage)),
  guaranteed: rangeJson(row.guaranteed),
  hitDependent: rangeJson(row.hitDependent),
  conditioned: rangeJson(row.conditioned),
  saveDependent: rangeJson(row.saveDependent),
  resourcesConsumed: row.resourcesConsumed,
  warningCount: row.warningCount,
  errorCount: row.errorCount,
  isBestByAverage: comparison.bestByAverageRotationId === row.rotationId,
  isBestByWeightedAverage: comparison.bestByWeightedAverageRotationId === row.rotationId,
  isBestByGuaranteed: comparison.bestByGuaranteedRotationId === row.rotationId
});

const collectIssues = (comparison: RotationComparisonResult): RotationReportJson['issues'] =>
  comparison.rows.flatMap((row) =>
    row.validation.issues.map((issue) => ({
      ...issue,
      rotationId: row.rotationId,
      rotationName: row.rotationName
    }))
  );

export const buildRotationReportJson = (
  character: Character,
  comparison: RotationComparisonResult,
  options: RotationReportOptions = {}
): RotationReportJson => ({
  schemaVersion: 1,
  generatedAt: options.generatedAt ?? new Date().toISOString(),
  app: 'dnd-combat-math-mvp',
  character: {
    id: character.id,
    name: character.name,
    level: getTotalLevel(character),
    armorClass: getArmorClass(character),
    initiative: getInitiative(character),
    proficiencyBonus: getProficiencyBonus(character),
    classes: character.classes.map((characterClass) => ({
      id: characterClass.id,
      name: characterClass.name,
      level: characterClass.level
    }))
  },
  scenario: scenarioSummary(comparison.scenario),
  winners: {
    bestByAverageRotationId: comparison.bestByAverageRotationId,
    bestByWeightedAverageRotationId: comparison.bestByWeightedAverageRotationId,
    bestByGuaranteedRotationId: comparison.bestByGuaranteedRotationId
  },
  rows: comparison.rows.map((row) => rowSummary(row, comparison)),
  issues: collectIssues(comparison),
  notes: options.notes
});

const numberCell = (value: number | undefined): string => (value === undefined ? '-' : formatNumber(value));

const bestLabels = (row: RotationReportRowSummary): string => {
  const labels = [
    row.isBestByAverage ? 'média bruta' : undefined,
    row.isBestByWeightedAverage ? 'média ponderada' : undefined,
    row.isBestByGuaranteed ? 'dano garantido' : undefined
  ].filter(Boolean);
  return labels.length ? labels.join(', ') : '-';
};

const resourceText = (resources: RotationResourceSummary[]): string =>
  resources.length ? resources.map((resource) => `${resource.label} ×${resource.amount}`).join(', ') : 'Nenhum recurso limitado cadastrado';

const markdownTable = (rows: RotationReportRowSummary[]): string => {
  const header = '| Rotação | Ataques | Média bruta | Média ponderada | Mín-Máx | Garantido | Acerto | Condicionado | Save/mitigação | Melhor em | Avisos/erros |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|';
  const body = rows.map((row) =>
    `| ${row.rotationName} | ${row.attackCount} | ${numberCell(row.total.average)} | ${numberCell(row.weightedAverage)} | ${numberCell(row.total.min)}-${numberCell(row.total.max)} | ${numberCell(row.guaranteed.average)} | ${numberCell(row.hitDependent.average)} | ${numberCell(row.conditioned.average)} | ${numberCell(row.saveDependent.average)} | ${bestLabels(row)} | ${row.warningCount}/${row.errorCount} |`
  );
  return [header, ...body].join('\n');
};

const issueMarkdown = (issues: RotationReportJson['issues']): string => {
  if (!issues.length) return 'Nenhum aviso ou erro de regra registrado.';
  return issues
    .map((issue) => `- **${issue.rotationName}** · ${issue.severity.toUpperCase()} · ${issue.code}: ${issue.message}`)
    .join('\n');
};

export const buildRotationReportMarkdown = (
  character: Character,
  comparison: RotationComparisonResult,
  options: RotationReportOptions = {}
): string => {
  const report = buildRotationReportJson(character, comparison, options);
  const sortedRows = report.rows.slice().sort((left, right) => (right.weightedAverage ?? right.total.average) - (left.weightedAverage ?? left.total.average));
  const weightedRows = sortedRows.filter((row) => row.weightedAverage !== undefined);
  const weightedCoverage = sortedRows.length ? weightedRows.length / sortedRows.length : 0;

  const lines = [
    `# Relatório de comparação de rotações — ${report.character.name}`,
    '',
    `Gerado em: ${report.generatedAt}`,
    '',
    '## Personagem',
    '',
    `- Nível total: ${report.character.level}`,
    `- Classes: ${report.character.classes.map((item) => `${item.name} ${item.level}`).join(' / ') || '-'}`,
    `- Proficiência: +${report.character.proficiencyBonus}`,
    `- CA: ${report.character.armorClass}`,
    `- Iniciativa: ${report.character.initiative >= 0 ? '+' : ''}${report.character.initiative}`,
    '',
    '## Cenário',
    '',
    `- Nome: ${report.scenario.name}`,
    `- Parâmetros: ${describeCombatScenario(comparison.scenario)}`,
    report.scenario.notes ? `- Notas: ${report.scenario.notes}` : undefined,
    '',
    '## Resumo comparativo',
    '',
    markdownTable(sortedRows),
    '',
    `Cobertura de média ponderada: ${formatPercent(weightedCoverage)} das rotações. Quando a média ponderada está vazia, falta CA, bônus de ataque calculável ou a ação usa regra de save ainda não configurada.`,
    '',
    '## Recursos consumidos',
    '',
    ...sortedRows.map((row) => `- **${row.rotationName}:** ${resourceText(row.resourcesConsumed)}`),
    '',
    '## Avisos e conflitos',
    '',
    issueMarkdown(report.issues),
    '',
    '## Detalhe por rotação',
    '',
    ...sortedRows.flatMap((row) => [
      `### ${row.rotationName}`,
      '',
      `- Ações: ${row.actionCount}`,
      `- Ataques/efeitos: ${row.attackCount}`,
      `- Dano mínimo/máximo/médio: ${numberCell(row.total.min)} / ${numberCell(row.total.max)} / ${numberCell(row.total.average)}`,
      `- Média ponderada por acerto: ${numberCell(row.weightedAverage)}`,
      `- Dano garantido médio: ${numberCell(row.guaranteed.average)}`,
      `- Dano dependente de acerto médio: ${numberCell(row.hitDependent.average)}`,
      `- Dano condicionado médio: ${numberCell(row.conditioned.average)}`,
      `- Dano dependente de save/mitigação médio: ${numberCell(row.saveDependent.average)}`,
      `- Recursos: ${resourceText(row.resourcesConsumed)}`,
      ''
    ]),
    options.notes ? '## Notas do relatório' : undefined,
    options.notes ? '' : undefined,
    options.notes,
    '',
    '---',
    'Relatório gerado localmente. O app não embute regras oficiais; resultados dependem dos dados manuais/importados e validados pelo usuário.'
  ].filter((line): line is string => line !== undefined);

  return lines.join('\n');
};

export const exportRotationReport = (params: {
  character: Character;
  comparison: RotationComparisonResult;
  format: RotationReportFormat;
  options?: RotationReportOptions;
}): RotationReportExport => {
  const generatedAt = params.options?.generatedAt ?? new Date().toISOString();
  const filenameBase = `${safeName(params.character.name)}-${safeName(params.comparison.scenario.name)}-${generatedAt.slice(0, 10)}`;

  if (params.format === 'json') {
    return {
      filename: `${filenameBase}.json`,
      mimeType: 'application/json',
      content: JSON.stringify(buildRotationReportJson(params.character, params.comparison, { ...params.options, generatedAt }), null, 2)
    };
  }

  return {
    filename: `${filenameBase}.md`,
    mimeType: 'text/markdown',
    content: buildRotationReportMarkdown(params.character, params.comparison, { ...params.options, generatedAt })
  };
};
