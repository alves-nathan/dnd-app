import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_CATALOG_NETWORK_POLICY,
  assessCatalogMirrorStatus,
  createFetchCatalogMirrorTransport,
  parseSignedCatalogDistributionManifest,
  rankCatalogMirrors,
  validateCatalogDownloadEvidence,
  verifySignedCatalogDistributionManifest,
  type CatalogDownloadEvidence,
  type CatalogDownloadSession,
  type CatalogMirrorObservation,
  type CatalogMirrorTransport,
  type CatalogNetworkPolicy,
  type CatalogNetworkSnapshot,
  type SignedCatalogDistributionManifest
} from '../catalog/catalogDistribution';
import type { CatalogRemoteManifestVerification, CatalogTransparencyLog } from '../catalog/catalogTransparency';
import { runCatalogDownloadCoordinator } from '../catalog/catalogDownloadCoordinator';
import type { CatalogTrustRegistry } from '../catalog/catalogTrust';
import type { CharacterCompatibilityReport } from '../characters/characterCompatibility';
import { sha256Hex } from '../catalog/catalogBundleDigest';
import { characterStorage } from '../storage/characterStorage';
import { asyncStorageAdapter } from '../storage/asyncStorageAdapter';
import { createCatalogDownloadCacheRepository, type CatalogCachedBundleDescriptor } from '../storage/catalogDownloadCacheRepository';
import { useCatalogUpdateSessionStore } from './catalogUpdateSessionStore';
import { useCatalogTrustStore } from './catalogTrustStore';
import { useCatalogPublicationStore } from './catalogPublicationStore';
import { useCatalogRolloutHealthStore } from './catalogRolloutHealthStore';
import { migrateCatalogDistributionPersistenceState } from '../releaseCandidate/persistenceMigrations';

export const CATALOG_DISTRIBUTION_STORE_VERSION = 2;

export interface CatalogDistributionEvent {
  id: string;
  at: string;
  type: string;
  details?: Record<string, unknown>;
}

export interface CatalogDistributionState {
  policy: CatalogNetworkPolicy;
  manifests: Record<string, SignedCatalogDistributionManifest>;
  observations: Record<string, CatalogMirrorObservation[]>;
  sessions: Record<string, CatalogDownloadSession>;
  cachedBundles: Record<string, CatalogCachedBundleDescriptor>;
  evidence: CatalogDownloadEvidence[];
  events: CatalogDistributionEvent[];
  pauseRequested: Record<string, boolean>;
  setPolicy: (policy: CatalogNetworkPolicy) => void;
  importManifest: (rawText: string, params: { registry: CatalogTrustRegistry; remoteManifest?: CatalogRemoteManifestVerification; localLog?: CatalogTransparencyLog }) => { ok: boolean; issue?: string; manifest?: SignedCatalogDistributionManifest };
  probeMirrors: (publisherId: string) => Promise<{ ok: boolean; observations: CatalogMirrorObservation[]; issue?: string }>;
  startOrResumeDownload: (publisherId: string, network: CatalogNetworkSnapshot, options?: { mirrorId?: string; automatic?: boolean; manualOverride?: boolean }) => Promise<{ ok: boolean; issue?: string; cacheId?: string }>;
  requestPause: (sessionId: string) => void;
  cancelDownload: (sessionId: string) => Promise<void>;
  prepareCachedUpdate: (cacheId: string, currentReports: CharacterCompatibilityReport[]) => Promise<{ ok: boolean; issues: string[] }>;
  removeCachedBundle: (cacheId: string) => Promise<boolean>;
  clearManifest: (publisherId: string) => void;
}

const cache = createCatalogDownloadCacheRepository(asyncStorageAdapter);
let mirrorTransport: CatalogMirrorTransport = createFetchCatalogMirrorTransport();
export const setCatalogMirrorTransportForTests = (transport: CatalogMirrorTransport): void => { mirrorTransport = transport; };

