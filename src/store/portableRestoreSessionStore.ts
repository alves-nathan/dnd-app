import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { characterStorage } from '../storage/characterStorage';
import {
  acknowledgePortableRestoreConflict,
  portableRestoreAuditEntry,
  type PortableRestoreSession,
  type PortableRestoreSessionAuditEntry,
  type PortableRestoreSessionEvent,
  type PortableRestoreSessionPhase,
  type PortableRestoreSessionStatus
} from '../backup/portableRestoreSession';
import {
  createPortableRestoreIntegrityReceipt,
  validatePortableRestoreIntegrityReceipt,
  type PortableRestorePostVerification
} from '../backup/portableRestoreVerification';
import {
  createPortableRestoreHistoricalEvidenceRecord,
  revalidatePortableRestoreEvidenceHistory,
  type PortableRestoreHistoricalEvidenceRecord
} from '../backup/portableRestoreEvidenceCenter';
import type { PortableRestoreDataCheckpoint } from '../backup/portableRestoreSession';
import type { CatalogConfigurationHistoryEntry } from '../catalog/catalogConfigurationHistory';

export const PORTABLE_RESTORE_SESSION_STORE_VERSION = 3;

export interface PortableRestoreSessionStore {
  activeSession?: PortableRestoreSession;
  history: PortableRestoreSessionAuditEntry[];
  archivedSessions: PortableRestoreSession[];
  evidenceRecords: PortableRestoreHistoricalEvidenceRecord[];
  setPreparedSession: (session: PortableRestoreSession) => boolean;
  acknowledgeConflict: (conflictId: string, acknowledged: boolean) => boolean;
  markCommitStarted: () => boolean;
  markDataApplied: () => boolean;
  markCatalogApplied: (historyEntryId?: string) => boolean;
  markCommitted: () => boolean;
  recordPostRestoreVerification: (verification: PortableRestorePostVerification) => boolean;
  acknowledgePostRestoreVerification: () => boolean;
  reopenArchivedRollback: (sessionId: string) => boolean;
  importEvidenceRecords: (records: PortableRestoreHistoricalEvidenceRecord[]) => number;
  revalidateEvidenceHistory: (checkpoint: PortableRestoreDataCheckpoint, catalogHistory: CatalogConfigurationHistoryEntry[], force?: boolean) => number;
  markEvidenceCatalogChanged: (recordIds: string[], fromVersion: string, toVersion: string) => number;
  replaceEvidenceRecords: (records: PortableRestoreHistoricalEvidenceRecord[]) => void;
  removeEvidenceRecord: (recordId: string, removeLocalCheckpoint?: boolean) => boolean;
  cleanupEvidenceHistory: (recordIds: string[], checkpointSessionIds: string[]) => { removedRecords: number; removedCheckpoints: number };
  markInterrupted: (message?: string) => boolean;
  markFailed: (message: string) => boolean;
  markRollbackStarted: () => boolean;
  markDataRolledBack: () => boolean;
  markCatalogRolledBack: () => boolean;
  markRolledBack: () => boolean;
  discardPreparedSession: () => boolean;
  archiveCommittedSession: () => boolean;
  clearFinishedSession: () => boolean;
}

const nowIso = (): string => new Date().toISOString();

const makeEvent = (
  session: PortableRestoreSession,
  kind: PortableRestoreSessionEvent['kind'],
  message: string,
  at: string
): PortableRestoreSessionEvent => ({
  id: `${session.id}-${kind}-${at.replace(/[^0-9]/g, '').slice(0, 17)}-${session.events.length + 1}`,
  at,
  kind,
  message
});

