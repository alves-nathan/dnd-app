import type { CatalogFilterState, CatalogSnapshot } from '../catalog/types';
import type { Character, RuleValidationIssue } from '../types';
import {
  isCatalogConfigurationHistoryEntry,
  type CatalogConfigurationHistoryEntry,
  type CatalogConfigurationPortableImport
} from '../catalog/catalogConfigurationHistory';
import type { CharacterCompatibilityRemediationPlan } from '../characters/compatibilityRemediation';
import { characterProgressionFingerprint } from '../characters/progressionTransaction';
import { cloneCatalogFilterState, sanitizeCatalogFilterState } from '../storage/catalogFilterPreferences';

export const PORTABLE_CATALOG_AUDIT_SCHEMA = 'dnd-portable-catalog-audit.v1' as const;
export const PORTABLE_CATALOG_AUDIT_CHECKSUM_ALGORITHM = 'fnv1a32' as const;

export interface PortableCatalogAuditSection {
  schemaVersion: typeof PORTABLE_CATALOG_AUDIT_SCHEMA;
  exportedAt: string;
  catalogVersion: string;
  catalogSnapshotId: string;
  revision: number;
  filterState: CatalogFilterState;
  history: CatalogConfigurationHistoryEntry[];
  historyIntegrity: {
    algorithm: typeof PORTABLE_CATALOG_AUDIT_CHECKSUM_ALGORITHM;
    checksum: string;
  };
  remediationPlans: CharacterCompatibilityRemediationPlan[];
}

export type PortableCatalogComparisonRelation =
  | 'identical'
  | 'incomingAhead'
  | 'localAhead'
  | 'diverged'
  | 'catalogMismatch';

export interface PortableCatalogAuditComparison {
  relation: PortableCatalogComparisonRelation;
  localRevision: number;
  incomingRevision: number;
  localHistoryCount: number;
  incomingHistoryCount: number;
  sharedCommitIds: string[];
  localOnlyCommitIds: string[];
  incomingOnlyCommitIds: string[];
  conflictingCommitIds: string[];
  changedBookIds: string[];
  changedCategoryIds: string[];
  changedEntityIds: string[];
  planConflicts: string[];
  incomingPlanCharacterIds: string[];
  requiresExplicitImport: boolean;
}

export interface PortableCatalogAuditValidationResult {
  ok: boolean;
  issues: RuleValidationIssue[];
  section?: PortableCatalogAuditSection;
}

export interface PortableRemediationPlanImportResult {
  accepted: CharacterCompatibilityRemediationPlan[];
  duplicateCharacterIds: string[];
  conflictingCharacterIds: string[];
  skippedCharacterIds: string[];
  issues: RuleValidationIssue[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const issue = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({ severity, code, message });

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((output, key) => {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) output[key] = canonicalize(entry);
    return output;
  }, {});
};

const canonicalStringify = (value: unknown): string => JSON.stringify(canonicalize(value));

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const portableCatalogHistoryChecksum = (history: readonly CatalogConfigurationHistoryEntry[]): string =>
  fnv1a32(canonicalStringify(history));

const same = (left: unknown, right: unknown): boolean => canonicalStringify(left) === canonicalStringify(right);

const changedKeys = <T>(left: Record<string, T | undefined>, right: Record<string, T | undefined>): string[] =>
  Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).filter((key) => left[key] !== right[key]).sort();

const isRemediationPlan = (value: unknown): value is CharacterCompatibilityRemediationPlan => {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 'dnd-character-compatibility-remediation.v1'
    && typeof value.id === 'string'
    && typeof value.characterId === 'string'
    && typeof value.baseFingerprint === 'string'
    && typeof value.targetCatalogSnapshotId === 'string'
    && Array.isArray(value.decisions);
};

export const createPortableCatalogAuditSection = (params: {
  snapshot: CatalogSnapshot;
  filterState: CatalogFilterState;
  revision: number;
  history: readonly CatalogConfigurationHistoryEntry[];
  remediationPlans?: Record<string, CharacterCompatibilityRemediationPlan> | readonly CharacterCompatibilityRemediationPlan[];
  selectedCharacterIds?: readonly string[];
  now?: () => Date;
}): PortableCatalogAuditSection => {
  const selected = params.selectedCharacterIds?.length ? new Set(params.selectedCharacterIds) : undefined;
  const planList = Array.isArray(params.remediationPlans)
    ? params.remediationPlans
    : Object.values(params.remediationPlans ?? {});
  const remediationPlans = planList
    .filter((plan) => !selected || selected.has(plan.characterId))
    .map(clone)
    .sort((left, right) => left.characterId.localeCompare(right.characterId));
  const history = [...params.history].map(clone).sort((left, right) => left.revision - right.revision || left.id.localeCompare(right.id));
  return {
    schemaVersion: PORTABLE_CATALOG_AUDIT_SCHEMA,
    exportedAt: (params.now ?? (() => new Date()))().toISOString(),
    catalogVersion: params.snapshot.catalogVersion,
    catalogSnapshotId: params.snapshot.snapshotId,
    revision: Math.max(params.revision, history.reduce((maximum, entry) => Math.max(maximum, entry.revision), 0)),
    filterState: cloneCatalogFilterState(params.filterState),
    history,
    historyIntegrity: {
      algorithm: PORTABLE_CATALOG_AUDIT_CHECKSUM_ALGORITHM,
      checksum: portableCatalogHistoryChecksum(history)
    },
    remediationPlans
  };
};

