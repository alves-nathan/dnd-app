import { ContentPolicyService } from './contentPolicyService';
import { CatalogLoader } from './catalogLoader';
import { catalogDigestAdapter, sha256Hex } from './catalogBundleDigest';
import type { CatalogFilterState, CatalogSnapshot, RuntimeCatalogBundle } from './types';
import { sanitizeCatalogFilterState, type CatalogConfigurationCheckpointDocument } from '../storage/catalogFilterPreferences';
import type { CatalogRuntimePackageRef, CatalogPackageDescriptor } from '../storage/catalogPackageRepository';
import type { CatalogConfigurationHistoryEntry } from './catalogConfigurationHistory';
import type { PortableRestoreHistoricalEvidenceRecord } from '../backup/portableRestoreEvidenceCenter';
import { verifySignedCatalogEnvelope, type CatalogTrustRegistry, type CatalogTrustVerification } from './catalogTrust';
import type { CatalogTransparencyAnchor, CatalogTransparencyCheckpoint } from './catalogTransparency';

export const CATALOG_UPDATE_SESSION_SCHEMA = 'dnd-catalog-update-session.v1' as const;
export const CATALOG_UPDATE_RECEIPT_SCHEMA = 'dnd-catalog-update-receipt.v1' as const;

export interface CatalogUpdateCharacterRecord {
  id: string;
  name: string;
  catalogSnapshotId?: string;
  compendiumLinks?: unknown[];
}

export interface CatalogUpdateCompatibilityReportLike {
  manifest: {
    characterId: string;
    references: Array<{ origin: 'catalog' | 'compendium'; entityId?: string }>;
  };
}

export type CatalogUpdateSessionStatus = 'prepared' | 'committing' | 'committed' | 'rollingBack' | 'rolledBack' | 'interrupted' | 'failed';

export interface CatalogVersionDiff {
  fromVersion: string;
  toVersion: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  versionDirection: 'upgrade' | 'downgrade' | 'sidegrade';
  addedEntityIds: string[];
  removedEntityIds: string[];
  changedEntityIds: string[];
  addedBookIds: string[];
  removedBookIds: string[];
  addedCategoryIds: string[];
  removedCategoryIds: string[];
  dependencyEdgesBefore: number;
  dependencyEdgesAfter: number;
  dependencyEdgeDelta: number;
  aliasCountBefore: number;
  aliasCountAfter: number;
}

export interface CatalogUpdateCharacterImpact {
  characterId: string;
  characterName: string;
  currentSnapshotId?: string;
  targetSnapshotId: string;
  referencedEntityIds: string[];
  changedEntityIds: string[];
  removedEntityIds: string[];
  disabledEntityIds: string[];
  requiresSnapshotMigration: boolean;
  blockingIssueCount: number;
}

export interface CatalogUpdateImpactReport {
  characters: CatalogUpdateCharacterImpact[];
  affectedCharacterIds: string[];
  snapshotMigrationCharacterIds: string[];
  blockingCharacterIds: string[];
  affectedEvidenceRecordIds: string[];
  counts: {
    charactersExamined: number;
    charactersAffected: number;
    snapshotMigrations: number;
    blockingCharacters: number;
    evidenceRecordsAffected: number;
  };
}

export interface CatalogUpdateCheckpoint {
  runtimeRef: CatalogRuntimePackageRef;
  trustRegistry?: CatalogTrustRegistry;
  transparency?: CatalogTransparencyCheckpoint;
  catalog: CatalogConfigurationCheckpointDocument;
  characters: CatalogUpdateCharacterRecord[];
  evidenceRecords: PortableRestoreHistoricalEvidenceRecord[];
}

export interface CatalogUpdateReceipt {
  schemaVersion: typeof CATALOG_UPDATE_RECEIPT_SCHEMA;
  receiptId: string;
  sessionId: string;
  committedAt: string;
  fromVersion: string;
  toVersion: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  versionDirection: 'upgrade' | 'downgrade' | 'sidegrade';
  candidateChecksum: string;
  migratedCharacterIds: string[];
  affectedEvidenceRecordIds: string[];
  provenance?: CatalogTrustVerification;
  transparency?: CatalogTransparencyAnchor;
  checksum: string;
}

