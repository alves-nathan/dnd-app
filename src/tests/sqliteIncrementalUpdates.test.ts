import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  applyCompendiumItemMappingUpdate,
  applyCompendiumItemReviewUpdate
} from '../storage/sqliteCompendiumRepository';

const source = {
  id: 'incremental-source',
  book: 'Incremental fixture',
  status: 'active' as const,
  confidence: 'exact' as const
};

const item = buildPersistedCompendiumImport({
  id: 'incremental-pack',
  source,
  items: [{
    id: 'incremental-feature',
    kind: 'feature',
    name: 'Incremental Feature',
    source,
    payload: { sourceType: 'classFeature', summary: 'original' }
  }]
}).items[0]!;

describe('SQLite incremental item transformations', () => {
  it('updates review metadata without changing unrelated persisted fields', () => {
    const updated = applyCompendiumItemReviewUpdate(item, {
      status: 'validated',
      reviewDecision: 'approved',
      reviewNotes: 'Reviewed incrementally',
      reviewedBy: 'Nathan'
    }, '2026-07-14T12:00:00.000Z');

    expect(updated.id).toBe(item.id);
    expect(updated.packId).toBe(item.packId);
    expect(updated.normalizedJson).toEqual(item.normalizedJson);
    expect(updated.status).toBe('validated');
    expect(updated.reviewDecision).toBe('approved');
    expect(updated.reviewNotes).toBe('Reviewed incrementally');
    expect(updated.reviewedBy).toBe('Nathan');
    expect(updated.reviewedAt).toBe('2026-07-14T12:00:00.000Z');
    expect(updated.updatedAt).toBe('2026-07-14T12:00:00.000Z');
  });

  it('updates normalized mapping and optional review fields atomically', () => {
    const updated = applyCompendiumItemMappingUpdate(item, {
      normalizedJson: { sourceType: 'classFeature', summary: 'mapped', actionCost: 'bonusAction' },
      status: 'validated',
      reviewDecision: 'approved',
      reviewedBy: 'Mapping editor'
    }, '2026-07-14T13:00:00.000Z');

    expect(updated.id).toBe(item.id);
    expect(updated.normalizedJson).toEqual({ sourceType: 'classFeature', summary: 'mapped', actionCost: 'bonusAction' });
    expect(updated.status).toBe('validated');
    expect(updated.reviewDecision).toBe('approved');
    expect(updated.reviewedBy).toBe('Mapping editor');
    expect(updated.reviewedAt).toBe('2026-07-14T13:00:00.000Z');
  });
});
