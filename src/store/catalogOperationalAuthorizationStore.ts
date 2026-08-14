import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { sha256Hex } from '../catalog/catalogBundleDigest';
import {
  assertCatalogOperationalAuthorizationUnused,
  catalogExecutorConfirmationChecksum,
  catalogOperationalAuthorizationChecksum,
  createCatalogOperationalExecutionReceipt,
  parseSignedCatalogExecutorConfirmation,
  parseSignedCatalogOperationalAuthorization,
  verifySignedCatalogExecutorConfirmation,
  verifySignedCatalogOperationalAuthorization,
  type CatalogOperationalExecutionReceipt,
  type CatalogOperationalExecutionResult,
  type SignedCatalogExecutorConfirmation,
  type SignedCatalogOperationalAuthorization
} from '../catalog/catalogOperationalAuthorization';
import {
  appendCatalogOperationalJournalEntry,
  assertCatalogOperationalRecoveryUnused,
  catalogOperationalRecoveryAuthorizationChecksum,
  catalogOperationalRecoveryConfirmationChecksum,
  createCatalogOperationalEvidence,
  createCatalogOperationalJournalArchive,
  createCatalogOperationalReconciliation,
  createCatalogOperationalStateSnapshot,
  parseSignedCatalogOperationalRecoveryAuthorization,
  parseSignedCatalogOperationalRecoveryConfirmation,
  validateCatalogOperationalEvidence,
  validateCatalogOperationalJournalArchive,
  validateCatalogOperationalJournalChain,
  validateCatalogOperationalReconciliation,
  verifySignedCatalogOperationalRecoveryAuthorization,
  verifySignedCatalogOperationalRecoveryConfirmation,
  type CatalogOperationalEvidence,
  type CatalogOperationalJournalArchive,
  type CatalogOperationalJournalEntry,
  type CatalogOperationalReconciliation,
  type CatalogOperationalRecoveryAction,
  type SignedCatalogOperationalRecoveryAuthorization,
  type SignedCatalogOperationalRecoveryConfirmation
} from '../catalog/catalogOperationalJournal';
import { catalogRolloutAggregateReportChecksum } from '../catalog/catalogRolloutAggregation';
import type { CatalogTrustRegistry } from '../catalog/catalogTrust';
import { stableStringify } from '../catalog/utils';
import { characterStorage } from '../storage/characterStorage';
import { useCatalogPublicationStore } from './catalogPublicationStore';
import { useCatalogRolloutAggregationStore } from './catalogRolloutAggregationStore';
import { useCatalogRolloutHealthStore, type CatalogOperationalRolloutOverride } from './catalogRolloutHealthStore';
import { useCatalogUpdateSessionStore } from './catalogUpdateSessionStore';
import { useCatalogTrustStore } from './catalogTrustStore';

export const CATALOG_OPERATIONAL_AUTHORIZATION_STORE_VERSION = 2;

export type CatalogOperationalSessionStatus = 'prepared' | 'executing' | 'interrupted' | 'succeeded' | 'failed' | 'closed';

export interface CatalogOperationalExecutionSession {
  sessionId: string;
  authorizationId: string;
  authorizationChecksum: string;
  confirmationChecksum: string;
  createdAt: string;
  updatedAt: string;
  status: CatalogOperationalSessionStatus;
  humanConfirmedAt?: string;
  lastIssue?: string;
  checkpoint: {
    selectedChannel: ReturnType<typeof useCatalogPublicationStore.getState>['selectedChannel'];
    operationalOverrides: Record<string, CatalogOperationalRolloutOverride[]>;
  };
}

export interface CatalogOperationalRecoveryExecution {
  recoveryAuthorizationChecksum: string;
  nonce: string;
  receiptId: string;
  action: CatalogOperationalRecoveryAction;
  completedAt: string;
  status: 'succeeded' | 'failed';
  issue?: string;
}

export interface CatalogOperationalEvent {
  id: string;
  at: string;
  type: string;
  details?: Record<string, unknown>;
}

