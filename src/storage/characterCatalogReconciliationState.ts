export const CHARACTER_CATALOG_RECONCILIATION_VERSION = 1;

export interface CharacterCatalogReconciliationState {
  /** Version of the catalog-aware repair algorithm last completed. */
  version: number;
  /** Fingerprint of character-link identity carriers used by that repair. */
  catalogFingerprint?: string;
  completedAt?: string;
  changedCharacterIds: string[];
  repairedLinkCount: number;
  unresolvedLinkCount: number;
}

export const emptyCharacterCatalogReconciliationState = (): CharacterCatalogReconciliationState => ({
  version: 0,
  catalogFingerprint: undefined,
  completedAt: undefined,
  changedCharacterIds: [],
  repairedLinkCount: 0,
  unresolvedLinkCount: 0
});

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const asNonNegativeInteger = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

export const normalizeCharacterCatalogReconciliationState = (
  value: unknown
): CharacterCatalogReconciliationState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptyCharacterCatalogReconciliationState();
  }
  const record = value as Record<string, unknown>;
  return {
    version: asNonNegativeInteger(record.version),
    catalogFingerprint: typeof record.catalogFingerprint === 'string' && record.catalogFingerprint
      ? record.catalogFingerprint
      : undefined,
    completedAt: typeof record.completedAt === 'string' && record.completedAt
      ? record.completedAt
      : undefined,
    changedCharacterIds: Array.from(new Set(asStringArray(record.changedCharacterIds))),
    repairedLinkCount: asNonNegativeInteger(record.repairedLinkCount),
    unresolvedLinkCount: asNonNegativeInteger(record.unresolvedLinkCount)
  };
};