const event = (type: string, details?: Record<string, unknown>): CatalogDistributionEvent => ({ id: `distribution-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), type, ...(details ? { details } : {}) });
const sessionKey = (publisherId: string, sequence: number): string => `${publisherId}:${sequence}`;

export const useCatalogDistributionStore = create<CatalogDistributionState>()(
  persist(
    (set, get) => ({
      policy: DEFAULT_CATALOG_NETWORK_POLICY,
      manifests: {},
      observations: {},
      sessions: {},
      cachedBundles: {},
      evidence: [],
      events: [],
      pauseRequested: {},
      setPolicy: (policy) => set({ policy: { ...policy }, events: [...get().events, event('networkPolicyUpdated', { mode: policy.mode })].slice(-200) }),
      importManifest: (rawText, params) => {
        try {
          const manifest = parseSignedCatalogDistributionManifest(rawText);
          const verification = verifySignedCatalogDistributionManifest({ manifest, ...params });
          set({ manifests: { ...get().manifests, [manifest.publisherId]: manifest }, observations: { ...get().observations, [manifest.publisherId]: [] }, events: [...get().events, event('distributionManifestAccepted', { publisherId: verification.publisherId, sequence: verification.sequence, mirrors: verification.mirrorCount })].slice(-200) });
          return { ok: true, manifest };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'O manifesto de distribuição foi rejeitado.';
          set({ events: [...get().events, event('distributionManifestRejected', { issue })].slice(-200) });
          return { ok: false, issue };
        }
      },
      probeMirrors: async (publisherId) => {
        const manifest = get().manifests[publisherId];
        if (!manifest) return { ok: false, observations: [], issue: 'Nenhum manifesto de distribuição foi validado para este publicador.' };
        const observations = await Promise.all(manifest.mirrors.map(async (mirror): Promise<CatalogMirrorObservation> => {
          try {
            const result = await mirrorTransport.probe(mirror, manifest);
            return assessCatalogMirrorStatus(manifest, mirror, result.status, result.latencyMs);
          } catch (error) {
            return { mirrorId: mirror.mirrorId, checkedAt: new Date().toISOString(), status: 'unavailable', issue: error instanceof Error ? error.message : 'Mirror indisponível.' };
          }
        }));
        set({ observations: { ...get().observations, [publisherId]: observations }, events: [...get().events, event('mirrorsProbed', { publisherId, available: observations.filter((entry) => entry.status === 'available').length, conflicting: observations.filter((entry) => entry.status === 'conflicting').length, stale: observations.filter((entry) => entry.status === 'stale').length })].slice(-200) });
        const available = observations.some((entry) => entry.status === 'available');
        return { ok: available, observations, ...(available ? {} : { issue: 'Nenhum mirror consistente está disponível.' }) };
      },
      startOrResumeDownload: async (publisherId, network, options = {}) => {
        const startedAt = Date.now();
        let publicationContext: { publicationId: string; publisherId: string; channel: 'stable' | 'beta' | 'preview'; cohortScore: number } | undefined;
        const manifest = get().manifests[publisherId];
        if (!manifest) return { ok: false, issue: 'Nenhum manifesto de distribuição foi validado.' };
        const key = sessionKey(publisherId, manifest.sequence);
        try {
          const eligibility = useCatalogPublicationStore.getState().assertDistributionEligible(manifest);
          publicationContext = { publicationId: eligibility.publicationId, publisherId: eligibility.publisherId, channel: eligibility.channel, cohortScore: eligibility.cohortScore };
          useCatalogRolloutHealthStore.getState().recordSignal({ ...publicationContext, type: 'downloadStarted' });
          set({ events: [...get().events, event('publicationEligibilityAccepted', { publisherId, publicationId: eligibility.publicationId, channel: eligibility.channel, evidenceId: eligibility.evidenceId })].slice(-200) });
          let observations = get().observations[publisherId] ?? [];
          if (!rankCatalogMirrors(manifest, observations).length) {
            const probe = await get().probeMirrors(publisherId);
            observations = probe.observations;
            if (!probe.ok) throw new Error(probe.issue ?? 'Nenhum mirror consistente está disponível.');
          }
          const result = await runCatalogDownloadCoordinator({
            manifest,
            observations,
            repository: cache,
            transport: mirrorTransport,
            policy: get().policy,
            network,
            registry: useCatalogTrustStore.getState().registry,
            session: get().sessions[key],
            automatic: options.automatic,
            manualOverride: options.manualOverride,
            preferredMirrorId: options.mirrorId,
            shouldPause: () => Boolean(get().pauseRequested[get().sessions[key]?.id ?? '']),
            onSession: (session) => set({ sessions: { ...get().sessions, [key]: session } })
          });
          if (!result.ok || !result.evidence || !result.rawText) {
            if (publicationContext) useCatalogRolloutHealthStore.getState().recordSignal({ ...publicationContext, type: 'downloadFailed', durationMs: Date.now() - startedAt, issueCode: result.issue ?? 'downloadInterrupted' });
            set({
              sessions: { ...get().sessions, [key]: result.session },
              events: [...get().events, event('downloadInterrupted', { publisherId, sequence: manifest.sequence, issue: result.issue })].slice(-200)
            });
            return { ok: false, issue: result.issue ?? 'O download foi interrompido.' };
          }
          const session = result.session;
          const cacheId = `catalog-cache-${publisherId}-${manifest.sequence}-${manifest.bundleChecksum.slice(0, 12)}`;
          const descriptor: CatalogCachedBundleDescriptor = {
            cacheId,
            publisherId,
            sequence: manifest.sequence,
            catalogVersion: manifest.catalogVersion,
            snapshotId: manifest.snapshotId,
            catalogChecksum: manifest.catalogChecksum,
            bundleChecksum: manifest.bundleChecksum,
            manifestChecksum: session.manifestChecksum,
            bundleByteLength: manifest.bundleByteLength,
            chunkCount: manifest.chunks.length,
            cachedAt: result.evidence.completedAt,
            lastVerifiedAt: result.evidence.completedAt,
            evidenceId: result.evidence.evidenceId
          };
          await cache.cacheVerifiedBundle(descriptor, result.evidence);
          if (publicationContext) useCatalogRolloutHealthStore.getState().recordSignal({ ...publicationContext, type: 'downloadSucceeded', durationMs: Date.now() - startedAt });
          set({
            sessions: { ...get().sessions, [key]: session },
            cachedBundles: { ...get().cachedBundles, [cacheId]: descriptor },
            evidence: [...get().evidence.filter((entry) => entry.evidenceId !== result.evidence!.evidenceId), result.evidence].slice(-50),
            pauseRequested: { ...get().pauseRequested, [session.id]: false },
            events: [...get().events, event('bundleCachedOffline', { publisherId, sequence: manifest.sequence, cacheId, mirrors: result.evidence.usedMirrorIds })].slice(-200)
          });
          return { ok: true, cacheId };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'O download não pôde ser concluído.';
          if (publicationContext) useCatalogRolloutHealthStore.getState().recordSignal({ ...publicationContext, type: issue.toLowerCase().includes('integridade') || issue.toLowerCase().includes('checksum') ? 'integrityFailed' : 'downloadFailed', durationMs: Date.now() - startedAt, issueCode: issue });
          const current = get().sessions[key];
          if (current) {
            const failed: CatalogDownloadSession = { ...current, status: 'paused', updatedAt: new Date().toISOString(), lastError: issue };
            set({ sessions: { ...get().sessions, [key]: failed }, events: [...get().events, event('downloadInterrupted', { publisherId, sequence: manifest.sequence, issue })].slice(-200) });
            await cache.saveSession(failed, manifest);
          }
          return { ok: false, issue };
        }
      },
      requestPause: (sessionId) => set({ pauseRequested: { ...get().pauseRequested, [sessionId]: true } }),
      cancelDownload: async (sessionId) => {
        const entry = Object.entries(get().sessions).find(([, session]) => session.id === sessionId);
        if (!entry) return;
        const [key, session] = entry;
        const cancelled = { ...session, status: 'cancelled' as const, updatedAt: new Date().toISOString(), lastError: undefined };
        set({ sessions: { ...get().sessions, [key]: cancelled }, events: [...get().events, event('downloadCancelled', { sessionId })].slice(-200) });
        const manifest = get().manifests[session.publisherId];
        if (manifest) await cache.saveSession(cancelled, manifest);
      },
      prepareCachedUpdate: async (cacheId, currentReports) => {
        try {
          const loaded = await cache.readCachedBundle(cacheId);
          if (!validateCatalogDownloadEvidence(loaded.evidence)) throw new Error('A evidência do download offline foi adulterada.');
          if (get().policy.verifyCachedBundleOnRead && sha256Hex(loaded.rawText) !== loaded.descriptor.bundleChecksum) throw new Error('O cache offline foi alterado depois da verificação.');
          const manifest = Object.values(get().manifests).find((entry) => entry.publisherId === loaded.descriptor.publisherId && entry.sequence === loaded.descriptor.sequence && entry.bundleChecksum === loaded.descriptor.bundleChecksum);
          if (!manifest) throw new Error('O manifesto de distribuição correspondente ao cache não está disponível.');
          const eligibility = useCatalogPublicationStore.getState().assertDistributionEligible(manifest);
          useCatalogRolloutHealthStore.getState().recordSignal({ publicationId: eligibility.publicationId, publisherId: eligibility.publisherId, channel: eligibility.channel, type: 'previewOpened', cohortScore: eligibility.cohortScore });
          return await useCatalogUpdateSessionStore.getState().prepareCandidate({ rawText: loaded.rawText, sourceName: `cache offline ${loaded.descriptor.publisherId} #${loaded.descriptor.sequence}`, expectedChecksum: loaded.descriptor.bundleChecksum, currentReports });
        } catch (error) {
          return { ok: false, issues: [error instanceof Error ? error.message : 'O cache offline não pôde ser preparado.'] };
        }
      },
      removeCachedBundle: async (cacheId) => {
        const removed = await cache.removeCachedBundle(cacheId);
        if (removed) {
          const next = { ...get().cachedBundles };
          delete next[cacheId];
          set({ cachedBundles: next, events: [...get().events, event('cachedBundleRemoved', { cacheId })].slice(-200) });
        }
        return removed;
      },
      clearManifest: (publisherId) => {
        const manifests = { ...get().manifests }; delete manifests[publisherId];
        const observations = { ...get().observations }; delete observations[publisherId];
        set({ manifests, observations });
      }
    }),
    {
      name: '@dnd-combat-math/catalog-distribution/v1',
      version: CATALOG_DISTRIBUTION_STORE_VERSION,
      storage: createJSONStorage(() => characterStorage),
      migrate: (persisted) => migrateCatalogDistributionPersistenceState(persisted),
      partialize: (state: CatalogDistributionState) => ({ policy: state.policy, manifests: state.manifests, observations: state.observations, sessions: state.sessions, cachedBundles: state.cachedBundles, evidence: state.evidence, events: state.events })
    }
  )
);
