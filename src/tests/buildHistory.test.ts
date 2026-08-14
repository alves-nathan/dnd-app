import { createDefaultCharacter, defaultCombatState } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { compareRotationsForScenario, createCombatScenario } from '../rules-engine/turns/compareRotations';
import {
  buildHistoryDiffMarkdown,
  buildHistorySnapshotMarkdown,
  compareBuildHistorySnapshots,
  createBuildHistorySnapshot
} from '../history/buildHistory';
import { AttackAction, TurnRotation } from '../types';

const makeAttack = (id: string, formula: string): AttackAction => ({
  id,
  type: 'attack',
  name: id,
  actionCost: 'action',
  sourceType: 'weapon',
  attackAbility: 'STR',
  damage: parseDamageFormula(formula),
  attacksCount: 1
});

const fixedNow = '2026-07-11T12:00:00.000Z';

const makeSnapshot = (formula: string, id: string, name: string) => {
  const character = createDefaultCharacter('Kael');
  const rotation: TurnRotation = {
    id: 'rot-main',
    characterId: character.id,
    name: 'Rotação principal',
    actions: [{ id: 'turn-main', name: 'Ataque', actionCost: 'action', action: makeAttack('attack-main', formula) }]
  };
  character.rotations = [rotation];
  const scenario = createCombatScenario({
    characterId: character.id,
    name: 'CA 15',
    combatState: { ...defaultCombatState, targetAC: 15 },
    id: 'scenario-history',
    now: fixedNow
  });
  const comparison = compareRotationsForScenario(character.rotations, character, scenario);
  return createBuildHistorySnapshot({ character, scenario, comparison, id, name, now: fixedNow });
};

describe('build history snapshots', () => {
  it('creates a stable snapshot from a rotation comparison', () => {
    const snapshot = makeSnapshot('1d8 + STR', 'snapshot-1', 'Antes do feat');

    expect(snapshot.character.name).toBe('Kael');
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]?.rotationName).toBe('Rotação principal');
    expect(snapshot.scenario.targetAC).toBe(15);
  });

  it('diffs damage between two snapshots', () => {
    const before = makeSnapshot('1d6 + STR', 'snapshot-before', 'Antes');
    const after = makeSnapshot('1d12 + STR', 'snapshot-after', 'Depois');

    const diff = compareBuildHistorySnapshots(before, after);

    expect(diff.rotationDeltas[0]?.status).toBe('changed');
    expect(diff.rotationDeltas[0]?.average.delta).toBeGreaterThan(0);
    expect(diff.warningDelta).toBe(0);
  });

  it('exports snapshot and diff markdown', () => {
    const before = makeSnapshot('1d6 + STR', 'snapshot-before', 'Antes');
    const after = makeSnapshot('1d12 + STR', 'snapshot-after', 'Depois');

    const snapshotMarkdown = buildHistorySnapshotMarkdown(before);
    const diffMarkdown = buildHistoryDiffMarkdown(before, after);

    expect(snapshotMarkdown).toContain('# Snapshot de build');
    expect(diffMarkdown).toContain('# Diferença de build');
    expect(diffMarkdown).toContain('Rotação principal');
  });
});
