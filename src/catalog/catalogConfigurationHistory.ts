import type { CatalogFilterState, FilterImpactReport } from './types';

export const CATALOG_CONFIGURATION_COMMIT_SCHEMA =
  'dnd-catalog-configuration-commit.v1' as const;

export interface CatalogConfigurationPortableImport {
  schemaVersion: 'dnd-portable-catalog-audit.v1';
  sourceCatalogVersion: string;
  sourceCatalogSnapshotId: string;
  sourceRevision: number;
  sourceHistoryChecksum: string;
  sourceHistory: CatalogConfigurationHistoryEntry[];
  comparison: 'identical' | 'incomingAhead' | 'localAhead' | 'diverged' | 'catalogMismatch';
  conflictingCommitIds: string[];
}

export type CatalogConfigurationCommitOrigin =
  | 'book'
  | 'category'
  | 'entity'
  | 'profile'
  | 'reset'
  | 'import'
  | 'restore'
  | 'manual';

export interface CatalogConfigurationAcknowledgement {
  required: boolean;
  acknowledged: boolean;
  acknowledgedAt?: string;
  affectedCharacterIds: string[];
  newBlockingIssues: number;
  newWarnings: number;
  preventivePlansRequested: boolean;
  preventivePlanCharacterIds: string[];
  obsoletePreventivePlanCharacterIds: string[];
  preservedPreventivePlanCharacterIds: string[];
}

export interface CatalogConfigurationChangeSet {
  bookIds: string[];
  categoryIds: string[];
  entityIds: string[];
}

export interface CatalogConfigurationImpactSummary {
  beforeEnabled: number;
  afterEnabled: number;
  disabledCount: number;
  enabledCount: number;
  hardDependencyBreakCount: number;
}

export interface CatalogConfigurationHistoryEntry {
  schemaVersion: typeof CATALOG_CONFIGURATION_COMMIT_SCHEMA;
  id: string;
  revision: number;
  committedAt: string;
  author: {
    kind: 'local';
    id: 'local-user';
    displayName: 'Usuário local';
  };
  label: string;
  origin: CatalogConfigurationCommitOrigin;
  catalogVersion: string;
  catalogSnapshotId: string;
  restoredFromCommitId?: string;
  beforeState: CatalogFilterState;
  afterState: CatalogFilterState;
  changes: CatalogConfigurationChangeSet;
  impact: CatalogConfigurationImpactSummary;
  acknowledgement: CatalogConfigurationAcknowledgement;
  portableImport?: CatalogConfigurationPortableImport;
  portableRestoreSessionId?: string;
}

export interface CatalogConfigurationCommitContext {
  origin?: CatalogConfigurationCommitOrigin;
  restoredFromCommitId?: string;
  acknowledgement?: Partial<CatalogConfigurationAcknowledgement>;
  portableImport?: CatalogConfigurationPortableImport;
  portableRestoreSessionId?: string;
}

const cloneState = (state: CatalogFilterState): CatalogFilterState => ({
  bookStates: { ...state.bookStates },
  categoryStates: { ...state.categoryStates },
  entityStates: { ...state.entityStates }
});

const changedKeys = <T>(
  before: Record<string, T | undefined>,
  after: Record<string, T | undefined>
): string[] => Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  .filter((key) => before[key] !== after[key])
  .sort();

export const diffCatalogFilterStates = (
  before: CatalogFilterState,
  after: CatalogFilterState
): CatalogConfigurationChangeSet => ({
  bookIds: changedKeys(before.bookStates, after.bookStates),
  categoryIds: changedKeys(before.categoryStates, after.categoryStates),
  entityIds: changedKeys(before.entityStates, after.entityStates)
});

export const summarizeCatalogFilterImpact = (
  impact: FilterImpactReport
): CatalogConfigurationImpactSummary => ({
  beforeEnabled: impact.beforeEnabled,
  afterEnabled: impact.afterEnabled,
  disabledCount: impact.disabledEntityIds.length,
  enabledCount: impact.enabledEntityIds.length,
  hardDependencyBreakCount: impact.hardDependencyBreaks.length
});

export const createCatalogConfigurationHistoryEntry = (params: {
  revision: number;
  committedAt: string;
  label: string;
  origin: CatalogConfigurationCommitOrigin;
  catalogVersion: string;
  catalogSnapshotId: string;
  beforeState: CatalogFilterState;
  afterState: CatalogFilterState;
  impact: FilterImpactReport;
  context?: CatalogConfigurationCommitContext;
}): CatalogConfigurationHistoryEntry => {
  const acknowledgement = params.context?.acknowledgement ?? {};
  return {
    schemaVersion: CATALOG_CONFIGURATION_COMMIT_SCHEMA,
    id: `catalog-config-${params.revision}-${params.committedAt.replace(/[^0-9]/g, '').slice(0, 17)}`,
    revision: params.revision,
    committedAt: params.committedAt,
    author: {
      kind: 'local',
      id: 'local-user',
      displayName: 'Usuário local'
    },
    label: params.label,
    origin: params.context?.origin ?? params.origin,
    catalogVersion: params.catalogVersion,
    catalogSnapshotId: params.catalogSnapshotId,
    restoredFromCommitId: params.context?.restoredFromCommitId,
    beforeState: cloneState(params.beforeState),
    afterState: cloneState(params.afterState),
    changes: diffCatalogFilterStates(params.beforeState, params.afterState),
    impact: summarizeCatalogFilterImpact(params.impact),
    portableRestoreSessionId: params.context?.portableRestoreSessionId,
    portableImport: params.context?.portableImport ? {
      ...params.context.portableImport,
      conflictingCommitIds: [...params.context.portableImport.conflictingCommitIds],
      sourceHistory: params.context.portableImport.sourceHistory.map((entry) => ({ ...entry }))
    } : undefined,
    acknowledgement: {
      required: acknowledgement.required ?? false,
      acknowledged: acknowledgement.acknowledged ?? false,
      acknowledgedAt: acknowledgement.acknowledgedAt,
      affectedCharacterIds: [...(acknowledgement.affectedCharacterIds ?? [])].sort(),
      newBlockingIssues: acknowledgement.newBlockingIssues ?? 0,
      newWarnings: acknowledgement.newWarnings ?? 0,
      preventivePlansRequested: acknowledgement.preventivePlansRequested ?? false,
      preventivePlanCharacterIds: [...(acknowledgement.preventivePlanCharacterIds ?? [])].sort(),
      obsoletePreventivePlanCharacterIds: [...(acknowledgement.obsoletePreventivePlanCharacterIds ?? [])].sort(),
      preservedPreventivePlanCharacterIds: [...(acknowledgement.preservedPreventivePlanCharacterIds ?? [])].sort()
    }
  };
};

export const isCatalogConfigurationHistoryEntry = (
  value: unknown
): value is CatalogConfigurationHistoryEntry => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CatalogConfigurationHistoryEntry>;
  return candidate.schemaVersion === CATALOG_CONFIGURATION_COMMIT_SCHEMA
    && typeof candidate.id === 'string'
    && typeof candidate.revision === 'number'
    && typeof candidate.committedAt === 'string'
    && typeof candidate.label === 'string'
    && Boolean(candidate.beforeState)
    && Boolean(candidate.afterState);
};
