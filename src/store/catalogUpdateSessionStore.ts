import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { asyncStorageAdapter } from '../storage/asyncStorageAdapter';
import { characterStorage } from '../storage/characterStorage';
import { createCatalogPackageRepository } from '../storage/catalogPackageRepository';
import {
  buildCatalogUpdateImpact,
  canCommitCatalogUpdate,
  createCatalogUpdateReceipt,
  createCatalogUpdateSession,
  migrateCharacterCatalogSnapshots,
  parseAndValidateCatalogCandidate,
  parseAndValidateTrustedCatalogCandidate,
  projectCatalogFilterState,
  validateCatalogUpdateReceipt,
  type CatalogUpdateReceipt,
  type CatalogUpdateSession
} from '../catalog/catalogUpdateTransaction';
import type { CharacterCompatibilityReport } from '../characters/characterCompatibility';
import type { Character } from '../types';
import { useCatalogStore } from './catalogStore';
import { useCharacterStore } from './characterStore';
import { usePortableRestoreSessionStore } from './portableRestoreSessionStore';
import { useCatalogTrustStore } from './catalogTrustStore';
import { SIGNED_CATALOG_BUNDLE_SCHEMA, verifySignedCatalogEnvelope } from '../catalog/catalogTrust';
import { useCatalogTransparencyStore } from './catalogTransparencyStore';
import { useCatalogPublicationStore } from './catalogPublicationStore';
import { useCatalogRolloutHealthStore } from './catalogRolloutHealthStore';
import { migrateCatalogUpdateSessionPersistenceState } from '../releaseCandidate/persistenceMigrations';

export const CATALOG_UPDATE_SESSION_STORE_VERSION = 2;

export interface CatalogUpdateSessionStore {
  activeSession?: CatalogUpdateSession;
  history: CatalogUpdateReceipt[];
  prepareCandidate: (params: { rawText: string; sourceName?: string; expectedChecksum?: string; currentReports: CharacterCompatibilityReport[]; trustBypassForInternalFixture?: boolean }) => Promise<{ ok: boolean; issues: string[] }>;
  setMigrationCharacterIds: (ids: string[]) => boolean;
  acknowledgeImpact: (acknowledged: boolean) => boolean;
  acknowledgeEvidence: (acknowledged: boolean) => boolean;
  acknowledgeBlockingReferences: (acknowledged: boolean) => boolean;
  commit: () => Promise<{ ok: boolean; issues: string[] }>;
  resumeCommit: () => Promise<{ ok: boolean; issues: string[] }>;
  rollback: () => Promise<{ ok: boolean; issues: string[] }>;
  discard: () => Promise<boolean>;
  finalizeCommitted: () => Promise<boolean>;
  clearFinished: () => Promise<boolean>;
}

const packages = createCatalogPackageRepository(asyncStorageAdapter);
const nowIso = (): string => new Date().toISOString();
const publicationForSession = (session: CatalogUpdateSession) => {
  const provenance = session.trustVerification;
  if (!provenance) return undefined;
  return Object.values(useCatalogPublicationStore.getState().publications).find((entry) => entry.publisherId === provenance.publisherId && entry.sequence === provenance.sequence && entry.catalogChecksum === provenance.catalogChecksum);
};
const updateActive = (session: CatalogUpdateSession, patch: Partial<CatalogUpdateSession>): CatalogUpdateSession => ({ ...session, ...patch, updatedAt: nowIso() });