export interface CatalogUpdateSession {
  schemaVersion: typeof CATALOG_UPDATE_SESSION_SCHEMA;
  id: string;
  status: CatalogUpdateSessionStatus;
  createdAt: string;
  updatedAt: string;
  sourceName?: string;
  candidate: CatalogPackageDescriptor;
  diff: CatalogVersionDiff;
  impact: CatalogUpdateImpactReport;
  projectedFilterState: CatalogFilterState;
  checkpoint: CatalogUpdateCheckpoint;
  migrationCharacterIds: string[];
  impactAcknowledged: boolean;
  evidenceAcknowledged: boolean;
  blockingAcknowledged: boolean;
  commitPhase: 'none' | 'packageActivated' | 'catalogApplied' | 'charactersMigrated' | 'complete';
  rollbackPhase: 'none' | 'catalogRestored' | 'charactersRestored' | 'complete';
  committedAt?: string;
  rolledBackAt?: string;
  lastError?: string;
  receipt?: CatalogUpdateReceipt;
  trustVerification?: CatalogTrustVerification;
  internalFixtureBypass?: boolean;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) result[key] = canonicalize(entry);
    return result;
  }, {});
};

const fingerprint = (value: unknown): string => sha256Hex(JSON.stringify(canonicalize(value)));
const sortedDifference = (left: Iterable<string>, right: Set<string>): string[] => Array.from(left).filter((id) => !right.has(id)).sort();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const entityFingerprint = (snapshot: CatalogSnapshot, entityId: string): string => fingerprint({
  entry: snapshot.entryById.get(entityId),
  registry: snapshot.registry.get(entityId),
  outgoing: snapshot.dependenciesFrom.get(entityId) ?? [],
  incoming: snapshot.dependenciesTo.get(entityId) ?? []
});

const numericVersion = (value: string): number[] => (value.match(/\d+/g) ?? []).slice(0, 4).map(Number);
const compareVersions = (left: string, right: string): number => {
  const a = numericVersion(left);
  const b = numericVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta) return delta;
  }
  return left.localeCompare(right);
};
const versionDirection = (fromVersion: string, toVersion: string): CatalogVersionDiff['versionDirection'] => {
  const comparison = compareVersions(toVersion, fromVersion);
  return comparison > 0 ? 'upgrade' : comparison < 0 ? 'downgrade' : 'sidegrade';
};

export const compareCatalogSnapshots = (current: CatalogSnapshot, candidate: CatalogSnapshot): CatalogVersionDiff => {
  const currentIds = new Set(current.entries.map((entry) => entry.entityId));
  const candidateIds = new Set(candidate.entries.map((entry) => entry.entityId));
  const shared = Array.from(currentIds).filter((id) => candidateIds.has(id));
  const currentBooks = new Set(current.manifest.sourceBooks);
  const candidateBooks = new Set(candidate.manifest.sourceBooks);
  const currentCategories = new Set(current.categories.map((entry) => entry.id));
  const candidateCategories = new Set(candidate.categories.map((entry) => entry.id));
  const dependencyEdgesBefore = Array.from(current.dependenciesFrom.values()).reduce((sum, edges) => sum + edges.length, 0);
  const dependencyEdgesAfter = Array.from(candidate.dependenciesFrom.values()).reduce((sum, edges) => sum + edges.length, 0);
  return {
    fromVersion: current.catalogVersion,
    toVersion: candidate.catalogVersion,
    fromSnapshotId: current.snapshotId,
    toSnapshotId: candidate.snapshotId,
    versionDirection: versionDirection(current.catalogVersion, candidate.catalogVersion),
    addedEntityIds: sortedDifference(candidateIds, currentIds),
    removedEntityIds: sortedDifference(currentIds, candidateIds),
    changedEntityIds: shared.filter((id) => entityFingerprint(current, id) !== entityFingerprint(candidate, id)).sort(),
    addedBookIds: sortedDifference(candidateBooks, currentBooks),
    removedBookIds: sortedDifference(currentBooks, candidateBooks),
    addedCategoryIds: sortedDifference(candidateCategories, currentCategories),
    removedCategoryIds: sortedDifference(currentCategories, candidateCategories),
    dependencyEdgesBefore,
    dependencyEdgesAfter,
    dependencyEdgeDelta: dependencyEdgesAfter - dependencyEdgesBefore,
    aliasCountBefore: current.aliases.size,
    aliasCountAfter: candidate.aliases.size
  };
};

