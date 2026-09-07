import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { classifySpellAccessFeature } from '../characters/spellAccessFeatureClassifier';
import {
  PHB2024_CATALOG_RECONCILIATION_MANIFEST,
  getSpellAccessCatalogReconciliation
} from '../characters/spellAccessCatalogReconciliation';
import { PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE } from '../characters/phb2024SubclassSpellGrantBridge';

const items = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-16T00:00:00.000Z'
  }).items
);

const byImportId = (id: string): StoredCompendiumItem => {
  const item = items.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};

describe('final spell-access release gate contracts', () => {
  it('reconciles every PHB 2024 needs-review spell table declared by the final manifest', () => {
    expect(PHB2024_CATALOG_RECONCILIATION_MANIFEST.entries).toHaveLength(10);
    for (const entry of PHB2024_CATALOG_RECONCILIATION_MANIFEST.entries) {
      const reconciliation = getSpellAccessCatalogReconciliation(entry.featureId);
      expect(reconciliation).toBeDefined();
      expect(reconciliation?.bridgeId).toBe(entry.bridgeId);
      expect(reconciliation?.spellReferences.length).toBeGreaterThan(0);
      const signals = classifySpellAccessFeature(byImportId(entry.featureId));
      expect(signals.some((signal) => signal.kind === 'catalogReconciliationRequired')).toBe(false);
      expect(signals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'alwaysPrepared',
          spellReferences: expect.arrayContaining(reconciliation!.spellReferences),
          details: expect.objectContaining({ reconciledFrom: 'runtimeCatalogBridge', bridgeId: entry.bridgeId })
        })
      ]));
    }
  });

  it('keeps the runtime subclass spell bridge complete and uniquely keyed', () => {
    expect(PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE).toHaveLength(35);
    expect(new Set(PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE.map((entry) => entry.id)).size).toBe(35);
    const reconciledBridgeIds = new Set(PHB2024_CATALOG_RECONCILIATION_MANIFEST.entries.map((entry) => entry.bridgeId));
    for (const bridgeId of reconciledBridgeIds) {
      expect(PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE.some((entry) => entry.id === bridgeId)).toBe(true);
    }
  });
});