const updateSession = (
  session: PortableRestoreSession,
  params: {
    status?: PortableRestoreSessionStatus;
    phase?: PortableRestoreSessionPhase;
    recoveryRequired?: boolean;
    eventKind: PortableRestoreSessionEvent['kind'];
    message: string;
    applied?: Partial<PortableRestoreSession['applied']>;
    catalogHistoryEntryId?: string;
    committedAt?: string;
    rolledBackAt?: string;
    discardedAt?: string;
    lastError?: string;
    postRestoreVerification?: PortableRestorePostVerification;
    integrityReceipt?: PortableRestoreSession['integrityReceipt'];
    clearIntegrityReceipt?: boolean;
    closedAt?: string;
  }
): PortableRestoreSession => {
  const at = nowIso();
  return {
    ...session,
    status: params.status ?? session.status,
    phase: params.phase ?? session.phase,
    recoveryRequired: params.recoveryRequired ?? session.recoveryRequired,
    updatedAt: at,
    applied: { ...session.applied, ...params.applied },
    catalogHistoryEntryId: params.catalogHistoryEntryId ?? session.catalogHistoryEntryId,
    committedAt: params.committedAt ?? session.committedAt,
    rolledBackAt: params.rolledBackAt ?? session.rolledBackAt,
    discardedAt: params.discardedAt ?? session.discardedAt,
    lastError: params.lastError,
    postRestoreVerification: params.postRestoreVerification ?? session.postRestoreVerification,
    integrityReceipt: params.clearIntegrityReceipt ? undefined : params.integrityReceipt ?? session.integrityReceipt,
    closedAt: params.closedAt ?? session.closedAt,
    events: [...session.events, makeEvent(session, params.eventKind, params.message, at)]
  };
};

const terminal = new Set<PortableRestoreSessionStatus>(['rolledBack', 'discarded']);

