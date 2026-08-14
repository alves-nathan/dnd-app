import { initializeBundledCatalog } from '../catalog/bundledCatalog';
import { ContentPolicyService } from '../catalog/contentPolicyService';
import { listCharacterChoices, resolveCharacterChoice } from '../catalog/characterChoiceBridge';
import { applyCharacterChoice } from '../catalog/characterChoiceApplication';
import type { StoredCompendiumItem } from '../compendium/types';
import { createEmptyCharacter } from '../data/mockData';

interface RawCompendiumItem {
  id: string;
  kind: StoredCompendiumItem['type'];
  name: string;
  summary?: string;
  source: {
    id: string;
    book?: string;
    version?: string;
    status: 'active' | 'disabled' | 'needsReview';
    confidence: 'exact' | 'ambiguous' | 'manual' | 'importedNeedsReview';
  };
  payload: Record<string, unknown>;
}

interface RawCompendiumPack {
  id: string;
  source: RawCompendiumItem['source'];
  items: RawCompendiumItem[];
}

const rawPack = require('../../assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json') as RawCompendiumPack;
const importedAt = '2026-08-03T22:40:00.000Z';
const compendiumItems: StoredCompendiumItem[] = rawPack.items.map((item) => ({
  id: `${rawPack.id}:${item.id}`,
  importItemId: item.id,
  packId: rawPack.id,
  sourceId: item.source.id,
  type: item.kind,
  name: item.name,
  summary: item.summary,
  version: item.source.version,
  rawJson: item,
  normalizedJson: {
    ...item.payload,
    id: item.id,
    name: item.name,
    type: item.kind,
    sourceId: item.source.id,
    sourceStatus: item.source.status,
    sourceConfidence: item.source.confidence,
    requiresReview: true
  },
  tags: [item.kind, item.name.toLowerCase()],
  status: 'needsReview',
  reviewDecision: 'pending',
  createdAt: importedAt,
  updatedAt: importedAt
}));

describe('APP-03 real catalog and bundled compendium bridge', () => {
  it('materializes the complete PHB creation payload without duplicate local carriers', () => {
    const snapshot = initializeBundledCatalog();
    const input = {
      snapshot,
      filterState: new ContentPolicyService(snapshot).createDefaultState(),
      compendiumItems,
      enabledSourceIds: [rawPack.source.id]
    };

    const result = listCharacterChoices(input);
    const byKind = result.choices.reduce<Record<string, number>>((counts, choice) => {
      counts[choice.kind] = (counts[choice.kind] ?? 0) + 1;
      return counts;
    }, {});

    expect(result.choices).toHaveLength(1066);
    expect(result.hiddenDuplicateCount).toBe(1066);
    expect(byKind).toMatchObject({
      class: 12,
      subclass: 48,
      species: 10,
      background: 16,
      feat: 75,
      spell: 378,
      weapon: 38,
      armor: 13
    });

    const wizard = result.choices.find((choice) => choice.choiceId === 'catalog:phb-2024-class-wizard');
    expect(wizard).toBeDefined();
    expect(wizard?.compendiumItemId).toBe(
      'phb-2024-full-consolidated-import-pack-v5-complete-invocations:phb-2024-class-wizard'
    );
    expect(resolveCharacterChoice(wizard?.compendiumItemId ?? '', input).canonicalChoiceId).toBe(wizard?.choiceId);

    if (!wizard) return;
    const applied = applyCharacterChoice({ character: createEmptyCharacter('Real Wizard'), choice: wizard });
    expect(applied.ok).toBe(true);
    expect(applied.character.classes[0]?.name).toBe('Wizard');
    expect(applied.character.catalogSnapshotId).toBe(snapshot.snapshotId);
    expect(applied.character.compendiumLinks?.[0]).toMatchObject({
      itemId: 'catalog:phb-2024-class-wizard',
      origin: 'catalog',
      catalogEntityId: 'phb-2024-class-wizard',
      status: 'active'
    });
  });

  it('blocks official choices when their source book is disabled', () => {
    const snapshot = initializeBundledCatalog();
    const defaultState = new ContentPolicyService(snapshot).createDefaultState();
    const result = listCharacterChoices({
      snapshot,
      filterState: {
        ...defaultState,
        bookStates: { ...defaultState.bookStates, 'phb-2024': false }
      },
      compendiumItems,
      enabledSourceIds: [rawPack.source.id]
    }, { kinds: ['class'] });

    expect(result.choices).toHaveLength(0);
  });
});