export const validatePortableCatalogAuditSection = (params: {
  candidate: unknown;
  snapshot: CatalogSnapshot;
  fallback: CatalogFilterState;
  knownCharacterIds?: readonly string[];
}): PortableCatalogAuditValidationResult => {
  const issues: RuleValidationIssue[] = [];
  if (!isRecord(params.candidate)) return { ok: false, issues: [issue('error', 'backup.catalogAudit.invalidRoot', 'A seção do catálogo não é um objeto válido.')] };
  const candidate = params.candidate;
  if (candidate.schemaVersion !== PORTABLE_CATALOG_AUDIT_SCHEMA) {
    return { ok: false, issues: [issue('error', 'backup.catalogAudit.unsupportedSchema', `Schema de catálogo portátil não suportado: ${String(candidate.schemaVersion ?? 'ausente')}.`)] };
  }
  const rawHistory = Array.isArray(candidate.history) ? candidate.history : [];
  const validHistory = rawHistory.filter(isCatalogConfigurationHistoryEntry).map(clone);
  if (validHistory.length !== rawHistory.length) issues.push(issue('error', 'backup.catalogAudit.invalidHistoryEntry', 'O histórico importado contém commits inválidos.'));
  const commitIds = new Set<string>();
  const revisions = new Set<number>();
  for (const entry of validHistory) {
    if (commitIds.has(entry.id)) issues.push(issue('error', 'backup.catalogAudit.duplicateCommitId', `O commit ${entry.id} aparece mais de uma vez.`));
    if (revisions.has(entry.revision)) issues.push(issue('error', 'backup.catalogAudit.duplicateRevision', `A revisão ${entry.revision} aparece mais de uma vez.`));
    commitIds.add(entry.id);
    revisions.add(entry.revision);
  }
  const sortedHistory = validHistory.sort((left, right) => left.revision - right.revision || left.id.localeCompare(right.id));
  for (let index = 1; index < sortedHistory.length; index += 1) {
    const previous = sortedHistory[index - 1];
    const current = sortedHistory[index];
    if (current.revision <= previous.revision) issues.push(issue('error', 'backup.catalogAudit.nonMonotonicHistory', 'O histórico do catálogo não possui revisões monotônicas.'));
    if (current.revision === previous.revision + 1 && !same(previous.afterState, current.beforeState)) {
      issues.push(issue('error', 'backup.catalogAudit.brokenHistoryChain', `A transição entre as revisões ${previous.revision} e ${current.revision} não é contínua.`));
    }
  }
  const declaredChecksum = isRecord(candidate.historyIntegrity) && typeof candidate.historyIntegrity.checksum === 'string'
    ? candidate.historyIntegrity.checksum
    : undefined;
  if (!declaredChecksum || candidate.historyIntegrity && (candidate.historyIntegrity as Record<string, unknown>).algorithm !== PORTABLE_CATALOG_AUDIT_CHECKSUM_ALGORITHM) {
    issues.push(issue('error', 'backup.catalogAudit.missingHistoryIntegrity', 'A auditoria do catálogo não possui integridade compatível.'));
  } else if (declaredChecksum !== portableCatalogHistoryChecksum(sortedHistory)) {
    issues.push(issue('error', 'backup.catalogAudit.historyIntegrityMismatch', 'A integridade do histórico do catálogo falhou.'));
  }
  const rawRevision = typeof candidate.revision === 'number' && Number.isFinite(candidate.revision) ? Math.max(0, Math.floor(candidate.revision)) : 0;
  const maximumRevision = sortedHistory.reduce((maximum, entry) => Math.max(maximum, entry.revision), 0);
  if (rawRevision < maximumRevision) issues.push(issue('error', 'backup.catalogAudit.revisionBehindHistory', 'A revisão declarada é anterior ao último commit do histórico.'));
  const sanitizedState = sanitizeCatalogFilterState(params.snapshot, candidate.filterState, params.fallback);
  if (sortedHistory.length && !same(sanitizeCatalogFilterState(params.snapshot, sortedHistory[sortedHistory.length - 1].afterState, params.fallback), sanitizedState)) {
    issues.push(issue('warning', 'backup.catalogAudit.stateDiffersFromHistoryTail', 'Os filtros exportados diferem do último commit preservado; a importação usará explicitamente os filtros exportados.'));
  }
  const sourceCatalogVersion = typeof candidate.catalogVersion === 'string' ? candidate.catalogVersion : 'unknown';
  const sourceSnapshotId = typeof candidate.catalogSnapshotId === 'string' ? candidate.catalogSnapshotId : 'unknown';
  if (sourceCatalogVersion !== params.snapshot.catalogVersion) {
    issues.push(issue('warning', 'backup.catalogAudit.catalogVersionMismatch', `O backup usa o catálogo ${sourceCatalogVersion}; IDs compatíveis serão migrados para ${params.snapshot.catalogVersion}.`));
  }
  const rawPlans = Array.isArray(candidate.remediationPlans) ? candidate.remediationPlans : [];
  const plans = rawPlans.filter(isRemediationPlan).map(clone);
  if (plans.length !== rawPlans.length) issues.push(issue('error', 'backup.catalogAudit.invalidRemediationPlan', 'A seção contém planos de remediação inválidos.'));
  const planCharacters = new Set<string>();
  for (const plan of plans) {
    if (planCharacters.has(plan.characterId)) issues.push(issue('error', 'backup.catalogAudit.duplicatePlanCharacter', `Há mais de um plano para o personagem ${plan.characterId}.`));
    planCharacters.add(plan.characterId);
    if (params.knownCharacterIds && !params.knownCharacterIds.includes(plan.characterId)) {
      issues.push(issue('warning', 'backup.catalogAudit.planCharacterNotIncluded', `O plano de ${plan.characterId} não possui personagem correspondente no backup.`));
    }
  }
  const sanitizedHistory = sortedHistory.map((entry) => ({
    ...entry,
    beforeState: sanitizeCatalogFilterState(params.snapshot, entry.beforeState, params.fallback),
    afterState: sanitizeCatalogFilterState(params.snapshot, entry.afterState, params.fallback)
  }));
  const section: PortableCatalogAuditSection = {
    schemaVersion: PORTABLE_CATALOG_AUDIT_SCHEMA,
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : new Date().toISOString(),
    catalogVersion: sourceCatalogVersion,
    catalogSnapshotId: sourceSnapshotId,
    revision: Math.max(rawRevision, maximumRevision),
    filterState: sanitizedState,
    history: sanitizedHistory,
    historyIntegrity: {
      algorithm: PORTABLE_CATALOG_AUDIT_CHECKSUM_ALGORITHM,
      checksum: portableCatalogHistoryChecksum(sanitizedHistory)
    },
    remediationPlans: plans
  };
  return { ok: !issues.some((entry) => entry.severity === 'error'), issues, section };
};

