import { createEmptyCharacter } from '../data/mockData';
import {
  characterProgressionFingerprint,
  commitProgressionDraft,
  createProgressionDraft,
  progressionOperation,
  rollbackProgressionAudit,
  updateProgressionDraft,
  validateProgressionDraft
} from '../characters/progressionTransaction';
import type { Character } from '../types';

const leveledCharacter = (name = 'Atomic Hero'): Character => ({
  ...createEmptyCharacter(name),
  id: 'character-atomic',
  level: 1,
  classes: [{
    id: 'class-wizard',
    name: 'Wizard',
    level: 1,
    source: { id: 'test', status: 'active', confidence: 'exact' }
  }],
  catalogSnapshotId: 'catalog-4.7.0-test'
});

describe('APP-05 atomic progression transaction', () => {
  it('keeps the published character unchanged until a valid commit', () => {
    const published = leveledCharacter();
    const working: Character = {
      ...published,
      level: 2,
      classes: published.classes.map((entry) => ({ ...entry, level: 2 })),
      catalogSnapshotId: 'catalog-4.8.0-test'
    };
    const draft = createProgressionDraft({
      character: published,
      workingCharacter: working,
      targetCatalogSnapshotId: 'catalog-4.8.0-test',
      migrationApproved: true,
      operations: [progressionOperation('levelUp', 'Wizard 1 → 2')]
    });

    expect(published.level).toBe(1);
    expect(draft.workingCharacter.level).toBe(2);

    const committed = commitProgressionDraft(published, draft);
    expect(committed.ok).toBe(true);
    expect(committed.character.level).toBe(2);
    expect(committed.character.progressionTransactions).toHaveLength(1);
    expect(committed.auditEntry?.before.level).toBe(1);
    expect(committed.auditEntry?.after.level).toBe(2);
  });

  it('blocks unresolved mandatory choices but allows optional spell replacement warnings', () => {
    const published = leveledCharacter();
    const mandatory = createProgressionDraft({
      character: published,
      workingCharacter: {
        ...published,
        pendingChoices: [{
          id: 'pending-subclass',
          kind: 'subclass',
          title: 'Escolher subclasse',
          description: 'Obrigatória.',
          status: 'pending',
          createdAt: '2026-08-03T00:00:00.000Z'
        }]
      },
      operations: [progressionOperation('choice', 'Pendência criada')]
    });
    expect(validateProgressionDraft(mandatory, published).blockingIssues.some((issue) => issue.code === 'PROGRESSION_TRANSACTION_PENDING_CHOICES')).toBe(true);

    const optional = createProgressionDraft({
      character: published,
      workingCharacter: {
        ...published,
        level: 2,
        classes: [{ ...published.classes[0]!, level: 2 }],
        pendingChoices: [{
          id: 'pending-spell-replacement',
          kind: 'spellReplacement',
          title: 'Troca opcional',
          description: 'Opcional.',
          status: 'pending',
          createdAt: '2026-08-03T00:00:00.000Z'
        }]
      },
      operations: [progressionOperation('levelUp', 'Wizard 1 → 2')]
    });
    const preview = validateProgressionDraft(optional, published);
    expect(preview.ok).toBe(true);
    expect(preview.warnings.some((issue) => issue.code === 'PROGRESSION_TRANSACTION_OPTIONAL_PENDING')).toBe(true);
  });

  it('detects concurrent modifications before commit', () => {
    const published = leveledCharacter();
    const draft = createProgressionDraft({
      character: published,
      workingCharacter: {
        ...published,
        level: 2,
        classes: [{ ...published.classes[0]!, level: 2 }]
      },
      operations: [progressionOperation('levelUp', 'Wizard 1 → 2')]
    });
    const concurrentlyEdited = { ...published, notes: 'Alterado fora da transação' };
    const result = commitProgressionDraft(concurrentlyEdited, draft);
    expect(result.ok).toBe(false);
    expect(result.character.notes).toBe('Alterado fora da transação');
    expect(result.preview.blockingIssues.some((issue) => issue.code === 'PROGRESSION_TRANSACTION_CONFLICT')).toBe(true);
  });

  it('updates a cloned draft and can restore the exact previous snapshot', () => {
    const published = leveledCharacter();
    const draft = createProgressionDraft({
      character: published,
      operations: [progressionOperation('levelUp', 'Iniciar progressão')]
    });
    const updated = updateProgressionDraft(
      draft,
      (character) => ({
        ...character,
        level: 2,
        classes: [{ ...character.classes[0]!, level: 2 }],
        feats: [{ id: 'feat-alert', name: 'Alert', source: { id: 'test', status: 'active', confidence: 'exact' } }]
      }),
      progressionOperation('choice', 'Selecionar Alert')
    );
    const committed = commitProgressionDraft(published, updated);
    expect(committed.ok).toBe(true);
    expect(published.feats).toHaveLength(0);
    expect(committed.character.feats.map((feat) => feat.name)).toEqual(['Alert']);

    const rollback = rollbackProgressionAudit(committed.character, committed.auditEntry!);
    expect(rollback.character.level).toBe(1);
    expect(rollback.character.feats).toHaveLength(0);
    expect(rollback.character.progressionTransactions?.at(-1)?.status).toBe('rolledBack');
    expect(rollback.auditEntry.rolledBackTransactionId).toBe(committed.auditEntry?.transactionId);
  });

  it('requires explicit snapshot migration approval', () => {
    const published = leveledCharacter();
    const draft = createProgressionDraft({
      character: published,
      workingCharacter: {
        ...published,
        level: 2,
        classes: [{ ...published.classes[0]!, level: 2 }],
        catalogSnapshotId: 'catalog-4.8.0-test'
      },
      targetCatalogSnapshotId: 'catalog-4.8.0-test',
      migrationApproved: false,
      operations: [progressionOperation('snapshotMigration', 'Migrar snapshot')]
    });
    expect(validateProgressionDraft(draft, published).blockingIssues.some((issue) => issue.code === 'PROGRESSION_TRANSACTION_SNAPSHOT_APPROVAL_REQUIRED')).toBe(true);
  });

  it('ignores audit history when checking the base fingerprint', () => {
    const published = leveledCharacter();
    const before = characterProgressionFingerprint(published);
    const withEmptyHistory = { ...published, progressionTransactions: [] };
    expect(characterProgressionFingerprint(withEmptyHistory)).toBe(before);
  });
});
