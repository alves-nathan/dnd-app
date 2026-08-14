export type CatalogBookId = 'phb-2024' | 'dmg-2024' | 'mm-2025' | string;
export type CatalogEntityState = 'enabled' | 'disabled' | 'inherit';

export interface CatalogManifest {
  packageId: string;
  version: string;
  ruleset: string;
  sourceBooks: string[];
  counts?: Record<string, number>;
  validation?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RuntimeCatalogEntry {
  entityId: string;
  kind: string;
  displayName: string;
  displayContext: string[];
  sourceBookId: CatalogBookId | null;
  sourceFile: string;
  categoryIds: string[];
  status: string;
  defaultEnabled: boolean | null;
  manualReviewRequired: boolean;
  dependencyCounts: { outgoing: number; incoming: number };
  searchKey: string;
}

export interface EntityRegistryEntry {
  entityId: string;
  kind: string;
  sourceBookId: CatalogBookId | null;
  sourceFile: string;
  name?: unknown;
  key?: string | null;
  status: string;
  defaultEnabled: boolean | null;
  manualReviewRequired: boolean;
  confidence?: string | null;
}

export interface DependencyEdge {
  id: string;
  fromId: string;
  toId: string;
  relation: string;
  strength: string;
  resolutionPolicy: string;
  crossBook: boolean;
  status: string;
  provenance?: Record<string, unknown>;
}

export interface AliasEquivalence {
  id: string;
  kind: string;
  from: string;
  to: string;
  relation: string;
  resolutionPolicy: string;
  status: string;
  source?: Record<string, unknown>;
}

export interface ContentCategory {
  id: string;
  kind: 'contentCategory' | string;
  key: string;
  name: Record<string, string>;
  sourceBookId: CatalogBookId | null;
  memberCount: number;
  memberEntityIds: string[];
  defaultEnabled: boolean;
  canDisable: boolean;
  activationScopes: string[];
  availabilityClasses: string[];
  status: string;
}

export interface ContentFilterProfile {
  id: string;
  name: string;
  bookStates: Record<string, boolean>;
}

export interface ContentFilterPolicyDocument {
  id: string;
  kind: string;
  version: string;
  precedence: string[];
  rules: Array<{ id: string; description: string }>;
  profiles: ContentFilterProfile[];
  status: string;
}

export interface RuntimeCatalogBundle {
  schemaVersion: 'dnd-combat-runtime-bundle.v1' | string;
  catalogVersion: string;
  generatedAt: string;
  sourcePackage: {
    packageId: string;
    version: string;
    ruleset: string;
    sourceBooks: string[];
    zipSha256: string;
  };
  sourceFiles: Record<string, string>;
  sourceChecksums: Record<string, string>;
  manifest: CatalogManifest;
  runtimeIndex: {
    lotId: string;
    version: string;
    entryCount: number;
    entries: RuntimeCatalogEntry[];
  };
  entityRegistry: {
    id: string;
    kind: string;
    generatedFromVersion: string;
    entries: EntityRegistryEntry[];
    statistics?: Record<string, unknown>;
  };
  dependencyGraph: {
    id: string;
    kind: string;
    generatedFromVersion: string;
    nodeCount: number;
    edgeCount: number;
    edges: DependencyEdge[];
    statistics?: Record<string, unknown>;
  };
  aliases: {
    lotId: string;
    entities: AliasEquivalence[];
  };
  contentCategories: {
    lotId: string;
    version: string;
    entities: ContentCategory[];
  };
  contentFilterPolicy: ContentFilterPolicyDocument;
  readinessProfile: Record<string, unknown>;
  integrationContract: Record<string, unknown>;
  runtimeOperations: Record<string, unknown>;
  runtimeErrors: Record<string, unknown>;
  snapshotMigrationPolicy: Record<string, unknown>;
  activationPolicy: Record<string, unknown>;
  selectionContracts: Record<string, unknown>;
  providerCollections: Record<string, unknown>;
}

export interface CatalogValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  entityId?: string;
  path?: string;
}

export interface CatalogValidationReport {
  status: 'passed' | 'failed';
  catalogVersion?: string;
  checkedAt: string;
  checks: {
    bundleChecksum: boolean | 'notRequested';
    versionCoherence: boolean;
    counts: boolean;
    uniqueEntityIds: boolean;
    registryCoverage: boolean;
    categoryReferences: boolean;
    dependencyReferences: boolean;
    aliasReferences: boolean;
  };
  counts: {
    runtimeEntries: number;
    registryEntries: number;
    dependencyEdges: number;
    categories: number;
    aliases: number;
  };
  issues: CatalogValidationIssue[];
}

export interface CatalogSnapshot {
  readonly snapshotId: string;
  readonly catalogVersion: string;
  readonly loadedAt: string;
  readonly bundleSha256?: string;
  readonly manifest: CatalogManifest;
  readonly entries: readonly RuntimeCatalogEntry[];
  readonly registry: ReadonlyMap<string, EntityRegistryEntry>;
  readonly entryById: ReadonlyMap<string, RuntimeCatalogEntry>;
  readonly categories: readonly ContentCategory[];
  readonly categoryById: ReadonlyMap<string, ContentCategory>;
  readonly dependenciesFrom: ReadonlyMap<string, readonly DependencyEdge[]>;
  readonly dependenciesTo: ReadonlyMap<string, readonly DependencyEdge[]>;
  readonly aliases: ReadonlyMap<string, AliasEquivalence>;
  readonly filterPolicy: ContentFilterPolicyDocument;
  readonly readinessProfile: Readonly<Record<string, unknown>>;
  readonly validation: CatalogValidationReport;
}

export interface DigestAdapter {
  sha256(input: string): Promise<string>;
}

export interface CatalogLoadOptions {
  expectedSha256?: string;
  digestAdapter?: DigestAdapter;
  strictEditorial?: boolean;
  now?: () => Date;
}

export interface CatalogFilterState {
  bookStates: Record<string, boolean>;
  categoryStates: Record<string, boolean>;
  entityStates: Record<string, CatalogEntityState>;
}

export interface EntityAvailability {
  entityId: string;
  enabled: boolean;
  reason:
    | 'sourceBookDisabled'
    | 'protectedEntity'
    | 'explicitEntityDisabled'
    | 'explicitEntityEnabled'
    | 'categoryDisabled'
    | 'categoryEnabled'
    | 'entityDefaultEnabled'
    | 'entityDefaultDisabled';
  sourceBookId: string | null;
  categoryIds: string[];
}

export interface CatalogSearchRequest {
  text?: string;
  kinds?: string[];
  sourceBookIds?: string[];
  categoryIds?: string[];
  includeManualReview?: boolean;
  enabledOnly?: boolean;
  limit?: number;
}

export interface FilterImpactReport {
  beforeEnabled: number;
  afterEnabled: number;
  disabledEntityIds: string[];
  enabledEntityIds: string[];
  hardDependencyBreaks: Array<{
    fromId: string;
    toId: string;
    relation: string;
    resolutionPolicy: string;
  }>;
}
