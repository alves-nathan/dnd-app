import { runBetaDataSafetyRehearsal } from '../release/betaDataSafety';
import { createDefaultCharacter } from '../data/mockData';
import { createCombatScenario } from '../rules-engine/turns/compareRotations';
import { createBuildPresetFromCharacter } from '../presets/buildPresets';
import { createBuildHistorySnapshot } from '../history/buildHistory';
import { compareRotationsForScenario } from '../rules-engine/turns/compareRotations';
import { CHARACTER_STORE_VERSION } from '../storage/characterMigrations';

const buildEntities = () => {
  const character = createDefaultCharacter('Beta Safety');
  const scenario = createCombatScenario({
    id: 'beta-scenario',
    characterId: character.id,
    name: 'Beta scenario',
    combatState: { targetAC: 15, targetCount: 1, resistanceMultiplier: 1, rollMode: 'normal' }
  });
  const preset = createBuildPresetFromCharacter(character, 'Beta preset');
  const comparison = compareRotationsForScenario(character.rotations, character, scenario);
  const snapshot = createBuildHistorySnapshot({
    character,
    scenario,
    comparison,
    name: 'Beta snapshot',
    kind: 'manual'
  });

  return {
    characters: [character],
    scenarios: [scenario],
    buildPresets: [preset],
    buildHistorySnapshots: [snapshot]
  };
};

describe('beta data safety rehearsal', () => {
  it('passes integrity, isolated restore, references and every migration version', () => {
    const report = runBetaDataSafetyRehearsal(buildEntities(), '2026-07-14T00:00:00.000Z');

    expect(report.status).toBe('passed');
    expect(report.checks.every((entry) => entry.passed)).toBe(true);
    expect(report.migrations).toHaveLength(CHARACTER_STORE_VERSION + 1);
    expect(report.migrations.every((entry) => entry.passed)).toBe(true);
    expect(report.summary.characterCount).toBe(1);
  });

  it('also supports an empty installation rehearsal', () => {
    const report = runBetaDataSafetyRehearsal({
      characters: [],
      scenarios: [],
      buildPresets: [],
      buildHistorySnapshots: []
    });

    expect(report.status).toBe('passed');
    expect(report.summary.characterCount).toBe(0);
  });
});
