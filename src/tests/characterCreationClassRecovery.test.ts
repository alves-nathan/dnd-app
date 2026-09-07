import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(root, relativePath), 'utf8');

describe('character creation class recovery contract', () => {
  it('repairs the required PHB carrier on hydration of an existing compendium', () => {
    const source = read('src/storage/activeCompendiumRepository.ts');
    expect(source).toContain('ensureRequiredCharacterCreationCompendium(repository)');
    expect(source).toContain('restoredRequiredBundledPackIds');
    expect(source).toContain('requiredBundledRepairIssues');
  });

  it('keeps the PHB 2024 bundled pack as required character-creation content', () => {
    const source = read('src/compendium/bundledCompendium.ts');
    expect(source).toContain('REQUIRED_CHARACTER_CREATION_BUNDLED_PACK_IDS');
    expect(source).toContain('phb-2024-full-consolidated-import-pack-v5-complete-invocations');
  });

  it('shows actionable recovery instead of a blank class list', () => {
    const source = read('app/characters/new.tsx');
    expect(source).toContain("classes.length === 0");
    expect(source).toContain('Recarregar conteúdo básico');
    expect(source).toContain('Abrir filtros de conteúdo');
    expect(source).toContain("router.push('/content-management')");
  });

  it('exposes bundled mechanical supplements in the content manager', () => {
    const source = read('app/content-management.tsx');
    expect(source).toContain('Livros e suplementos do compêndio');
    expect(source).toContain('BUNDLED_COMPENDIUM_PACKS');
    expect(source).toContain('installBundledPack');
    expect(source).toContain('repairRequiredBundledContent');
    expect(source).toContain('mechanicalFeedback');
    expect(source).toContain('buildImportedCompendiumSourceRows');
    expect(source).toContain('Fontes instaladas localmente');
  });

  it('keeps a bundled PHB mechanical fallback for missing persisted carriers', () => {
    const source = read('src/catalog/useCharacterChoiceBridge.ts');
    expect(source).toContain('mergeRequiredBundledChoiceCarriers');
    expect(source).toContain('mechanicalItems');
  });

  it('keeps the active compendium write backend aligned with a legacy hydration fallback', () => {
    const source = read('src/storage/activeCompendiumRepository.ts');
    expect(source).toContain('activateLegacyCompendiumFallback');
    expect(source).toContain("activeRepositoryKind = 'legacy'");
    expect(source).toContain('activeRepository = legacyRepository');
  });

  it('shows persistent install/repair feedback instead of relying only on native alerts', () => {
    const source = read('app/content-management.tsx');
    expect(source).toContain('mechanicalFeedback');
    expect(source).toContain('accessibilityLiveRegion="polite"');
    expect(source).toContain('handleRepairRequiredBundledContent');
    expect(source).toContain('Livros e suplementos do compêndio');
  });

});
