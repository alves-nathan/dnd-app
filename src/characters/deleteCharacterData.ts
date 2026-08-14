import { useBuildHistoryStore } from '../store/buildHistoryStore';
import { useCharacterStore } from '../store/characterStore';
import { useCombatScenarioStore } from '../store/combatScenarioStore';

export interface DeleteCharacterDataResult {
  ok: boolean;
  characterRemoved: boolean;
  removedSnapshots: number;
  removedScenarios: number;
}

/**
 * Removes a character and all persisted entities that are owned exclusively by it.
 * Build presets are intentionally preserved because they are reusable templates and
 * are not character-owned records.
 */
export const deleteCharacterData = (characterId: string): DeleteCharacterDataResult => {
  const characterStore = useCharacterStore.getState();
  const historyStore = useBuildHistoryStore.getState();
  const scenarioStore = useCombatScenarioStore.getState();

  const existed = characterStore.characters.some((character) => character.id === characterId);
  if (!existed) {
    return { ok: false, characterRemoved: false, removedSnapshots: 0, removedScenarios: 0 };
  }

  const removedSnapshots = historyStore.snapshots.filter((snapshot) => snapshot.characterId === characterId).length;
  const removedScenarios = scenarioStore.scenarios.filter((scenario) => scenario.characterId === characterId).length;

  historyStore.removeCharacterSnapshots(characterId);
  scenarioStore.removeCharacterScenarios(characterId);
  characterStore.removeCharacter(characterId);

  const characterRemoved = !useCharacterStore.getState().characters.some((character) => character.id === characterId);
  return { ok: characterRemoved, characterRemoved, removedSnapshots, removedScenarios };
};
