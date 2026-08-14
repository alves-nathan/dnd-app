import type { CompendiumImportV2UpsertPlan } from '../compendium/importUpsertPlan';
import type { CanonicalImportPackForPreview } from '../compendium/importPreview';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  applyCompendiumImportV2PlanToSnapshot,
  buildStoredCompendiumV2Item,
  createCompendiumV2StorageItemId
} from '../storage/compendiumV2Persistence';
import { emptyCompendiumPersistenceState } from '../storage/compendiumSnapshot';

const source = {
  id: 'phb-2024',
  book: 'Player Handbook',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const,
  rulesEra: '2024' as const,
  contentType: 'official' as const
};

const spell = (damageFormula = '1d10') => ({
  id: 'phb-2024-spell-fire-bolt',
  kind: 'spell' as const,
  name: 'Fire Bolt',
  source,
  payload: { level: 0, classes: ['Wizard'], castingTime: { kind: 'action' as const, actionCost: 'action' as const }, damageFormula }
});

const pack = (damageFormula = '1d10'): CanonicalImportPackForPreview => ({
  templateVersion: 'dnd-combat-import.v2',
  id: 'phb-2024-pack',
  source,
  items: [spell(damageFormula)]
});

const createPlan = (damageFormula = '1d10'): CompendiumImportV2UpsertPlan => ({
  packId: 'phb-2024-pack',
  creates: [{ kind: 'create', itemId: spell().id, contentHash: 'cmpv2_create', item: spell(damageFormula), changedPaths: [] }],
  updates: [],
  unchangedItemIds: [],
  unchangedContentHashes: {},
  conflictItemIds: [],
  executable: true
});

describe('Compendium Import V2 persistence transaction', () => {
  it('creates deterministic storage ids and persists contentHash', () => {
    const result = applyCompendiumImportV2PlanToSnapshot(emptyCompendiumPersistenceState(), pack(), createPlan(), {
      importedAt: '2026-08-10T23:00:00.000Z'
    });

    const item = result.snapshot.items[0]!;
    expect(item.id).toBe(createCompendiumV2StorageItemId('phb-2024-pack', spell().id));
    expect(item.importItemId).toBe(spell().id);
    expect(item.contentHash).toBe('cmpv2_create');
    expect(item.normalizedJson.contentHash).toBe('cmpv2_create');
    expect(result.pack.schemaVersion).toBe('dnd-combat-import.v2');
    expect(result.summary.created).toBe(1);
  });

  it('preserves the existing storage id and createdAt on update', () => {
    const first = applyCompendiumImportV2PlanToSnapshot(emptyCompendiumPersistenceState(), pack(), createPlan(), {
      importedAt: '2026-08-10T23:00:00.000Z'
    });
    const existing = first.snapshot.items[0]!;
    const updatePlan: CompendiumImportV2UpsertPlan = {
      packId: 'patch-pack',
      creates: [],
      updates: [{
        kind: 'update',
        itemId: spell().id,
        contentHash: 'cmpv2_updated',
        item: spell('2d10'),
        existingStorageId: existing.id,
        changedPaths: ['payload.damageFormula']
      }],
      unchangedItemIds: [],
      unchangedContentHashes: {},
      conflictItemIds: [],
      executable: true
    };
    const patchPack: CanonicalImportPackForPreview = { ...pack('2d10'), id: 'patch-pack' };

    const updated = applyCompendiumImportV2PlanToSnapshot(first.snapshot, patchPack, updatePlan, {
      importedAt: '2026-08-10T23:30:00.000Z'
    });
    const after = updated.snapshot.items[0]!;

    expect(after.id).toBe(existing.id);
    expect(after.createdAt).toBe(existing.createdAt);
    expect(after.packId).toBe(existing.packId);
    expect(after.normalizedJson.damageFormula).toBe('2d10');
    expect(updated.summary.preservedStorageIds).toEqual([existing.id]);
  });

  it('preserves a local disabled decision during content updates', () => {
    const operation = createPlan().creates[0]!;
    const existing = buildStoredCompendiumV2Item(operation, 'phb-2024-pack', '2026-08-10T22:00:00.000Z');
    const disabled: StoredCompendiumItem = {
      ...existing,
      status: 'disabled',
      reviewDecision: 'rejected',
      reviewNotes: 'Disabled locally',
      reviewedBy: 'User'
    };
    const update = { ...operation, kind: 'update' as const, contentHash: 'cmpv2_new', item: spell('2d10'), existingStorageId: disabled.id };

    const persisted = buildStoredCompendiumV2Item(update, 'phb-2024-pack', '2026-08-10T23:00:00.000Z', disabled);
    expect(persisted.status).toBe('disabled');
    expect(persisted.reviewDecision).toBe('rejected');
    expect(persisted.reviewNotes).toBe('Disabled locally');
    expect(persisted.reviewedBy).toBe('User');
  });

  it('backfills content hashes for semantically unchanged legacy rows without changing storage identity', () => {
    const first = applyCompendiumImportV2PlanToSnapshot(emptyCompendiumPersistenceState(), pack(), createPlan(), {
      importedAt: '2026-08-10T23:00:00.000Z'
    });
    const legacyLike = { ...first.snapshot.items[0]!, contentHash: undefined };
    const snapshot = { ...first.snapshot, items: [legacyLike] };
    const unchangedPlan: CompendiumImportV2UpsertPlan = {
      packId: 'phb-2024-pack',
      creates: [],
      updates: [],
      unchangedItemIds: [legacyLike.importItemId],
      unchangedContentHashes: { [legacyLike.importItemId]: 'cmpv2_backfill' },
      conflictItemIds: [],
      executable: true
    };

    const result = applyCompendiumImportV2PlanToSnapshot(snapshot, pack(), unchangedPlan, {
      importedAt: '2026-08-10T23:45:00.000Z'
    });
    expect(result.snapshot.items[0]?.id).toBe(legacyLike.id);
    expect(result.snapshot.items[0]?.contentHash).toBe('cmpv2_backfill');
    expect(result.snapshot.items[0]?.updatedAt).toBe(legacyLike.updatedAt);
    expect(result.summary.contentHashesBackfilled).toBe(1);
  });

  it('rejects stale update plans before mutating a snapshot', () => {
    const first = applyCompendiumImportV2PlanToSnapshot(emptyCompendiumPersistenceState(), pack(), createPlan());
    const existing = first.snapshot.items[0]!;
    const stalePlan: CompendiumImportV2UpsertPlan = {
      packId: 'phb-2024-pack',
      creates: [],
      updates: [{
        kind: 'update', itemId: 'other-id', contentHash: 'cmpv2_stale', item: { ...spell('2d10'), id: 'other-id' }, existingStorageId: existing.id, changedPaths: []
      }],
      unchangedItemIds: [],
      unchangedContentHashes: {},
      conflictItemIds: [],
      executable: true
    };

    expect(() => applyCompendiumImportV2PlanToSnapshot(first.snapshot, { ...pack('2d10'), items: [{ ...spell('2d10'), id: 'other-id' }] }, stalePlan))
      .toThrow(/Plano V2 obsoleto/);
    expect(first.snapshot.items[0]?.importItemId).toBe(spell().id);
  });
});
