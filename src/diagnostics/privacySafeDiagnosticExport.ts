import type { GlobalDiagnosticReport } from './globalDiagnostics';
import type { CompendiumPersistenceState } from '../storage/compendiumSnapshot';

export interface PrivacySafeDiagnosticExport {
  format: 'dnd-combat-privacy-safe-diagnostic.v1';
  generatedAt: string;
  health: {
    score: number;
    errors: number;
    warnings: number;
    infos: number;
    backupRoundtripOk: boolean;
  };
  inventory: {
    characters: number;
    rotations: number;
    scenarios: number;
    compendiumSources: number;
    enabledSources: number;
    compendiumPacks: number;
    compendiumItems: number;
    validatedItems: number;
    itemsByType: Record<string, number>;
    itemsByStatus: Record<string, number>;
  };
  issuesByCode: Array<{ area: string; severity: string; code: string; count: number }>;
  privacy: {
    includesNames: false;
    includesIds: false;
    includesRulesText: false;
    includesRawCompendium: false;
    includesCharacterBuildDetails: false;
  };
}

const countBy = <T>(values: T[], key: (value: T) => string): Record<string, number> =>
  values.reduce<Record<string, number>>((counts, value) => {
    const resolved = key(value);
    counts[resolved] = (counts[resolved] ?? 0) + 1;
    return counts;
  }, {});

export const createPrivacySafeDiagnosticExport = (
  report: GlobalDiagnosticReport,
  compendium: CompendiumPersistenceState
): PrivacySafeDiagnosticExport => {
  const issueCounts = new Map<string, PrivacySafeDiagnosticExport['issuesByCode'][number]>();
  for (const issue of report.issues) {
    const key = `${issue.area}:${issue.severity}:${issue.code}`;
    const current = issueCounts.get(key);
    if (current) current.count += 1;
    else issueCounts.set(key, { area: issue.area, severity: issue.severity, code: issue.code, count: 1 });
  }

  return {
    format: 'dnd-combat-privacy-safe-diagnostic.v1',
    generatedAt: report.summary.generatedAt,
    health: {
      score: report.summary.healthScore,
      errors: report.summary.errorCount,
      warnings: report.summary.warningCount,
      infos: report.summary.infoCount,
      backupRoundtripOk: report.summary.backupRoundtripOk
    },
    inventory: {
      characters: report.summary.characterCount,
      rotations: report.summary.rotationCount,
      scenarios: report.summary.scenarioCount,
      compendiumSources: compendium.sources.length,
      enabledSources: compendium.enabledSourceIds.length,
      compendiumPacks: compendium.packs.length,
      compendiumItems: compendium.items.length,
      validatedItems: report.summary.validatedCompendiumItemCount,
      itemsByType: countBy(compendium.items, (item) => item.type),
      itemsByStatus: countBy(compendium.items, (item) => item.status)
    },
    issuesByCode: Array.from(issueCounts.values()).sort((left, right) =>
      `${left.area}:${left.severity}:${left.code}`.localeCompare(`${right.area}:${right.severity}:${right.code}`)
    ),
    privacy: {
      includesNames: false,
      includesIds: false,
      includesRulesText: false,
      includesRawCompendium: false,
      includesCharacterBuildDetails: false
    }
  };
};

export const privacySafeDiagnosticToMarkdown = (diagnostic: PrivacySafeDiagnosticExport): string => {
  const typeSummary = Object.entries(diagnostic.inventory.itemsByType).map(([type, count]) => `${type}: ${count}`).join(' · ') || 'vazio';
  const statusSummary = Object.entries(diagnostic.inventory.itemsByStatus).map(([status, count]) => `${status}: ${count}`).join(' · ') || 'vazio';
  return [
    '# Diagnóstico D&D Combat — exportação sem conteúdo privado',
    '',
    `Gerado em: ${diagnostic.generatedAt}`,
    `Saúde: ${diagnostic.health.score}/100 · ${diagnostic.health.errors} erro(s) · ${diagnostic.health.warnings} aviso(s) · ${diagnostic.health.infos} info(s)`,
    `Inventário: ${diagnostic.inventory.characters} personagem(ns) · ${diagnostic.inventory.rotations} rotação(ões) · ${diagnostic.inventory.scenarios} cenário(s)`,
    `Compêndio: ${diagnostic.inventory.compendiumSources} fonte(s), ${diagnostic.inventory.enabledSources} ativa(s), ${diagnostic.inventory.compendiumPacks} pacote(s), ${diagnostic.inventory.compendiumItems} item(ns)`,
    `Tipos: ${typeSummary}`,
    `Status: ${statusSummary}`,
    '',
    '## Problemas agregados por código',
    ...(diagnostic.issuesByCode.length
      ? diagnostic.issuesByCode.map((entry) => `- ${entry.severity.toUpperCase()} · ${entry.area} · ${entry.code}: ${entry.count}`)
      : ['- Nenhum problema registrado.']),
    '',
    '## Privacidade',
    '- Não inclui nomes, IDs, texto de regras, payloads do compêndio ou detalhes da build dos personagens.',
    '- Nenhum dado é enviado automaticamente; este relatório só sai do dispositivo quando o usuário escolhe compartilhar.'
  ].join('\n');
};
