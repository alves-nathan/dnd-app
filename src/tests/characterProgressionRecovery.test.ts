import { createEmptyCharacter } from '../data/mockData';
import {
  commitProgressionDraft,
  createProgressionDraft,
  progressionOperation,
  updateProgressionDraft,
  validateProgressionDraft
} from '../characters/progressionTransaction';
import {
  acknowledgeRecoveredProgressionDraft,
  reconcileProgressionRecovery
} from '../characters/progressionRecovery';
import type { Character } from '../types';

const publishedCharacter = (): Character => ({
  ...createEmptyCharacter('Recovery Wizard'),
  id: 'character-recovery',
  level: 1,
  catalogSnapshotId: 'catalog-4.8.0-test',
  classes: [{
    id: 'class-wizard',
    name: 'Wizard',
    level: 1,
    source: { id: 'test', status: 'active', confidence: 'exact' }
  }]
});

const activeDraft = (character = publishedCharacter()) => createProgressionDraft({
  character,
  workingCharacter: {
    ...character,
    level: 2,
    classes: character.classes.map((entry) => ({ ...entry, level: 2 }))
  },
  operations: [progressionOperation('levelUp', 'Wizard 1 → 2')]
});

describe('APP-06 progression recovery', () => {
  it('marks a persisted draft as recoverable and requires acknowledgement', () => {
    const character = publishedCharacter();
    const draft = activeDraft(character);
    const recovery = reconcileProgressionRecovery([character], { [character.id]: draft }, [], '2026-08-04T00:00:00.000Z');
    const restored = recovery.drafts[character.id]!;

    expect(restored.recovery.status).toBe('recoverable');
    expect(recovery.summary.recoverableCharacterIds).toEqual([character.id]);
    expect(validateProgressionDraft(restored, character).blockingIssues.some((entry) => entry.code === 'PROGRESSION_TRANSACTION_RECOVERY_ACK_REQUIRED')).toBe(true);

    const acknowledged = acknowledgeRecoveredProgressionDraft(restored, '2026-08-04T00:01:00.000Z');
    expect(acknowledged.recovery.status).toBe('active');
    expect(commitProgressionDraft(character, acknowledged).ok).toBe(true);
  });

  it('isolates a conflicting draft instead of applying it to a changed character', () => {
    const character = publishedCharacter();
    const draft = activeDraft(character);
    const edited = { ...character, notes: 'Changed after checkpoint' };
    const recovery = reconcileProgressionRecovery([edited], { [character.id]: draft });
    const restored = recovery.drafts[character.id]!;

    expect(restored.recovery.status).toBe('conflicted');
    expect(recovery.summary.conflictedCharacterIds).toEqual([character.id]);
    expect(commitProgressionDraft(edited, restored).ok).toBe(false);
  });

  it('quarantines orphaned and structurally invalid records', () => {
    const character = publishedCharacter();
    const orphan = activeDraft(character);
    const recovery = reconcileProgressionRecovery([], {
      [character.id]: orphan,
      invalid: { id: 'broken' }
    });

    expect(Object.keys(recovery.drafts)).toHaveLength(0);
    expect(recovery.summary.issues.map((entry) => entry.kind).sort()).toEqual(['invalid', 'orphaned']);
  });

  it('increments the persisted checkpoint sequence for each draft mutation', () => {
    const character = publishedCharacter();
    const draft = activeDraft(character);
    const updated = updateProgressionDraft(
      draft,
      (working) => ({ ...working, notes: 'Checkpoint mutation' }),
      progressionOperation('manual', 'Update notes')
    );

    expect(updated.recovery.checkpointSequence).toBe(draft.recovery.checkpointSequence + 1);
    expect(updated.recovery.status).toBe('active');
    expect(updated.recovery.lastCheckpointAt).toBe(updated.updatedAt);
  });
});
