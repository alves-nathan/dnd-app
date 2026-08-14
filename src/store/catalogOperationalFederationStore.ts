import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  compareCatalogOperationalFederationConsensus,
  parseCatalogOperationalFederationPackage,
  verifyCatalogOperationalFederationPackage,
  type CatalogOperationalFederationConsensus,
  type CatalogOperationalFederationPackage
} from '../catalog/catalogOperationalFederation';
import type { CatalogTrustRegistry } from '../catalog/catalogTrust';
import { characterStorage } from '../storage/characterStorage';

export const CATALOG_OPERATIONAL_FEDERATION_STORE_VERSION = 1;

export interface CatalogOperationalImportedFederation {
  recordId: string;
  importedAt: string;
  sourceLabel?: string;
  federation: CatalogOperationalFederationPackage;
  consensus: CatalogOperationalFederationConsensus;
  readOnly: true;
}

export interface CatalogOperationalFederationEvent {
  id: string;
  at: string;
  type: string;
  details?: Record<string, unknown>;
}

export interface CatalogOperationalFederationState {
  importedFederations: CatalogOperationalImportedFederation[];
  events: CatalogOperationalFederationEvent[];
  importFederation: (rawText: string, registry: CatalogTrustRegistry, sourceLabel?: string) => { ok: boolean; issue?: string; record?: CatalogOperationalImportedFederation };
  compareFederations: (leftRecordId: string, rightRecordId: string) => ReturnType<typeof compareCatalogOperationalFederationConsensus> | undefined;
  removeFederation: (recordId: string) => boolean;
  clearFederations: () => void;
}

const event = (type: string, details?: Record<string, unknown>): CatalogOperationalFederationEvent => ({
  id: `catalog-operational-federation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  at: new Date().toISOString(),
  type,
  ...(details ? { details } : {})
});
const appendEvent = (events: CatalogOperationalFederationEvent[], next: CatalogOperationalFederationEvent): CatalogOperationalFederationEvent[] => [...events, next].slice(-300);

export const useCatalogOperationalFederationStore = create<CatalogOperationalFederationState>()(
  persist(
    (set, get) => ({
      importedFederations: [],
      events: [],
      importFederation: (rawText, registry, sourceLabel) => {
        try {
          const federation = parseCatalogOperationalFederationPackage(rawText);
          const consensus = verifyCatalogOperationalFederationPackage({ federation, registry });
          if (consensus.status === 'rejected') throw new Error(consensus.findings.filter((entry) => entry.severity === 'error').map((entry) => `${entry.code}: ${entry.message}`).join('\n') || 'A federação de auditoria foi rejeitada.');
          const record: CatalogOperationalImportedFederation = {
            recordId: `imported-operational-federation-${federation.federationId}`,
            importedAt: new Date().toISOString(),
            ...(sourceLabel?.trim() ? { sourceLabel: sourceLabel.trim() } : {}),
            federation,
            consensus,
            readOnly: true
          };
          set({
            importedFederations: [...get().importedFederations.filter((entry) => entry.recordId !== record.recordId), record].slice(-30),
            events: appendEvent(get().events, event('catalogOperationalFederationImported', {
              federationId: federation.federationId,
              status: consensus.status,
              devices: consensus.deviceCount,
              witnesses: consensus.uniqueWitnessCount,
              readOnly: true
            }))
          });
          return { ok: true, record };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'A federação de auditoria não pôde ser importada.';
          set({ events: appendEvent(get().events, event('catalogOperationalFederationRejected', { issue })) });
          return { ok: false, issue };
        }
      },
      compareFederations: (leftRecordId, rightRecordId) => {
        const left = get().importedFederations.find((entry) => entry.recordId === leftRecordId);
        const right = get().importedFederations.find((entry) => entry.recordId === rightRecordId);
        return left && right ? compareCatalogOperationalFederationConsensus(left.consensus, right.consensus) : undefined;
      },
      removeFederation: (recordId) => {
        if (!get().importedFederations.some((entry) => entry.recordId === recordId)) return false;
        set({
          importedFederations: get().importedFederations.filter((entry) => entry.recordId !== recordId),
          events: appendEvent(get().events, event('catalogOperationalFederationRemoved', { recordId }))
        });
        return true;
      },
      clearFederations: () => set({ importedFederations: [], events: appendEvent(get().events, event('catalogOperationalFederationsCleared')) })
    }),
    {
      name: '@dnd-combat-math/catalog-operational-federation/v1',
      version: CATALOG_OPERATIONAL_FEDERATION_STORE_VERSION,
      storage: createJSONStorage(() => characterStorage),
      partialize: (state: CatalogOperationalFederationState) => ({ importedFederations: state.importedFederations, events: state.events })
    }
  )
);