export const useCatalogUpdateSessionStore = create<CatalogUpdateSessionStore>()(
  persist(
    (set, get) => ({
      activeSession: undefined,
      history: [],
      prepareCandidate: async ({ rawText, sourceName, expectedChecksum, currentReports, trustBypassForInternalFixture }) => {
        try {
          const catalog = useCatalogStore.getState();
          if (catalog.status !== 'ready' || !catalog.snapshot || !catalog.filterState) return { ok: false, issues: ['O catálogo atual ainda não está pronto.'] };
          if (get().activeSession && !['rolledBack', 'failed'].includes(get().activeSession!.status)) return { ok: false, issues: ['Já existe uma atualização de catálogo em andamento.'] };
          const trustRegistry = useCatalogTrustStore.getState().registry;
          const trusted = trustBypassForInternalFixture
            ? undefined
            : await parseAndValidateTrustedCatalogCandidate({ rawText, currentSnapshot: catalog.snapshot, trustRegistry, expectedEnvelopeChecksum: expectedChecksum, sourceName });
          const parsed = trusted ?? await parseAndValidateCatalogCandidate({ rawText, currentSnapshot: catalog.snapshot, expectedChecksum, sourceName });
          if (trusted) {
            const transparent = useCatalogTransparencyStore.getState().assertBundleAllowed(trusted.verification);
            if (!transparent.ok) throw new Error(transparent.issue ?? 'O bundle falhou na verificação de transparência.');
          }
          const catalogRawText = trusted?.catalogRawText ?? rawText;
          const projectedFilterState = projectCatalogFilterState(catalog.filterState, parsed.snapshot);
          const characters = useCharacterStore.getState().characters;
          const evidence = usePortableRestoreSessionStore.getState().evidenceRecords;
          const impact = buildCatalogUpdateImpact({
            characters,
            currentReports,
            candidateSnapshot: parsed.snapshot,
            candidateFilterState: projectedFilterState,
            diff: parsed.diff,
            evidenceRecords: evidence,
            catalogHistory: catalog.history
          });
          const descriptor = await packages.stage(catalogRawText, {
            id: parsed.packageId,
            catalogVersion: parsed.snapshot.catalogVersion,
            snapshotId: parsed.snapshot.snapshotId,
            checksum: parsed.checksum,
            sourceName
          });
          const session = createCatalogUpdateSession({
            candidate: descriptor,
            diff: parsed.diff,
            impact,
            projectedFilterState,
            sourceName,
            checkpoint: {
              runtimeRef: catalog.runtimeRef,
              catalog: {
                filterState: catalog.filterState,
                revision: catalog.revision,
                history: catalog.history
              },
              characters,
              evidenceRecords: evidence,
              trustRegistry,
              transparency: {
                logs: JSON.parse(JSON.stringify(useCatalogTransparencyStore.getState().logs)),
                remoteManifests: JSON.parse(JSON.stringify(useCatalogTransparencyStore.getState().remoteManifests)),
                recoveryPolicies: JSON.parse(JSON.stringify(useCatalogTransparencyStore.getState().recoveryPolicies)),
                events: JSON.parse(JSON.stringify(useCatalogTransparencyStore.getState().events))
              }
            },
            ...(trusted ? { trustVerification: trusted.verification } : {}),
            ...(trustBypassForInternalFixture ? { internalFixtureBypass: true } : {})
          });
          set({ activeSession: session });
          return { ok: true, issues: [] };
        } catch (error) {
          return { ok: false, issues: [error instanceof Error ? error.message : 'O bundle candidato não pôde ser preparado.'] };
        }
      },
      setMigrationCharacterIds: (ids) => {
        const session = get().activeSession;
        if (!session || session.status !== 'prepared') return false;
        const allowed = new Set(session.impact.snapshotMigrationCharacterIds);
        set({ activeSession: updateActive(session, { migrationCharacterIds: Array.from(new Set<string>(ids)).filter((id) => allowed.has(id)).sort() }) });
        return true;
      },
      acknowledgeImpact: (acknowledged) => {
        const session = get().activeSession;
        if (!session || session.status !== 'prepared') return false;
        set({ activeSession: updateActive(session, { impactAcknowledged: acknowledged }) });
        return true;
      },
      acknowledgeEvidence: (acknowledged) => {
        const session = get().activeSession;
        if (!session || session.status !== 'prepared') return false;
        set({ activeSession: updateActive(session, { evidenceAcknowledged: acknowledged }) });
        return true;
      },
      acknowledgeBlockingReferences: (acknowledged) => {
        const session = get().activeSession;
        if (!session || session.status !== 'prepared') return false;
        set({ activeSession: updateActive(session, { blockingAcknowledged: acknowledged }) });
        return true;
      },
      commit: async () => get().resumeCommit(),
      resumeCommit: async () => {
        const commitStartedAt = Date.now();
        let session = get().activeSession;
        if (!session) return { ok: false, issues: ['Nenhuma atualização está preparada.'] };
        const validation = canCommitCatalogUpdate(session);
        if (!validation.ok) return validation;
        try {
          if (session.status === 'prepared' || session.status === 'interrupted') {
            session = updateActive(session, { status: 'committing', lastError: undefined });
            set({ activeSession: session });
          }
          if (session.commitPhase === 'none' && session.trustVerification) {
            const stored = await packages.readPackage(session.candidate.id);
            const provenance = {
              publisherId: session.trustVerification.publisherId,
              publisherName: session.trustVerification.publisherName,
              publisherKind: session.trustVerification.publisherKind,
              keyId: session.trustVerification.keyId,
              algorithm: session.trustVerification.signatureAlgorithm,
              issuedAt: session.trustVerification.issuedAt,
              ...(session.trustVerification.expiresAt ? { expiresAt: session.trustVerification.expiresAt } : {}),
              sequence: session.trustVerification.sequence,
              ...(session.trustVerification.previousBundleChecksum ? { previousBundleChecksum: session.trustVerification.previousBundleChecksum } : {}),
              catalogChecksum: session.trustVerification.catalogChecksum,
              catalogVersion: session.trustVerification.catalogVersion,
              snapshotId: session.trustVerification.snapshotId
            };
            verifySignedCatalogEnvelope({
              rawText: JSON.stringify({ schemaVersion: SIGNED_CATALOG_BUNDLE_SCHEMA, catalog: JSON.parse(stored.rawText), provenance, signature: session.trustVerification.signature }),
              registry: useCatalogTrustStore.getState().registry
            });
          }
          if (session.commitPhase === 'none') {
            session = updateActive(session, { commitPhase: 'packageActivated' });
            set({ activeSession: session });
          }
          if (session.commitPhase === 'packageActivated') {
            const result = await useCatalogStore.getState().switchRuntimeCatalog(
              { kind: 'stored', packageId: session.candidate.id },
              {
                filterState: session.projectedFilterState,
                revision: session.checkpoint.catalog.revision,
                history: session.checkpoint.catalog.history
              }
            );
            if (!result.ok) throw new Error(result.issues.join('\n'));
            session = updateActive(session, { commitPhase: 'catalogApplied' });
            set({ activeSession: session });
          }
          if (session.commitPhase === 'catalogApplied') {
            const currentCharacters = useCharacterStore.getState().characters;
            useCharacterStore.getState().setCharacters(migrateCharacterCatalogSnapshots(currentCharacters, session.migrationCharacterIds, session.diff.toSnapshotId) as unknown as Character[]);
            session = updateActive(session, { commitPhase: 'charactersMigrated' });
            set({ activeSession: session });
          }
          if (session.commitPhase === 'charactersMigrated') {
            let transparencyAnchor;
            if (session.trustVerification) {
              const accepted = useCatalogTrustStore.getState().acceptBundle(session.trustVerification, session.diff.toVersion, session.diff.toSnapshotId);
              if (!accepted.ok) throw new Error(accepted.issue ?? 'A cadeia de confiança mudou durante o commit.');
              const appended = useCatalogTransparencyStore.getState().appendAcceptedBundle(session.trustVerification);
              if (!appended.ok || !appended.anchor) throw new Error(appended.issue ?? 'O registro append-only não pôde confirmar o bundle.');
              transparencyAnchor = appended.anchor;
            }
            usePortableRestoreSessionStore.getState().markEvidenceCatalogChanged(
              session.impact.affectedEvidenceRecordIds,
              session.diff.fromVersion,
              session.diff.toVersion
            );
            const receipt = createCatalogUpdateReceipt(session, () => new Date(), transparencyAnchor);
            session = updateActive(session, { status: 'committed', commitPhase: 'complete', committedAt: receipt.committedAt, receipt });
            set({ activeSession: session, history: [...get().history, receipt].slice(-20) });
            const publication = publicationForSession(session);
            if (publication) useCatalogRolloutHealthStore.getState().recordSignal({ publicationId: publication.publicationId, publisherId: publication.publisherId, channel: publication.channel, type: 'commitSucceeded', durationMs: Date.now() - commitStartedAt });
          }
          return { ok: true, issues: [] };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'A atualização foi interrompida.';
          if (session) {
            set({ activeSession: updateActive(session, { status: 'interrupted', lastError: message }) });
            const publication = publicationForSession(session);
            if (publication) useCatalogRolloutHealthStore.getState().recordSignal({ publicationId: publication.publicationId, publisherId: publication.publisherId, channel: publication.channel, type: 'commitFailed', durationMs: Date.now() - commitStartedAt, issueCode: message });
          }
          return { ok: false, issues: [message] };
        }
      },
      rollback: async () => {
        const rollbackStartedAt = Date.now();
        let session = get().activeSession;
        const validReceipt = Boolean(session?.receipt && validateCatalogUpdateReceipt(session.receipt));
        const partialCommit = Boolean(session?.status === 'interrupted' && session.commitPhase !== 'none');
        if (!session || !['committed', 'rollingBack', 'interrupted'].includes(session.status) || (!validReceipt && !partialCommit)) return { ok: false, issues: ['Não existe commit ou checkpoint parcial íntegro para rollback.'] };
        try {
          session = updateActive(session, { status: 'rollingBack', lastError: undefined });
          set({ activeSession: session });
          const result = await useCatalogStore.getState().switchRuntimeCatalog(session.checkpoint.runtimeRef, session.checkpoint.catalog);
          if (!result.ok) throw new Error(result.issues.join('\n'));
          session = updateActive(session, { rollbackPhase: 'catalogRestored' });
          set({ activeSession: session });
          useCharacterStore.getState().setCharacters(session.checkpoint.characters as unknown as Character[]);
          usePortableRestoreSessionStore.getState().replaceEvidenceRecords(session.checkpoint.evidenceRecords);
          if (session.checkpoint.trustRegistry) useCatalogTrustStore.getState().replaceRegistry(session.checkpoint.trustRegistry);
          if (session.checkpoint.transparency) useCatalogTransparencyStore.getState().replaceStateDocument({ ...session.checkpoint.transparency, importedTrust: undefined });
          session = updateActive(session, { status: 'rolledBack', rollbackPhase: 'complete', rolledBackAt: nowIso() });
          set({ activeSession: session });
          const publication = publicationForSession(session);
          if (publication) useCatalogRolloutHealthStore.getState().recordSignal({ publicationId: publication.publicationId, publisherId: publication.publisherId, channel: publication.channel, type: 'rollbackCompleted', durationMs: Date.now() - rollbackStartedAt });
          return { ok: true, issues: [] };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'O rollback do catálogo foi interrompido.';
          set({ activeSession: updateActive(session, { status: 'interrupted', lastError: message }) });
          return { ok: false, issues: [message] };
        }
      },
      discard: async () => {
        const session = get().activeSession;
        if (!session || session.status !== 'prepared') return false;
        await packages.remove(session.candidate.id);
        set({ activeSession: undefined });
        return true;
      },
      finalizeCommitted: async () => {
        const session = get().activeSession;
        if (!session || session.status !== 'committed' || !session.receipt || !validateCatalogUpdateReceipt(session.receipt)) return false;
        if (session.checkpoint.runtimeRef.kind === 'stored') await packages.remove(session.checkpoint.runtimeRef.packageId);
        set({ activeSession: undefined });
        return true;
      },
      clearFinished: async () => {
        const session = get().activeSession;
        if (!session || !['rolledBack', 'failed'].includes(session.status)) return false;
        if (session.status === 'rolledBack') await packages.remove(session.candidate.id);
        set({ activeSession: undefined });
        return true;
      }
    }),
    {
      name: '@dnd-combat-math/catalog-update-session/v1',
      version: CATALOG_UPDATE_SESSION_STORE_VERSION,
      storage: createJSONStorage(() => characterStorage),
      migrate: (persisted, version) => migrateCatalogUpdateSessionPersistenceState(persisted, version),
      partialize: (state) => ({ activeSession: state.activeSession, history: state.history })
    }
  )
);
