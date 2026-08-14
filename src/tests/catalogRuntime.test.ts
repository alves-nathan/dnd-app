import {
  CatalogQueryService,
  ContentPolicyService,
  initializeBundledCatalog
} from '../catalog';

const snapshot = initializeBundledCatalog();

describe('consolidated runtime catalog', () => {
  it('loads the v4.8.0 bundle with all indexed structures', () => {
    expect(snapshot.catalogVersion).toBe('4.8.0');
    expect(snapshot.validation.status).toBe('passed');
    expect(snapshot.entries).toHaveLength(5841);
    expect(snapshot.registry.size).toBe(5841);
    expect(snapshot.categories).toHaveLength(57);
    expect(snapshot.aliases.size).toBe(127);

    const dependencyCount = Array.from(snapshot.dependenciesFrom.values())
      .reduce((total, edges) => total + edges.length, 0);
    expect(dependencyCount).toBe(15385);
  });

  it('searches real entities and resolves aliases without duplicating data', () => {
    const query = new CatalogQueryService(snapshot);
    const fireball = query.search({ text: 'fireball', limit: 20 });
    expect(fireball.length).toBeGreaterThan(0);
    expect(fireball.some((entry) => entry.displayName.toLowerCase().includes('fireball'))).toBe(true);

    const activeAlias = Array.from(snapshot.aliases.values())
      .find((entry) => entry.status === 'active');
    expect(activeAlias).toBeDefined();
    if (!activeAlias) return;
    const resolved = query.resolveAlias(activeAlias.from);
    expect(resolved.entityId).toBe(activeAlias.to);
    expect(resolved.chain).toHaveLength(1);
  });

  it('previews disabling the Monster Manual and reports dependency impact', () => {
    const policy = new ContentPolicyService(snapshot);
    const before = policy.createDefaultState();
    const after = {
      ...before,
      bookStates: { ...before.bookStates, 'mm-2025': false }
    };
    const impact = policy.previewImpact(before, after);

    expect(impact.beforeEnabled).toBeGreaterThan(impact.afterEnabled);
    expect(impact.disabledEntityIds.length).toBeGreaterThan(2000);
    expect(impact.hardDependencyBreaks.length).toBeGreaterThan(0);
  });
});