export const projectCatalogFilterState = (
  current: CatalogFilterState,
  candidate: CatalogSnapshot
): CatalogFilterState => sanitizeCatalogFilterState(candidate, current, new ContentPolicyService(candidate).createDefaultState());

export const buildCatalogUpdateImpact = (params: {
  characters: readonly CatalogUpdateCharacterRecord[];
  currentReports: readonly CatalogUpdateCompatibilityReportLike[];
  candidateSnapshot: CatalogSnapshot;
  candidateFilterState: CatalogFilterState;
  diff: CatalogVersionDiff;
  evidenceRecords: readonly PortableRestoreHistoricalEvidenceRecord[];
  catalogHistory: readonly CatalogConfigurationHistoryEntry[];
}): CatalogUpdateImpactReport => {
  const reportByCharacterId = new Map(params.currentReports.map((report) => [report.manifest.characterId, report]));
  const changedSet = new Set(params.diff.changedEntityIds);
  const removedSet = new Set(params.diff.removedEntityIds);
  const policy = new ContentPolicyService(params.candidateSnapshot);
  const characters = params.characters.map<CatalogUpdateCharacterImpact>((character) => {
    const report = reportByCharacterId.get(character.id);
    const referencedEntityIds = report?.manifest.references
      .filter((reference) => reference.origin === 'catalog' && reference.entityId)
      .map((reference) => reference.entityId!) ?? [];
    const unique = Array.from(new Set(referencedEntityIds)).sort();
    const removedEntityIds = unique.filter((id) => removedSet.has(id) || !params.candidateSnapshot.entryById.has(id));
    const changedEntityIds = unique.filter((id) => changedSet.has(id));
    const disabledEntityIds = unique.filter((id) => {
      const entry = params.candidateSnapshot.entryById.get(id);
      return Boolean(entry && !policy.isEnabled(id, params.candidateFilterState));
    });
    return {
      characterId: character.id,
      characterName: character.name,
      currentSnapshotId: character.catalogSnapshotId,
      targetSnapshotId: params.candidateSnapshot.snapshotId,
      referencedEntityIds: unique,
      changedEntityIds,
      removedEntityIds,
      disabledEntityIds,
      requiresSnapshotMigration: character.catalogSnapshotId !== params.candidateSnapshot.snapshotId,
      blockingIssueCount: removedEntityIds.length + disabledEntityIds.length
    };
  });
  const historyById = new Map(params.catalogHistory.map((entry) => [entry.id, entry]));
  const affectedEvidenceRecordIds = params.evidenceRecords.filter((record) => {
    const historyId = record.receipt.catalogHistoryEntryId;
    if (!historyId) return false;
    const history = historyById.get(historyId);
    return Boolean(history && history.catalogSnapshotId === params.diff.fromSnapshotId);
  }).map((record) => record.recordId).sort();
  const affectedCharacterIds = characters
    .filter((entry) => entry.changedEntityIds.length || entry.removedEntityIds.length || entry.disabledEntityIds.length)
    .map((entry) => entry.characterId);
  const snapshotMigrationCharacterIds = characters.filter((entry) => entry.requiresSnapshotMigration).map((entry) => entry.characterId);
  const blockingCharacterIds = characters.filter((entry) => entry.blockingIssueCount > 0).map((entry) => entry.characterId);
  return {
    characters,
    affectedCharacterIds,
    snapshotMigrationCharacterIds,
    blockingCharacterIds,
    affectedEvidenceRecordIds,
    counts: {
      charactersExamined: characters.length,
      charactersAffected: affectedCharacterIds.length,
      snapshotMigrations: snapshotMigrationCharacterIds.length,
      blockingCharacters: blockingCharacterIds.length,
      evidenceRecordsAffected: affectedEvidenceRecordIds.length
    }
  };
};

