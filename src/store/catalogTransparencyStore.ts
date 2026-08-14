import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { characterStorage } from '../storage/characterStorage';
import {
  appendCatalogTransparencyEntry,
  applyCatalogTrustRecovery,
  assertBundleAllowedByRemoteManifest,
  compareCatalogTransparencyLogs,
  createCatalogTransparencyLog,
  createPortableCatalogTrustDocument,
  parsePortableCatalogTrustDocument,
  verifySignedCatalogRemoteManifest,
  type CatalogRecoveryPolicy,
  type CatalogRecoveryStatement,
  type CatalogRemoteManifestVerification,
  type CatalogTransparencyAnchor,
  type CatalogTransparencyCheckpoint,
  type CatalogTransparencyLog,
  type PortableCatalogTrustDocument,
  type SignedCatalogRemoteManifest
} from '../catalog/catalogTransparency';
import type { CatalogTrustEvent, CatalogTrustRegistry, CatalogTrustVerification } from '../catalog/catalogTrust';

export const CATALOG_TRANSPARENCY_STORE_VERSION = 1;

export interface CatalogTransparencyStateDocument extends CatalogTransparencyCheckpoint {
  importedTrust?: PortableCatalogTrustDocument;
}

export interface CatalogTransparencyStore extends CatalogTransparencyStateDocument {
  ensurePublisherLog: (publisherId: string) => CatalogTransparencyLog;
  assertBundleAllowed: (verification: CatalogTrustVerification) => { ok: boolean; issue?: string };
  appendAcceptedBundle: (verification: CatalogTrustVerification) => { ok: boolean; issue?: string; anchor?: CatalogTransparencyAnchor };
  importRemoteManifest: (manifest: SignedCatalogRemoteManifest, registry: CatalogTrustRegistry) => { ok: boolean; issue?: string; verification?: CatalogRemoteManifestVerification };
  compareRemoteLog: (remote: CatalogTransparencyLog) => { ok: boolean; relation?: ReturnType<typeof compareCatalogTransparencyLogs>; issue?: string };
  exportPortableTrust: (registry: CatalogTrustRegistry) => PortableCatalogTrustDocument;
  previewPortableTrustImport: (rawText: string) => { ok: boolean; issue?: string; document?: PortableCatalogTrustDocument; conflicts?: string[] };
  applyPortableTrustImport: (currentRegistry: CatalogTrustRegistry) => { ok: boolean; issue?: string; registry?: CatalogTrustRegistry };
  clearPortableTrustImport: () => void;
  setRecoveryPolicy: (policy: CatalogRecoveryPolicy) => { ok: boolean; issue?: string };
  applyRecovery: (registry: CatalogTrustRegistry, statement: CatalogRecoveryStatement) => { ok: boolean; issue?: string; registry?: CatalogTrustRegistry };
  replaceStateDocument: (document: CatalogTransparencyStateDocument) => void;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const event = (type: string, details?: Record<string, unknown>) => ({ id: `transparency-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), type, ...(details ? { details } : {}) });

export const useCatalogTransparencyStore = create<CatalogTransparencyStore>()(
  persist(
    (set, get) => ({
      logs: {},
      remoteManifests: {},
      recoveryPolicies: [],
      importedTrust: undefined,
      events: [],
      ensurePublisherLog: (publisherId) => {
        const existing = get().logs[publisherId];
        if (existing) return existing;
        const created = createCatalogTransparencyLog(publisherId);
        set({ logs: { ...get().logs, [publisherId]: created } });
        return created;
      },
      assertBundleAllowed: (verification) => {
        try {
          const remote = get().remoteManifests[verification.publisherId];
          assertBundleAllowedByRemoteManifest(verification, remote);
          const log = get().logs[verification.publisherId];
          const latest = log?.entries[log.entries.length - 1];
          if (latest) {
            if (verification.sequence !== latest.sequence + 1) throw new Error('O bundle não estende a sequência observada no registro local.');
            if (verification.previousBundleChecksum !== latest.catalogChecksum) throw new Error('O bundle não estende o checksum observado no registro local.');
          }
          return { ok: true };
        } catch (error) {
          return { ok: false, issue: error instanceof Error ? error.message : 'O bundle falhou na política de transparência.' };
        }
      },
      appendAcceptedBundle: (verification) => {
        try {
          const current = get().logs[verification.publisherId] ?? createCatalogTransparencyLog(verification.publisherId);
          const result = appendCatalogTransparencyEntry(current, verification);
          set({ logs: { ...get().logs, [verification.publisherId]: result.log }, events: [...get().events, event('bundleAppended', { publisherId: verification.publisherId, sequence: verification.sequence, root: result.log.treeRoot })].slice(-200) });
          return { ok: true, anchor: result.anchor };
        } catch (error) {
          return { ok: false, issue: error instanceof Error ? error.message : 'O bundle não pôde ser anexado ao registro.' };
        }
      },
      importRemoteManifest: (manifest, registry) => {
        try {
          const localLog = get().logs[manifest.publisherId] ?? createCatalogTransparencyLog(manifest.publisherId);
          const verification = verifySignedCatalogRemoteManifest({ manifest, registry, localLog });
          set({ remoteManifests: { ...get().remoteManifests, [manifest.publisherId]: verification }, events: [...get().events, event('remoteManifestAccepted', { publisherId: manifest.publisherId, sequence: manifest.latestSequence, status: verification.status })].slice(-200) });
          return { ok: true, verification };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'O manifesto remoto foi rejeitado.';
          set({ events: [...get().events, event('remoteManifestRejected', { publisherId: manifest.publisherId, issue })].slice(-200) });
          return { ok: false, issue };
        }
      },
      compareRemoteLog: (remote) => {
        try {
          const local = get().logs[remote.publisherId] ?? createCatalogTransparencyLog(remote.publisherId);
          const relation = compareCatalogTransparencyLogs(local, remote);
          if (relation === 'localAhead') throw new Error('O registro remoto é anterior ao estado já observado: possível rollback do servidor.');
          if (relation === 'forked') throw new Error('O registro remoto diverge do histórico local: possível omissão ou bifurcação.');
          return { ok: true, relation };
        } catch (error) {
          return { ok: false, issue: error instanceof Error ? error.message : 'A comparação do registro falhou.' };
        }
      },
      exportPortableTrust: (registry) => createPortableCatalogTrustDocument(registry, Object.values(get().logs), get().recoveryPolicies),
      previewPortableTrustImport: (rawText) => {
        try {
          const document = parsePortableCatalogTrustDocument(rawText);
          const conflicts: string[] = [];
          for (const remote of document.logs) {
            const local = get().logs[remote.publisherId];
            if (!local) continue;
            const relation = compareCatalogTransparencyLogs(local, remote);
            if (relation === 'localAhead') conflicts.push(`${remote.publisherId}: a exportação está atrás do registro local.`);
            if (relation === 'forked') conflicts.push(`${remote.publisherId}: a exportação diverge do registro local.`);
          }
          set({ importedTrust: document });
          return { ok: true, document, conflicts };
        } catch (error) {
          return { ok: false, issue: error instanceof Error ? error.message : 'A exportação de confiança é inválida.' };
        }
      },
      applyPortableTrustImport: (currentRegistry) => {
        try {
          const document = get().importedTrust;
          if (!document) throw new Error('Nenhuma exportação foi validada para importação.');
          const currentOfficial = currentRegistry.publishers.filter((entry) => entry.kind === 'official');
          const incomingOfficial = document.registry.publishers.filter((entry) => entry.kind === 'official');
          for (const currentPublisher of currentOfficial) {
            const incomingPublisher = incomingOfficial.find((entry) => entry.publisherId === currentPublisher.publisherId);
            if (!incomingPublisher) throw new Error(`A exportação omite o publicador oficial ${currentPublisher.publisherId}.`);
            const currentCritical = { publisherId: currentPublisher.publisherId, displayName: currentPublisher.displayName, kind: currentPublisher.kind, trustLevel: currentPublisher.trustLevel, status: currentPublisher.status, keys: currentPublisher.keys };
            const incomingCritical = { publisherId: incomingPublisher.publisherId, displayName: incomingPublisher.displayName, kind: incomingPublisher.kind, trustLevel: incomingPublisher.trustLevel, status: incomingPublisher.status, keys: incomingPublisher.keys };
            if (JSON.stringify(currentCritical) !== JSON.stringify(incomingCritical)) throw new Error('Alterações em raízes oficiais, chaves ou status exigem uma declaração de recuperação em quórum; a importação direta foi bloqueada.');
            if ((incomingPublisher.lastAcceptedBundle?.sequence ?? 0) < (currentPublisher.lastAcceptedBundle?.sequence ?? 0)) throw new Error(`A âncora oficial ${currentPublisher.publisherId} está atrás do estado local.`);
          }
          const nextLogs = { ...get().logs };
          for (const remote of document.logs) {
            const local = nextLogs[remote.publisherId];
            if (!local) { nextLogs[remote.publisherId] = remote; continue; }
            const relation = compareCatalogTransparencyLogs(local, remote);
            if (relation === 'localAhead' || relation === 'forked') throw new Error(`O registro ${remote.publisherId} não pode substituir o histórico local (${relation}).`);
            if (relation === 'remoteAhead') nextLogs[remote.publisherId] = remote;
          }
          const incomingCommunity = document.registry.publishers.filter((entry) => entry.kind === 'community');
          const mergedPublishers = currentRegistry.publishers.map((publisher) => {
            if (publisher.kind !== 'official') return publisher;
            const incoming = incomingOfficial.find((entry) => entry.publisherId === publisher.publisherId);
            return incoming && (incoming.lastAcceptedBundle?.sequence ?? 0) > (publisher.lastAcceptedBundle?.sequence ?? 0) ? incoming : publisher;
          });
          for (const publisher of incomingCommunity) {
            const index = mergedPublishers.findIndex((entry) => entry.publisherId === publisher.publisherId);
            if (index < 0) mergedPublishers.push(publisher);
            else if (JSON.stringify(mergedPublishers[index]) !== JSON.stringify(publisher)) throw new Error(`O publicador comunitário ${publisher.publisherId} diverge do registro local e exige revisão manual.`);
          }
          const importedEvent: CatalogTrustEvent = { id: `trust-import-${Date.now()}`, at: new Date().toISOString(), type: 'registryImported', publisherId: 'portable-import', details: { checksum: document.checksum } };
          const registry: CatalogTrustRegistry = { ...currentRegistry, publishers: mergedPublishers, revision: Math.max(currentRegistry.revision, document.registry.revision) + 1, updatedAt: importedEvent.at, events: [...currentRegistry.events, importedEvent].slice(-150) };
          set({ logs: nextLogs, recoveryPolicies: document.recoveryPolicies, importedTrust: undefined, events: [...get().events, event('portableTrustImported', { checksum: document.checksum })].slice(-200) });
          return { ok: true, registry };
        } catch (error) {
          return { ok: false, issue: error instanceof Error ? error.message : 'A importação de confiança falhou.' };
        }
      },
      clearPortableTrustImport: () => set({ importedTrust: undefined }),
      setRecoveryPolicy: (policy) => {
        try {
          if (policy.threshold < 2 || policy.approvers.filter((entry) => entry.status === 'active').length < policy.threshold) throw new Error('A política precisa de ao menos duas aprovações ativas e quórum alcançável.');
          const policies = get().recoveryPolicies.filter((entry) => entry.publisherId !== policy.publisherId);
          set({ recoveryPolicies: [...policies, clone(policy)], events: [...get().events, event('recoveryPolicyUpdated', { publisherId: policy.publisherId, threshold: policy.threshold })].slice(-200) });
          return { ok: true };
        } catch (error) {
          return { ok: false, issue: error instanceof Error ? error.message : 'A política de recuperação é inválida.' };
        }
      },
      applyRecovery: (registry, statement) => {
        try {
          const policy = get().recoveryPolicies.find((entry) => entry.publisherId === statement.publisherId);
          if (!policy) throw new Error('Nenhuma política de recuperação em quórum foi configurada para este publicador.');
          const recovered = applyCatalogTrustRecovery(registry, policy, statement);
          set({ events: [...get().events, event('trustRecovered', { publisherId: statement.publisherId, action: statement.action })].slice(-200) });
          return { ok: true, registry: recovered };
        } catch (error) {
          return { ok: false, issue: error instanceof Error ? error.message : 'A recuperação de confiança falhou.' };
        }
      },
      replaceStateDocument: (document) => set({ logs: clone(document.logs), remoteManifests: clone(document.remoteManifests), recoveryPolicies: clone(document.recoveryPolicies), importedTrust: document.importedTrust ? clone(document.importedTrust) : undefined, events: clone(document.events) })
    }),
    {
      name: '@dnd-combat-math/catalog-transparency/v1',
      version: CATALOG_TRANSPARENCY_STORE_VERSION,
      storage: createJSONStorage(() => characterStorage),
      partialize: (state) => ({ logs: state.logs, remoteManifests: state.remoteManifests, recoveryPolicies: state.recoveryPolicies, importedTrust: state.importedTrust, events: state.events })
    }
  )
);