export const comparePortableCatalogAudit = (params: {
  snapshot: CatalogSnapshot;
  localFilterState: CatalogFilterState;
  localRevision: number;
  localHistory: readonly CatalogConfigurationHistoryEntry[];
  localPlans: Record<string, CharacterCompatibilityRemediationPlan>;
  incoming: PortableCatalogAuditSection;
}): PortableCatalogAuditComparison => {
  const localById = new Map(params.localHistory.map((entry) => [entry.id, entry]));
  const incomingById = new Map(params.incoming.history.map((entry) => [entry.id, entry]));
  const sharedCommitIds = [...localById.keys()].filter((id) => incomingById.has(id)).sort();
  const conflictingCommitIds = sharedCommitIds.filter((id) => !same(localById.get(id), incomingById.get(id)));
  const localOnlyCommitIds = [...localById.keys()].filter((id) => !incomingById.has(id)).sort();
  const incomingOnlyCommitIds = [...incomingById.keys()].filter((id) => !localById.has(id)).sort();
  let relation: PortableCatalogComparisonRelation;
  if (params.incoming.catalogVersion !== params.snapshot.catalogVersion) relation = 'catalogMismatch';
  else if (!conflictingCommitIds.length && !localOnlyCommitIds.length && !incomingOnlyCommitIds.length && same(params.localFilterState, params.incoming.filterState)) relation = 'identical';
  else if (!conflictingCommitIds.length && !localOnlyCommitIds.length && params.incoming.revision >= params.localRevision) relation = 'incomingAhead';
  else if (!conflictingCommitIds.length && !incomingOnlyCommitIds.length && params.localRevision >= params.incoming.revision) relation = 'localAhead';
  else relation = 'diverged';
  const incomingPlanCharacterIds = params.incoming.remediationPlans.map((plan) => plan.characterId).sort();
  const planConflicts = params.incoming.remediationPlans
    .filter((plan) => params.localPlans[plan.characterId] && !same(params.localPlans[plan.characterId], plan))
    .map((plan) => plan.characterId)
    .sort();
  return {
    relation,
    localRevision: params.localRevision,
    incomingRevision: params.incoming.revision,
    localHistoryCount: params.localHistory.length,
    incomingHistoryCount: params.incoming.history.length,
    sharedCommitIds,
    localOnlyCommitIds,
    incomingOnlyCommitIds,
    conflictingCommitIds,
    changedBookIds: changedKeys(params.localFilterState.bookStates, params.incoming.filterState.bookStates),
    changedCategoryIds: changedKeys(params.localFilterState.categoryStates, params.incoming.filterState.categoryStates),
    changedEntityIds: changedKeys(params.localFilterState.entityStates, params.incoming.filterState.entityStates),
    planConflicts,
    incomingPlanCharacterIds,
    requiresExplicitImport: relation !== 'identical' || Boolean(planConflicts.length)
  };
};