export const parseAndValidateCatalogCandidate = async (params: {
  rawText: string;
  currentSnapshot: CatalogSnapshot;
  expectedChecksum?: string;
  sourceName?: string;
  now?: () => Date;
}): Promise<{ bundle: RuntimeCatalogBundle; snapshot: CatalogSnapshot; checksum: string; packageId: string; diff: CatalogVersionDiff }> => {
  const checksum = sha256Hex(params.rawText);
  const expectedChecksum = params.expectedChecksum?.trim().toLowerCase().split(/\s+/)[0];
  if (expectedChecksum && expectedChecksum !== checksum) throw new Error('O checksum informado não corresponde ao bundle candidato.');
  const bundle = JSON.parse(params.rawText) as RuntimeCatalogBundle;
  const snapshot = await new CatalogLoader().initializeFromText(params.rawText, {
    expectedSha256: checksum,
    digestAdapter: catalogDigestAdapter,
    now: params.now
  });
  const diff = compareCatalogSnapshots(params.currentSnapshot, snapshot);
  const noMaterialChanges = diff.addedEntityIds.length === 0
    && diff.removedEntityIds.length === 0
    && diff.changedEntityIds.length === 0
    && diff.addedBookIds.length === 0
    && diff.removedBookIds.length === 0
    && diff.addedCategoryIds.length === 0
    && diff.removedCategoryIds.length === 0
    && diff.dependencyEdgeDelta === 0
    && diff.aliasCountBefore === diff.aliasCountAfter;
  if (snapshot.snapshotId === params.currentSnapshot.snapshotId || (snapshot.catalogVersion === params.currentSnapshot.catalogVersion && noMaterialChanges)) {
    throw new Error('O bundle candidato é idêntico ao catálogo ativo.');
  }
  const packageId = `catalog-package-${snapshot.catalogVersion}-${checksum.slice(0, 16)}`;
  return { bundle, snapshot, checksum, packageId, diff };
};

export const parseAndValidateTrustedCatalogCandidate = async (params: {
  rawText: string;
  currentSnapshot: CatalogSnapshot;
  trustRegistry: CatalogTrustRegistry;
  expectedEnvelopeChecksum?: string;
  sourceName?: string;
  now?: () => Date;
}): Promise<{ bundle: RuntimeCatalogBundle; snapshot: CatalogSnapshot; checksum: string; packageId: string; diff: CatalogVersionDiff; verification: CatalogTrustVerification; catalogRawText: string }> => {
  const expected = params.expectedEnvelopeChecksum?.trim().toLowerCase().split(/\s+/)[0];
  const actualEnvelopeChecksum = sha256Hex(params.rawText);
  if (expected && expected !== actualEnvelopeChecksum) throw new Error('O checksum informado não corresponde ao envelope assinado.');
  const trusted = verifySignedCatalogEnvelope({ rawText: params.rawText, registry: params.trustRegistry, now: params.now });
  const parsed = await parseAndValidateCatalogCandidate({
    rawText: trusted.catalogRawText,
    currentSnapshot: params.currentSnapshot,
    sourceName: params.sourceName,
    now: params.now
  });
  if (parsed.snapshot.snapshotId !== trusted.envelope.provenance.snapshotId) throw new Error('O snapshot calculado diverge do snapshot assinado.');
  return { ...parsed, verification: trusted.verification, catalogRawText: trusted.catalogRawText };
};

export const createCatalogUpdateSession = (params: {
  candidate: CatalogPackageDescriptor;
  diff: CatalogVersionDiff;
  impact: CatalogUpdateImpactReport;
  projectedFilterState: CatalogFilterState;
  checkpoint: CatalogUpdateCheckpoint;
  sourceName?: string;
  trustVerification?: CatalogTrustVerification;
  internalFixtureBypass?: boolean;
  now?: () => Date;
}): CatalogUpdateSession => {
  const now = params.now ?? (() => new Date());
  const at = now().toISOString();
  return {
    schemaVersion: CATALOG_UPDATE_SESSION_SCHEMA,
    id: `catalog-update-${at.replace(/[^0-9]/g, '').slice(0, 17)}-${params.candidate.checksum.slice(0, 8)}`,
    status: 'prepared',
    createdAt: at,
    updatedAt: at,
    sourceName: params.sourceName,
    candidate: clone(params.candidate),
    diff: clone(params.diff),
    impact: clone(params.impact),
    projectedFilterState: clone(params.projectedFilterState),
    checkpoint: clone(params.checkpoint),
    migrationCharacterIds: [],
    impactAcknowledged: false,
    evidenceAcknowledged: params.impact.affectedEvidenceRecordIds.length === 0,
    blockingAcknowledged: params.impact.blockingCharacterIds.length === 0,
    commitPhase: 'none',
    rollbackPhase: 'none',
    ...(params.trustVerification ? { trustVerification: clone(params.trustVerification) } : {}),
    ...(params.internalFixtureBypass ? { internalFixtureBypass: true } : {})
  };
};

