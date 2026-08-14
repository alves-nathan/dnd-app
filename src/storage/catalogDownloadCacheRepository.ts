import type { KeyValueStorageAdapter } from './keyValueStorage';
import type { CatalogDownloadEvidence, CatalogDownloadSession, SignedCatalogDistributionManifest } from '../catalog/catalogDistribution';

export const CATALOG_DOWNLOAD_CACHE_SCHEMA = 'dnd-catalog-download-cache.v1' as const;
export const CATALOG_DOWNLOAD_CACHE_INDEX_KEY = '@dnd-combat-math/catalog-download-cache/v1';

export interface CatalogCachedBundleDescriptor {
  cacheId: string;
  publisherId: string;
  sequence: number;
  catalogVersion: string;
  snapshotId: string;
  catalogChecksum: string;
  bundleChecksum: string;
  manifestChecksum: string;
  bundleByteLength: number;
  chunkCount: number;
  cachedAt: string;
  lastVerifiedAt: string;
  evidenceId: string;
}

export interface CatalogDownloadCacheIndex {
  schemaVersion: typeof CATALOG_DOWNLOAD_CACHE_SCHEMA;
  sessions: Record<string, CatalogDownloadSession>;
  manifests: Record<string, SignedCatalogDistributionManifest>;
  cachedBundles: Record<string, CatalogCachedBundleDescriptor>;
  evidence: Record<string, CatalogDownloadEvidence>;
  updatedAt: string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const chunkKey = (sessionId: string, index: number): string => `${CATALOG_DOWNLOAD_CACHE_INDEX_KEY}/session/${sessionId}/chunk/${index}`;

export const createCatalogDownloadCacheRepository = (storage: KeyValueStorageAdapter, now: () => Date = () => new Date()) => {
  const empty = (): CatalogDownloadCacheIndex => ({ schemaVersion: CATALOG_DOWNLOAD_CACHE_SCHEMA, sessions: {}, manifests: {}, cachedBundles: {}, evidence: {}, updatedAt: now().toISOString() });
  const loadIndex = async (): Promise<CatalogDownloadCacheIndex> => {
    const raw = await storage.getItem(CATALOG_DOWNLOAD_CACHE_INDEX_KEY);
    if (!raw) return empty();
    try {
      const parsed = JSON.parse(raw) as CatalogDownloadCacheIndex;
      if (parsed.schemaVersion !== CATALOG_DOWNLOAD_CACHE_SCHEMA || !parsed.sessions || !parsed.manifests || !parsed.cachedBundles || !parsed.evidence) throw new Error('index');
      return parsed;
    } catch { return empty(); }
  };
  const saveIndex = async (index: CatalogDownloadCacheIndex): Promise<void> => {
    index.updatedAt = now().toISOString();
    await storage.setItem(CATALOG_DOWNLOAD_CACHE_INDEX_KEY, JSON.stringify(index));
  };
  return {
    loadIndex,
    saveSession: async (session: CatalogDownloadSession, manifest: SignedCatalogDistributionManifest): Promise<void> => {
      const index = await loadIndex();
      index.sessions[session.id] = clone(session);
      index.manifests[session.id] = clone(manifest);
      await saveIndex(index);
    },
    loadSession: async (sessionId: string): Promise<{ session: CatalogDownloadSession; manifest: SignedCatalogDistributionManifest } | undefined> => {
      const index = await loadIndex();
      const session = index.sessions[sessionId];
      const manifest = index.manifests[sessionId];
      return session && manifest ? { session: clone(session), manifest: clone(manifest) } : undefined;
    },
    writeChunk: async (sessionId: string, index: number, content: string): Promise<void> => storage.setItem(chunkKey(sessionId, index), content),
    readChunk: async (sessionId: string, index: number): Promise<string | undefined> => (await storage.getItem(chunkKey(sessionId, index))) ?? undefined,
    assemble: async (sessionId: string, chunkCount: number): Promise<string> => {
      const chunks: string[] = [];
      for (let index = 0; index < chunkCount; index += 1) {
        const content = await storage.getItem(chunkKey(sessionId, index));
        if (content === null) throw new Error(`O cache está incompleto no bloco ${index}.`);
        chunks.push(content);
      }
      return chunks.join('');
    },
    cacheVerifiedBundle: async (descriptor: CatalogCachedBundleDescriptor, evidence: CatalogDownloadEvidence): Promise<void> => {
      const index = await loadIndex();
      index.cachedBundles[descriptor.cacheId] = clone(descriptor);
      index.evidence[evidence.evidenceId] = clone(evidence);
      await saveIndex(index);
    },
    readCachedBundle: async (cacheId: string): Promise<{ descriptor: CatalogCachedBundleDescriptor; rawText: string; evidence: CatalogDownloadEvidence }> => {
      const index = await loadIndex();
      const descriptor = index.cachedBundles[cacheId];
      if (!descriptor) throw new Error('O bundle offline não existe mais no cache.');
      const session = index.sessions[descriptor.evidenceId.replace('catalog-download-evidence-', '')];
      const evidence = index.evidence[descriptor.evidenceId];
      if (!session || !evidence) throw new Error('A evidência do cache está incompleta.');
      return { descriptor: clone(descriptor), rawText: await (async () => {
        const chunks: string[] = [];
        for (let position = 0; position < descriptor.chunkCount; position += 1) {
          const content = await storage.getItem(chunkKey(session.id, position));
          if (content === null) throw new Error(`O cache está incompleto no bloco ${position}.`);
          chunks.push(content);
        }
        return chunks.join('');
      })(), evidence: clone(evidence) };
    },
    removeSession: async (sessionId: string, keepVerifiedChunks = false): Promise<void> => {
      const index = await loadIndex();
      const manifest = index.manifests[sessionId];
      const isReferenced = Object.values(index.cachedBundles).some((descriptor) => descriptor.evidenceId === `catalog-download-evidence-${sessionId}`);
      if (!keepVerifiedChunks && !isReferenced && manifest) for (const chunk of manifest.chunks) await storage.removeItem(chunkKey(sessionId, chunk.index));
      delete index.sessions[sessionId];
      delete index.manifests[sessionId];
      await saveIndex(index);
    },
    removeCachedBundle: async (cacheId: string): Promise<boolean> => {
      const index = await loadIndex();
      const descriptor = index.cachedBundles[cacheId];
      if (!descriptor) return false;
      const sessionId = descriptor.evidenceId.replace('catalog-download-evidence-', '');
      const manifest = index.manifests[sessionId];
      if (manifest) for (const chunk of manifest.chunks) await storage.removeItem(chunkKey(sessionId, chunk.index));
      delete index.cachedBundles[cacheId];
      delete index.evidence[descriptor.evidenceId];
      delete index.sessions[sessionId];
      delete index.manifests[sessionId];
      await saveIndex(index);
      return true;
    }
  };
};
