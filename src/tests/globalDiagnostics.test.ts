import { runGlobalDiagnostics, filterGlobalDiagnosticIssues, globalDiagnosticsReportToMarkdown } from '../diagnostics/globalDiagnostics';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { createDefaultCharacter } from '../data/mockData';
import { createCombatScenario } from '../rules-engine/turns/compareRotations';
import { createBuildPresetFromCharacter } from '../presets/buildPresets';
import { createCharacterDataBackup } from '../backup/characterBackup';
import type { CompendiumImportInput } from '../compendium/schemas';

const source = { id: 'diag-source', book: 'Fonte própria', page: '12', version: '2024', status: 'active' as const, confidence: 'exact' as const };

const buildPack = (items: CompendiumImportInput['items']) =>
  buildPersistedCompendiumImport({
    id: 'diag-pack',
    source,
    items
  });

describe('globalDiagnostics', () => {
  it('returns a clean enough report for a default character and a ready compendium item', () => {
    const character = createDefaultCharacter('Diagnóstico Hero');
    const scenario = createCombatScenario({ characterId: character.id, name: 'Padrão' });
    const preset = createBuildPresetFromCharacter(character, 'Preset diagnóstico');
    const pack = buildPack([
      {
        id: 'weapon-ready',
        kind: 'weapon',
        name: 'Weapon Ready',
        source,
        payload: { damageFormula: '1d8 + STR', actionCost: 'action', attackAbility: 'STR', weaponType: 'melee' }
      }
    ]);

    const report = runGlobalDiagnostics({
      characters: [character],
      scenarios: [scenario],
      buildPresets: [preset],
      buildHistorySnapshots: [],
      compendium: { sources: [source], packs: [pack.pack], items: pack.items, enabledSourceIds: [source.id] }
    });

    expect(report.summary.characterCount).toBe(1);
    expect(report.summary.rotationCount).toBe(1);
    expect(report.summary.backupRoundtripOk).toBe(true);
    expect(report.summary.engineReadyCompendiumItemCount).toBe(1);
    expect(report.summary.errorCount).toBe(0);
  });

  it('detects orphan scenarios, resource overflow and blocked engine items', () => {
    const character = createDefaultCharacter('Problem Hero');
    character.resources = [{ id: 'res-a', name: 'Resource A', max: 1, current: 3, recharge: 'longRest' }];
    const orphanScenario = createCombatScenario({ characterId: 'missing-character', name: 'Órfão' });
    const pack = buildPack([
      {
        id: 'weapon-blocked',
        kind: 'weapon',
        name: 'Weapon Without Damage',
        source,
        payload: { weaponType: 'melee', actionCost: 'action' }
      }
    ]);

    const report = runGlobalDiagnostics({
      characters: [character],
      scenarios: [orphanScenario],
      buildPresets: [],
      buildHistorySnapshots: [],
      compendium: { sources: [source], packs: [pack.pack], items: pack.items, enabledSourceIds: [source.id] }
    });

    expect(report.issues.some((issue) => issue.code === 'RESOURCE_CURRENT_ABOVE_MAX')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'ORPHAN_SCENARIO_CHARACTER')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'ENGINE_READINESS_BLOCKED_ITEM')).toBe(true);
  });

  it('filters issues and exports markdown', () => {
    const character = createDefaultCharacter('Filter Hero');
    character.activeEffects = [
      { id: 'e1', name: 'Concentração A', kind: 'spell', sourceType: 'spell', status: 'active', concentration: true, duration: { unit: 'manual' }, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'e2', name: 'Concentração B', kind: 'spell', sourceType: 'spell', status: 'active', concentration: true, duration: { unit: 'manual' }, createdAt: '2026-01-01T00:00:00.000Z' }
    ];

    const report = runGlobalDiagnostics({
      characters: [character],
      scenarios: [],
      buildPresets: [],
      buildHistorySnapshots: [],
      compendium: { sources: [], packs: [], items: [], enabledSourceIds: [] }
    });

    const effectErrors = filterGlobalDiagnosticIssues(report, { area: 'effects', severity: 'error' });
    expect(effectErrors.some((issue) => issue.code === 'MULTIPLE_ACTIVE_CONCENTRATION_EFFECTS')).toBe(true);
    const markdown = globalDiagnosticsReportToMarkdown(report);
    expect(markdown).toContain('Diagnóstico global do D&D Combat Math');
    expect(markdown).toContain('MULTIPLE_ACTIVE_CONCENTRATION_EFFECTS');
  });

  it('catches backup roundtrip issues surfaced by backup parser', () => {
    const character = createDefaultCharacter('Backup Warnings');
    const backup = createCharacterDataBackup({ characters: [character], scenarios: [], buildPresets: [], buildHistorySnapshots: [] });
    expect(backup.summary.characterCount).toBe(1);

    const report = runGlobalDiagnostics({
      characters: [{ ...character, id: '' }],
      scenarios: [],
      buildPresets: [],
      buildHistorySnapshots: [],
      compendium: { sources: [], packs: [], items: [], enabledSourceIds: [] }
    });

    expect(report.issues.some((issue) => issue.code === 'CHARACTER_ID_MISSING')).toBe(true);
    expect(report.summary.backupRoundtripOk).toBe(false);
  });
});