export interface CatalogOperationalAuthorizationState {
  authorizations: SignedCatalogOperationalAuthorization[];
  confirmations: Record<string, SignedCatalogExecutorConfirmation>;
  sessions: CatalogOperationalExecutionSession[];
  receipts: CatalogOperationalExecutionReceipt[];
  events: CatalogOperationalEvent[];
  journal: CatalogOperationalJournalEntry[];
  journalArchives: CatalogOperationalJournalArchive[];
  reconciliations: Record<string, CatalogOperationalReconciliation>;
  evidence: CatalogOperationalEvidence[];
  recoveryAuthorizations: SignedCatalogOperationalRecoveryAuthorization[];
  recoveryConfirmations: Record<string, SignedCatalogOperationalRecoveryConfirmation>;
  recoveryExecutions: CatalogOperationalRecoveryExecution[];
  importAuthorization: (rawText: string, registry: CatalogTrustRegistry) => { ok: boolean; issue?: string; authorization?: SignedCatalogOperationalAuthorization };
  importExecutorConfirmation: (rawText: string, registry: CatalogTrustRegistry) => { ok: boolean; issue?: string; confirmation?: SignedCatalogExecutorConfirmation };
  prepareExecution: (authorizationId: string) => { ok: boolean; issue?: string; session?: CatalogOperationalExecutionSession };
  confirmAndExecute: (sessionId: string, humanConfirmed: true) => Promise<{ ok: boolean; issue?: string; receipt?: CatalogOperationalExecutionReceipt }>;
  resumeInterruptedExecution: (sessionId: string, humanConfirmed: true) => Promise<{ ok: boolean; issue?: string; receipt?: CatalogOperationalExecutionReceipt }>;
  recoverInterruptedSessions: () => number;
  reconcileReceipt: (receiptId: string, acknowledgeWarnings?: boolean) => { ok: boolean; issue?: string; reconciliation?: CatalogOperationalReconciliation };
  closeOperation: (receiptId: string, acknowledgeWarnings?: boolean) => { ok: boolean; issue?: string; evidence?: CatalogOperationalEvidence };
  importRecoveryAuthorization: (rawText: string, registry: CatalogTrustRegistry) => { ok: boolean; issue?: string; authorization?: SignedCatalogOperationalRecoveryAuthorization };
  importRecoveryConfirmation: (rawText: string, registry: CatalogTrustRegistry) => { ok: boolean; issue?: string; confirmation?: SignedCatalogOperationalRecoveryConfirmation };
  executeRecovery: (authorizationId: string, humanConfirmed: true) => Promise<{ ok: boolean; issue?: string; reconciliation?: CatalogOperationalReconciliation }>;
  archiveJournal: (keepRecent?: number) => { ok: boolean; issue?: string; archive?: CatalogOperationalJournalArchive };
  discardPrepared: (sessionId: string) => boolean;
}