export const migrateCharacterCatalogSnapshots = (
  characters: readonly CatalogUpdateCharacterRecord[],
  characterIds: readonly string[],
  snapshotId: string
): CatalogUpdateCharacterRecord[] => {
  const selected = new Set(characterIds);
  return characters.map((character) => {
    const cloned = clone(character);
    if (!selected.has(character.id)) return cloned;
    const links = Array.isArray(cloned.compendiumLinks)
      ? (cloned.compendiumLinks as Array<Record<string, unknown>>).map((link) => link.origin === 'catalog' ? { ...link, catalogSnapshotId: snapshotId } : link)
      : cloned.compendiumLinks;
    return { ...cloned, catalogSnapshotId: snapshotId, ...(links === undefined ? {} : { compendiumLinks: links }) };
  });
};

export const canCommitCatalogUpdate = (session: CatalogUpdateSession): { ok: boolean; issues: string[] } => {
  const issues: string[] = [];
  if (!['prepared', 'interrupted', 'committing'].includes(session.status)) issues.push('A sessão não está pronta para commit.');
  if (!session.trustVerification && !session.internalFixtureBypass) issues.push('O bundle não possui uma verificação criptográfica confiável.');
  if (session.impact.blockingCharacterIds.length && !session.blockingAcknowledged) issues.push(`${session.impact.blockingCharacterIds.length} personagem(ns) possuem referências removidas ou indisponíveis e exigem reconhecimento explícito.`);
  if (session.impact.affectedCharacterIds.length && !session.impactAcknowledged) issues.push('O impacto nas fichas ainda não foi reconhecido.');
  if (session.impact.affectedEvidenceRecordIds.length && !session.evidenceAcknowledged) issues.push('O impacto nas evidências históricas ainda não foi reconhecido.');
  const requiredMigrations = new Set(session.impact.snapshotMigrationCharacterIds);
  const migrated = new Set(session.migrationCharacterIds);
  const missingMigrations = Array.from(requiredMigrations).filter((id) => !migrated.has(id));
  if (missingMigrations.length) issues.push(`${missingMigrations.length} personagem(ns) ainda não foram incluídos na migração explícita de snapshot.`);
  return { ok: issues.length === 0, issues };
};

export const createCatalogUpdateReceipt = (session: CatalogUpdateSession, now: () => Date = () => new Date(), transparency?: CatalogTransparencyAnchor): CatalogUpdateReceipt => {
  const committedAt = now().toISOString();
  const base: Omit<CatalogUpdateReceipt, 'checksum'> = {
    schemaVersion: CATALOG_UPDATE_RECEIPT_SCHEMA,
    receiptId: `catalog-update-receipt-${session.id}`,
    sessionId: session.id,
    committedAt,
    fromVersion: session.diff.fromVersion,
    toVersion: session.diff.toVersion,
    fromSnapshotId: session.diff.fromSnapshotId,
    toSnapshotId: session.diff.toSnapshotId,
    versionDirection: session.diff.versionDirection,
    candidateChecksum: session.candidate.checksum,
    migratedCharacterIds: [...session.migrationCharacterIds].sort(),
    affectedEvidenceRecordIds: [...session.impact.affectedEvidenceRecordIds].sort(),
    ...(session.trustVerification ? { provenance: clone(session.trustVerification) } : {}),
    ...(transparency ? { transparency: clone(transparency) } : {})
  };
  return { ...base, checksum: fingerprint(base) };
};

export const validateCatalogUpdateReceipt = (receipt: CatalogUpdateReceipt): boolean => {
  const { checksum, ...base } = receipt;
  return receipt.schemaVersion === CATALOG_UPDATE_RECEIPT_SCHEMA && checksum === fingerprint(base);
};
