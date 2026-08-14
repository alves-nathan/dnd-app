import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { characterStorage } from '../storage/characterStorage';
import {
  acceptVerifiedCatalogBundle,
  addCommunityPublisher,
  applyCatalogKeyRevocation,
  applyCatalogKeyRotation,
  type CatalogEcPublicJwk,
  type CatalogKeyRevocationStatement,
  type CatalogKeyRotationStatement,
  type CatalogTrustRegistry,
  type CatalogTrustVerification
} from '../catalog/catalogTrust';
import { createDefaultCatalogTrustRegistry } from '../catalog/catalogTrustDefaults';

export const CATALOG_TRUST_STORE_VERSION = 1;

export interface CatalogTrustStore {
  registry: CatalogTrustRegistry;
  addCommunityPublisher: (params: { publisherId: string; displayName: string; keyId: string; publicJwk: CatalogEcPublicJwk; acknowledgedFingerprint: string }) => { ok: boolean; issue?: string };
  applyRotation: (statement: CatalogKeyRotationStatement) => { ok: boolean; issue?: string };
  applyRevocation: (statement: CatalogKeyRevocationStatement) => { ok: boolean; issue?: string };
  acceptBundle: (verification: CatalogTrustVerification, catalogVersion: string, snapshotId: string) => { ok: boolean; issue?: string };
  replaceRegistry: (registry: CatalogTrustRegistry) => void;
}

const attempt = (action: () => CatalogTrustRegistry, set: (state: Partial<CatalogTrustStore>) => void): { ok: boolean; issue?: string } => {
  try {
    set({ registry: action() });
    return { ok: true };
  } catch (error) {
    return { ok: false, issue: error instanceof Error ? error.message : 'A operação de confiança falhou.' };
  }
};

export const useCatalogTrustStore = create<CatalogTrustStore>()(
  persist(
    (set, get) => ({
      registry: createDefaultCatalogTrustRegistry(),
      addCommunityPublisher: (params) => attempt(() => addCommunityPublisher(get().registry, params), set),
      applyRotation: (statement) => attempt(() => applyCatalogKeyRotation(get().registry, statement), set),
      applyRevocation: (statement) => attempt(() => applyCatalogKeyRevocation(get().registry, statement), set),
      acceptBundle: (verification, catalogVersion, snapshotId) => attempt(() => acceptVerifiedCatalogBundle(get().registry, verification, catalogVersion, snapshotId), set),
      replaceRegistry: (registry) => set({ registry: JSON.parse(JSON.stringify(registry)) as CatalogTrustRegistry })
    }),
    {
      name: '@dnd-combat-math/catalog-trust/v1',
      version: CATALOG_TRUST_STORE_VERSION,
      storage: createJSONStorage(() => characterStorage),
      partialize: (state) => ({ registry: state.registry })
    }
  )
);
