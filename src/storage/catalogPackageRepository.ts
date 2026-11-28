import type { KeyValueStorageAdapter } from './keyValueStorage';

export const CATALOG_PACKAGE_INDEX_KEY = '@dnd-combat-math/catalog-packages/v1';
export const CATALOG_PACKAGE_SCHEMA = 'dnd-catalog-package-index.v1' as const;
const CHUNK_SIZE = 128 * 1024;

export interface CatalogPackageDescriptor {
  id: string;
  catalogVersion: string;
  snapshotId: string;
  checksum: string;
  byteLength: number;
  chunkCount: number;
  stagedAt: string;
  sourceName?: string;
}

export type CatalogRuntimePackageRef = { kind: 'bundled' } | { kind: 'stored'; packageId: string };

export interface CatalogPackageIndexDocument {
  schemaVersion: typeof CATALOG_PACKAGE_SCHEMA;
  active: CatalogRuntimePackageRef;
  previous?: CatalogRuntimePackageRef;
  packages: Record<string, CatalogPackageDescriptor>;
  updatedAt: string;
}

const utf8ByteLength = (value: string): number => {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      length += 4;
      index += 1;
    } else length += 3;
  }
  return length;
};

const chunkKey = (packageId: string, index: number): string => `${CATALOG_PACKAGE_INDEX_KEY}/package/${packageId}/chunk/${index}`;
const cloneRef = (ref: CatalogRuntimePackageRef | undefined): CatalogRuntimePackageRef | undefined => ref ? { ...ref } : undefined;

export const createCatalogPackageRepository = (
  storage: KeyValueStorageAdapter,
  now: () => Date = () => new Date()
) => {
  const loadIndex = async (): Promise<CatalogPackageIndexDocument> => {
    const raw = await storage.getItem(CATALOG_PACKAGE_INDEX_KEY);
    if (!raw) return { schemaVersion: CATALOG_PACKAGE_SCHEMA, active: { kind: 'bundled' }, packages: {}, updatedAt: now().toISOString() };
    try {
      const parsed = JSON.parse(raw) as CatalogPackageIndexDocument;
      if (parsed.schemaVersion !== CATALOG_PACKAGE_SCHEMA || !parsed.active || !parsed.packages) throw new Error('index');
      return parsed;
    } catch {
      return { schemaVersion: CATALOG_PACKAGE_SCHEMA, active: { kind: 'bundled' }, packages: {}, updatedAt: now().toISOString() };
    }
  };
  const saveIndex = async (index: CatalogPackageIndexDocument): Promise<void> => storage.setItem(CATALOG_PACKAGE_INDEX_KEY, JSON.stringify(index));

  const readPackage = async (packageId: string): Promise<{ descriptor: CatalogPackageDescriptor; rawText: string }> => {
    const index = await loadIndex();
    const descriptor = index.packages[packageId];
    if (!descriptor) throw new Error(`Pacote de catálogo não encontrado: ${packageId}.`);
    const chunks: string[] = [];
    for (let position = 0; position < descriptor.chunkCount; position += 1) {
      const chunk = await storage.getItem(chunkKey(packageId, position));
      if (chunk === null) throw new Error(`O pacote ${packageId} está incompleto no bloco ${position}.`);
      chunks.push(chunk);
    }
    return { descriptor, rawText: chunks.join('') };
  };

  return {
    loadIndex,
    readPackage,
    loadActive: async (): Promise<{ ref: CatalogRuntimePackageRef; descriptor?: CatalogPackageDescriptor; rawText?: string }> => {
      const index = await loadIndex();
      if (index.active.kind === 'bundled') return { ref: { kind: 'bundled' } };
      const loaded = await readPackage(index.active.packageId);
      return { ref: { ...index.active }, ...loaded };
    },
    stage: async (rawText: string, descriptor: Omit<CatalogPackageDescriptor, 'byteLength' | 'chunkCount' | 'stagedAt'>): Promise<CatalogPackageDescriptor> => {
      const chunkCount = Math.ceil(rawText.length / CHUNK_SIZE);
      const complete: CatalogPackageDescriptor = {
        ...descriptor,
        byteLength: utf8ByteLength(rawText),
        chunkCount,
        stagedAt: now().toISOString()
      };
      for (let position = 0; position < chunkCount; position += 1) {
        await storage.setItem(chunkKey(complete.id, position), rawText.slice(position * CHUNK_SIZE, (position + 1) * CHUNK_SIZE));
      }
      const index = await loadIndex();
      index.packages[complete.id] = complete;
      index.updatedAt = now().toISOString();
      await saveIndex(index);
      return complete;
    },
    activate: async (ref: CatalogRuntimePackageRef): Promise<{ previous: CatalogRuntimePackageRef; active: CatalogRuntimePackageRef }> => {
      const index = await loadIndex();
      if (ref.kind === 'stored' && !index.packages[ref.packageId]) throw new Error(`Pacote candidato desconhecido: ${ref.packageId}.`);
      const previous = cloneRef(index.active)!;
      index.previous = previous;
      index.active = cloneRef(ref)!;
      index.updatedAt = now().toISOString();
      await saveIndex(index);
      return { previous, active: cloneRef(ref)! };
    },
    restoreActive: async (active: CatalogRuntimePackageRef, previous?: CatalogRuntimePackageRef): Promise<void> => {
      const index = await loadIndex();
      index.active = cloneRef(active)!;
      index.previous = cloneRef(previous);
      index.updatedAt = now().toISOString();
      await saveIndex(index);
    },
    remove: async (packageId: string): Promise<boolean> => {
      const index = await loadIndex();
      if (index.active.kind === 'stored' && index.active.packageId === packageId) return false;
      const descriptor = index.packages[packageId];
      if (!descriptor) return false;
      for (let position = 0; position < descriptor.chunkCount; position += 1) await storage.removeItem(chunkKey(packageId, position));
      delete index.packages[packageId];
      if (index.previous?.kind === 'stored' && index.previous.packageId === packageId) delete index.previous;
      index.updatedAt = now().toISOString();
      await saveIndex(index);
      return true;
    }
  };
};

// Shared read-only inventory helpers: same exact persisted chunk format.
export {CHUNK_SIZE as CATALOG_PACKAGE_CHUNK_SIZE,utf8ByteLength as catalogPackageByteLength,chunkKey as catalogPackageChunkKey};
