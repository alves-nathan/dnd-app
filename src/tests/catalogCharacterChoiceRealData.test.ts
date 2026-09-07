import { initializeBundledCatalog } from '../catalog/bundledCatalog';
import { ContentPolicyService } from '../catalog/contentPolicyService';
import { listCharacterChoices, resolveCharacterChoice } from '../catalog/characterChoiceBridge';
import { applyCharacterChoice } from '../catalog/characterChoiceApplication';
import { characterChoiceToMapperItem } from '../catalog/catalogCompendiumAdapter';
import { resolveCharacterSpellAccess } from '../characters/characterSpellAccess';
import { getWizardSpellbookFeatureRequirements } from '../characters/wizardSpellbookRules';
import { getSubclassChoiceRequirements } from '../characters/subclassChoiceRules';
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


  it('preserves canonical carrier references behind catalog ids for dependent spell mechanics', () => {
    const snapshot = initializeBundledCatalog();
    const input = {
      snapshot,
      filterState: new ContentPolicyService(snapshot).createDefaultState(),
      compendiumItems,
      enabledSourceIds: [rawPack.source.id]
    };
    const result = listCharacterChoices(input, { includeUnavailable: true });
    const originalById = new Map(compendiumItems.map((item) => [item.id, item] as const));
    const mappedItems = result.choices
      .filter((choice) => choice.available || Boolean(choice.compendiumItemId) || choice.origin === 'compendium')
      .map((choice) => characterChoiceToMapperItem(
        choice,
        choice.compendiumItemId ? originalById.get(choice.compendiumItemId) : undefined
      ));
    const byCarrierReference = (reference: string) => mappedItems.find((item) => {
      const rawId = (item.rawJson as { id?: string }).id;
      return item.id === reference || item.importItemId === reference || rawId === reference;
    });

    const mageHandLegerdemain = byCarrierReference('phb-2024-feature-rogue-arcane-trickster-mage-hand-legerdemain');
    expect(mageHandLegerdemain).toBeDefined();
    expect(mageHandLegerdemain?.importItemId).toBe(
      'phb-2024-subclass-feature-rogue-arcane-trickster-mage-hand-legerdemain'
    );
    expect((mageHandLegerdemain?.rawJson as { id?: string }).id).toBe(
      'phb-2024-feature-rogue-arcane-trickster-mage-hand-legerdemain'
    );

    const rogue = byCarrierReference('phb-2024-class-rogue');
    const arcaneTrickster = byCarrierReference('phb-2024-subclass-rogue-arcane-trickster');
    expect(rogue).toBeDefined();
    expect(arcaneTrickster).toBeDefined();
    if (rogue && arcaneTrickster) {
      const access = resolveCharacterSpellAccess({
        classItem: rogue,
        classLevel: 3,
        subclassItem: arcaneTrickster,
        items: mappedItems
      });
      expect(access.grantedSpellReferences).toContain('phb-2024-spell-mage-hand');
    }

    const wizard = byCarrierReference('phb-2024-class-wizard');
    const abjurer = byCarrierReference('phb-2024-subclass-wizard-abjurer');
    expect(wizard).toBeDefined();
    expect(abjurer).toBeDefined();
    if (wizard && abjurer) {
      expect(getWizardSpellbookFeatureRequirements({
        classItem: wizard,
        classLevel: 3,
        subclassItem: abjurer,
        items: mappedItems
      })).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'savantInitial', featureName: 'Abjuration Savant', count: 2 })
      ]));
    }

    const land = byCarrierReference('phb-2024-subclass-druid-circle-of-the-land');
    expect(land).toBeDefined();
    if (land) {
      expect(getSubclassChoiceRequirements(land, mappedItems, 3)).toEqual(expect.arrayContaining([
        expect.objectContaining({ choiceId: 'land-spell-list' })
      ]));
    }
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
