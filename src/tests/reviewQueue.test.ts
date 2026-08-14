import { buildReviewChecklistForItem, buildReviewQueue, createReviewApprovalNotes } from '../compendium/reviewQueue';
import type { StoredCompendiumItem, StoredCompendiumPack } from '../compendium/types';
import type { RuleSource } from '../types';

const source: RuleSource = {
  id: 'src-a',
  book: 'Livro próprio',
  page: '10',
  version: '1.0',
  status: 'active',
  confidence: 'exact'
};

const pack: StoredCompendiumPack = {
  id: 'pack-a',
  name: 'Pacote A',
  sourceId: source.id,
  schemaVersion: '1.0.0',
  checksum: 'cmp_test',
  importedAt: '2026-01-01T00:00:00.000Z',
  itemCount: 1
};

const createItem = (overrides: Partial<StoredCompendiumItem>): StoredCompendiumItem => ({
  id: 'pack-a:item-a',
  importItemId: 'item-a',
  packId: pack.id,
  sourceId: source.id,
  type: 'weapon',
  name: 'Arma teste',
  summary: 'Resumo',
  version: '1.0',
  rawJson: {
    id: 'item-a',
    kind: 'weapon',
    name: 'Arma teste',
    summary: 'Resumo',
    source,
    payload: { damageFormula: '1d8 + STR' }
  },
  normalizedJson: {
    id: 'item-a',
    name: 'Arma teste',
    type: 'weapon',
    weaponType: 'melee',
    damageFormula: '1d8 + STR',
    attackAbility: 'STR',
    actionCost: 'action'
  },
  tags: ['weapon', 'arma'],
  status: 'needsReview',
  reviewDecision: 'pending',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
});

describe('reviewQueue', () => {
  it('marks complete weapon as approvable with no blocking issues', () => {
    const item = createItem({});
    const checklist = buildReviewChecklistForItem(item, source);
    expect(checklist.some((entry) => entry.severity === 'error')).toBe(false);

    const queue = buildReviewQueue({ items: [item], sources: [source], packs: [pack] });
    expect(queue.summary.approvableItems).toBe(1);
    expect(queue.items[0].canApprove).toBe(true);
  });

  it('blocks weapon without damage mapping', () => {
    const item = createItem({ normalizedJson: { id: 'item-a', name: 'Arma teste', type: 'weapon', weaponType: 'melee' } });
    const queue = buildReviewQueue({ items: [item], sources: [source], packs: [pack] });
    expect(queue.summary.blockingItems).toBe(1);
    expect(queue.items[0].canApprove).toBe(false);
    expect(queue.items[0].checklist.some((entry) => entry.id === 'weapon-damage' && entry.severity === 'error')).toBe(true);
  });

  it('groups review items by source, pack, type and status', () => {
    const spell = createItem({
      id: 'pack-a:spell-a',
      importItemId: 'spell-a',
      type: 'spell',
      name: 'Magia teste',
      rawJson: { id: 'spell-a', kind: 'spell', name: 'Magia teste', source, payload: { level: 0, damageFormula: '1d10' } },
      normalizedJson: { id: 'spell-a', name: 'Magia teste', type: 'spell', level: 0, castingTime: 'action', damageFormula: '1d10' }
    });
    const byType = buildReviewQueue({ items: [createItem({}), spell], sources: [source], packs: [pack], filters: { groupBy: 'type' } });
    expect(byType.groups.map((group) => group.id).sort()).toEqual(['spell', 'weapon']);

    const byStatus = buildReviewQueue({ items: [createItem({}), spell], sources: [source], packs: [pack], filters: { groupBy: 'status' } });
    expect(byStatus.groups).toHaveLength(1);
    expect(byStatus.groups[0].id).toBe('needsReview');
  });

  it('filters default queue to needsReview and draft', () => {
    const validated = createItem({ id: 'pack-a:validated', status: 'validated', reviewDecision: 'approved' });
    const draft = createItem({ id: 'pack-a:draft', status: 'draft' });
    const queue = buildReviewQueue({ items: [validated, draft], sources: [source], packs: [pack] });
    expect(queue.items.map((row) => row.item.id)).toEqual(['pack-a:draft']);
  });

  it('creates approval notes preserving warning summary', () => {
    const ambiguousSource = { ...source, confidence: 'manual' as const };
    const item = createItem({ rawJson: { ...createItem({}).rawJson, source: ambiguousSource } });
    const queue = buildReviewQueue({ items: [item], sources: [ambiguousSource], packs: [pack] });
    const notes = createReviewApprovalNotes(queue.items[0], 'Revisado contra minha cópia.');
    expect(notes).toContain('Aprovado via fila guiada');
    expect(notes).toContain('Revisado contra minha cópia.');
  });
});
