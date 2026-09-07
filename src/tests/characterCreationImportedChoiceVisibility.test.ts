import fs from 'fs';
import path from 'path';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  getExplicitProgressionSelectionReviewItems,
  REVIEWABLE_CHARACTER_CHOICE_STATUSES
} from '../characters/characterChoiceAvailability';

const root = path.resolve(__dirname, '../..');

const toStoredItems = (pack: any, packId: string): StoredCompendiumItem[] => pack.items.map((item: any) => ({
  id: item.id,
  importItemId: item.id,
  packId,
  sourceId: item.source?.id ?? 'unknown',
  type: item.kind,
  name: item.name,
  summary: item.summary,
  rawJson: item,
  normalizedJson: item.payload ?? {},
  tags: item.payload?.tags ?? item.tags ?? [],
  status: 'needsReview',
  reviewDecision: 'pending',
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z'
}));

const forgePack = require('../../assets/compendium/forge-artificer-2025-full-consolidated-import-pack-v2-canonical.json');
const tashaPack = require('../../assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json');
const forgeItems = toStoredItems(forgePack, 'forge');
const tashaItems = toStoredItems(tashaPack, 'tasha');

const find = (items: StoredCompendiumItem[], id: string): StoredCompendiumItem => {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error(`Missing fixture ${id}`);
  return item;
};

describe('imported character-choice visibility', () => {
  it('surfaces active pending review items but still excludes disabled content', () => {
    expect(REVIEWABLE_CHARACTER_CHOICE_STATUSES).toEqual(['validated', 'needsReview', 'draft']);
    expect(REVIEWABLE_CHARACTER_CHOICE_STATUSES).not.toContain('disabled');
  });

  it('approves the selected Artificer together with progression mechanics unlocked at the selected level', () => {
    const artificer = find(forgeItems, 'forge-artificer-2025-class-artificer');
    const reviewItems = getExplicitProgressionSelectionReviewItems(artificer, forgeItems, 3);

    expect(reviewItems[0]).toBe(artificer);
    expect(reviewItems.some((item) => item.type === 'feature')).toBe(true);
    expect(reviewItems.every((item) => item.status === 'needsReview')).toBe(true);
  });

  it('collects pending subclass features when a legacy/2024-compatible subclass is explicitly selected', () => {
    const bladesinging = find(tashaItems, 'tcoe-2020-subclass-bladesinging');
    const reviewItems = getExplicitProgressionSelectionReviewItems(bladesinging, tashaItems, 3);

    expect(reviewItems[0]).toBe(bladesinging);
    expect(reviewItems.some((item) => item.type === 'feature')).toBe(true);
  });

  it('wires class, species, background and subclass selectors to reviewable active content', () => {
    const source = fs.readFileSync(path.join(root, 'app/characters/new.tsx'), 'utf8');

    expect(source).toContain("types: ['class'], statuses: REVIEWABLE_CHARACTER_CHOICE_STATUSES, onlyEnabled: true");
    expect(source).toContain("types: ['species'], statuses: REVIEWABLE_CHARACTER_CHOICE_STATUSES, onlyEnabled: true");
    expect(source).toContain("types: ['background'], statuses: REVIEWABLE_CHARACTER_CHOICE_STATUSES, onlyEnabled: true");
    expect(source).toContain("types: ['subclass'], statuses: REVIEWABLE_CHARACTER_CHOICE_STATUSES, onlyEnabled: true");
    expect(source).toContain('void selectClass(item)');
    expect(source).toContain('void selectSubclass(classItem, level, item)');
    expect(source).toContain('getExplicitProgressionSelectionReviewItems(item, items, initialLevel)');
    expect(source).toContain("instance.item.status === 'validated' ? undefined : choiceForItemId(instance.item.id)");
    expect(source).toContain('applyCharacterChoice({ character: next, choice: canonicalChoice })');
    expect(source).not.toContain('updateItemsReview');
  });
});
