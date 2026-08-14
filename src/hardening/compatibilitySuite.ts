import type { BuildHistorySnapshot, Character, CombatScenario, RuleValidationIssue } from '../types';
import type { BuildPreset } from '../presets/buildPresets';
import type { CompendiumPersistenceState } from '../storage/compendiumSnapshot';
import { createExampleLibraryBundle, exampleCharacterBackupJson, exampleCompendiumImportJson } from '../fixtures/exampleLibrary';
import { validateCompendiumJson, buildPersistedCompendiumImport } from '../compendium/importer';
import { buildCompendiumPackageExport } from '../compendium/packageExport';
import { buildEngineReadinessReport } from '../compendium/engineReadiness';
import { runGlobalDiagnostics } from '../diagnostics/globalDiagnostics';
import { createCharacterDataBackup, parseCharacterDataBackup, restoreCharacterDataBackup } from '../backup/characterBackup';
import { analyzeTurnRotation } from '../rules-engine/turns/analyzeTurn';
import { createCombatScenario } from '../rules-engine/turns/compareRotations';
import { buildTableModeSummary } from '../table/tableMode';
import { defaultCombatState } from '../data/mockData';

export type CompatibilityCheckArea =
  | 'fixtures'
  | 'import'
  | 'export'
  | 'backup'
  | 'engine'
  | 'diagnostics'
  | 'tableMode'
  | 'compendium'
  | 'qualityGate';

export type CompatibilityCheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CompatibilityCheckResult {
  id: string;
  area: CompatibilityCheckArea;
  status: CompatibilityCheckStatus;
  title: string;
  message: string;
  issues: RuleValidationIssue[];
  durationMs: number;
  suggestedAction?: string;
}

export interface CompatibilitySuiteInput {
  characters: Character[];
  scenarios: CombatScenario[];
  buildPresets: BuildPreset[];
  buildHistorySnapshots: BuildHistorySnapshot[];
  compendium: CompendiumPersistenceState;
}

export interface CompatibilitySuiteSummary {
  generatedAt: string;
  status: CompatibilityCheckStatus;
  totalChecks: number;
  passed: number;
  warnings: number;
  failed: number;
  skipped: number;
  readinessScore: number;
  nextReleaseGate: 'ready' | 'needsReview' | 'blocked';
}

export interface CompatibilitySuiteReport {
  summary: CompatibilitySuiteSummary;
  checks: CompatibilityCheckResult[];
}

const issue = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({ severity, code, message });

const emptyCompendium = (): CompendiumPersistenceState => ({
  sources: [],
  packs: [],
  items: [],
  enabledSourceIds: []
});

const duration = (started: number): number => Date.now() - started;

const statusFromIssues = (issues: RuleValidationIssue[], emptyStatus: CompatibilityCheckStatus = 'pass'): CompatibilityCheckStatus => {
  if (!issues.length) return emptyStatus;
  if (issues.some((entry) => entry.severity === 'error')) return 'fail';
  if (issues.some((entry) => entry.severity === 'warning')) return 'warn';
  return emptyStatus;
};

const safeCheck = (
  id: string,
  area: CompatibilityCheckArea,
  title: string,
  callback: () => Omit<CompatibilityCheckResult, 'id' | 'area' | 'title' | 'durationMs'>
): CompatibilityCheckResult => {
  const started = Date.now();
  try {
    const result = callback();
    return { id, area, title, durationMs: duration(started), ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id,
      area,
      title,
      durationMs: duration(started),
      status: 'fail',
      message: `Falha inesperada: ${message}`,
      issues: [issue('error', 'COMPATIBILITY_CHECK_THROWN', message)],
      suggestedAction: 'Corrija a exceção antes de preparar dev build ou release.'
    };
  }
};

const defaultScenarioFor = (character: Character): CombatScenario =>
  createCombatScenario({
    id: `compat_default_${character.id}`,
    characterId: character.id,
    name: 'Compatibilidade padrão',
    combatState: defaultCombatState
  });

const findScenarioFor = (character: Character, scenarios: CombatScenario[]): CombatScenario =>
  scenarios.find((scenario) => scenario.characterId === character.id) ?? defaultScenarioFor(character);

const scoreFor = (checks: CompatibilityCheckResult[]): number => {
  if (!checks.length) return 0;
  const max = checks.length * 100;
  const value = checks.reduce((sum, check) => {
    if (check.status === 'pass') return sum + 100;
    if (check.status === 'warn') return sum + 65;
    if (check.status === 'skip') return sum + 35;
    return sum;
  }, 0);
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
};

const summarizeStatus = (checks: CompatibilityCheckResult[]): CompatibilityCheckStatus => {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  if (checks.every((check) => check.status === 'skip')) return 'skip';
  return 'pass';
};

