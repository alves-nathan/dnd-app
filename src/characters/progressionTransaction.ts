import type {
  Character,
  CharacterProgressionAuditEntry,
  CharacterProgressionChangeSummary,
  CharacterProgressionOperation,
  CharacterProgressionSnapshot,
  CharacterProgressionTransactionKind,
  RuleValidationIssue
} from '../types';
import { createId } from '../utils/id';

export type CharacterProgressionDraftStatus = 'draft' | 'ready' | 'blocked';

export type CharacterProgressionRecoveryStatus = 'active' | 'recoverable' | 'conflicted';

export interface CharacterProgressionRecoveryMetadata {
  status: CharacterProgressionRecoveryStatus;
  checkpointSequence: number;
  lastCheckpointAt: string;
  detectedAt?: string;
  acknowledgedAt?: string;
  reason?: string;
}

export interface CharacterProgressionDraft {
  id: string;
  characterId: string;
  kind: CharacterProgressionTransactionKind;
  status: CharacterProgressionDraftStatus;
  schemaVersion: 1;
  recovery: CharacterProgressionRecoveryMetadata;
  createdAt: string;
  updatedAt: string;
  baseFingerprint: string;
  targetCatalogSnapshotId?: string;
  migrationApproved: boolean;
  baseCharacter: CharacterProgressionSnapshot;
  workingCharacter: CharacterProgressionSnapshot;
  operations: CharacterProgressionOperation[];
}

export interface CharacterProgressionPreview {
  ok: boolean;
  draft: CharacterProgressionDraft;
  summary: CharacterProgressionChangeSummary;
  issues: RuleValidationIssue[];
  blockingIssues: RuleValidationIssue[];
  warnings: RuleValidationIssue[];
  currentFingerprint?: string;
}

export interface CharacterProgressionCommitResult {
  ok: boolean;
  character: Character;
  preview: CharacterProgressionPreview;
  auditEntry?: CharacterProgressionAuditEntry;
}

const MAX_PROGRESSION_AUDIT_ENTRIES = 20;

const now = (): string => new Date().toISOString();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const progressionSnapshot = (character: Character): CharacterProgressionSnapshot => {
  const { progressionTransactions: _history, ...snapshot } = character;
  return clone(snapshot);
};

const fingerprintText = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const characterProgressionFingerprint = (character: Character): string =>
  fingerprintText(JSON.stringify(progressionSnapshot(character)));

const countPending = (character: CharacterProgressionSnapshot): number =>
  (character.pendingChoices ?? []).filter((choice) => choice.status === 'pending').length;

const entityCollections = [
  'classes',
  'subclasses',
  'feats',
  'features',
  'spells',
  'spellbookEntries',
  'weapons',
  'armors',
  'armorAccessories',
  'equipment',
  'magicItems',
  'weaponMasteries',
  'resources',
  'spellSlots',
  'companions',
  'compendiumLinks'
] as const;

const lengthOf = (character: CharacterProgressionSnapshot, key: typeof entityCollections[number]): number => {
  const value = character[key];
  return Array.isArray(value) ? value.length : 0;
};

