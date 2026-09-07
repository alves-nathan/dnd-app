import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('character sheet read-only reconciliation boundary', () => {
  it('does not reconcile or mutate the published character when the sheet opens', () => {
    const sheet = read('app/characters/[id]/index.tsx');

    expect(sheet).not.toContain('state.updateCharacter');
    expect(sheet).not.toContain('useCharacterStore.getState().characters.find');
    expect(sheet).not.toContain('applyAutomaticClassProgression');
    expect(sheet).not.toContain('applyAutomaticSpeciesProgression');
    expect(sheet).not.toContain('reconcileFeatSubchoiceResources');
    expect(sheet).not.toContain('reconcileCharacterHitPoints');
    expect(sheet).not.toContain('buildPendingCharacterChoices');
  });

  it('holds application routes until the current catalog-aware snapshot pass is complete', () => {
    const layout = read('app/_layout.tsx');

    expect(layout).toContain('createCharacterLinkCatalogFingerprint(compendiumItems)');
    expect(layout).toContain('catalogAwareVersion >= CHARACTER_CATALOG_RECONCILIATION_VERSION');
    expect(layout).toContain('catalogAwareFingerprint === currentCatalogFingerprint');
    expect(layout).toContain('const characterSnapshotsReady = Boolean(');
    expect(layout).toContain('{characterSnapshotsReady ? (');
    expect(layout).toContain('reconcileCatalogAwareCharacters(useCompendiumStore.getState().items)');
  });

  it('reacts to identity fingerprints instead of the mutable compendium item array in the reconciliation effect', () => {
    const layout = read('app/_layout.tsx');
    const effectStart = layout.indexOf('reconcileCatalogAwareCharacters(useCompendiumStore.getState().items)');
    expect(effectStart).toBeGreaterThan(-1);
    const dependencySlice = layout.slice(effectStart, effectStart + 500);

    expect(dependencySlice).toContain('currentCatalogFingerprint');
    expect(dependencySlice).not.toContain('compendiumItems,');
  });
});