const nextReleaseGate = (checks: CompatibilityCheckResult[]): CompatibilitySuiteSummary['nextReleaseGate'] => {
  if (checks.some((check) => check.status === 'fail')) return 'blocked';
  if (checks.some((check) => check.status === 'warn')) return 'needsReview';
  return 'ready';
};

const buildSummary = (checks: CompatibilityCheckResult[]): CompatibilitySuiteSummary => ({
  generatedAt: new Date().toISOString(),
  status: summarizeStatus(checks),
  totalChecks: checks.length,
  passed: checks.filter((check) => check.status === 'pass').length,
  warnings: checks.filter((check) => check.status === 'warn').length,
  failed: checks.filter((check) => check.status === 'fail').length,
  skipped: checks.filter((check) => check.status === 'skip').length,
  readinessScore: scoreFor(checks),
  nextReleaseGate: nextReleaseGate(checks)
});

export const runCompatibilitySuite = (input: CompatibilitySuiteInput): CompatibilitySuiteReport => {
  const compendium = input.compendium ?? emptyCompendium();
  const checks: CompatibilityCheckResult[] = [];

  checks.push(safeCheck('fixtures.exampleLibrary', 'fixtures', 'Biblioteca de exemplos íntegra', () => {
    const bundle = createExampleLibraryBundle();
    const issues: RuleValidationIssue[] = [];
    if (!bundle.characters.length) issues.push(issue('error', 'FIXTURE_NO_CHARACTERS', 'A biblioteca de exemplos não criou personagens.'));
    if (!bundle.compendiumImport.items.length) issues.push(issue('error', 'FIXTURE_NO_COMPENDIUM_ITEMS', 'A biblioteca de exemplos não criou itens de compêndio.'));
    if (!bundle.characterBackup.entities.characters.length) issues.push(issue('error', 'FIXTURE_NO_BACKUP_CHARACTERS', 'O backup exemplo não contém personagens.'));
    return {
      status: statusFromIssues(issues),
      message: issues.length ? 'A biblioteca de exemplos precisa de revisão.' : `${bundle.characters.length} personagem(ns) e ${bundle.compendiumImport.items.length} item(ns) de compêndio prontos para testes.`,
      issues,
      suggestedAction: issues.length ? 'Revise src/fixtures/exampleLibrary.ts.' : undefined
    };
  }));

  checks.push(safeCheck('import.exampleCompendium', 'import', 'Importação JSON exemplo validável', () => {
    const preview = validateCompendiumJson(exampleCompendiumImportJson());
    return {
      status: statusFromIssues(preview.issues, preview.ok ? 'pass' : 'fail'),
      message: preview.ok ? 'Template de compêndio exemplo é aceito pelo importador.' : 'Template de compêndio exemplo falhou na validação.',
      issues: preview.issues,
      suggestedAction: preview.ok ? undefined : 'Ajuste docs/import-templates e src/fixtures/exampleLibrary.ts para o schema atual.'
    };
  }));

  checks.push(safeCheck('backup.exampleRoundtrip', 'backup', 'Backup exemplo parseável e restaurável', () => {
    const parsed = parseCharacterDataBackup(exampleCharacterBackupJson());
    if (!parsed.ok || !parsed.backup) {
      return { status: 'fail', message: 'Backup exemplo não pôde ser parseado.', issues: parsed.issues, suggestedAction: 'Corrija createExampleLibraryBundle ou characterBackup.ts.' };
    }
    const restored = restoreCharacterDataBackup({ characters: [], scenarios: [], buildPresets: [], buildHistorySnapshots: [] }, parsed.backup, { mode: 'replaceAll' });
    const issues = [...parsed.issues, ...restored.issues];
    if (!restored.characters.length) issues.push(issue('error', 'BACKUP_RESTORE_EMPTY', 'Restauração do backup exemplo não retornou personagens.'));
    return {
      status: statusFromIssues(issues, restored.ok ? 'pass' : 'fail'),
      message: restored.ok ? `${restored.characters.length} personagem(ns) restaurado(s) do backup exemplo.` : 'Restauração do backup exemplo falhou.',
      issues,
      suggestedAction: restored.ok ? undefined : 'Revise o contrato dnd-combat-character-backup.v1.'
    };
  }));

  checks.push(safeCheck('diagnostics.currentData', 'diagnostics', 'Diagnóstico global sem erro bloqueante', () => {
    const report = runGlobalDiagnostics({
      characters: input.characters,
      scenarios: input.scenarios,
      buildPresets: input.buildPresets,
      buildHistorySnapshots: input.buildHistorySnapshots,
      compendium
    });
    const issues: RuleValidationIssue[] = report.issues.map((entry) => ({ severity: entry.severity, code: entry.code, message: entry.message }));
    return {
      status: report.summary.errorCount > 0 ? 'fail' : report.summary.warningCount > 0 ? 'warn' : 'pass',
      message: `Health score ${report.summary.healthScore}/100 · ${report.summary.errorCount} erro(s), ${report.summary.warningCount} aviso(s).`,
      issues,
      suggestedAction: report.summary.errorCount || report.summary.warningCount ? 'Abra Diagnóstico global para corrigir os pontos antes da release.' : undefined
    };
  }));

  checks.push(safeCheck('engine.currentRotations', 'engine', 'Rotações atuais analisáveis pela engine', () => {
    const issues: RuleValidationIssue[] = [];
    let rotationCount = 0;
    for (const character of input.characters) {
      const scenario = findScenarioFor(character, input.scenarios);
      for (const rotation of character.rotations ?? []) {
        rotationCount += 1;
        const analysis = analyzeTurnRotation(rotation, character, scenario.combatState);
        issues.push(...analysis.validation.issues, ...analysis.resourceAvailability.issues, ...analysis.spellSlotAvailability.issues, ...analysis.actions.flatMap((action) => action.warnings));
      }
    }
    if (rotationCount === 0) {
      return { status: 'skip', message: 'Nenhuma rotação local para testar.', issues: [], suggestedAction: 'Use a Biblioteca de exemplos ou crie rotações para testar a engine.' };
    }
    return {
      status: statusFromIssues(issues),
      message: `${rotationCount} rotação(ões) analisada(s) pela engine.`,
      issues,
      suggestedAction: issues.some((entry) => entry.severity !== 'info') ? 'Abra cada rotação com aviso/erro e corrija conflitos de ação, recurso ou slot.' : undefined
    };
  }));

  checks.push(safeCheck('tableMode.currentCharacters', 'tableMode', 'Modo mesa consegue resumir personagens', () => {
    const issues: RuleValidationIssue[] = [];
    if (!input.characters.length) return { status: 'skip', message: 'Nenhum personagem local para resumir em modo mesa.', issues: [] };
    for (const character of input.characters) {
      const scenario = findScenarioFor(character, input.scenarios);
      const summary = buildTableModeSummary(character, scenario);
      issues.push(...summary.quickWarnings);
    }
    return {
      status: statusFromIssues(issues),
      message: `${input.characters.length} personagem(ns) resumido(s) no modo mesa.`,
      issues,
      suggestedAction: issues.length ? 'Revise cards bloqueados/avisos no modo mesa.' : undefined
    };
  }));

  checks.push(safeCheck('compendium.readiness', 'compendium', 'Compêndio compatível com pré-engine', () => {
    const report = buildEngineReadinessReport({ items: compendium.items, sources: compendium.sources, packs: compendium.packs, enabledSourceIds: compendium.enabledSourceIds });
    if (!compendium.items.length) return { status: 'skip', message: 'Compêndio vazio. Nada para validar.', issues: [] };
    const issues: RuleValidationIssue[] = report.items
      .filter((item) => item.status === 'blocked')
      .map((entry) => issue('error', 'COMPENDIUM_ITEM_BLOCKED_FOR_ENGINE', `${entry.item.name}: ${entry.issues.map((itemIssue) => itemIssue.message).join('; ')}`));
    report.items
      .filter((entry) => entry.status === 'partial')
      .forEach((entry) => issues.push(issue('warning', 'COMPENDIUM_ITEM_PARTIAL_FOR_ENGINE', `${entry.item.name}: ${entry.issues.map((itemIssue) => itemIssue.message).join('; ')}`)));
    return {
      status: statusFromIssues(issues),
      message: `${report.summary.readyItems} pronto(s), ${report.summary.partialItems} parcial(is), ${report.summary.blockedItems} bloqueado(s).`,
      issues,
      suggestedAction: issues.length ? 'Use Prontidão pré-engine e Fila de revisão para completar os mapeamentos.' : undefined
    };
  }));

  checks.push(safeCheck('export.currentCompendium', 'export', 'Exportação do compêndio reimportável', () => {
    if (!compendium.items.length) return { status: 'skip', message: 'Compêndio vazio. Exportação ignorada.', issues: [] };
    const result = buildCompendiumPackageExport(compendium, { includeReviewMetadata: true, includeOriginalSourceMetadata: true, includeDisabledItems: false });
    return {
      status: statusFromIssues(result.issues, result.ok ? 'pass' : 'fail'),
      message: result.ok ? `${result.summary.exportedItemCount} item(ns) exportáveis e reimportáveis.` : 'Exportação do compêndio falhou.',
      issues: result.issues,
      suggestedAction: result.ok ? undefined : 'Corrija itens/pacotes sem metadados antes de exportar.'
    };
  }));

  checks.push(safeCheck('backup.currentRoundtrip', 'backup', 'Backup atual parseável', () => {
    const backup = createCharacterDataBackup(
      {
        characters: input.characters,
        scenarios: input.scenarios,
        buildPresets: input.buildPresets,
        buildHistorySnapshots: input.buildHistorySnapshots
      },
      { metadata: { name: 'Compatibility smoke backup', exportedBy: 'compatibility-suite' } }
    );
    const parsed = parseCharacterDataBackup(JSON.stringify(backup));
    return {
      status: statusFromIssues(parsed.issues, parsed.ok ? 'pass' : 'fail'),
      message: parsed.ok ? `${backup.summary.characterCount} personagem(ns) coberto(s) pelo backup smoke.` : 'Backup smoke não é parseável.',
      issues: parsed.issues,
      suggestedAction: parsed.ok ? undefined : 'Revise characterBackup.ts antes de gerar release.'
    };
  }));

  checks.push(safeCheck('quality.releaseGate', 'qualityGate', 'Gate de release/dev build', () => {
    const failed = checks.filter((check) => check.status === 'fail');
    const warnings = checks.filter((check) => check.status === 'warn');
    const issues: RuleValidationIssue[] = [
      ...failed.map((check) => issue('error', `GATE_FAIL_${check.id}`, `${check.title}: ${check.message}`)),
      ...warnings.map((check) => issue('warning', `GATE_WARN_${check.id}`, `${check.title}: ${check.message}`))
    ];
    return {
      status: failed.length ? 'fail' : warnings.length ? 'warn' : 'pass',
      message: failed.length ? `${failed.length} check(s) bloqueiam release.` : warnings.length ? `${warnings.length} check(s) exigem revisão antes da release.` : 'Gate lógico pronto para dev build.',
      issues,
      suggestedAction: failed.length || warnings.length ? 'Corrija falhas e revise warnings antes da Fase 28.' : undefined
    };
  }));

  return { summary: buildSummary(checks), checks };
};

