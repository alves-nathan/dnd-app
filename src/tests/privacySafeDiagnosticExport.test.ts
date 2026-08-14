import { buildPersistedCompendiumImport } from '../compendium/importer';
import { createDefaultCharacter } from '../data/mockData';
import { runGlobalDiagnostics } from '../diagnostics/globalDiagnostics';
import { createPrivacySafeDiagnosticExport, privacySafeDiagnosticToMarkdown } from '../diagnostics/privacySafeDiagnosticExport';

const privateSource = {
  id: 'private-source-secret-id',
  book: 'Livro Privado Secreto',
  status: 'active' as const,
  confidence: 'exact' as const
};

describe('privacy-safe diagnostic export', () => {
  it('exports aggregate diagnostics without names, ids or rules text', () => {
    const character = createDefaultCharacter('Nome Privado do Herói');
    const persisted = buildPersistedCompendiumImport({
      id: 'private-pack-secret-id',
      source: privateSource,
      items: [{
        id: 'private-feature-secret-id',
        kind: 'feature',
        name: 'Regra Privada Secreta',
        summary: 'Texto privado da regra que não pode sair.',
        source: privateSource,
        payload: { summary: 'Payload privado secreto' }
      }]
    });
    const compendium = {
      sources: [persisted.source],
      packs: [persisted.pack],
      items: persisted.items,
      enabledSourceIds: [persisted.source.id]
    };
    const report = runGlobalDiagnostics({
      characters: [character],
      scenarios: [],
      buildPresets: [],
      buildHistorySnapshots: [],
      compendium
    });

    const diagnostic = createPrivacySafeDiagnosticExport(report, compendium);
    const serialized = JSON.stringify(diagnostic);
    const markdown = privacySafeDiagnosticToMarkdown(diagnostic);

    for (const privateValue of ['Nome Privado do Herói', 'Livro Privado Secreto', 'private-source-secret-id', 'Regra Privada Secreta', 'Texto privado da regra', 'Payload privado secreto']) {
      expect(serialized).not.toContain(privateValue);
      expect(markdown).not.toContain(privateValue);
    }
    expect(diagnostic.inventory.characters).toBe(1);
    expect(diagnostic.inventory.compendiumItems).toBe(1);
    expect(diagnostic.privacy.includesRawCompendium).toBe(false);
  });
});
