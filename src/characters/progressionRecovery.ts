import type { Character } from '../types';
import {
  characterProgressionFingerprint,
  type CharacterProgressionDraft,
  type CharacterProgressionRecoveryMetadata
} from './progressionTransaction';

export type CharacterProgressionRecoveryIssueKind = 'orphaned' | 'invalid';

export interface CharacterProgressionRecoveryIssue {
  id: string;
  kind: CharacterProgressionRecoveryIssueKind;
  characterId?: string;
  draftId?: string;
  reason: string;
  detectedAt: string;
}

export interface CharacterProgressionRecoverySummary {
  hydrated: boolean;
  reconciledAt?: string;
  recoverableCharacterIds: string[];
  conflictedCharacterIds: string[];
  issues: CharacterProgressionRecoveryIssue[];
  error?: string;
}

export interface CharacterProgressionRecoveryResult {
  drafts: Record<string, CharacterProgressionDraft>;
  summary: CharacterProgressionRecoverySummary;
}

const now = (): string => new Date().toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSnapshot = (value: unknown): value is Character =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.level === 'number' &&
  Array.isArray(value.classes);

export const isProgressionDraft = (value: unknown): value is CharacterProgressionDraft => {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' &&
    typeof value.characterId === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.baseFingerprint === 'string' &&
    isSnapshot(value.baseCharacter) &&
    isSnapshot(value.workingCharacter) &&
    Array.isArray(value.operations);
};

const normalizeRecovery = (
  draft: CharacterProgressionDraft,
  status: CharacterProgressionRecoveryMetadata['status'],
  detectedAt: string,
  reason?: string
): CharacterProgressionRecoveryMetadata => ({
  status,
  checkpointSequence: Math.max(1, Number(draft.recovery?.checkpointSequence ?? 1)),
  lastCheckpointAt: draft.recovery?.lastCheckpointAt ?? draft.updatedAt ?? draft.createdAt,
  detectedAt,
  acknowledgedAt: status === 'active' ? (draft.recovery?.acknowledgedAt ?? detectedAt) : undefined,
  reason
});

export const normalizeProgressionDraft = (
  value: CharacterProgressionDraft,
  status: CharacterProgressionRecoveryMetadata['status'] = 'active',
  detectedAt = now(),
  reason?: string
): CharacterProgressionDraft => ({
  ...value,
  schemaVersion: 1,
  recovery: normalizeRecovery(value, status, detectedAt, reason)
});

const issueId = (kind: CharacterProgressionRecoveryIssueKind, key: string, detectedAt: string): string =>
  `progressionRecovery:${kind}:${key}:${detectedAt}`;

export const reconcileProgressionRecovery = (
  characters: Character[],
  rawDrafts: Record<string, unknown> | undefined,
  priorIssues: CharacterProgressionRecoveryIssue[] = [],
  reconciledAt = now()
): CharacterProgressionRecoveryResult => {
  const characterById = new Map(characters.map((character) => [character.id, character]));
  const drafts: Record<string, CharacterProgressionDraft> = {};
  const recoverableCharacterIds: string[] = [];
  const conflictedCharacterIds: string[] = [];
  const issues = [...priorIssues];

  for (const [key, rawDraft] of Object.entries(rawDrafts ?? {})) {
    if (!isProgressionDraft(rawDraft)) {
      issues.push({
        id: issueId('invalid', key, reconciledAt),
        kind: 'invalid',
        characterId: key,
        reason: 'O registro persistido não possui a estrutura mínima de uma transação de progressão.',
        detectedAt: reconciledAt
      });
      continue;
    }

    const character = characterById.get(rawDraft.characterId);
    if (!character) {
      issues.push({
        id: issueId('orphaned', rawDraft.id, reconciledAt),
        kind: 'orphaned',
        characterId: rawDraft.characterId,
        draftId: rawDraft.id,
        reason: 'O personagem associado ao rascunho não existe mais neste dispositivo.',
        detectedAt: reconciledAt
      });
      continue;
    }

    if (key !== rawDraft.characterId || rawDraft.baseCharacter.id !== rawDraft.characterId || rawDraft.workingCharacter.id !== rawDraft.characterId) {
      issues.push({
        id: issueId('invalid', rawDraft.id, reconciledAt),
        kind: 'invalid',
        characterId: rawDraft.characterId,
        draftId: rawDraft.id,
        reason: 'Os identificadores do rascunho, da ficha-base e da ficha projetada não correspondem.',
        detectedAt: reconciledAt
      });
      continue;
    }

    const currentFingerprint = characterProgressionFingerprint(character);
    if (currentFingerprint !== rawDraft.baseFingerprint) {
      const reason = 'A ficha publicada mudou depois do último checkpoint. O rascunho foi preservado somente para inspeção e descarte.';
      drafts[key] = normalizeProgressionDraft(rawDraft, 'conflicted', reconciledAt, reason);
      conflictedCharacterIds.push(key);
      continue;
    }

    drafts[key] = normalizeProgressionDraft(
      rawDraft,
      'recoverable',
      reconciledAt,
      'Rascunho restaurado do armazenamento local após reinício ou encerramento inesperado.'
    );
    recoverableCharacterIds.push(key);
  }

  return {
    drafts,
    summary: {
      hydrated: true,
      reconciledAt,
      recoverableCharacterIds,
      conflictedCharacterIds,
      issues
    }
  };
};

export const acknowledgeRecoveredProgressionDraft = (
  draft: CharacterProgressionDraft,
  acknowledgedAt = now()
): CharacterProgressionDraft => ({
  ...draft,
  updatedAt: acknowledgedAt,
  recovery: {
    ...draft.recovery,
    status: 'active',
    acknowledgedAt,
    detectedAt: draft.recovery.detectedAt,
    reason: undefined
  }
});

export const emptyProgressionRecoverySummary = (): CharacterProgressionRecoverySummary => ({
  hydrated: false,
  recoverableCharacterIds: [],
  conflictedCharacterIds: [],
  issues: []
});
