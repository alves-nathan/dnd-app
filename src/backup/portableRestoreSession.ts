import type { BuildPreset } from '../presets/buildPresets';
import type {
  BuildHistorySnapshot,
  Character,
  CombatScenario,
  RuleValidationIssue
} from '../types';
import type { CharacterProgressionDraft } from '../characters/progressionTransaction';
import {
  emptyProgressionRecoverySummary,
  type CharacterProgressionRecoverySummary
} from '../characters/progressionRecovery';
import type { CharacterCompatibilityRemediationPlan } from '../characters/compatibilityRemediation';
import {
  emptyCompatibilityRemediationRecoverySummary,
  type CompatibilityRemediationQuarantineEntry,
  type CompatibilityRemediationRecoverySummary
} from '../characters/compatibilityRemediationRecovery';
import type { CatalogConfigurationCheckpointDocument } from '../storage/catalogFilterPreferences';
import type { PortableRestoreIntegrityReceipt, PortableRestorePostVerification } from './portableRestoreVerification';
import {
  createPreventiveCompatibilityPlans,
  type CatalogChangeCharacterImpactPreview
} from '../characters/catalogChangeImpact';
import {
  restoreCharacterDataBackup,
  type CharacterBackupPayload,
  type CharacterBackupRestoreOptions,
  type CharacterBackupRestoreResult
} from './characterBackup';
import {
  preparePortableRemediationPlanImport,
  type PortableCatalogAuditComparison,
  type PortableCatalogAuditSection,
  type PortableRemediationPlanImportResult
} from './portableCatalogBackup';

export const PORTABLE_RESTORE_SESSION_SCHEMA = 'dnd-portable-restore-session.v1' as const;
export const PORTABLE_RESTORE_SESSION_AUDIT_SCHEMA = 'dnd-portable-restore-session-audit.v1' as const;

export type PortableRestoreSessionStatus =
  | 'prepared'
  | 'committing'
  | 'interrupted'
  | 'committed'
  | 'rollingBack'
  | 'rolledBack'
  | 'discarded'
  | 'failed';

export type PortableRestoreSessionPhase =
  | 'preview'
  | 'data'
  | 'catalog'
  | 'complete'
  | 'rollbackData'
  | 'rollbackCatalog';

export interface PortableRestoreCharacterCheckpoint {
  characters: Character[];
  progressionDrafts: Record<string, CharacterProgressionDraft>;
  progressionRecovery: CharacterProgressionRecoverySummary;
  compatibilityRemediationPlans: Record<string, CharacterCompatibilityRemediationPlan>;
  compatibilityRemediationRecovery: CompatibilityRemediationRecoverySummary;
  compatibilityRemediationQuarantine: Record<string, CompatibilityRemediationQuarantineEntry>;
}

export interface PortableRestoreDataCheckpoint {
  characterStore: PortableRestoreCharacterCheckpoint;
  scenarios: CombatScenario[];
  buildPresets: BuildPreset[];
  buildHistorySnapshots: BuildHistorySnapshot[];
  catalog: CatalogConfigurationCheckpointDocument;
}

export type PortableRestoreConflictKind =
  | 'replaceAll'
  | 'catalogImpact'
  | 'catalogHistory'
  | 'catalogVersion'
  | 'catalogDirection'
  | 'remediationPlan'
  | 'skippedPlan';

export interface PortableRestoreConflict {
  id: string;
  kind: PortableRestoreConflictKind;
  title: string;
  description: string;
  required: boolean;
  count: number;
}

export interface PortableRestoreSessionPreview {
  before: {
    characters: number;
    scenarios: number;
    presets: number;
    snapshots: number;
    remediationPlans: number;
    catalogRevision: number;
  };
  after: {
    characters: number;
    scenarios: number;
    presets: number;
    snapshots: number;
    remediationPlans: number;
    catalogRevision: number;
  };
  imported: CharacterBackupRestoreResult['imported'];
  remappedCharacterIds: number;
  acceptedPlans: number;
  preventivePlans: number;
  preservedLocalPlanConflicts: number;
  skippedPlans: number;
  catalogRelation?: PortableCatalogAuditComparison['relation'];
  affectedCharacters: number;
  newBlockingIssues: number;
  newWarnings: number;
  conflictCount: number;
}