const nowIso = (): string => new Date().toISOString();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const appendEvent = (events: CatalogOperationalEvent[], next: CatalogOperationalEvent): CatalogOperationalEvent[] => [...events, next].slice(-600);
const event = (type: string, details?: Record<string, unknown>): CatalogOperationalEvent => ({
  id: `catalog-operation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  at: nowIso(),
  type,
  ...(details ? { details } : {})
});

const appendJournal = (
  state: Pick<CatalogOperationalAuthorizationState, 'journal' | 'journalArchives'>,
  params: Omit<Parameters<typeof appendCatalogOperationalJournalEntry>[0], 'entries' | 'archivedHeadHash' | 'archivedLastSequence'>
): CatalogOperationalJournalEntry[] => {
  const archive = state.journalArchives[state.journalArchives.length - 1];
  const entry = appendCatalogOperationalJournalEntry({
    ...params,
    entries: state.journal,
    archivedHeadHash: archive?.headHash,
    archivedLastSequence: archive?.lastSequence
  });
  return [...state.journal, entry].slice(-1000);
};

const contextForAuthorization = (authorization: SignedCatalogOperationalAuthorization) => {
  const aggregation = useCatalogRolloutAggregationStore.getState();
  const publication = useCatalogPublicationStore.getState().publications[authorization.publicationId];
  if (!publication) throw new Error('A publicação autorizada não está disponível.');
  const decision = aggregation.decisions.find((entry) => entry.checksum === authorization.quorumDecisionChecksum);
  if (!decision) throw new Error('A decisão aprovada não está disponível.');
  const report = aggregation.reports.find((entry) => catalogRolloutAggregateReportChecksum(entry) === authorization.aggregateReportChecksum);
  if (!report) throw new Error('O relatório consolidado não está disponível.');
  const policy = [...(aggregation.policies[authorization.publicationId] ?? [])].sort((a, b) => b.revision - a.revision)[0];
  if (!policy) throw new Error('A política de quórum não está disponível.');
  const approvals = Object.values(aggregation.approvals).flat().filter((entry) => decision.approvalIds.includes(entry.approvalId));
  return { publication, decision, report, policy, approvals };
};

const executeAction = async (authorization: SignedCatalogOperationalAuthorization): Promise<CatalogOperationalExecutionResult> => {
  const publicationStore = useCatalogPublicationStore.getState();
  const publication = publicationStore.publications[authorization.publicationId];
  if (!publication) throw new Error('A publicação não está disponível para execução.');
  if (authorization.action === 'expand' || authorization.action === 'pause') {
    const rollout = authorization.action === 'pause' ? 0 : authorization.targetRolloutPercent;
    if (rollout === undefined) throw new Error('O percentual operacional não foi informado.');
    const before = useCatalogRolloutHealthStore.getState().effectiveRolloutFor(publication);
    useCatalogRolloutHealthStore.getState().applyOperationalOverride(publication.publicationId, {
      authorizationId: authorization.authorizationId,
      action: authorization.action,
      rolloutPercent: rollout,
      appliedAt: nowIso()
    });
    const after = useCatalogRolloutHealthStore.getState().effectiveRolloutFor(publication);
    return { kind: 'rolloutOverride', summary: `${authorization.action === 'pause' ? 'Pausa' : 'Expansão'} operacional confirmada em ${after.rolloutPercent}%.`, before, after };
  }
  if (authorization.action === 'promote') {
    if (!authorization.targetChannel) throw new Error('O canal alvo não foi informado.');
    const before = publicationStore.selectedChannel;
    const changed = publicationStore.setSelectedChannel(authorization.targetChannel, true);
    if (!changed.ok) throw new Error(changed.issue ?? 'A migração de canal foi rejeitada.');
    return { kind: 'channelPromotion', summary: `Canal operacional alterado de ${before} para ${authorization.targetChannel}.`, before: { selectedChannel: before }, after: { selectedChannel: authorization.targetChannel } };
  }
  const update = useCatalogUpdateSessionStore.getState();
  if (!update.activeSession || update.activeSession.id !== authorization.rollbackTargetSessionId) throw new Error('A sessão de catálogo autorizada para rollback não está ativa.');
  if (update.activeSession.status === 'rolledBack') return { kind: 'catalogRollback', summary: 'Rollback transacional do catálogo já estava concluído.', transactionId: authorization.rollbackTargetSessionId };
  const result = await update.rollback();
  if (!result.ok) throw new Error(result.issues.join('\n'));
  return { kind: 'catalogRollback', summary: 'Rollback transacional do catálogo concluído.', transactionId: authorization.rollbackTargetSessionId };
};

const actualSnapshotForReceipt = (receipt: CatalogOperationalExecutionReceipt) => {
  const publicationStore = useCatalogPublicationStore.getState();
  const healthStore = useCatalogRolloutHealthStore.getState();
  const publication = publicationStore.publications[receipt.publicationId];
  const updateSession = useCatalogUpdateSessionStore.getState().activeSession;
  const overrides = healthStore.operationalOverrides ?? {};
  const effective = publication ? healthStore.effectiveRolloutFor(publication) : undefined;
  return createCatalogOperationalStateSnapshot({
    selectedChannel: publicationStore.selectedChannel,
    operationalOverridesChecksum: sha256Hex(stableStringify(overrides)),
    ...(publication ? { publicationId: publication.publicationId } : {}),
    ...(effective ? { effectiveRolloutPercent: effective.rolloutPercent } : {}),
    ...(updateSession ? { updateSessionId: updateSession.id, updateSessionStatus: updateSession.status } : {})
  });
};

const executeRecoveryAction = async (params: {
  authorization: SignedCatalogOperationalRecoveryAuthorization;
  receipt: CatalogOperationalExecutionReceipt;
  session?: CatalogOperationalExecutionSession;
}): Promise<void> => {
  const { authorization, receipt, session } = params;
  if (authorization.action === 'rollbackCheckpoint') {
    if (!session) throw new Error('O checkpoint original da operação não está disponível.');
    if (receipt.action === 'rollback') throw new Error('A reversão de um rollback de catálogo exige uma nova autorização transacional do catálogo.');
    useCatalogPublicationStore.getState().setSelectedChannel(session.checkpoint.selectedChannel, true);
    useCatalogRolloutHealthStore.getState().restoreOperationalOverrides(session.checkpoint.operationalOverrides);
    return;
  }
  if (!receipt.result) throw new Error('O recibo não possui estado esperado para reaplicação.');
  if (receipt.result.kind === 'rolloutOverride') {
    const rolloutPercent = Number((receipt.result.after ?? {}).rolloutPercent);
    if (!Number.isFinite(rolloutPercent)) throw new Error('O rollout esperado não está disponível.');
    useCatalogRolloutHealthStore.getState().applyOperationalOverride(receipt.publicationId, {
      authorizationId: authorization.authorizationId,
      action: rolloutPercent === 0 ? 'pause' : 'expand',
      rolloutPercent,
      appliedAt: nowIso()
    });
    return;
  }
  if (receipt.result.kind === 'channelPromotion') {
    const channel = String((receipt.result.after ?? {}).selectedChannel ?? '');
    const changed = useCatalogPublicationStore.getState().setSelectedChannel(channel as ReturnType<typeof useCatalogPublicationStore.getState>['selectedChannel'], true);
    if (!changed.ok) throw new Error(changed.issue ?? 'O canal esperado não pôde ser reaplicado.');
    return;
  }
  const update = useCatalogUpdateSessionStore.getState();
  if (!update.activeSession || update.activeSession.id !== receipt.result.transactionId) throw new Error('A sessão do catálogo necessária para reaplicar o rollback não está disponível.');
  if (update.activeSession.status !== 'rolledBack') {
    const result = await update.rollback();
    if (!result.ok) throw new Error(result.issues.join('\n'));
  }
};

export const useCatalogOperationalAuthorizationStore = create<CatalogOperationalAuthorizationState>()(
  persist(
    (set, get) => ({
      authorizations: [], confirmations: {}, sessions: [], receipts: [], events: [], journal: [], journalArchives: [], reconciliations: {}, evidence: [], recoveryAuthorizations: [], recoveryConfirmations: {}, recoveryExecutions: [],
      importAuthorization: (rawText, registry) => {
        try {
          const authorization = parseSignedCatalogOperationalAuthorization(rawText);
          const context = contextForAuthorization(authorization);
          const verified = verifySignedCatalogOperationalAuthorization({ authorization, registry, ...context });
          assertCatalogOperationalAuthorizationUnused(verified, get().receipts);
          const at = nowIso();
          set({
            authorizations: [...get().authorizations.filter((entry) => entry.authorizationId !== verified.authorizationId), verified].slice(-100),
            events: appendEvent(get().events, event('catalogOperationalAuthorizationAccepted', { authorizationId: verified.authorizationId, action: verified.action, executorId: verified.executor.executorId })),
            journal: appendJournal(get(), { at, type: 'authorizationAccepted', authorizationId: verified.authorizationId, details: { action: verified.action, executorId: verified.executor.executorId, authorizationChecksum: catalogOperationalAuthorizationChecksum(verified) } })
          });
          return { ok: true, authorization: verified };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'A autorização operacional foi rejeitada.';
          set({ events: appendEvent(get().events, event('catalogOperationalAuthorizationRejected', { issue })) });
          return { ok: false, issue };
        }
      },
      importExecutorConfirmation: (rawText, registry) => {
        try {
          const confirmation = parseSignedCatalogExecutorConfirmation(rawText);
          const authorization = get().authorizations.find((entry) => catalogOperationalAuthorizationChecksum(entry) === confirmation.authorizationChecksum);
          if (!authorization) throw new Error('Importe primeiro a autorização operacional correspondente.');
          assertCatalogOperationalAuthorizationUnused(authorization, get().receipts);
          const verified = verifySignedCatalogExecutorConfirmation({ confirmation, authorization, registry });
          const at = nowIso();
          set({
            confirmations: { ...get().confirmations, [verified.authorizationChecksum]: verified },
            events: appendEvent(get().events, event('catalogExecutorConfirmationAccepted', { confirmationId: verified.confirmationId, authorizationId: authorization.authorizationId, executorId: verified.executorId })),
            journal: appendJournal(get(), { at, type: 'executorConfirmed', authorizationId: authorization.authorizationId, details: { confirmationId: verified.confirmationId, confirmationChecksum: catalogExecutorConfirmationChecksum(verified) } })
          });
          return { ok: true, confirmation: verified };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'A confirmação do executor foi rejeitada.';
          set({ events: appendEvent(get().events, event('catalogExecutorConfirmationRejected', { issue })) });
          return { ok: false, issue };
        }
      },
      prepareExecution: (authorizationId) => {
        try {
          const authorization = get().authorizations.find((entry) => entry.authorizationId === authorizationId);
          if (!authorization) throw new Error('Autorização operacional não encontrada.');
          assertCatalogOperationalAuthorizationUnused(authorization, get().receipts);
          const context = contextForAuthorization(authorization);
          verifySignedCatalogOperationalAuthorization({ authorization, registry: useCatalogTrustStore.getState().registry, ...context });
          const authorizationChecksum = catalogOperationalAuthorizationChecksum(authorization);
          const confirmation = get().confirmations[authorizationChecksum];
          if (!confirmation) throw new Error('A confirmação assinada do executor ainda não foi importada.');
          verifySignedCatalogExecutorConfirmation({ confirmation, authorization, registry: useCatalogTrustStore.getState().registry });
          const existing = get().sessions.find((entry) => entry.authorizationChecksum === authorizationChecksum && entry.status === 'prepared');
          if (existing) return { ok: true, session: existing };
          const createdAt = nowIso();
          const session: CatalogOperationalExecutionSession = {
            sessionId: `catalog-operation-session-${authorization.authorizationId}-${Date.now()}`,
            authorizationId, authorizationChecksum, confirmationChecksum: catalogExecutorConfirmationChecksum(confirmation), createdAt, updatedAt: createdAt, status: 'prepared',
            checkpoint: { selectedChannel: useCatalogPublicationStore.getState().selectedChannel, operationalOverrides: clone(useCatalogRolloutHealthStore.getState().operationalOverrides ?? {}) }
          };
          set({ sessions: [...get().sessions, session].slice(-100), events: appendEvent(get().events, event('catalogOperationalExecutionPrepared', { sessionId: session.sessionId, authorizationId })), journal: appendJournal(get(), { at: createdAt, type: 'executionPrepared', authorizationId, sessionId: session.sessionId }) });
          return { ok: true, session };
        } catch (error) { return { ok: false, issue: error instanceof Error ? error.message : 'A execução não pôde ser preparada.' }; }
      },
      confirmAndExecute: async (sessionId, humanConfirmed) => {
        const session = get().sessions.find((entry) => entry.sessionId === sessionId);
        if (!session || !['prepared', 'interrupted'].includes(session.status)) return { ok: false, issue: 'A sessão operacional não está pronta.' };
        if (humanConfirmed !== true) return { ok: false, issue: 'A confirmação humana final é obrigatória.' };
        const authorization = get().authorizations.find((entry) => entry.authorizationId === session.authorizationId);
        if (!authorization) return { ok: false, issue: 'A autorização da sessão não está disponível.' };
        const confirmation = get().confirmations[session.authorizationChecksum];
        if (!confirmation || catalogExecutorConfirmationChecksum(confirmation) !== session.confirmationChecksum) return { ok: false, issue: 'A confirmação do executor mudou ou está ausente.' };
        try {
          const context = contextForAuthorization(authorization);
          verifySignedCatalogOperationalAuthorization({ authorization, registry: useCatalogTrustStore.getState().registry, ...context });
          verifySignedCatalogExecutorConfirmation({ confirmation, authorization, registry: useCatalogTrustStore.getState().registry });
          assertCatalogOperationalAuthorizationUnused(authorization, get().receipts);
        } catch (error) { return { ok: false, issue: error instanceof Error ? error.message : 'A autorização já foi consumida.' }; }
        const humanConfirmedAt = nowIso();
        const startedAt = nowIso();
        set({ sessions: get().sessions.map((entry) => entry.sessionId === sessionId ? { ...entry, status: 'executing', humanConfirmedAt, updatedAt: startedAt } : entry), journal: appendJournal(get(), { at: startedAt, type: session.status === 'interrupted' ? 'executionResumed' : 'executionStarted', authorizationId: authorization.authorizationId, sessionId }) });
        let result: CatalogOperationalExecutionResult | undefined;
        let issue: string | undefined;
        try { result = await executeAction(authorization); }
        catch (error) {
          issue = error instanceof Error ? error.message : 'A execução operacional falhou.';
          if (authorization.action !== 'rollback') {
            useCatalogPublicationStore.getState().setSelectedChannel(session.checkpoint.selectedChannel, true);
            useCatalogRolloutHealthStore.getState().restoreOperationalOverrides(session.checkpoint.operationalOverrides);
          }
        }
        const completedAt = nowIso();
        const receipt = createCatalogOperationalExecutionReceipt({ authorization, confirmation, humanConfirmedAt, startedAt, completedAt, status: issue ? 'failed' : 'succeeded', ...(result ? { result } : {}), ...(issue ? { issue } : {}) });
        set({
          sessions: get().sessions.map((entry) => entry.sessionId === sessionId ? { ...entry, status: issue ? 'failed' : 'succeeded', lastIssue: issue, updatedAt: completedAt } : entry),
          receipts: [...get().receipts, receipt].slice(-200),
          events: appendEvent(get().events, event(issue ? 'catalogOperationalExecutionFailed' : 'catalogOperationalExecutionSucceeded', { sessionId, authorizationId: authorization.authorizationId, receiptId: receipt.receiptId, action: authorization.action, issue })),
          journal: appendJournal(get(), { at: completedAt, type: issue ? 'executionFailed' : 'executionSucceeded', authorizationId: authorization.authorizationId, sessionId, receiptId: receipt.receiptId, details: { receiptChecksum: receipt.checksum, issue } })
        });
        return issue ? { ok: false, issue, receipt } : { ok: true, receipt };
      },
      resumeInterruptedExecution: (sessionId, humanConfirmed) => get().confirmAndExecute(sessionId, humanConfirmed),
      recoverInterruptedSessions: () => {
        const interrupted = get().sessions.filter((entry) => entry.status === 'executing');
        if (!interrupted.length) return 0;
        let journal = get().journal;
        for (const session of interrupted) journal = appendJournal({ journal, journalArchives: get().journalArchives } as CatalogOperationalAuthorizationState, { at: nowIso(), type: 'executionInterrupted', authorizationId: session.authorizationId, sessionId: session.sessionId });
        set({ sessions: get().sessions.map((entry) => entry.status === 'executing' ? { ...entry, status: 'interrupted', lastIssue: 'A aplicação foi encerrada durante a execução.', updatedAt: nowIso() } : entry), journal, events: appendEvent(get().events, event('catalogOperationalInterruptedSessionsRecovered', { count: interrupted.length })) });
        return interrupted.length;
      },
      reconcileReceipt: (receiptId, acknowledgeWarnings = false) => {
        try {
          const receipt = get().receipts.find((entry) => entry.receiptId === receiptId);
          if (!receipt) throw new Error('Recibo operacional não encontrado.');
          const previous = get().reconciliations[receiptId];
          const warningCodes = acknowledgeWarnings ? (previous?.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.code) ?? ['OPERATIONAL_EXECUTION_FAILED']) : [];
          const reconciliation = createCatalogOperationalReconciliation({ receipt, actual: actualSnapshotForReceipt(receipt), acknowledgedWarningCodes: warningCodes });
          const at = nowIso();
          set({ reconciliations: { ...get().reconciliations, [receiptId]: reconciliation }, journal: appendJournal(get(), { at, type: reconciliation.status === 'failed' ? 'reconciliationFailed' : 'reconciliationCompleted', authorizationId: receipt.authorizationId, receiptId, details: { reconciliationChecksum: reconciliation.checksum, status: reconciliation.status, issueCodes: reconciliation.issues.map((issue) => issue.code) } }), events: appendEvent(get().events, event('catalogOperationalReconciled', { receiptId, status: reconciliation.status })) });
          return { ok: true, reconciliation };
        } catch (error) { return { ok: false, issue: error instanceof Error ? error.message : 'A reconciliação falhou.' }; }
      },
      closeOperation: (receiptId, acknowledgeWarnings = false) => {
        try {
          let reconciliation = get().reconciliations[receiptId];
          if (!reconciliation || (reconciliation.status === 'warning' && acknowledgeWarnings)) {
            const rerun = get().reconcileReceipt(receiptId, acknowledgeWarnings);
            if (!rerun.ok || !rerun.reconciliation) throw new Error(rerun.issue ?? 'A reconciliação não pôde ser concluída.');
            reconciliation = rerun.reconciliation;
          }
          if (!validateCatalogOperationalReconciliation(reconciliation) || reconciliation.status === 'failed' || reconciliation.status === 'warning') throw new Error('A operação possui divergências ou avisos não reconhecidos.');
          const receipt = get().receipts.find((entry) => entry.receiptId === receiptId);
          if (!receipt) throw new Error('O recibo não está disponível.');
          const closedAt = nowIso();
          const journal = appendJournal(get(), { at: closedAt, type: 'operationClosed', authorizationId: receipt.authorizationId, receiptId, details: { reconciliationChecksum: reconciliation.checksum } });
          const evidence = createCatalogOperationalEvidence({ receipt, reconciliation, journalEntries: journal, archives: get().journalArchives, closedAt });
          set({ journal, evidence: [...get().evidence.filter((entry) => entry.receipt.receiptId !== receiptId), evidence].slice(-300), sessions: get().sessions.map((entry) => entry.authorizationId === receipt.authorizationId ? { ...entry, status: 'closed', updatedAt: closedAt } : entry), events: appendEvent(get().events, event('catalogOperationalClosed', { receiptId, evidenceId: evidence.evidenceId })) });
          return { ok: true, evidence };
        } catch (error) { return { ok: false, issue: error instanceof Error ? error.message : 'A operação não pôde ser encerrada.' }; }
      },
      importRecoveryAuthorization: (rawText, registry) => {
        try {
          const authorization = parseSignedCatalogOperationalRecoveryAuthorization(rawText);
          const receipt = get().receipts.find((entry) => entry.checksum === authorization.receiptChecksum);
          const reconciliation = Object.values(get().reconciliations).find((entry) => entry.checksum === authorization.reconciliationChecksum);
          if (!receipt || !reconciliation) throw new Error('O recibo ou a reconciliação da recuperação não está disponível.');
          assertCatalogOperationalRecoveryUnused(authorization, get().recoveryExecutions.map((entry) => entry.recoveryAuthorizationChecksum), get().recoveryExecutions.map((entry) => entry.nonce));
          const verified = verifySignedCatalogOperationalRecoveryAuthorization({ authorization, registry, receipt, reconciliation });
          set({ recoveryAuthorizations: [...get().recoveryAuthorizations.filter((entry) => entry.authorizationId !== verified.authorizationId), verified].slice(-100), journal: appendJournal(get(), { at: nowIso(), type: 'recoveryAuthorizationAccepted', authorizationId: receipt.authorizationId, receiptId: receipt.receiptId, details: { recoveryAuthorizationId: verified.authorizationId, action: verified.action } }) });
          return { ok: true, authorization: verified };
        } catch (error) { return { ok: false, issue: error instanceof Error ? error.message : 'A autorização de recuperação foi rejeitada.' }; }
      },
      importRecoveryConfirmation: (rawText, registry) => {
        try {
          const confirmation = parseSignedCatalogOperationalRecoveryConfirmation(rawText);
          const authorization = get().recoveryAuthorizations.find((entry) => catalogOperationalRecoveryAuthorizationChecksum(entry) === confirmation.recoveryAuthorizationChecksum);
          if (!authorization) throw new Error('Importe primeiro a autorização de recuperação correspondente.');
          const verified = verifySignedCatalogOperationalRecoveryConfirmation({ confirmation, authorization, registry });
          set({ recoveryConfirmations: { ...get().recoveryConfirmations, [verified.recoveryAuthorizationChecksum]: verified } });
          return { ok: true, confirmation: verified };
        } catch (error) { return { ok: false, issue: error instanceof Error ? error.message : 'A confirmação da recuperação foi rejeitada.' }; }
      },
      executeRecovery: async (authorizationId, humanConfirmed) => {
        if (humanConfirmed !== true) return { ok: false, issue: 'A confirmação humana da recuperação é obrigatória.' };
        const authorization = get().recoveryAuthorizations.find((entry) => entry.authorizationId === authorizationId);
        if (!authorization) return { ok: false, issue: 'Autorização de recuperação não encontrada.' };
        const receipt = get().receipts.find((entry) => entry.checksum === authorization.receiptChecksum);
        const reconciliation = Object.values(get().reconciliations).find((entry) => entry.checksum === authorization.reconciliationChecksum);
        const confirmation = get().recoveryConfirmations[catalogOperationalRecoveryAuthorizationChecksum(authorization)];
        if (!receipt || !reconciliation || !confirmation) return { ok: false, issue: 'O contexto ou a confirmação da recuperação está incompleto.' };
        try {
          verifySignedCatalogOperationalRecoveryAuthorization({ authorization, registry: useCatalogTrustStore.getState().registry, receipt, reconciliation });
          verifySignedCatalogOperationalRecoveryConfirmation({ confirmation, authorization, registry: useCatalogTrustStore.getState().registry });
          assertCatalogOperationalRecoveryUnused(authorization, get().recoveryExecutions.map((entry) => entry.recoveryAuthorizationChecksum), get().recoveryExecutions.map((entry) => entry.nonce));
        } catch (error) { return { ok: false, issue: error instanceof Error ? error.message : 'A recuperação já foi consumida.' }; }
        const session = get().sessions.find((entry) => entry.authorizationId === receipt.authorizationId);
        let issue: string | undefined;
        try { await executeRecoveryAction({ authorization, receipt, session }); }
        catch (error) { issue = error instanceof Error ? error.message : 'A recuperação operacional falhou.'; }
        const completedAt = nowIso();
        const execution: CatalogOperationalRecoveryExecution = { recoveryAuthorizationChecksum: catalogOperationalRecoveryAuthorizationChecksum(authorization), nonce: authorization.nonce, receiptId: receipt.receiptId, action: authorization.action, completedAt, status: issue ? 'failed' : 'succeeded', ...(issue ? { issue } : {}) };
        let nextReconciliation: CatalogOperationalReconciliation | undefined;
        if (!issue) {
          const expectedOverride = authorization.action === 'rollbackCheckpoint' && session
            ? { selectedChannel: session.checkpoint.selectedChannel, operationalOverridesChecksum: sha256Hex(stableStringify(session.checkpoint.operationalOverrides)) }
            : undefined;
          nextReconciliation = createCatalogOperationalReconciliation({ receipt, actual: actualSnapshotForReceipt(receipt), expectedOverride });
        }
        set({ recoveryExecutions: [...get().recoveryExecutions, execution].slice(-200), ...(nextReconciliation ? { reconciliations: { ...get().reconciliations, [receipt.receiptId]: nextReconciliation } } : {}), journal: appendJournal(get(), { at: completedAt, type: 'recoveryExecuted', authorizationId: receipt.authorizationId, receiptId: receipt.receiptId, details: { recoveryAuthorizationId: authorization.authorizationId, action: authorization.action, status: execution.status, issue } }), events: appendEvent(get().events, event('catalogOperationalRecoveryExecuted', { receiptId: receipt.receiptId, action: authorization.action, status: execution.status, issue })) });
        return issue ? { ok: false, issue } : { ok: true, reconciliation: nextReconciliation };
      },
      archiveJournal: (keepRecent = 200) => {
        try {
          const count = Math.max(0, get().journal.length - Math.max(20, keepRecent));
          if (!count) throw new Error('Não existem entradas antigas suficientes para arquivamento.');
          const segment = get().journal.slice(0, count);
          const archive = createCatalogOperationalJournalArchive(segment);
          if (!validateCatalogOperationalJournalArchive(archive)) throw new Error('O arquivo gerado não passou na verificação de integridade.');
          const remaining = get().journal.slice(count);
          if (!validateCatalogOperationalJournalChain(remaining, archive.headHash, archive.lastSequence)) throw new Error('A cadeia restante não preserva a âncora do arquivo.');
          set({ journalArchives: [...get().journalArchives, archive].slice(-20), journal: remaining, events: appendEvent(get().events, event('catalogOperationalJournalArchived', { archiveId: archive.archiveId, entries: archive.entries.length })) });
          return { ok: true, archive };
        } catch (error) { return { ok: false, issue: error instanceof Error ? error.message : 'O diário não pôde ser arquivado.' }; }
      },
      discardPrepared: (sessionId) => {
        const session = get().sessions.find((entry) => entry.sessionId === sessionId);
        if (!session || session.status !== 'prepared') return false;
        set({ sessions: get().sessions.filter((entry) => entry.sessionId !== sessionId), events: appendEvent(get().events, event('catalogOperationalExecutionDiscarded', { sessionId })) });
        return true;
      }
    }),
    {
      name: '@dnd-combat-math/catalog-operational-authorization/v2',
      version: CATALOG_OPERATIONAL_AUTHORIZATION_STORE_VERSION,
      storage: createJSONStorage(() => characterStorage),
      migrate: (persisted: unknown) => {
        const state = (persisted ?? {}) as Partial<CatalogOperationalAuthorizationState>;
        return { ...state, journal: state.journal ?? [], journalArchives: state.journalArchives ?? [], reconciliations: state.reconciliations ?? {}, evidence: state.evidence ?? [], recoveryAuthorizations: state.recoveryAuthorizations ?? [], recoveryConfirmations: state.recoveryConfirmations ?? {}, recoveryExecutions: state.recoveryExecutions ?? [] } as CatalogOperationalAuthorizationState;
      },
      onRehydrateStorage: () => (state) => { state?.recoverInterruptedSessions(); },
      partialize: (state) => ({ authorizations: state.authorizations, confirmations: state.confirmations, sessions: state.sessions, receipts: state.receipts, events: state.events, journal: state.journal, journalArchives: state.journalArchives, reconciliations: state.reconciliations, evidence: state.evidence, recoveryAuthorizations: state.recoveryAuthorizations, recoveryConfirmations: state.recoveryConfirmations, recoveryExecutions: state.recoveryExecutions })
    }
  )
);
