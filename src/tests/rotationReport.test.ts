import { createDefaultCharacter, defaultCombatState } from '../data/mockData';
import { compareRotationsForScenario, createCombatScenario } from '../rules-engine/turns/compareRotations';
import { buildRotationReportJson, buildRotationReportMarkdown, exportRotationReport } from '../reports/rotationReport';

const fixedNow = '2026-07-11T12:00:00.000Z';

describe('rotation reports', () => {
  it('exports a markdown report with character, scenario and rotation rows', () => {
    const character = createDefaultCharacter('Kael');
    const scenario = createCombatScenario({
      characterId: character.id,
      name: 'Mesa rápida',
      combatState: { ...defaultCombatState, targetAC: 15 },
      id: 'scenario-report',
      now: fixedNow
    });
    const comparison = compareRotationsForScenario(character.rotations, character, scenario);

    const markdown = buildRotationReportMarkdown(character, comparison, { generatedAt: fixedNow, notes: 'Teste de mesa.' });

    expect(markdown).toContain('# Relatório de comparação de rotações — Kael');
    expect(markdown).toContain('## Cenário');
    expect(markdown).toContain('| Rotação | Ataques | Média bruta |');
    expect(markdown).toContain('Teste de mesa.');
  });

  it('exports a stable JSON schema for external tools', () => {
    const character = createDefaultCharacter('Soren');
    const scenario = createCombatScenario({
      characterId: character.id,
      name: 'CA 16',
      combatState: { ...defaultCombatState, targetAC: 16 },
      id: 'scenario-json',
      now: fixedNow
    });
    const comparison = compareRotationsForScenario(character.rotations, character, scenario);

    const json = buildRotationReportJson(character, comparison, { generatedAt: fixedNow });

    expect(json.schemaVersion).toBe(1);
    expect(json.character.name).toBe('Soren');
    expect(json.scenario.targetAC).toBe(16);
    expect(json.rows.length).toBe(character.rotations.length);
  });

  it('selects filename and mime type by format', () => {
    const character = createDefaultCharacter('Seraphiel Auravita');
    const scenario = createCombatScenario({ characterId: character.id, name: 'Relatório Especial', id: 'scenario-file', now: fixedNow });
    const comparison = compareRotationsForScenario(character.rotations, character, scenario);

    const markdown = exportRotationReport({ character, comparison, format: 'markdown', options: { generatedAt: fixedNow } });
    const json = exportRotationReport({ character, comparison, format: 'json', options: { generatedAt: fixedNow } });

    expect(markdown.filename).toBe('seraphiel-auravita-relatorio-especial-2026-07-11.md');
    expect(markdown.mimeType).toBe('text/markdown');
    expect(json.filename.endsWith('.json')).toBe(true);
    expect(json.mimeType).toBe('application/json');
  });
});
