import { buildCompendiumPackageExport } from '../compendium/packageExport';
import { createCompendiumImportItemContentHash } from '../compendium/importContentHash';
import { parseImportPack } from '../compendium/parseImportPack';
import type { CompendiumImportItem } from '../compendium/importDomain';
import type { StoredCompendiumItem } from '../compendium/types';
import type { CompendiumPersistenceState } from '../storage/compendiumSnapshot';

const source = {
  id: 'test-2024',
  book: 'Round Trip Test',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const,
  rulesEra: '2024' as const,
  contentType: 'official' as const
};

const items: CompendiumImportItem[] = [
  {
    id: 'test-feature', kind: 'feature', name: 'Feature', source,
    metadata: { legacyImport: { sourceFile: 'features.json', sourceFileOrder: 7 } },
    payload: { sourceType: 'class', classId: 'test-class', levelGained: 1, actionCost: 'bonusAction', mechanics: { choice: true } }
  },
  {
    id: 'test-class', kind: 'class', name: 'Wizard', source,
    payload: { hitDie: 6, primaryAbilities: ['INT'], featureIds: ['test-feature'], progression: [{ level: 1, featureIds: ['test-feature'] }] }
  },
  {
    id: 'test-subclass', kind: 'subclass', name: 'School', source,
    payload: { classId: 'test-class', featureIds: [], progression: [] }
  },
  {
    id: 'test-species', kind: 'species', name: 'Human', source,
    payload: { creatureType: 'Humanoid', speed: 30, size: 'Medium' }
  },
  {
    id: 'test-feat', kind: 'feat', name: 'Skilled', source,
    payload: { category: 'Origin', repeatable: true, mechanics: { skillProficiencyChoice: 3 } }
  },
  {
    id: 'test-background', kind: 'background', name: 'Sage', source,
    payload: {
      abilityScoreOptions: ['CON', 'INT', 'WIS'],
      featIds: ['test-feat'],
      skillProficiencies: ['Arcana', 'History'],
      equipmentOptions: { A: { itemIds: ['test-equipment'], currency: [{ amount: 10, unit: 'GP' }] } }
    }
  },
  {
    id: 'test-weapon', kind: 'weapon', name: 'Spear', source,
    payload: { weaponCategory: 'simple', weaponType: 'melee', damageFormula: '1d6', damageType: 'piercing', cost: { amount: 1, unit: 'GP' } }
  },
  {
    id: 'test-armor', kind: 'armor', name: 'Leather Armor', source,
    payload: { armorCategory: 'light', baseAC: 11, dexCap: null, cost: { amount: 10, unit: 'GP' } }
  },
  {
    id: 'test-equipment', kind: 'equipment', name: 'Book', source,
    payload: { equipmentCategory: 'adventuringGear', cost: { amount: 25, unit: 'GP' }, quantity: 1 }
  },
  {
    id: 'test-magic-item', kind: 'magicItem', name: 'Wand', source,
    payload: { rarity: 'Uncommon', attunement: true, equipmentCategory: 'wand' }
  },
  {
    id: 'test-spell', kind: 'spell', name: 'Fire Bolt', source,
    payload: {
      level: 0,
      school: 'Evocation',
      classes: ['Wizard'],
      classIds: ['test-class'],
      castingTime: { kind: 'action', actionCost: 'action' },
      range: '120 feet',
      damageFormula: '1d10',
      damageType: 'fire',
      scaling: { kind: 'characterLevel', steps: [{ level: 5, value: '2d10' }] }
    }
  },
  {
    id: 'test-condition', kind: 'condition', name: 'Prone', source,
    payload: { conditionId: 'prone', officialCondition: true }
  },
  {
    id: 'test-creature', kind: 'creatureStatBlock', name: 'Wolf', source,
    payload: {
      size: 'Medium',
      creatureType: 'Beast',
      armorClass: 13,
      hitPoints: 11,
      speed: { walk: 40 },
      actions: [{ name: 'Bite', actionCost: 'action', damageFormula: '2d4+2', damageType: 'piercing', conditionIds: ['prone'] }]
    }
  }
];

const storedItem = (item: CompendiumImportItem, index: number): StoredCompendiumItem => ({
  id: `pack:${item.id}`,
  importItemId: item.id,
  packId: 'pack',
  sourceId: item.source.id,
  type: item.kind,
  name: item.name,
  summary: item.summary,
  version: item.source.version,
  rawJson: item,
  normalizedJson: { ...item.payload, id: item.id, name: item.name, type: item.kind, sourceId: item.source.id },
  contentHash: `legacy-hash-${index}`,
  tags: [item.kind],
  status: 'validated',
  reviewDecision: 'approved',
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z'
});