export interface PortableRestoreSessionEvent {
  id: string;
  at: string;
  kind:
    | 'prepared'
    | 'acknowledged'
    | 'commitStarted'
    | 'dataApplied'
    | 'catalogApplied'
    | 'committed'
    | 'interrupted'
    | 'rollbackStarted'
    | 'dataRolledBack'
    | 'catalogRolledBack'
    | 'rolledBack'
    | 'discarded'
    | 'verificationCompleted'
    | 'verificationAccepted'
    | 'receiptCreated'
    | 'archived'
    | 'rollbackReopened'
    | 'failed';
  message: string;
}

export interface PortableRestoreSession {
  schemaVersion: typeof PORTABLE_RESTORE_SESSION_SCHEMA;
  id: string;
  createdAt: string;
  updatedAt: string;
  source: {
    backupSchemaVersion: CharacterBackupPayload['schemaVersion'];
    exportedAt: string;
    checksum?: string;
    name?: string;
  };
  options: CharacterBackupRestoreOptions;
  status: PortableRestoreSessionStatus;
  phase: PortableRestoreSessionPhase;
  recoveryRequired: boolean;
  beforeFingerprint: string;
  projectedFingerprint: string;
  before: PortableRestoreDataCheckpoint;
  projected: PortableRestoreDataCheckpoint;
  catalogAudit?: PortableCatalogAuditSection;
  catalogComparison?: PortableCatalogAuditComparison;
  catalogImpact?: CatalogChangeCharacterImpactPreview;
  conflicts: PortableRestoreConflict[];
  acknowledgedConflictIds: string[];
  preview: PortableRestoreSessionPreview;
  idMap: Record<string, string>;
  restoreIssues: RuleValidationIssue[];
  planImport: Pick<PortableRemediationPlanImportResult, 'duplicateCharacterIds' | 'conflictingCharacterIds' | 'skippedCharacterIds' | 'issues'>;
  applied: {
    data: boolean;
    catalog: boolean;
  };
  catalogHistoryEntryId?: string;
  committedAt?: string;
  rolledBackAt?: string;
  discardedAt?: string;
  lastError?: string;
  postRestoreVerification?: PortableRestorePostVerification;
  integrityReceipt?: PortableRestoreIntegrityReceipt;
  closedAt?: string;
  events: PortableRestoreSessionEvent[];
}

export interface PortableRestoreSessionAuditEntry {
  schemaVersion: typeof PORTABLE_RESTORE_SESSION_AUDIT_SCHEMA;
  sessionId: string;
  sourceName?: string;
  sourceChecksum?: string;
  createdAt: string;
  completedAt: string;
  result: 'committed' | 'rolledBack' | 'discarded' | 'failed';
  beforeFingerprint: string;
  projectedFingerprint: string;
  conflictIds: string[];
  acknowledgedConflictIds: string[];
  imported: CharacterBackupRestoreResult['imported'];
  catalogHistoryEntryId?: string;
  eventCount: number;
}

export interface PreparePortableRestoreSessionParams {
  backup: CharacterBackupPayload;
  options: CharacterBackupRestoreOptions;
  current: PortableRestoreDataCheckpoint;
  catalogAudit?: PortableCatalogAuditSection;
  catalogComparison?: PortableCatalogAuditComparison;
  catalogImpact?: CatalogChangeCharacterImpactPreview;
  now?: () => Date;
}

