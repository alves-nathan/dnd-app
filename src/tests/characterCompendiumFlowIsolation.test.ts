import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('character and compendium flow isolation', () => {
  it('opens the character sheet without forcing catalog compatibility maintenance', () => {
    const sheet = read('app/characters/[id]/index.tsx');
    const compatibility = read('app/characters/[id]/compatibility.tsx');

    expect(sheet).not.toContain('useCharacterCompatibility');
    expect(sheet).not.toContain('compatibilityReviewed');
    expect(sheet).not.toContain('Verificando ficha');
    expect(sheet).not.toContain('Abrir manifesto da ficha');
    expect(sheet).not.toContain("router.replace(`/characters/${character.id}/compatibility`");
    expect(compatibility).toContain("router.replace(`/characters/${character.id}` as never)");
  });

  it('keeps catalog maintenance out of Home and Settings', () => {
    const home = read('app/index.tsx');
    const settings = read('app/settings.tsx');
    const maintenanceRoutes = [
      '/content-management',
      '/catalog-history',
      '/catalog-update',
      '/catalog-trust',
      '/catalog-transparency',
      '/catalog-publication',
      '/catalog-rollout-health',
      '/catalog-rollout-aggregation',
      '/catalog-operational-authorization',
      '/catalog-operational-journal',
      '/catalog-operational-audit',
      '/catalog-operational-federation',
      '/catalog-distribution',
      '/character-compatibility'
    ];

    for (const route of maintenanceRoutes) {
      expect(home).not.toContain(`router.push('${route}')`);
      expect(settings).not.toContain(`router.push('${route}')`);
    }

    expect(settings).toContain("router.push('/compendium')");

    const characterCompendium = read('app/characters/[id]/compendium.tsx');
    expect(characterCompendium).not.toContain('Revisar e validar item');
    expect(characterCompendium).not.toContain('setItemStatus');
    expect(characterCompendium).not.toContain('Mostrar itens pendentes de revisão');

    for (const characterFlow of [
      'app/characters/new.tsx',
      'app/characters/[id]/compendium.tsx',
      'app/characters/[id]/feats.tsx',
      'app/characters/[id]/spells.tsx'
    ]) {
      expect(read(characterFlow)).not.toContain('updateItemsReview');
      expect(read(characterFlow)).not.toContain('setItemStatus');
    }
  });

  it('concentrates catalog maintenance in the Compendium flow', () => {
    const compendium = read('app/compendium/index.tsx');
    const maintenance = read('app/compendium/maintenance.tsx');
    const layout = read('app/_layout.tsx');

    expect(compendium).toContain('Manutenção de regras e catálogo');
    expect(compendium).toContain("router.push('/compendium/maintenance')");
    expect(maintenance).toContain('Manutenção de regras e catálogo');
    expect(maintenance).toContain('Manifestos por personagem');
    expect(maintenance).toContain("router.push('/character-compatibility')");
    expect(maintenance).toContain("router.push('/catalog-update')");
    expect(maintenance).toContain("router.push('/catalog-publication')");
    expect(maintenance).toContain("router.push('/catalog-distribution')");
    expect(layout).toContain('<Stack.Screen name="compendium/maintenance" />');
  });
});
