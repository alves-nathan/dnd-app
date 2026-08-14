import { useCallback } from 'react';
import type { Character, CharacterProgressionOperation } from '../types';
import { useCharacterStore } from '../store/characterStore';
import { progressionOperation } from './progressionTransaction';

export interface CharacterProgressionSession {
  character?: Character;
  persistedCharacter?: Character;
  hasActiveTransaction: boolean;
  transactionId?: string;
  recoveryStatus?: 'active' | 'recoverable' | 'conflicted';
  recoveryPending: boolean;
  updateCharacter: (
    characterId: string,
    updater: (character: Character) => Character,
    operation?: CharacterProgressionOperation
  ) => void;
  completePendingChoice: (pendingChoiceId: string, label?: string) => void;
}

export const useCharacterProgressionSession = (
  characterId?: string
): CharacterProgressionSession => {
  const persistedCharacter = useCharacterStore((state) =>
    state.characters.find((entry) => entry.id === characterId)
  );
  const draft = useCharacterStore((state) => characterId ? state.progressionDrafts[characterId] : undefined);
  const activeDraft = draft?.recovery.status === 'active' ? draft : undefined;
  const updatePublished = useCharacterStore((state) => state.updateCharacter);
  const updateDraft = useCharacterStore((state) => state.updateProgressionDraft);

  const updateCharacter = useCallback((
    id: string,
    updater: (character: Character) => Character,
    operation?: CharacterProgressionOperation
  ) => {
    if (draft && id === draft.characterId) {
      if (activeDraft) {
        updateDraft(id, updater, operation ?? progressionOperation('choice', 'Escolha atualizada durante a transação'));
      }
      return;
    }
    updatePublished(id, updater);
  }, [activeDraft, draft, updateDraft, updatePublished]);

  const completePendingChoice = useCallback((pendingChoiceId: string, label = 'Escolha pendente resolvida') => {
    if (!characterId) return;
    updateCharacter(characterId, (character) => ({
      ...character,
      pendingChoices: (character.pendingChoices ?? []).filter((choice) => choice.id !== pendingChoiceId)
    }), progressionOperation('choice', label, { pendingChoiceId }));
  }, [characterId, updateCharacter]);

  return {
    character: activeDraft ? activeDraft.workingCharacter as Character : persistedCharacter,
    persistedCharacter,
    hasActiveTransaction: Boolean(activeDraft),
    transactionId: draft?.id,
    recoveryStatus: draft?.recovery.status,
    recoveryPending: Boolean(draft && draft.recovery.status !== 'active'),
    updateCharacter,
    completePendingChoice
  };
};
