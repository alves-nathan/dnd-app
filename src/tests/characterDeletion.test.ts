import fs from 'fs';
import path from 'path';
import type { BuildHistorySnapshot } from '../types';
import { deleteCharacterData } from '../characters/deleteCharacterData';
import { useBuildHistoryStore } from '../store/buildHistoryStore';
import { useCharacterStore } from '../store/characterStore';
import { useCombatScenarioStore } from '../store/combatScenarioStore';

const historySnapshot = (characterId: string): BuildHistorySnapshot => ({
  id: `snapshot-${characterId}`,
  characterId,
  name: 'Antes da exclusão',
  kind: 'manual',
  createdAt: '2026-08-10T12:00:00.000Z',
  character: {
    name: 'Teste',
    level: 1,
    classes: [],
    weaponCount: 0,
    spellCount: 0,
    featureCount: 0,
    featCount: 0,
    compendiumLinkCount: 0
  },
  scenario: {
    id: `scenario-${characterId}`,
    name: 'Alvo padrão',
    targetCount: 1,
    rollMode: 'normal',
    resistanceMultiplier: 1
  },
  rows: [],
  winners: {},
  issueCount: { warnings: 0, errors: 0 }
});

describe('character deletion', () => {
  beforeEach(() => {
    useCharacterStore.setState({
      characters: [],
      progressionDrafts: {},
      compatibilityRemediationPlans: {},
      compatibilityRemediationQuarantine: {}
    });
    useBuildHistoryStore.setState({ snapshots: [] });
    useCombatScenarioStore.setState({ scenarios: [] });
  });

  it('removes the character and character-owned persisted data', () => {
    const character = useCharacterStore.getState().addCharacter('Excluir');
    useCombatScenarioStore.getState().ensureDefaultScenario(character.id);
    useBuildHistoryStore.getState().addSnapshot(historySnapshot(character.id));

    const result = deleteCharacterData(character.id);

    expect(result).toEqual({ ok: true, characterRemoved: true, removedSnapshots: 1, removedScenarios: 1 });
    expect(useCharacterStore.getState().characters.some((entry) => entry.id === character.id)).toBe(false);
    expect(useCombatScenarioStore.getState().scenarios.some((entry) => entry.characterId === character.id)).toBe(false);
    expect(useBuildHistoryStore.getState().snapshots.some((entry) => entry.characterId === character.id)).toBe(false);
  });

  it('does not report success for an unknown character', () => {
    expect(deleteCharacterData('missing-character')).toEqual({
      ok: false,
      characterRemoved: false,
      removedSnapshots: 0,
      removedScenarios: 0
    });
  });

  it('uses an in-app confirmation instead of Alert.alert so deletion works on web', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'app/characters/[id]/index.tsx'), 'utf8');

    expect(source).toContain('testID="delete-character-button"');
    expect(source).toContain('testID="delete-character-confirmation"');
    expect(source).toContain('testID="confirm-delete-character"');
    expect(source).toContain('deleteCharacterData(character.id)');
    expect(source).not.toContain("Alert.alert('Excluir personagem?'");
  });
});
