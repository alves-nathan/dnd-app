import {
  CATALOG_SIGNATURE_ALGORITHM,
  CATALOG_TRUST_REGISTRY_SCHEMA,
  catalogPublicKeyFingerprint,
  type CatalogEcPublicJwk,
  type CatalogTrustRegistry
} from './catalogTrust';

export const OFFICIAL_CATALOG_PUBLISHER_ID = 'dnd-combat-official';
export const OFFICIAL_CATALOG_ROOT_KEY_ID = 'root-2026-01';
export const BUNDLED_CATALOG_CANONICAL_CHECKSUM = '0728e21b17ce768039d9873da7ee32d80b36480ab871297143944ad7fce50c43';

export const OFFICIAL_CATALOG_ROOT_PUBLIC_JWK: CatalogEcPublicJwk = {
  kty: 'EC',
  crv: 'P-256',
  x: 'aoGVl8cnUsF8Bo1TibmN1owfuox4TNWsIuHS6jeYYaA',
  y: 'IZpxakNqgMl5c909l8DT858IhGwp5yrvoLwkZo2Q_ms'
};

export const createDefaultCatalogTrustRegistry = (now: () => Date = () => new Date()): CatalogTrustRegistry => {
  const at = now().toISOString();
  const fingerprint = catalogPublicKeyFingerprint(OFFICIAL_CATALOG_ROOT_PUBLIC_JWK);
  return {
    schemaVersion: CATALOG_TRUST_REGISTRY_SCHEMA,
    revision: 1,
    publishers: [{
      publisherId: OFFICIAL_CATALOG_PUBLISHER_ID,
      displayName: 'D&D Combat Official Catalog',
      kind: 'official',
      trustLevel: 'pinned',
      status: 'trusted',
      keys: [{
        keyId: OFFICIAL_CATALOG_ROOT_KEY_ID,
        algorithm: CATALOG_SIGNATURE_ALGORITHM,
        publicJwk: OFFICIAL_CATALOG_ROOT_PUBLIC_JWK,
        fingerprint,
        status: 'active',
        validFrom: '2026-08-04T00:00:00.000Z',
        addedAt: at
      }],
      lastAcceptedBundle: {
        checksum: BUNDLED_CATALOG_CANONICAL_CHECKSUM,
        sequence: 0,
        catalogVersion: '4.8.0',
        snapshotId: 'bundled-catalog-v4.8.0',
        keyId: OFFICIAL_CATALOG_ROOT_KEY_ID,
        acceptedAt: at
      },
      createdAt: at,
      updatedAt: at
    }],
    events: [{
      id: `trust-publisherAdded-${at.replace(/[^0-9]/g, '').slice(0, 17)}-${OFFICIAL_CATALOG_PUBLISHER_ID}-${OFFICIAL_CATALOG_ROOT_KEY_ID}`,
      at,
      type: 'publisherAdded',
      publisherId: OFFICIAL_CATALOG_PUBLISHER_ID,
      keyId: OFFICIAL_CATALOG_ROOT_KEY_ID,
      details: { kind: 'official', trustLevel: 'pinned', fingerprint }
    }],
    updatedAt: at
  };
};
