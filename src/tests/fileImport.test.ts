import { inferLocalImportFileKind, parseLocalCompendiumFileContent } from '../compendium/fileImport';

const source = {
  id: 'test-file-source',
  book: 'Livro Teste',
  page: '12',
  version: '2024',
  notes: 'Fonte de teste.'
};

const validJson = JSON.stringify({
  id: 'file-pack',
  source: { id: 'test-file-source', book: 'Livro Teste', page: '12', version: '2024', status: 'active', confidence: 'manual' },
  items: [
    {
      id: 'file-sword',
      kind: 'weapon',
      name: 'File Sword',
      source: { id: 'test-file-source', book: 'Livro Teste', page: '12', version: '2024', status: 'active', confidence: 'manual' },
      payload: { damageFormula: '1d8 + STR', actionCost: 'action' }
    }
  ]
});

describe('fileImport', () => {
  it('detects JSON files by extension', () => {
    expect(inferLocalImportFileKind({ name: 'pack.json', mimeType: 'text/plain' })).toBe('json');
  });

  it('parses a structured JSON file directly', () => {
    const result = parseLocalCompendiumFileContent({ name: 'pack.json', mimeType: 'application/json', size: validJson.length }, validJson, { source });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('json');
    expect(result.detectedItemCount).toBe(1);
    expect(result.preview.data?.items[0].name).toBe('File Sword');
  });

  it('keeps invalid JSON schema blocked instead of silently approving it', () => {
    const result = parseLocalCompendiumFileContent({ name: 'bad.json', mimeType: 'application/json' }, '{"items":[]}', { source });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('json');
    expect(result.issues.some((issue) => issue.severity === 'error')).toBe(true);
  });

  it('converts Markdown to a needsReview compendium import draft', () => {
    const markdown = `## Test Blast\nCantrip spell. Action. Spell attack. Damage: 2d10 force damage.`;
    const result = parseLocalCompendiumFileContent({ name: 'notes.md', mimeType: 'text/markdown' }, markdown, {
      source,
      packId: 'markdown-pack',
      defaultKind: 'auto'
    });
    expect(result.kind).toBe('markdown');
    expect(result.detectedItemCount).toBe(1);
    expect(result.generatedJson).toContain('Test Blast');
    expect(result.generatedJson).toContain('needsReview');
  });

  it('falls back to JSON for unknown extensions with JSON-shaped content', () => {
    const result = parseLocalCompendiumFileContent({ name: 'export.data' }, validJson, { source });
    expect(result.kind).toBe('json');
    expect(result.ok).toBe(true);
  });

  it('parses canonical V2 JSON files directly', () => {
    const v2 = JSON.stringify({
      templateVersion: 'dnd-combat-import.v2',
      id: 'v2-file-pack',
      source: { id: 'test-file-source', book: 'Livro Teste', version: '2024', status: 'active', confidence: 'manual', rulesEra: '2024' },
      items: [
        {
          id: 'v2-file-sword',
          kind: 'weapon',
          name: 'V2 File Sword',
          source: { id: 'test-file-source', book: 'Livro Teste', version: '2024', status: 'active', confidence: 'manual', rulesEra: '2024' },
          payload: { weaponCategory: 'simple', weaponType: 'melee', damageFormula: '1d8 + STR', actionCost: 'action' }
        }
      ]
    });
    const result = parseLocalCompendiumFileContent({ name: 'v2-pack.json', mimeType: 'application/json' }, v2, { source });
    expect(result.ok).toBe(true);
    expect(result.preview.data?.templateVersion).toBe('dnd-combat-import.v2');
    expect(result.preview.data?.items[0].name).toBe('V2 File Sword');
  });


  it('validates incremental V2 references against installed catalog context', () => {
    const classSource = { id: 'phb', book: 'PHB', version: '2024', status: 'active' as const, confidence: 'exact' as const, rulesEra: '2024' as const };
    const incremental = JSON.stringify({
      templateVersion: 'dnd-combat-import.v2',
      id: 'subclass-patch',
      source: classSource,
      items: [
        {
          id: 'test-subclass',
          kind: 'subclass',
          name: 'Test Subclass',
          source: classSource,
          payload: { classId: 'test-class', progression: [] }
        }
      ]
    });
    const existingItems = [
      {
        id: 'installed:test-class',
        importItemId: 'test-class',
        type: 'class' as const,
        name: 'Test Class',
        sourceId: 'phb',
        rawJson: { id: 'test-class', kind: 'class', name: 'Test Class', source: classSource, payload: { progression: [] } },
        normalizedJson: { id: 'test-class', name: 'Test Class', type: 'class', sourceId: 'phb', progression: [] }
      }
    ];
    const result = parseLocalCompendiumFileContent(
      { name: 'subclass-patch.json', mimeType: 'application/json' },
      incremental,
      { source, existingItems }
    );
    expect(result.ok).toBe(true);
    expect(result.detectedItemCount).toBe(1);
  });

});
