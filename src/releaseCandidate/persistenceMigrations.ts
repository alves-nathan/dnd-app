export interface BuildPresetPersistenceState {
  presets: unknown[];
}

export interface CatalogDistributionPersistenceState {
  policy: Record<string, unknown>;
  manifests: Record<string, unknown>;
  observations: Record<string, unknown[]>;
  sessions: Record<string, unknown>;
  cachedBundles: Record<string, unknown>;
  evidence: unknown[];
  events: unknown[];
}

export interface CatalogUpdateSessionPersistenceState {
  activeSession?: unknown;
  history: unknown[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const arrayOrEmpty = (value: unknown): unknown[] => Array.isArray(value) ? [...value] : [];
const recordOrEmpty = (value: unknown): Record<string, unknown> => isRecord(value) ? { ...value } : {};

export const migrateBuildPresetPersistenceState = (persisted: unknown): BuildPresetPersistenceState => {
  const source = isRecord(persisted) ? persisted : {};
  return { presets: arrayOrEmpty(source.presets) };
};

export const migrateCatalogDistributionPersistenceState = (persisted: unknown): CatalogDistributionPersistenceState => {
  const source = isRecord(persisted) ? persisted : {};
  return {
    policy: recordOrEmpty(source.policy),
    manifests: recordOrEmpty(source.manifests),
    observations: Object.fromEntries(
      Object.entries(recordOrEmpty(source.observations)).map(([key, value]) => [key, arrayOrEmpty(value)])
    ),
    sessions: recordOrEmpty(source.sessions),
    cachedBundles: recordOrEmpty(source.cachedBundles),
    evidence: arrayOrEmpty(source.evidence),
    events: arrayOrEmpty(source.events)
  };
};

export const migrateCatalogUpdateSessionPersistenceState = (
  persisted: unknown,
  persistedVersion: number
): CatalogUpdateSessionPersistenceState => {
  const source = isRecord(persisted) ? persisted : {};
  const history = arrayOrEmpty(source.history);

  // APP-18 added trust and transparency checkpoints to in-flight updates. A v1
  // session cannot be resumed safely because it lacks those checkpoints. The
  // active candidate is discarded while immutable receipts remain available.
  if (persistedVersion < 2) return { activeSession: undefined, history };

  return {
    ...(source.activeSession === undefined ? {} : { activeSession: source.activeSession }),
    history
  };
};