export const summarizeProgressionChange = (
  before: CharacterProgressionSnapshot,
  after: CharacterProgressionSnapshot
): CharacterProgressionChangeSummary => {
  const beforeClassById = new Map(before.classes.map((entry) => [entry.id, entry]));
  const afterClassById = new Map(after.classes.map((entry) => [entry.id, entry]));
  const classIds = new Set([...beforeClassById.keys(), ...afterClassById.keys()]);
  const classChanges = [...classIds]
    .map((classId) => {
      const previous = beforeClassById.get(classId);
      const next = afterClassById.get(classId);
      return {
        classId,
        name: next?.name ?? previous?.name ?? classId,
        beforeLevel: previous?.level ?? 0,
        afterLevel: next?.level ?? 0
      };
    })
    .filter((entry) => entry.beforeLevel !== entry.afterLevel);

  const added: Record<string, number> = {};
  const removed: Record<string, number> = {};
  const changedPaths: string[] = [];
  for (const key of entityCollections) {
    const previous = lengthOf(before, key);
    const next = lengthOf(after, key);
    if (next > previous) added[key] = next - previous;
    if (previous > next) removed[key] = previous - next;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changedPaths.push(key);
  }
  if (before.level !== after.level) changedPaths.unshift('level');
  if (before.catalogSnapshotId !== after.catalogSnapshotId) changedPaths.push('catalogSnapshotId');
  const pendingBefore = countPending(before);
  const pendingAfter = countPending(after);
  if (JSON.stringify(before.pendingChoices ?? []) !== JSON.stringify(after.pendingChoices ?? [])) changedPaths.push('pendingChoices');
  const objectPaths = [
    'species', 'background', 'originFeatId', 'abilityScoreBonuses', 'abilityGeneration',
    'abilities', 'proficiencies', 'buildChoices', 'currency', 'hitPoints', 'hitDice',
    'senses', 'activeEffects', 'rotations', 'notes'
  ] as const;
  for (const key of objectPaths) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changedPaths.push(key);
  }

  return {
    levelBefore: before.level,
    levelAfter: after.level,
    catalogSnapshotBefore: before.catalogSnapshotId,
    catalogSnapshotAfter: after.catalogSnapshotId,
    classChanges,
    added,
    removed,
    pendingBefore,
    pendingAfter,
    changedPaths: Array.from(new Set(changedPaths))
  };
};

const issue = (
  severity: RuleValidationIssue['severity'],
  code: string,
  message: string
): RuleValidationIssue => ({ severity, code, message });

const duplicateIds = (values: Array<{ id?: string }>): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (!value.id) continue;
    if (seen.has(value.id)) duplicates.add(value.id);
    seen.add(value.id);
  }
  return [...duplicates];
};