const snapshot: CompendiumPersistenceState = {
  sources: [source],
  packs: [{ id: 'pack', name: 'Round Trip Pack', sourceId: source.id, schemaVersion: 'dnd-combat-import.v2', checksum: 'x', importedAt: '2026-08-11T00:00:00.000Z', itemCount: items.length }],
  items: items.map(storedItem),
  enabledSourceIds: [source.id]
};

describe('Compendium Import V2 export round-trip', () => {
  it('exports all 13 runtime entity kinds and reparses them without semantic loss', () => {
    const result = buildCompendiumPackageExport(snapshot, {
      exportId: 'round-trip',
      exportName: 'Round Trip',
      statuses: ['validated'],
      exportedAt: '2026-08-11T00:30:00.000Z',
      includeReviewMetadata: true,
      includeOriginalSourceMetadata: true
    });

    expect(result.ok).toBe(true);
    expect(result.data?.templateVersion).toBe('dnd-combat-import.v2');
    expect(result.summary.exportedItemCount).toBe(13);
    expect(new Set(result.data?.items.map((item) => item.kind))).toEqual(new Set(items.map((item) => item.kind)));
    expect(result.roundTrip?.valid).toBe(true);
    expect(result.roundTrip?.matchingItemHashes).toBe(13);
    expect(result.data?.metadata?.storageOrigins).toBeTruthy();
    expect(result.data?.metadata?.review).toBeTruthy();
    expect(result.data?.items.find((item) => item.id === 'test-feature')?.metadata).toEqual({
      legacyImport: { sourceFile: 'features.json', sourceFileOrder: 7 }
    });

    const parsed = parseImportPack(result.json ?? '');
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.items).toHaveLength(13);

    const originalHashes = new Map(items.map((item) => [item.id, createCompendiumImportItemContentHash(item)]));
    const exportedHashes = new Map(result.data?.items.map((item) => [item.id, createCompendiumImportItemContentHash(item)]) ?? []);
    for (const [id, hash] of originalHashes) expect(exportedHashes.get(id)).toBe(hash);
  });

  it('exports normalized runtime edits instead of reverting to the immutable raw payload', () => {
    const editedSnapshot: CompendiumPersistenceState = {
      ...snapshot,
      items: snapshot.items.map((item) => item.importItemId === 'test-weapon'
        ? { ...item, normalizedJson: { ...item.normalizedJson, damageFormula: '1d8', mastery: 'Sap' } }
        : item)
    };
    const result = buildCompendiumPackageExport(editedSnapshot, {
      exportId: 'runtime-edit',
      types: ['weapon'],
      statuses: ['validated'],
      exportedAt: '2026-08-11T00:45:00.000Z'
    });

    expect(result.ok).toBe(true);
    const weapon = result.data?.items[0];
    expect(weapon?.kind).toBe('weapon');
    expect(weapon?.kind === 'weapon' ? weapon.payload.damageFormula : undefined).toBe('1d8');
    expect(weapon?.kind === 'weapon' ? weapon.payload.mastery : undefined).toBe('Sap');
    const rawWeapon = snapshot.items.find((item) => item.importItemId === 'test-weapon')?.rawJson;
    expect(rawWeapon && 'payload' in rawWeapon && (rawWeapon.payload as Record<string, unknown>).damageFormula).toBe('1d6');
  });

  it('keeps storage/review metadata outside payload semantics', () => {
    const result = buildCompendiumPackageExport(snapshot, {
      exportId: 'metadata-boundary',
      includeReviewMetadata: true,
      includeOriginalSourceMetadata: true,
      exportedAt: '2026-08-11T01:00:00.000Z'
    });

    expect(result.ok).toBe(true);
    expect(result.data?.items.every((item) => !('exportMetadata' in item.payload))).toBe(true);
    expect(result.data?.metadata?.storageOrigins).toBeTruthy();
  });

  it('forces needsReview deliberately without breaking the V2 round-trip boundary', () => {
    const result = buildCompendiumPackageExport(snapshot, {
      exportId: 'review-copy',
      forceNeedsReview: true,
      exportedAt: '2026-08-11T01:30:00.000Z'
    });

    expect(result.ok).toBe(true);
    expect(result.data?.source.status).toBe('needsReview');
    expect(result.data?.items.every((item) => item.source.status === 'needsReview')).toBe(true);
    expect(result.data?.items.every((item) => item.source.confidence === 'importedNeedsReview')).toBe(true);
    expect(result.roundTrip?.valid).toBe(true);
  });
});
