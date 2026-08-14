import type { CatalogFilterState, CatalogSnapshot, DigestAdapter } from './types';
import { stableStringify } from './utils';

export interface SavedRulesSnapshot {
  schemaVersion: 'dnd-combat-rules-snapshot.v1';
  snapshotId: string;
  catalogSnapshotId: string;
  catalogVersion: string;
  createdAt: string;
  filterState: CatalogFilterState;
  pinnedEntityIds: string[];
  digest: string;
}

export class CatalogSnapshotService {
  constructor(
    private readonly snapshot: CatalogSnapshot,
    private readonly digest: DigestAdapter,
    private readonly now: () => Date = () => new Date()
  ) {}

  async create(filterState: CatalogFilterState, pinnedEntityIds: string[] = []): Promise<SavedRulesSnapshot> {
    const normalized = {
      schemaVersion: 'dnd-combat-rules-snapshot.v1' as const,
      catalogSnapshotId: this.snapshot.snapshotId,
      catalogVersion: this.snapshot.catalogVersion,
      createdAt: this.now().toISOString(),
      filterState: {
        bookStates: { ...filterState.bookStates },
        categoryStates: { ...filterState.categoryStates },
        entityStates: { ...filterState.entityStates }
      },
      pinnedEntityIds: Array.from(new Set(pinnedEntityIds)).sort()
    };
    const digest = await this.digest.sha256(stableStringify(normalized));
    return Object.freeze({
      ...normalized,
      snapshotId: `rules-${this.snapshot.catalogVersion}-${digest.slice(0, 16)}`,
      digest
    });
  }

  async verify(saved: SavedRulesSnapshot): Promise<boolean> {
    const { digest, snapshotId: _snapshotId, ...payload } = saved;
    return (await this.digest.sha256(stableStringify(payload))) === digest;
  }
}