export interface PreparePortableRestoreSessionResult {
  ok: boolean;
  issues: RuleValidationIssue[];
  session?: PortableRestoreSession;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const unique = (values: readonly string[]): string[] => Array.from(new Set(values)).sort();

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((output, key) => {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) output[key] = canonicalize(entry);
    return output;
  }, {});
};

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const portableRestoreCheckpointFingerprint = (checkpoint: PortableRestoreDataCheckpoint): string =>
  fnv1a32(JSON.stringify(canonicalize(checkpoint)));

const event = (
  sessionId: string,
  kind: PortableRestoreSessionEvent['kind'],
  message: string,
  at: string
): PortableRestoreSessionEvent => ({
  id: `${sessionId}-${kind}-${at.replace(/[^0-9]/g, '').slice(0, 17)}`,
  at,
  kind,
  message
});

const conflict = (
  kind: PortableRestoreConflictKind,
  title: string,
  description: string,
  count = 1,
  required = true
): PortableRestoreConflict => ({
  id: `restore-conflict-${kind}`,
  kind,
  title,
  description,
  count,
  required
});

const filterRecordByIds = <T>(source: Record<string, T>, ids: Set<string>): Record<string, T> =>
  Object.fromEntries(Object.entries(source).filter(([id]) => ids.has(id)));

export const canCommitPortableRestoreSession = (session: PortableRestoreSession): boolean => {
  if (!['prepared', 'interrupted'].includes(session.status)) return false;
  const acknowledged = new Set(session.acknowledgedConflictIds);
  return session.conflicts.every((entry) => !entry.required || acknowledged.has(entry.id));
};

export const acknowledgePortableRestoreConflict = (
  session: PortableRestoreSession,
  conflictId: string,
  acknowledged: boolean,
  now: () => Date = () => new Date()
): PortableRestoreSession => {
  if (!session.conflicts.some((entry) => entry.id === conflictId)) return session;
  const ids = new Set(session.acknowledgedConflictIds);
  if (acknowledged) ids.add(conflictId);
  else ids.delete(conflictId);
  const at = now().toISOString();
  return {
    ...session,
    updatedAt: at,
    acknowledgedConflictIds: Array.from(ids).sort(),
    events: [...session.events, event(session.id, 'acknowledged', `${acknowledged ? 'Reconhecido' : 'Reconhecimento removido'}: ${conflictId}.`, at)]
  };
};

