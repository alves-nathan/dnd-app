import { buildCompendiumPackageExport, buildCompendiumPackageExportFileName, summarizeCompendiumPackageExport } from '../compendium/packageExport';
import { parseImportPack } from '../compendium/parseImportPack';
import type { CompendiumPersistenceState } from '../storage/compendiumSnapshot';

const sourceA = { id: 'source-a', book: 'Fonte A', page: '10', version: '2024', status: 'active' as const, confidence: 'manual' as const };
const sourceB = { id: 'source-b', book: 'Fonte B', page: '20', version: '2024', status: 'active' as const, confidence: 'manual' as const };

const snapshot: CompendiumPersistenceState = {
  sources: [sourceA, sourceB],
  enabledSourceIds: ['source-a', 'source-b'],
  packs: [
    { id: 'pack-a', name: 'Pack A', sourceId: 'source-a', schemaVersion: '1.0.0', checksum: 'a', importedAt: '2026-01-01T00:00:00.000Z', itemCount: 2 },
    { id: 'pack-b', name: 'Pack B', sourceId: 'source-b', schemaVersion: '1.0.0', checksum: 'b', importedAt: '2026-01-01T00:00:00.000Z', itemCount: 1 }
  ],
  items: [
    {
      id: 'pack-a:sword',
      importItemId: 'sword',
      packId: 'pack-a',
      sourceId: 'source-a',
      type: 'weapon',
      name: 'Sword',
      rawJson: { id: 'sword', kind: 'weapon', name: 'Sword', source: sourceA, payload: { weaponType: 'melee', weaponCategory: 'martial', damageFormula: '1d8 + STR' } },
      normalizedJson: { weaponType: 'melee', weaponCategory: 'martial', damageFormula: '1d8 + STR' },
      tags: ['weapon'],
      status: 'validated',
      reviewDecision: 'approved',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'pack-a:draft-spell',
      importItemId: 'draft-spell',
      packId: 'pack-a',
      sourceId: 'source-a',
      type: 'spell',
      name: 'Draft Spell',
      rawJson: { id: 'draft-spell', kind: 'spell', name: 'Draft Spell', source: sourceA, payload: { level: 0, classes: ['Wizard'], castingTime: 'action', damageFormula: '2d10' } },
      normalizedJson: { level: 0, classes: ['Wizard'], castingTime: 'action', damageFormula: '2d10' },
      tags: ['spell'],
      status: 'needsReview',
      reviewDecision: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'pack-b:blast',
      importItemId: 'blast',
      packId: 'pack-b',
      sourceId: 'source-b',
      type: 'spell',
      name: 'Blast',
      rawJson: { id: 'blast', kind: 'spell', name: 'Blast', source: sourceB, payload: { level: 0, classes: ['Wizard'], castingTime: 'action', damageFormula: '1d10' } },
      normalizedJson: { level: 0, classes: ['Wizard'], castingTime: 'action', damageFormula: '1d10' },
      tags: ['spell'],
      status: 'validated',
      reviewDecision: 'approved',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ]
};

describe('packageExport', () => {
  it('exports a reimportable package filtered by status and type', () => {
    const result = buildCompendiumPackageExport(snapshot, { exportName: 'Weapons only', types: ['weapon'], statuses: ['validated'] });

    expect(result.ok).toBe(true);
    expect(result.summary.exportedItemCount).toBe(1);
    expect(result.data?.items[0].name).toBe('Sword');
    expect(result.json).toContain('dnd-combat-import.v2');
    expect(result.summary.roundTripVerified).toBe(true);

    const preview = parseImportPack(result.json ?? '');
    expect(preview.ok).toBe(true);
    expect(preview.data?.items.length).toBe(1);
  });

  it('exports multiple sources while preserving each item source and storage metadata', () => {
    const result = buildCompendiumPackageExport(snapshot, { exportName: 'All validated', statuses: ['validated'], includeOriginalSourceMetadata: true });

    expect(result.ok).toBe(true);
    expect(result.summary.sourceMode).toBe('multipleSources');
    expect(result.issues.some((issue) => issue.code === 'COMPENDIUM_EXPORT_V2_MULTIPLE_SOURCES')).toBe(true);
    expect(result.data?.items.length).toBe(2);
    expect(result.data?.metadata?.storageOrigins).toBeTruthy();
    expect(result.data?.items.find((item) => item.id === 'sword')?.source.id).toBe('source-a');
    expect(result.data?.items.find((item) => item.id === 'blast')?.source.id).toBe('source-b');

    const preview = parseImportPack(result.json ?? '');
    expect(preview.ok).toBe(true);
  });

  it('blocks empty exports', () => {
    const result = buildCompendiumPackageExport(snapshot, { types: ['armor'], statuses: ['validated'] });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'COMPENDIUM_EXPORT_EMPTY')).toBe(true);
  });

  it('can force a private export back to needsReview', () => {
    const result = buildCompendiumPackageExport(snapshot, { packIds: ['pack-a'], statuses: ['validated'], forceNeedsReview: true });

    expect(result.ok).toBe(true);
    expect(result.data?.source.status).toBe('needsReview');
    expect(result.data?.items[0].source.confidence).toBe('importedNeedsReview');
    expect(result.summary.roundTripVerified).toBe(true);
  });

  it('generates user-facing filename and summary', () => {
    const result = buildCompendiumPackageExport(snapshot, { exportName: 'My Export', statuses: ['validated'] });

    expect(buildCompendiumPackageExportFileName(result)).toContain('.json');
    expect(summarizeCompendiumPackageExport(result)).toContain('item(ns) exportados');
  });
});
