import {
  PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE,
  type Phb2024SubclassSpellGrantBridgeEntry
} from './phb2024SubclassSpellGrantBridge';

interface CatalogReconciliationManifestEntry {
  featureId: string;
  bridgeId: string;
  mode: 'alwaysPrepared';
}

interface CatalogReconciliationManifest {
  schemaVersion: string;
  sourceCatalogVersion: string;
  rulesEra: string;
  entries: CatalogReconciliationManifestEntry[];
}

const manifest = require('../../assets/spell-access/phb2024-catalog-reconciliation-v1.json') as CatalogReconciliationManifest;

export interface SpellAccessCatalogReconciliation {
  featureId: string;
  bridgeId: string;
  mode: 'alwaysPrepared';
  spellReferences: string[];
  bridgeEntry: Phb2024SubclassSpellGrantBridgeEntry;
}

export const PHB2024_CATALOG_RECONCILIATION_MANIFEST = manifest;

export const getSpellAccessCatalogReconciliation = (
  featureId: string
): SpellAccessCatalogReconciliation | undefined => {
  const entry = manifest.entries.find((candidate) => candidate.featureId === featureId);
  if (!entry) return undefined;
  const bridgeEntry = PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE.find((candidate) => candidate.id === entry.bridgeId);
  if (!bridgeEntry) return undefined;
  return {
    featureId: entry.featureId,
    bridgeId: entry.bridgeId,
    mode: entry.mode,
    spellReferences: Array.from(new Set(bridgeEntry.groups.flatMap((group) => group.spellReferences))),
    bridgeEntry
  };
};

export const isCatalogSpellAccessReconciled = (featureId: string): boolean =>
  Boolean(getSpellAccessCatalogReconciliation(featureId));