export const compatibilityReportToMarkdown = (report: CompatibilitySuiteReport): string => {
  const lines = [
    '# Relatório de hardening e compatibilidade',
    '',
    `Gerado em: ${report.summary.generatedAt}`,
    `Status: ${report.summary.status}`,
    `Gate: ${report.summary.nextReleaseGate}`,
    `Score: ${report.summary.readinessScore}/100`,
    `Checks: ${report.summary.passed} pass · ${report.summary.warnings} warn · ${report.summary.failed} fail · ${report.summary.skipped} skip`,
    '',
    '## Checks',
    ''
  ];

  for (const check of report.checks) {
    lines.push(`### ${check.status.toUpperCase()} · ${check.title}`);
    lines.push(`Área: ${check.area} · ID: ${check.id} · ${check.durationMs}ms`);
    lines.push('');
    lines.push(check.message);
    if (check.suggestedAction) lines.push(`Ação sugerida: ${check.suggestedAction}`);
    if (check.issues.length) {
      lines.push('');
      lines.push('Issues:');
      check.issues.slice(0, 50).forEach((entry) => lines.push(`- ${entry.severity.toUpperCase()} ${entry.code}: ${entry.message}`));
      if (check.issues.length > 50) lines.push(`- ... mais ${check.issues.length - 50} issue(s)`);
    }
    lines.push('');
  }

  return lines.join('\n');
};

export const createCompatibilitySuiteInputFromExamples = (): CompatibilitySuiteInput => {
  const bundle = createExampleLibraryBundle();
  const persisted = buildPersistedCompendiumImport(bundle.compendiumImport, { importedAt: '2026-07-11T12:00:00.000Z' });

  /*
   * A fonte permanece manual/fictícia para que os fluxos de importação
   * continuem gerando warnings. Entretanto, a fixture de hardening é
   * conhecida e revisada pelo próprio projeto, então seus itens podem
   * ser aprovados para os testes de integração com a engine.
   */
  const approvedFixtureItems = persisted.items.map((item) => ({
    ...item,
    status: 'validated' as const,
    reviewDecision: 'approved' as const,
    reviewNotes:
      item.reviewNotes ??
      'Fixture fictícia revisada e aprovada para a suíte de compatibilidade.'
  }));

  return {
    characters: bundle.characters,
    scenarios: bundle.scenarios,
    buildPresets: bundle.buildPresets,
    buildHistorySnapshots: bundle.buildHistorySnapshots,
    compendium: {
      sources: [persisted.source],
      packs: [persisted.pack],
      items: approvedFixtureItems,
      enabledSourceIds: [persisted.source.id]
    }
  };
};
