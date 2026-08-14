import { ContentPolicyService } from '../catalog/contentPolicyService';
import {
  createCatalogConfigurationHistoryEntry,
  diffCatalogFilterStates
} from '../catalog/catalogConfigurationHistory';
import type { CatalogSnapshot } from '../catalog/types';
import { createCatalogFilterPreferencesRepository } from '../storage/catalogFilterPreferences';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

const snapshot = {
  snapshotId: 'catalog-app12-test',
  catalogVersion: '4.8.0',
  manifest: { sourceBooks: ['phb-2024'] },
  entries: [{ entityId: 'acid', sourceBookId: 'phb-2024', categoryIds: ['spells'], defaultEnabled: true }],
  entryById: new Map([['acid', { entityId: 'acid', sourceBookId: 'phb-2024', categoryIds: ['spells'], defaultEnabled: true }]]),
  categories: [{ id: 'spells', defaultEnabled: true, canDisable: true }],
  categoryById: new Map([['spells', { id: 'spells', defaultEnabled: true, canDisable: true }]]),
  dependenciesFrom: new Map(),
  dependenciesTo: new Map(),
  filterPolicy: { profiles: [{ id: 'full-official', name: 'Full', bookStates: { 'phb-2024': true } }] }
} as unknown as CatalogSnapshot;

describe('APP-12 catalog configuration history', () => {
  it('records before/after state and acknowledgement in the same persisted document', async () => {
    const storage = createMemoryKeyValueStorage();
    const repository = createCatalogFilterPreferencesRepository(storage, () => new Date('2026-08-04T12:00:00.000Z'));
    const policy = new ContentPolicyService(snapshot);
    const before = policy.createDefaultState();
    const after = { ...before, entityStates: { acid: 'disabled' as const } };
    const saved = await repository.save(snapshot, after, {
      beforeState: before,
      label: 'Desativar Acid Splash',
      impact: policy.previewImpact(before, after),
      context: {
        origin: 'entity',
        acknowledgement: {
          required: true,
          acknowledged: true,
          affectedCharacterIds: ['wizard'],
          preventivePlansRequested: true
        }
      }
    });
    expect(saved.revision).toBe(1);
    expect(saved.history).toHaveLength(1);
    expect(saved.historyEntry?.beforeState.entityStates.acid).toBeUndefined();
    expect(saved.historyEntry?.afterState.entityStates.acid).toBe('disabled');
    expect(saved.historyEntry?.acknowledgement.affectedCharacterIds).toEqual(['wizard']);

    const loaded = await repository.load(snapshot, before);
    expect(loaded.revision).toBe(1);
    expect(loaded.history[0].label).toBe('Desativar Acid Splash');
  });

  it('computes a precise changed-key set and creates restoration commits', () => {
    const policy = new ContentPolicyService(snapshot);
    const before = policy.createDefaultState();
    const after = { ...before, entityStates: { acid: 'disabled' as const } };
    expect(diffCatalogFilterStates(before, after).entityIds).toEqual(['acid']);
    const entry = createCatalogConfigurationHistoryEntry({
      revision: 2,
      committedAt: '2026-08-04T12:05:00.000Z',
      label: 'Restaurar configuração anterior',
      origin: 'restore',
      catalogVersion: snapshot.catalogVersion,
      catalogSnapshotId: snapshot.snapshotId,
      beforeState: after,
      afterState: before,
      impact: policy.previewImpact(after, before),
      context: { origin: 'restore', restoredFromCommitId: 'catalog-config-1' }
    });
    expect(entry.origin).toBe('restore');
    expect(entry.restoredFromCommitId).toBe('catalog-config-1');
    expect(entry.impact.enabledCount).toBe(1);
  });
});