export const validateProgressionDraft = (
  draft: CharacterProgressionDraft,
  currentCharacter?: Character
): CharacterProgressionPreview => {
  const issues: RuleValidationIssue[] = [];
  const working = draft.workingCharacter;
  const summary = summarizeProgressionChange(draft.baseCharacter, working);
  const currentFingerprint = currentCharacter
    ? characterProgressionFingerprint(currentCharacter)
    : undefined;

  if (working.id !== draft.characterId || draft.baseCharacter.id !== draft.characterId) {
    issues.push(issue('error', 'PROGRESSION_TRANSACTION_CHARACTER_MISMATCH', 'A transação referencia outro personagem.'));
  }
  if (draft.recovery.status === 'recoverable') {
    issues.push(issue('error', 'PROGRESSION_TRANSACTION_RECOVERY_ACK_REQUIRED', 'O rascunho foi recuperado após uma nova sessão. Revise e confirme a retomada antes de continuar.'));
  }
  if (draft.recovery.status === 'conflicted') {
    issues.push(issue('error', 'PROGRESSION_TRANSACTION_RECOVERY_CONFLICT', draft.recovery.reason ?? 'O rascunho recuperado conflita com a ficha publicada e não pode ser retomado automaticamente.'));
  }
  if (currentFingerprint && currentFingerprint !== draft.baseFingerprint) {
    issues.push(issue('error', 'PROGRESSION_TRANSACTION_CONFLICT', 'O personagem foi alterado depois que a transação começou. Descarte ou recrie o preview antes de confirmar.'));
  }
  const calculatedLevel = working.classes.reduce((sum, entry) => sum + Math.max(0, entry.level), 0);
  if (working.classes.some((entry) => !Number.isInteger(entry.level) || entry.level < 1)) {
    issues.push(issue('error', 'PROGRESSION_TRANSACTION_INVALID_CLASS_LEVEL', 'Todas as classes devem possuir nível inteiro igual ou superior a 1.'));
  }
  if (working.level !== calculatedLevel) {
    issues.push(issue('error', 'PROGRESSION_TRANSACTION_LEVEL_MISMATCH', `O nível total ${working.level} não corresponde à soma das classes (${calculatedLevel}).`));
  }
  if (
    draft.targetCatalogSnapshotId &&
    working.catalogSnapshotId !== draft.targetCatalogSnapshotId
  ) {
    issues.push(issue('error', 'PROGRESSION_TRANSACTION_SNAPSHOT_NOT_APPLIED', 'O snapshot-alvo não foi aplicado integralmente ao rascunho.'));
  }
  if (
    draft.baseCharacter.catalogSnapshotId &&
    draft.targetCatalogSnapshotId &&
    draft.baseCharacter.catalogSnapshotId !== draft.targetCatalogSnapshotId &&
    !draft.migrationApproved
  ) {
    issues.push(issue('error', 'PROGRESSION_TRANSACTION_SNAPSHOT_APPROVAL_REQUIRED', 'A migração de snapshot precisa ser autorizada antes do commit.'));
  }

  const unresolvedRequired = draft.kind === 'compatibilityRemediation'
    ? []
    : (working.pendingChoices ?? []).filter(
        (choice) => choice.status === 'pending' && choice.kind !== 'spellReplacement'
      );
  if (unresolvedRequired.length) {
    issues.push(issue(
      'error',
      'PROGRESSION_TRANSACTION_PENDING_CHOICES',
      `${unresolvedRequired.length} escolha(s) obrigatória(s) ainda precisa(m) ser resolvida(s): ${unresolvedRequired.map((choice) => choice.title).join(', ')}.`
    ));
  }
  const optionalPending = (working.pendingChoices ?? []).filter(
    (choice) => choice.status === 'pending' && choice.kind === 'spellReplacement'
  );
  if (optionalPending.length) {
    issues.push(issue('warning', 'PROGRESSION_TRANSACTION_OPTIONAL_PENDING', `${optionalPending.length} troca(s) opcional(is) de magia permanecerá(ão) disponível(is) depois do commit.`));
  }

  const collections: Array<[string, Array<{ id?: string }>]> = [
    ['classes', working.classes],
    ['subclasses', working.subclasses],
    ['feats', working.feats],
    ['features', working.features],
    ['spells', working.spells],
    ['weapons', working.weapons],
    ['equipment', working.equipment],
    ['magicItems', working.magicItems],
    ['resources', working.resources],
    ['spellSlots', working.spellSlots],
    ['compendiumLinks', working.compendiumLinks ?? []]
  ];
  for (const [label, values] of collections) {
    const duplicates = duplicateIds(values);
    if (duplicates.length) {
      issues.push(issue('error', 'PROGRESSION_TRANSACTION_DUPLICATE_IDS', `${label} contém IDs duplicados: ${duplicates.slice(0, 5).join(', ')}.`));
    }
  }
  if (!summary.changedPaths.length) {
    issues.push(issue('warning', 'PROGRESSION_TRANSACTION_NO_CHANGES', 'O preview não contém alterações em relação ao personagem publicado.'));
  }
  if (!draft.operations.length) {
    issues.push(issue('warning', 'PROGRESSION_TRANSACTION_NO_OPERATIONS', 'Nenhuma operação foi registrada para auditoria.'));
  }

  const blockingIssues = issues.filter((entry) => entry.severity === 'error');
  return {
    ok: blockingIssues.length === 0 && summary.changedPaths.length > 0,
    draft: {
      ...draft,
      status: blockingIssues.length ? 'blocked' : 'ready'
    },
    summary,
    issues,
    blockingIssues,
    warnings: issues.filter((entry) => entry.severity !== 'error'),
    currentFingerprint
  };
};

export const createProgressionDraft = (params: {
  character: Character;
  workingCharacter?: Character;
  kind?: CharacterProgressionTransactionKind;
  targetCatalogSnapshotId?: string;
  migrationApproved?: boolean;
  operations?: CharacterProgressionOperation[];
}): CharacterProgressionDraft => {
  const createdAt = now();
  const baseCharacter = progressionSnapshot(params.character);
  const workingCharacter = progressionSnapshot(params.workingCharacter ?? params.character);
  return {
    id: createId('progressionTransaction'),
    characterId: params.character.id,
    kind: params.kind ?? 'combined',
    status: 'draft',
    schemaVersion: 1,
    recovery: {
      status: 'active',
      checkpointSequence: 1,
      lastCheckpointAt: createdAt,
      acknowledgedAt: createdAt
    },
    createdAt,
    updatedAt: createdAt,
    baseFingerprint: characterProgressionFingerprint(params.character),
    targetCatalogSnapshotId: params.targetCatalogSnapshotId,
    migrationApproved: params.migrationApproved ?? false,
    baseCharacter,
    workingCharacter,
    operations: clone(params.operations ?? [])
  };
};

