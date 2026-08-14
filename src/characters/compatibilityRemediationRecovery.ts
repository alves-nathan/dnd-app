import type { Character } from '../types';
import type { CharacterCompatibilityRemediationPlan } from './compatibilityRemediation';
import { characterProgressionFingerprint } from './progressionTransaction';

export type CompatibilityRemediationRecoveryStatus =
  | 'ready'
  | 'recoverable'
  | 'conflicted'
  | 'staleCatalog'
  | 'orphaned'
  | 'invalid';

export interface CompatibilityRemediationRecoveryIssue {
  id: string;
  planId?: string;
  characterId?: string;
  status: CompatibilityRemediationRecoveryStatus;
  code:
    | 'COMPATIBILITY_PLAN_RECOVERED'
    | 'COMPATIBILITY_PLAN_CONFLICT'
    | 'COMPATIBILITY_PLAN_CATALOG_STALE'
    | 'COMPATIBILITY_PLAN_ORPHANED'
    | 'COMPATIBILITY_PLAN_INVALID';
  message: string;
  blocking: boolean;
}

export interface CompatibilityRemediationQuarantineEntry {
  id: string;
  quarantinedAt: string;
  reason: 'orphaned' | 'invalid';
  characterId?: string;
  planId?: string;
  rawPlan: unknown;
}

export interface CompatibilityRemediationRecoverySummary {
  hydrated: boolean;
  reconciledAt?: string;
  currentCatalogSnapshotId?: string;
  pendingAcknowledgementCharacterIds: string[];
  conflictedCharacterIds: string[];
  staleCatalogCharacterIds: string[];
  quarantinedPlanIds: string[];
  issues: CompatibilityRemediationRecoveryIssue[];
}

export interface CompatibilityRemediationReconciliationResult {
  plans: Record<string, CharacterCompatibilityRemediationPlan>;
  quarantine: Record<string, CompatibilityRemediationQuarantineEntry>;
  summary: CompatibilityRemediationRecoverySummary;
}

const unique = (values: readonly string[]): string[] => Array.from(new Set(values));
const nowIso = (): string => new Date().toISOString();

export const emptyCompatibilityRemediationRecoverySummary = (): CompatibilityRemediationRecoverySummary => ({
  hydrated: false,
  pendingAcknowledgementCharacterIds: [],
  conflictedCharacterIds: [],
  staleCatalogCharacterIds: [],
  quarantinedPlanIds: [],
  issues: []
});

export const isCompatibilityRemediationPlan = (value: unknown): value is CharacterCompatibilityRemediationPlan => {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<CharacterCompatibilityRemediationPlan>;
  return plan.schemaVersion === 'dnd-character-compatibility-remediation.v1'
    && typeof plan.id === 'string'
    && Boolean(plan.id)
    && typeof plan.characterId === 'string'
    && Boolean(plan.characterId)
    && typeof plan.baseFingerprint === 'string'
    && Boolean(plan.baseFingerprint)
    && typeof plan.targetCatalogSnapshotId === 'string'
    && Boolean(plan.targetCatalogSnapshotId)
    && Array.isArray(plan.decisions)
    && plan.decisions.every((decision) => Boolean(decision)
      && typeof decision === 'object'
      && typeof decision.id === 'string'
      && typeof decision.issueId === 'string'
      && ['replace', 'remove', 'adoptSnapshot'].includes(decision.kind));
};

export const classifyCompatibilityRemediationPlan = (params: {
  plan: CharacterCompatibilityRemediationPlan;
  character?: Character;
  currentCatalogSnapshotId?: string;
  requiresAcknowledgement?: boolean;
}): CompatibilityRemediationRecoveryStatus => {
  if (!params.character) return 'orphaned';
  if (characterProgressionFingerprint(params.character) !== params.plan.baseFingerprint) return 'conflicted';
  if (params.currentCatalogSnapshotId && params.plan.targetCatalogSnapshotId !== params.currentCatalogSnapshotId) return 'staleCatalog';
  return params.requiresAcknowledgement ? 'recoverable' : 'ready';
};

const recoveryIssue = (
  status: CompatibilityRemediationRecoveryStatus,
  plan: Partial<CharacterCompatibilityRemediationPlan> | undefined,
  message: string
): CompatibilityRemediationRecoveryIssue => {
  const suffix = plan?.id ?? plan?.characterId ?? 'unknown';
  const code = status === 'recoverable'
    ? 'COMPATIBILITY_PLAN_RECOVERED'
    : status === 'conflicted'
      ? 'COMPATIBILITY_PLAN_CONFLICT'
      : status === 'staleCatalog'
        ? 'COMPATIBILITY_PLAN_CATALOG_STALE'
        : status === 'orphaned'
          ? 'COMPATIBILITY_PLAN_ORPHANED'
          : 'COMPATIBILITY_PLAN_INVALID';
  return {
    id: `${code}:${suffix}`,
    planId: plan?.id,
    characterId: plan?.characterId,
    status,
    code,
    message,
    blocking: status !== 'recoverable'
  };
};

