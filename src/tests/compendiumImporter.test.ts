import { buildPersistedCompendiumImport, createCompendiumChecksum, validateCompendiumJson } from '../compendium/importer';
import { CompendiumImportInput } from '../compendium/schemas';

const importPayload: CompendiumImportInput = {
  id: 'test-pack',
  source: {
    id: 'test-source',
    book: 'Fonte de teste',
    page: '12',
    version: '2024',
    status: 'active',
    confidence: 'manual'
  },
  items: [
    {
      id: 'test-spell',
      kind: 'spell',
      name: 'Raio de Teste',
      summary: 'Magia autoral para validar importação.',
      source: {
        id: 'test-source',
        book: 'Fonte de teste',
        page: '12',
        version: '2024',
        status: 'active',
        confidence: 'manual'
      },
      payload: { damageFormula: '1d10', actionCost: 'action' }
    }
  ]
};

describe('compendium importer', () => {
  it('validates structured compendium JSON', () => {
    const preview = validateCompendiumJson(JSON.stringify(importPayload));
    expect(preview.ok).toBe(true);
    expect(preview.data?.items).toHaveLength(1);
    expect(preview.issues.some((issue) => issue.code === 'IMPORTED_ITEM_NEEDS_REVIEW')).toBe(true);
  });

  it('rejects invalid JSON without throwing', () => {
    const preview = validateCompendiumJson('{invalid');
    expect(preview.ok).toBe(false);
    expect(preview.issues[0]?.code).toBe('IMPORT_JSON_ERROR');
  });

  it('builds persisted pack with raw and normalized data', () => {
    const imported = buildPersistedCompendiumImport(importPayload, { importedAt: '2026-07-11T12:00:00.000Z' });
    expect(imported.pack.id).toBe('test-pack');
    expect(imported.pack.itemCount).toBe(1);
    expect(imported.items[0]?.rawJson.id).toBe('test-spell');
    expect(imported.items[0]?.normalizedJson.name).toBe('Raio de Teste');
    expect(imported.items[0]?.status).toBe('needsReview');
    expect(imported.items[0]?.reviewDecision).toBe('pending');
    expect(imported.items[0]?.reviewNotes).toContain('revisão manual');
  });

  it('creates stable checksum regardless of object key order', () => {
    const left = createCompendiumChecksum({ b: 2, a: 1 });
    const right = createCompendiumChecksum({ a: 1, b: 2 });
    expect(left).toBe(right);
  });
});