export const usePortableRestoreSessionStore = create<PortableRestoreSessionStore>()(
  persist(
    (set, get) => ({
      activeSession: undefined,
      history: [],
      archivedSessions: [],
      evidenceRecords: [],
      setPreparedSession: (session) => {
        const current = get().activeSession;
        if (current && !terminal.has(current.status)) return false;
        set({ activeSession: session });
        return true;
      },
      acknowledgeConflict: (conflictId, acknowledged) => {
        const session = get().activeSession;
        if (!session || !['prepared', 'interrupted'].includes(session.status)) return false;
        set({ activeSession: acknowledgePortableRestoreConflict(session, conflictId, acknowledged) });
        return true;
      },
      markCommitStarted: () => {
        const session = get().activeSession;
        if (!session || !['prepared', 'interrupted'].includes(session.status)) return false;
        set({ activeSession: updateSession(session, {
          status: 'committing', phase: 'data', recoveryRequired: true,
          eventKind: 'commitStarted', message: 'Commit coordenado iniciado; o checkpoint anterior permanece disponível.'
        }) });
        return true;
      },
      markDataApplied: () => {
        const session = get().activeSession;
        if (!session || session.status !== 'committing') return false;
        set({ activeSession: updateSession(session, {
          phase: 'catalog', applied: { data: true }, recoveryRequired: true,
          eventKind: 'dataApplied', message: 'Personagens, cenários, presets, snapshots e planos foram aplicados de forma idempotente.'
        }) });
        return true;
      },
      markCatalogApplied: (historyEntryId) => {
        const session = get().activeSession;
        if (!session || session.status !== 'committing') return false;
        set({ activeSession: updateSession(session, {
          phase: 'complete', applied: { catalog: true }, recoveryRequired: true,
          catalogHistoryEntryId: historyEntryId,
          eventKind: 'catalogApplied', message: 'Configuração do catálogo confirmada como nova transação local.'
        }) });
        return true;
      },
      markCommitted: () => {
        const session = get().activeSession;
        if (!session || session.status !== 'committing') return false;
        const at = nowIso();
        const committed = updateSession(session, {
          status: 'committed', phase: 'complete', recoveryRequired: false, committedAt: at,
          applied: { data: true, catalog: session.catalogAudit ? true : session.applied.catalog },
          eventKind: 'committed', message: 'Sessão portátil confirmada integralmente.'
        });
        set({
          activeSession: committed,
          history: [...get().history, portableRestoreAuditEntry(committed, 'committed', at)].slice(-20)
        });
        return true;
      },
      recordPostRestoreVerification: (verification) => {
        const session = get().activeSession;
        if (!session || session.status !== 'committed') return false;
        const at = nowIso();
        const verified = updateSession(session, {
          eventKind: 'verificationCompleted',
          message: verification.status === 'failed'
            ? 'Verificação pós-restauração encontrou divergências bloqueantes.'
            : verification.status === 'warning'
              ? 'Verificação pós-restauração concluída com avisos que exigem reconhecimento.'
              : 'Verificação pós-restauração concluída sem divergências.',
          postRestoreVerification: verification,
          clearIntegrityReceipt: !verification.canClose,
          integrityReceipt: verification.canClose ? createPortableRestoreIntegrityReceipt(session, verification, () => new Date(at)) : undefined
        });
        const withReceipt = verified.integrityReceipt
          ? updateSession(verified, { eventKind: 'receiptCreated', message: 'Recibo portátil de integridade gerado e vinculado à sessão.' })
          : verified;
        set({ activeSession: withReceipt });
        return true;
      },
      acknowledgePostRestoreVerification: () => {
        const session = get().activeSession;
        const verification = session?.postRestoreVerification;
        if (!session || session.status !== 'committed' || !verification || verification.status !== 'warning') return false;
        const at = nowIso();
        const acknowledged = { ...verification, acknowledgedAt: at, canClose: true };
        const next = updateSession(session, {
          eventKind: 'verificationAccepted',
          message: 'Avisos da verificação pós-restauração reconhecidos explicitamente.',
          postRestoreVerification: acknowledged,
          integrityReceipt: createPortableRestoreIntegrityReceipt(session, acknowledged, () => new Date(at))
        });
        set({ activeSession: updateSession(next, { eventKind: 'receiptCreated', message: 'Recibo portátil de integridade gerado após o reconhecimento dos avisos.' }) });
        return true;
      },
      reopenArchivedRollback: (sessionId) => {
        if (get().activeSession) return false;
        const archived = get().archivedSessions.find((entry) => entry.id === sessionId);
        if (!archived || archived.status !== 'committed' || !archived.integrityReceipt || !validatePortableRestoreIntegrityReceipt(archived.integrityReceipt)) return false;
        const at = nowIso();
        const reopened = updateSession({ ...archived, closedAt: undefined }, {
          eventKind: 'rollbackReopened',
          message: 'Sessão arquivada reaberta com recibo íntegro para permitir rollback seguro.'
        });
        set({
          activeSession: reopened,
          archivedSessions: get().archivedSessions.filter((entry) => entry.id !== sessionId)
        });
        return true;
      },
      importEvidenceRecords: (records) => {
        const current = get().evidenceRecords;
        const known = new Set(current.map((record) => record.recordId));
        const accepted = records.filter((record) => !known.has(record.recordId));
        if (!accepted.length) return 0;
        set({ evidenceRecords: [...current, ...accepted] });
        return accepted.length;
      },
      revalidateEvidenceHistory: (checkpoint, catalogHistory, force = false) => {
        const current = get().evidenceRecords;
        const next = revalidatePortableRestoreEvidenceHistory(current, checkpoint, catalogHistory, { force });
        const changed = next.filter((record, index) => record.comparison?.comparedAt !== current[index]?.comparison?.comparedAt).length;
        if (changed) set({ evidenceRecords: next });
        return changed;
      },
      markEvidenceCatalogChanged: (recordIds, fromVersion, toVersion) => {
        const selected = new Set(recordIds);
        if (!selected.size) return 0;
        let changed = 0;
        const comparedAt = nowIso();
        const next = get().evidenceRecords.map((record) => {
          if (!selected.has(record.recordId)) return record;
          changed += 1;
          const previousMessages = record.comparison?.messages ?? [];
          const message = `O catálogo ativo mudou de ${fromVersion} para ${toVersion} após a emissão deste recibo.`;
          return {
            ...record,
            comparison: {
              status: 'changed' as const,
              comparedAt,
              expectedFingerprint: record.receipt.effectiveFingerprint,
              currentFingerprint: record.comparison?.currentFingerprint,
              catalogHistoryEntryId: record.receipt.catalogHistoryEntryId,
              catalogHistoryEntryPresent: record.comparison?.catalogHistoryEntryPresent,
              characterCountDelta: record.comparison?.characterCountDelta,
              remediationPlanCountDelta: record.comparison?.remediationPlanCountDelta,
              progressionDraftCountDelta: record.comparison?.progressionDraftCountDelta,
              messages: Array.from(new Set([...previousMessages, message]))
            }
          };
        });
        if (changed) set({ evidenceRecords: next });
        return changed;
      },
      replaceEvidenceRecords: (records) => set({ evidenceRecords: records.map((record) => JSON.parse(JSON.stringify(record)) as PortableRestoreHistoricalEvidenceRecord) }),
      removeEvidenceRecord: (recordId, removeLocalCheckpoint = false) => {
        const current = get().evidenceRecords;
        const record = current.find((entry) => entry.recordId === recordId);
        if (!record) return false;
        set({
          evidenceRecords: current.filter((entry) => entry.recordId !== recordId),
          archivedSessions: removeLocalCheckpoint
            ? get().archivedSessions.filter((entry) => entry.id !== record.sessionId)
            : get().archivedSessions
        });
        return true;
      },
      cleanupEvidenceHistory: (recordIds, checkpointSessionIds) => {
        const recordSet = new Set(recordIds);
        const checkpointSet = new Set(checkpointSessionIds);
        const records = get().evidenceRecords;
        const checkpoints = get().archivedSessions;
        const nextRecords = records.filter((record) => !recordSet.has(record.recordId));
        const nextCheckpoints = checkpoints.filter((session) => !checkpointSet.has(session.id));
        set({ evidenceRecords: nextRecords, archivedSessions: nextCheckpoints });
        return { removedRecords: records.length - nextRecords.length, removedCheckpoints: checkpoints.length - nextCheckpoints.length };
      },
      markInterrupted: (message = 'A sessão foi interrompida e precisa ser retomada ou revertida.') => {
        const session = get().activeSession;
        if (!session || !['committing', 'rollingBack', 'prepared'].includes(session.status)) return false;
        set({ activeSession: updateSession(session, {
          status: 'interrupted', recoveryRequired: true,
          eventKind: 'interrupted', message
        }) });
        return true;
      },
      markFailed: (message) => {
        const session = get().activeSession;
        if (!session) return false;
        const at = nowIso();
        const failed = updateSession(session, {
          status: 'failed', recoveryRequired: true, lastError: message,
          eventKind: 'failed', message
        });
        set({
          activeSession: failed,
          history: [...get().history, portableRestoreAuditEntry(failed, 'failed', at)].slice(-20)
        });
        return true;
      },
      markRollbackStarted: () => {
        const session = get().activeSession;
        if (!session || !['committed', 'interrupted', 'failed'].includes(session.status)) return false;
        set({ activeSession: updateSession(session, {
          status: 'rollingBack', phase: 'rollbackData', recoveryRequired: true,
          eventKind: 'rollbackStarted', message: 'Rollback integral iniciado a partir do checkpoint anterior.'
        }) });
        return true;
      },
      markDataRolledBack: () => {
        const session = get().activeSession;
        if (!session || session.status !== 'rollingBack') return false;
        set({ activeSession: updateSession(session, {
          phase: 'rollbackCatalog', applied: { data: false }, recoveryRequired: true,
          eventKind: 'dataRolledBack', message: 'Dados locais restaurados para o checkpoint anterior.'
        }) });
        return true;
      },
      markCatalogRolledBack: () => {
        const session = get().activeSession;
        if (!session || session.status !== 'rollingBack') return false;
        set({ activeSession: updateSession(session, {
          phase: 'complete', applied: { catalog: false }, recoveryRequired: true,
          eventKind: 'catalogRolledBack', message: 'Configuração e histórico do catálogo restaurados para o checkpoint anterior.'
        }) });
        return true;
      },
      markRolledBack: () => {
        const session = get().activeSession;
        if (!session || session.status !== 'rollingBack') return false;
        const at = nowIso();
        const rolledBack = updateSession(session, {
          status: 'rolledBack', phase: 'complete', recoveryRequired: false, rolledBackAt: at,
          applied: { data: false, catalog: false },
          eventKind: 'rolledBack', message: 'Rollback integral concluído.'
        });
        set({
          activeSession: rolledBack,
          history: [...get().history, portableRestoreAuditEntry(rolledBack, 'rolledBack', at)].slice(-20)
        });
        return true;
      },
      discardPreparedSession: () => {
        const session = get().activeSession;
        if (!session || session.status !== 'prepared' || session.applied.data || session.applied.catalog) return false;
        const at = nowIso();
        const discarded = updateSession(session, {
          status: 'discarded', phase: 'complete', recoveryRequired: false, discardedAt: at,
          eventKind: 'discarded', message: 'Preview descartado sem alteração dos dados locais.'
        });
        set({
          activeSession: discarded,
          history: [...get().history, portableRestoreAuditEntry(discarded, 'discarded', at)].slice(-20)
        });
        return true;
      },
      archiveCommittedSession: () => {
        const session = get().activeSession;
        if (!session || session.status !== 'committed' || !session.postRestoreVerification?.canClose || !session.integrityReceipt || !validatePortableRestoreIntegrityReceipt(session.integrityReceipt)) return false;
        const at = nowIso();
        const archived = updateSession(session, {
          eventKind: 'archived',
          message: 'Sessão encerrada após verificação e recibo íntegro.',
          closedAt: at
        });
        const evidence = createPortableRestoreHistoricalEvidenceRecord(archived, () => new Date(at));
        const evidenceRecords = evidence
          ? [...get().evidenceRecords.filter((record) => record.sessionId !== archived.id || record.source !== 'local'), evidence]
          : get().evidenceRecords;
        set({
          activeSession: undefined,
          archivedSessions: [...get().archivedSessions.filter((entry) => entry.id !== archived.id), archived],
          evidenceRecords
        });
        return true;
      },
      clearFinishedSession: () => {
        const session = get().activeSession;
        if (!session || !['rolledBack', 'discarded'].includes(session.status)) return false;
        set({ activeSession: undefined });
        return true;
      }
    }),
    {
      name: 'dnd-combat-math-portable-restore-session',
      storage: createJSONStorage(() => characterStorage),
      version: PORTABLE_RESTORE_SESSION_STORE_VERSION,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<PortableRestoreSessionStore>;
        const archivedSessions = state.archivedSessions ?? [];
        const existingRecords = state.evidenceRecords ?? [];
        const knownSessionIds = new Set(existingRecords.filter((record) => record.source === 'local').map((record) => record.sessionId));
        const migratedRecords = archivedSessions
          .filter((session) => !knownSessionIds.has(session.id))
          .map((session) => createPortableRestoreHistoricalEvidenceRecord(session))
          .filter((record): record is PortableRestoreHistoricalEvidenceRecord => Boolean(record));
        return {
          ...state,
          history: state.history ?? [],
          archivedSessions,
          evidenceRecords: [...existingRecords, ...migratedRecords]
        } as PortableRestoreSessionStore;
      },
      onRehydrateStorage: () => (state) => {
        const session = state?.activeSession;
        if (!session) return;
        if (session.status === 'committing' || session.status === 'rollingBack') {
          state.markInterrupted('O aplicativo foi encerrado durante a restauração. Retome o commit ou restaure o checkpoint anterior.');
        }
      }
    }
  )
);