export const preparePortableRestoreSession = (
  params: PreparePortableRestoreSessionParams
): PreparePortableRestoreSessionResult => {
  const now = params.now ?? (() => new Date());
  const at = now().toISOString();
  const restore = restoreCharacterDataBackup(
    {
      characters: params.current.characterStore.characters,
      scenarios: params.current.scenarios,
      buildPresets: params.current.buildPresets,
      buildHistorySnapshots: params.current.buildHistorySnapshots
    },
    params.backup,
    params.options
  );
  if (!restore.ok) return { ok: false, issues: restore.issues };

  const restoredIds = new Set(Object.values(restore.idMap));
  const restoredCharacters = restore.characters.filter((character) => restoredIds.has(character.id));
  const planImport = params.catalogAudit
    ? preparePortableRemediationPlanImport({
        incomingPlans: params.catalogAudit.remediationPlans,
        currentPlans: params.current.characterStore.compatibilityRemediationPlans,
        characterIdMap: restore.idMap,
        importedCharacters: restoredCharacters
      })
    : {
        accepted: [],
        duplicateCharacterIds: [],
        conflictingCharacterIds: [],
        skippedCharacterIds: [],
        issues: []
      };
  const finalIds = new Set(restore.characters.map((character) => character.id));
  const projectedPlans: Record<string, CharacterCompatibilityRemediationPlan> = {
    ...filterRecordByIds(params.current.characterStore.compatibilityRemediationPlans, finalIds)
  };
  for (const plan of planImport.accepted) projectedPlans[plan.characterId] = clone(plan);

  const preventive = params.catalogImpact
    ? createPreventiveCompatibilityPlans({
        preview: params.catalogImpact,
        characters: restore.characters,
        existingPlans: projectedPlans
      })
    : { plans: [], skippedCharacterIds: [] };
  for (const plan of preventive.plans) projectedPlans[plan.characterId] = clone(plan);

  const projected: PortableRestoreDataCheckpoint = {
    characterStore: {
      characters: clone(restore.characters),
      progressionDrafts: filterRecordByIds(params.current.characterStore.progressionDrafts, finalIds),
      progressionRecovery: emptyProgressionRecoverySummary(),
      compatibilityRemediationPlans: projectedPlans,
      compatibilityRemediationRecovery: emptyCompatibilityRemediationRecoverySummary(),
      compatibilityRemediationQuarantine: clone(params.current.characterStore.compatibilityRemediationQuarantine)
    },
    scenarios: clone(restore.scenarios),
    buildPresets: clone(restore.buildPresets),
    buildHistorySnapshots: clone(restore.buildHistorySnapshots),
    catalog: params.catalogAudit
      ? {
          filterState: clone(params.catalogAudit.filterState),
          revision: params.current.catalog.revision,
          history: clone(params.current.catalog.history),
          savedAt: params.current.catalog.savedAt
        }
      : clone(params.current.catalog)
  };

  const conflicts: PortableRestoreConflict[] = [];
  if (params.options.mode === 'replaceAll') {
    conflicts.push(conflict('replaceAll', 'Substituição dos dados selecionados', 'Personagens e coleções selecionadas serão substituídos pelo conteúdo do backup.'));
  }
  if (params.catalogImpact?.requiresAcknowledgement) {
    conflicts.push(conflict(
      'catalogImpact',
      'Impacto do catálogo nas fichas',
      `${params.catalogImpact.counts.affectedCharacters} personagem(ns) serão afetados; ${params.catalogImpact.counts.newBlockingIssues} novo(s) bloqueio(s) foram identificados.`,
      params.catalogImpact.counts.affectedCharacters + params.catalogImpact.impact.hardDependencyBreaks.length
    ));
  }
  if (params.catalogComparison?.conflictingCommitIds.length) {
    conflicts.push(conflict(
      'catalogHistory',
      'Históricos divergentes',
      `${params.catalogComparison.conflictingCommitIds.length} commit(s) possuem o mesmo ID com conteúdo diferente e serão preservados apenas como auditoria externa.`,
      params.catalogComparison.conflictingCommitIds.length
    ));
  }
  if (params.catalogComparison?.relation === 'catalogMismatch') {
    conflicts.push(conflict('catalogVersion', 'Versão diferente do catálogo', 'O backup foi criado em outra versão do catálogo. Somente IDs compatíveis serão aplicados.'));
  } else if (params.catalogComparison && ['localAhead', 'diverged'].includes(params.catalogComparison.relation)) {
    conflicts.push(conflict('catalogDirection', 'Histórico local não é ancestral do backup', 'A importação criará uma nova transação local e não substituirá a linha histórica existente.'));
  }
  if (planImport.conflictingCharacterIds.length) {
    conflicts.push(conflict(
      'remediationPlan',
      'Planos locais preservados',
      `${planImport.conflictingCharacterIds.length} plano(s) do backup conflitam com planos locais e não os substituirão.`,
      planImport.conflictingCharacterIds.length
    ));
  }
  if (planImport.skippedCharacterIds.length) {
    conflicts.push(conflict(
      'skippedPlan',
      'Planos sem ficha correspondente',
      `${planImport.skippedCharacterIds.length} plano(s) serão ignorados porque a ficha correspondente não faz parte da restauração.`,
      planImport.skippedCharacterIds.length
    ));
  }

  const sessionId = `portable-restore-${at.replace(/[^0-9]/g, '').slice(0, 17)}`;
  const before = clone(params.current);
  const preview: PortableRestoreSessionPreview = {
    before: {
      characters: before.characterStore.characters.length,
      scenarios: before.scenarios.length,
      presets: before.buildPresets.length,
      snapshots: before.buildHistorySnapshots.length,
      remediationPlans: Object.keys(before.characterStore.compatibilityRemediationPlans).length,
      catalogRevision: before.catalog.revision
    },
    after: {
      characters: projected.characterStore.characters.length,
      scenarios: projected.scenarios.length,
      presets: projected.buildPresets.length,
      snapshots: projected.buildHistorySnapshots.length,
      remediationPlans: Object.keys(projected.characterStore.compatibilityRemediationPlans).length,
      catalogRevision: params.catalogAudit ? before.catalog.revision + 1 : before.catalog.revision
    },
    imported: restore.imported,
    remappedCharacterIds: Object.entries(restore.idMap).filter(([beforeId, afterId]) => beforeId !== afterId).length,
    acceptedPlans: planImport.accepted.length,
    preventivePlans: preventive.plans.length,
    preservedLocalPlanConflicts: planImport.conflictingCharacterIds.length,
    skippedPlans: planImport.skippedCharacterIds.length,
    catalogRelation: params.catalogComparison?.relation,
    affectedCharacters: params.catalogImpact?.counts.affectedCharacters ?? 0,
    newBlockingIssues: params.catalogImpact?.counts.newBlockingIssues ?? 0,
    newWarnings: params.catalogImpact?.counts.newWarnings ?? 0,
    conflictCount: conflicts.length
  };

  const session: PortableRestoreSession = {
    schemaVersion: PORTABLE_RESTORE_SESSION_SCHEMA,
    id: sessionId,
    createdAt: at,
    updatedAt: at,
    source: {
      backupSchemaVersion: params.backup.schemaVersion,
      exportedAt: params.backup.exportedAt,
      checksum: params.backup.integrity?.checksum,
      name: params.backup.metadata?.name
    },
    options: clone(params.options),
    status: 'prepared',
    phase: 'preview',
    recoveryRequired: false,
    beforeFingerprint: portableRestoreCheckpointFingerprint(before),
    projectedFingerprint: portableRestoreCheckpointFingerprint(projected),
    before,
    projected,
    catalogAudit: params.catalogAudit ? clone(params.catalogAudit) : undefined,
    catalogComparison: params.catalogComparison ? clone(params.catalogComparison) : undefined,
    catalogImpact: params.catalogImpact ? clone(params.catalogImpact) : undefined,
    conflicts,
    acknowledgedConflictIds: [],
    preview,
    idMap: clone(restore.idMap),
    restoreIssues: [...restore.issues, ...planImport.issues].map(clone),
    planImport: {
      duplicateCharacterIds: unique(planImport.duplicateCharacterIds),
      conflictingCharacterIds: unique(planImport.conflictingCharacterIds),
      skippedCharacterIds: unique(planImport.skippedCharacterIds),
      issues: planImport.issues.map(clone)
    },
    applied: { data: false, catalog: false },
    events: [event(sessionId, 'prepared', 'Preview agregado e checkpoint local preparados sem gravar dados do backup.', at)]
  };
  return { ok: true, issues: session.restoreIssues, session };
};

export const portableRestoreAuditEntry = (
  session: PortableRestoreSession,
  result: PortableRestoreSessionAuditEntry['result'],
  completedAt: string
): PortableRestoreSessionAuditEntry => ({
  schemaVersion: PORTABLE_RESTORE_SESSION_AUDIT_SCHEMA,
  sessionId: session.id,
  sourceName: session.source.name,
  sourceChecksum: session.source.checksum,
  createdAt: session.createdAt,
  completedAt,
  result,
  beforeFingerprint: session.beforeFingerprint,
  projectedFingerprint: session.projectedFingerprint,
  conflictIds: session.conflicts.map((entry) => entry.id).sort(),
  acknowledgedConflictIds: [...session.acknowledgedConflictIds].sort(),
  imported: clone(session.preview.imported),
  catalogHistoryEntryId: session.catalogHistoryEntryId,
  eventCount: session.events.length
});