export const reconcileCompatibilityRemediationRecovery = (params: {
  characters: readonly Character[];
  plans: Record<string, unknown>;
  quarantine?: Record<string, CompatibilityRemediationQuarantineEntry>;
  previousSummary?: CompatibilityRemediationRecoverySummary;
  currentCatalogSnapshotId?: string;
  markRecovered?: boolean;
  now?: () => Date;
}): CompatibilityRemediationReconciliationResult => {
  const characterById = new Map(params.characters.map((character) => [character.id, character]));
  const previousPending = new Set(params.previousSummary?.pendingAcknowledgementCharacterIds ?? []);
  const plans: Record<string, CharacterCompatibilityRemediationPlan> = {};
  const quarantine = { ...(params.quarantine ?? {}) };
  const issues: CompatibilityRemediationRecoveryIssue[] = [];
  const pendingAcknowledgementCharacterIds: string[] = [];
  const conflictedCharacterIds: string[] = [];
  const staleCatalogCharacterIds: string[] = [];
  const at = (params.now ?? (() => new Date()))().toISOString();

  for (const [key, rawPlan] of Object.entries(params.plans ?? {})) {
    if (!isCompatibilityRemediationPlan(rawPlan)) {
      const quarantineId = `invalid:${key}`;
      quarantine[quarantineId] = {
        id: quarantineId,
        quarantinedAt: at,
        reason: 'invalid',
        characterId: key,
        rawPlan
      };
      issues.push(recoveryIssue('invalid', undefined, `O plano persistido de ${key} possui estrutura inválida e foi colocado em quarentena.`));
      continue;
    }
    const character = characterById.get(rawPlan.characterId);
    if (!character) {
      const quarantineId = `orphaned:${rawPlan.id}`;
      quarantine[quarantineId] = {
        id: quarantineId,
        quarantinedAt: at,
        reason: 'orphaned',
        characterId: rawPlan.characterId,
        planId: rawPlan.id,
        rawPlan
      };
      issues.push(recoveryIssue('orphaned', rawPlan, 'O personagem do plano não existe mais. O registro foi isolado sem afetar outras fichas.'));
      continue;
    }

    const requiresAcknowledgement = Boolean(params.markRecovered || previousPending.has(rawPlan.characterId));
    const status = classifyCompatibilityRemediationPlan({
      plan: rawPlan,
      character,
      currentCatalogSnapshotId: params.currentCatalogSnapshotId,
      requiresAcknowledgement
    });
    plans[rawPlan.characterId] = rawPlan;
    if (status === 'conflicted') {
      conflictedCharacterIds.push(rawPlan.characterId);
      issues.push(recoveryIssue(status, rawPlan, 'A ficha foi alterada depois da criação do plano. Descarte-o e gere um novo diagnóstico.'));
    } else if (status === 'staleCatalog') {
      staleCatalogCharacterIds.push(rawPlan.characterId);
      issues.push(recoveryIssue(status, rawPlan, `O plano foi criado para ${rawPlan.targetCatalogSnapshotId}, diferente do catálogo atual ${params.currentCatalogSnapshotId}.`));
    } else if (status === 'recoverable') {
      pendingAcknowledgementCharacterIds.push(rawPlan.characterId);
      issues.push(recoveryIssue(status, rawPlan, 'Plano recuperado após reinício. Confirme a retomada antes de editar ou aplicar decisões.'));
    }
  }

  const summary: CompatibilityRemediationRecoverySummary = {
    hydrated: true,
    reconciledAt: at,
    currentCatalogSnapshotId: params.currentCatalogSnapshotId,
    pendingAcknowledgementCharacterIds: unique(pendingAcknowledgementCharacterIds),
    conflictedCharacterIds: unique(conflictedCharacterIds),
    staleCatalogCharacterIds: unique(staleCatalogCharacterIds),
    quarantinedPlanIds: Object.keys(quarantine),
    issues
  };
  return { plans, quarantine, summary };
};

export const acknowledgeCompatibilityRemediationRecovery = (
  summary: CompatibilityRemediationRecoverySummary,
  characterId: string
): CompatibilityRemediationRecoverySummary => ({
  ...summary,
  reconciledAt: nowIso(),
  pendingAcknowledgementCharacterIds: summary.pendingAcknowledgementCharacterIds.filter((id) => id !== characterId),
  issues: summary.issues.filter((issue) => !(issue.characterId === characterId && issue.status === 'recoverable'))
});

export const clearCompatibilityRemediationRecoveryForCharacter = (
  summary: CompatibilityRemediationRecoverySummary,
  characterId: string
): CompatibilityRemediationRecoverySummary => ({
  ...summary,
  pendingAcknowledgementCharacterIds: summary.pendingAcknowledgementCharacterIds.filter((id) => id !== characterId),
  conflictedCharacterIds: summary.conflictedCharacterIds.filter((id) => id !== characterId),
  staleCatalogCharacterIds: summary.staleCatalogCharacterIds.filter((id) => id !== characterId),
  issues: summary.issues.filter((issue) => issue.characterId !== characterId)
});