export const updateProgressionDraft = (
  draft: CharacterProgressionDraft,
  updater: (character: Character) => Character,
  operation?: CharacterProgressionOperation
): CharacterProgressionDraft => {
  const current = clone(draft.workingCharacter) as Character;
  const next = progressionSnapshot(updater(current));
  const checkpointAt = now();
  return {
    ...draft,
    schemaVersion: 1,
    status: 'draft',
    updatedAt: checkpointAt,
    recovery: {
      ...draft.recovery,
      status: 'active',
      checkpointSequence: (draft.recovery?.checkpointSequence ?? 0) + 1,
      lastCheckpointAt: checkpointAt,
      acknowledgedAt: draft.recovery?.acknowledgedAt ?? checkpointAt,
      detectedAt: undefined,
      reason: undefined
    },
    workingCharacter: next,
    operations: operation ? [...draft.operations, clone(operation)] : draft.operations
  };
};

export const commitProgressionDraft = (
  currentCharacter: Character,
  draft: CharacterProgressionDraft
): CharacterProgressionCommitResult => {
  const preview = validateProgressionDraft(draft, currentCharacter);
  if (!preview.ok) return { ok: false, character: currentCharacter, preview };
  const committedAt = now();
  const history = currentCharacter.progressionTransactions ?? [];
  const nextSnapshot = clone(draft.workingCharacter);
  const auditEntry: CharacterProgressionAuditEntry = {
    id: createId('progressionAudit'),
    transactionId: draft.id,
    kind: draft.kind,
    status: 'committed',
    createdAt: draft.createdAt,
    committedAt,
    catalogSnapshotBefore: draft.baseCharacter.catalogSnapshotId,
    catalogSnapshotAfter: nextSnapshot.catalogSnapshotId,
    operations: clone(draft.operations),
    summary: preview.summary,
    before: clone(draft.baseCharacter),
    after: clone(nextSnapshot)
  };
  return {
    ok: true,
    character: {
      ...nextSnapshot,
      progressionTransactions: [...history, auditEntry].slice(-MAX_PROGRESSION_AUDIT_ENTRIES)
    },
    preview,
    auditEntry
  };
};

export const rollbackProgressionAudit = (
  currentCharacter: Character,
  auditEntry: CharacterProgressionAuditEntry
): { character: Character; auditEntry: CharacterProgressionAuditEntry } => {
  const beforeRollback = progressionSnapshot(currentCharacter);
  const restored = clone(auditEntry.before);
  const committedAt = now();
  const rollbackEntry: CharacterProgressionAuditEntry = {
    id: createId('progressionAudit'),
    transactionId: createId('progressionRollback'),
    kind: 'rollback',
    status: 'rolledBack',
    createdAt: committedAt,
    committedAt,
    rolledBackTransactionId: auditEntry.transactionId,
    catalogSnapshotBefore: beforeRollback.catalogSnapshotId,
    catalogSnapshotAfter: restored.catalogSnapshotId,
    operations: [{
      id: createId('progressionOperation'),
      kind: 'manual',
      label: `Reversão da transação ${auditEntry.transactionId}`,
      createdAt: committedAt,
      metadata: { rolledBackTransactionId: auditEntry.transactionId }
    }],
    summary: summarizeProgressionChange(beforeRollback, restored),
    before: beforeRollback,
    after: clone(restored)
  };
  return {
    character: {
      ...restored,
      progressionTransactions: [...(currentCharacter.progressionTransactions ?? []), rollbackEntry].slice(-MAX_PROGRESSION_AUDIT_ENTRIES)
    },
    auditEntry: rollbackEntry
  };
};

export const progressionOperation = (
  kind: CharacterProgressionOperation['kind'],
  label: string,
  values: Partial<Omit<CharacterProgressionOperation, 'id' | 'kind' | 'label' | 'createdAt'>> = {}
): CharacterProgressionOperation => ({
  id: createId('progressionOperation'),
  kind,
  label,
  createdAt: now(),
  ...values
});