export const portableCatalogImportMetadata = (
  section: PortableCatalogAuditSection,
  comparison: PortableCatalogAuditComparison
): CatalogConfigurationPortableImport => ({
  schemaVersion: PORTABLE_CATALOG_AUDIT_SCHEMA,
  sourceCatalogVersion: section.catalogVersion,
  sourceCatalogSnapshotId: section.catalogSnapshotId,
  sourceRevision: section.revision,
  sourceHistoryChecksum: section.historyIntegrity.checksum,
  sourceHistory: section.history.map(clone),
  comparison: comparison.relation,
  conflictingCommitIds: [...comparison.conflictingCommitIds]
});

export const preparePortableRemediationPlanImport = (params: {
  incomingPlans: readonly CharacterCompatibilityRemediationPlan[];
  currentPlans: Record<string, CharacterCompatibilityRemediationPlan>;
  characterIdMap: Record<string, string>;
  importedCharacters: readonly Character[];
}): PortableRemediationPlanImportResult => {
  const issues: RuleValidationIssue[] = [];
  const accepted: CharacterCompatibilityRemediationPlan[] = [];
  const duplicateCharacterIds: string[] = [];
  const conflictingCharacterIds: string[] = [];
  const skippedCharacterIds: string[] = [];
  const characterById = new Map(params.importedCharacters.map((character) => [character.id, character]));
  for (const incoming of params.incomingPlans) {
    const mappedCharacterId = params.characterIdMap[incoming.characterId] ?? incoming.characterId;
    const character = characterById.get(mappedCharacterId);
    if (!character) {
      skippedCharacterIds.push(incoming.characterId);
      issues.push(issue('warning', 'backup.planCharacterSkipped', `O plano de ${incoming.characterId} foi ignorado porque a ficha correspondente não foi restaurada.`));
      continue;
    }
    const remapped: CharacterCompatibilityRemediationPlan = {
      ...clone(incoming),
      id: mappedCharacterId === incoming.characterId ? incoming.id : `${incoming.id}-imported-${mappedCharacterId}`,
      characterId: mappedCharacterId,
      baseFingerprint: characterProgressionFingerprint(character)
    };
    const current = params.currentPlans[mappedCharacterId];
    if (current) {
      if (same(current, remapped)) duplicateCharacterIds.push(mappedCharacterId);
      else conflictingCharacterIds.push(mappedCharacterId);
      continue;
    }
    accepted.push(remapped);
  }
  if (conflictingCharacterIds.length) {
    issues.push(issue('warning', 'backup.planConflictPreservedLocal', `${conflictingCharacterIds.length} plano(s) local(is) foram preservados; o backup não os sobrescreveu.`));
  }
  return {
    accepted,
    duplicateCharacterIds: [...new Set(duplicateCharacterIds)].sort(),
    conflictingCharacterIds: [...new Set(conflictingCharacterIds)].sort(),
    skippedCharacterIds: [...new Set(skippedCharacterIds)].sort(),
    issues
  };
};

export const summarizePortableCatalogAudit = (section: PortableCatalogAuditSection): string =>
  `catálogo ${section.catalogVersion} · revisão ${section.revision} · ${section.history.length} commit(s) · ${section.remediationPlans.length} plano(s)`;
