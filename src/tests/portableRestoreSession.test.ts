import { createCharacterDataBackup } from '../backup/characterBackup';
import {
  acknowledgePortableRestoreConflict,
  canCommitPortableRestoreSession,
  portableRestoreCheckpointFingerprint,
  portableRestoreAuditEntry,
  preparePortableRestoreSession,
  type PortableRestoreDataCheckpoint
} from '../backup/portableRestoreSession';
import { createEmptyCharacter } from '../data/mockData';
import { emptyProgressionRecoverySummary } from '../characters/progressionRecovery';
import { emptyCompatibilityRemediationRecoverySummary } from '../characters/compatibilityRemediationRecovery';

const checkpoint = (): PortableRestoreDataCheckpoint => ({
  characterStore: {
    characters: [{ ...createEmptyCharacter('Local'), id: 'local-character' }],
    progressionDrafts: {},
    progressionRecovery: emptyProgressionRecoverySummary(),
    compatibilityRemediationPlans: {},
    compatibilityRemediationRecovery: emptyCompatibilityRemediationRecoverySummary(),
    compatibilityRemediationQuarantine: {}
  },
  scenarios: [],
  buildPresets: [],
  buildHistorySnapshots: [],
  catalog: {
    filterState: { bookStates: { 'phb-2024': true }, categoryStates: {}, entityStates: {} },
    revision: 2,
    history: []
  }
});

describe('portable restore session', () => {
  it('prepares an aggregate preview without mutating the checkpoint', () => {
    const current = checkpoint();
    const before = portableRestoreCheckpointFingerprint(current);
    const backup = createCharacterDataBackup({
      characters: [{ ...createEmptyCharacter('Imported'), id: 'imported-character' }],
      scenarios: [], buildPresets: [], buildHistorySnapshots: []
    });
    const result = preparePortableRestoreSession({
      backup,
      options: { mode: 'merge' },
      current,
      now: () => new Date('2026-08-04T12:00:00.000Z')
    });
    expect(result.ok).toBe(true);
    expect(result.session?.preview.before.characters).toBe(1);
    expect(result.session?.preview.after.characters).toBe(2);
    expect(portableRestoreCheckpointFingerprint(current)).toBe(before);
    expect(result.session?.status).toBe('prepared');
  });

  it('requires explicit acknowledgement for destructive conflicts', () => {
    const backup = createCharacterDataBackup({
      characters: [{ ...createEmptyCharacter('Imported'), id: 'imported-character' }],
      scenarios: [], buildPresets: [], buildHistorySnapshots: []
    });
    const prepared = preparePortableRestoreSession({
      backup,
      options: { mode: 'replaceAll' },
      current: checkpoint(),
      now: () => new Date('2026-08-04T12:01:00.000Z')
    }).session!;
    expect(canCommitPortableRestoreSession(prepared)).toBe(false);
    const acknowledged = acknowledgePortableRestoreConflict(prepared, 'restore-conflict-replaceAll', true, () => new Date('2026-08-04T12:02:00.000Z'));
    expect(canCommitPortableRestoreSession(acknowledged)).toBe(true);
    expect(acknowledged.events.some((entry) => entry.kind === 'acknowledged')).toBe(true);
  });

  it('creates a portable audit record for the whole session', () => {
    const backup = createCharacterDataBackup({ characters: [], scenarios: [], buildPresets: [], buildHistorySnapshots: [] });
    const session = preparePortableRestoreSession({ backup, options: { mode: 'merge' }, current: checkpoint() }).session!;
    const audit = portableRestoreAuditEntry(session, 'discarded', '2026-08-04T12:03:00.000Z');
    expect(audit.schemaVersion).toBe('dnd-portable-restore-session-audit.v1');
    expect(audit.sessionId).toBe(session.id);
    expect(audit.beforeFingerprint).toBe(session.beforeFingerprint);
  });
});
