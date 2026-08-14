import { applyCharacterChoice } from '../catalog/characterChoiceApplication';
import type { CharacterChoiceItem, CharacterChoiceKind } from '../catalog/characterChoiceTypes';
import type { CatalogFilterState, CatalogSnapshot } from '../catalog/types';
import { validateCharacterRules } from '../rules-engine/validators/ruleValidation';
import type {
  Character,
  CharacterCompendiumLink,
  CharacterProgressionOperation,
  CharacterProgressionChangeSummary,
  RuleValidationIssue
} from '../types';
import { createId } from '../utils/id';
import {
  buildCharacterCompatibilityReport,
  type CharacterCompatibilityReference,
  type CharacterCompatibilityReport
} from './characterCompatibility';
import {
  characterProgressionFingerprint,
  progressionOperation,
  progressionSnapshot,
  summarizeProgressionChange
} from './progressionTransaction';

export type CompatibilityRemediationDecisionKind = 'replace' | 'remove' | 'adoptSnapshot';

export interface CompatibilityRemediationDecision {
  id: string;
  issueId: string;
  referenceKey?: string;
  kind: CompatibilityRemediationDecisionKind;
  replacementChoiceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompatibilityRemediationPreventiveContext {
  label: string;
  catalogSnapshotId: string;
  disabledEntityIds: string[];
  affectedBookIds: string[];
  affectedCategoryIds: string[];
}

export interface CharacterCompatibilityRemediationPlan {
  schemaVersion: 'dnd-character-compatibility-remediation.v1';
  id: string;
  characterId: string;
  createdAt: string;
  updatedAt: string;
  baseFingerprint: string;
  baseCatalogSnapshotId?: string;
  targetCatalogSnapshotId: string;
  decisions: CompatibilityRemediationDecision[];
  origin?: 'diagnostic' | 'preventiveCatalogChange';
  preventiveContext?: CompatibilityRemediationPreventiveContext;
}

export interface CompatibilityRemediationChange {
  decisionId: string;
  issueId: string;
  kind: CompatibilityRemediationDecisionKind;
  label: string;
  beforeChoiceId?: string;
  afterChoiceId?: string;
  beforeEntityId?: string;
  afterEntityId?: string;
}

export interface CompatibilityRemediationImpact {
  replacements: number;
  removals: number;
  snapshotMigrations: number;
  referencesBefore: number;
  referencesAfter: number;
  blockingIssuesBefore: number;
  blockingIssuesAfter: number;
  changedPaths: string[];
  summary: CharacterProgressionChangeSummary;
}

export interface CompatibilityRemediationPreview {
  ok: boolean;
  plan: CharacterCompatibilityRemediationPlan;
  projectedCharacter: Character;
  beforeReport: CharacterCompatibilityReport;
  afterReport: CharacterCompatibilityReport;
  changes: CompatibilityRemediationChange[];
  impact: CompatibilityRemediationImpact;
  operations: CharacterProgressionOperation[];
  issues: RuleValidationIssue[];
  blockingIssues: RuleValidationIssue[];
  warnings: RuleValidationIssue[];
}

export interface CompatibilityRemediationPreviewInput {
  character: Character;
  report: CharacterCompatibilityReport;
  plan: CharacterCompatibilityRemediationPlan;
  snapshot: CatalogSnapshot;
  filterState: CatalogFilterState;
  choices: readonly CharacterChoiceItem[];
  now?: () => Date;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isoNow = (): string => new Date().toISOString();

const remediationIssue = (
  severity: RuleValidationIssue['severity'],
  code: string,
  message: string
): RuleValidationIssue => ({ severity, code, message });

export const createCompatibilityRemediationPlan = (params: {
  character: Character;
  report: CharacterCompatibilityReport;
  now?: () => Date;
  origin?: CharacterCompatibilityRemediationPlan['origin'];
  preventiveContext?: CompatibilityRemediationPreventiveContext;
}): CharacterCompatibilityRemediationPlan => {
  const createdAt = (params.now ?? (() => new Date()))().toISOString();
  return {
    schemaVersion: 'dnd-character-compatibility-remediation.v1',
    id: createId('compatibilityRemediation'),
    characterId: params.character.id,
    createdAt,
    updatedAt: createdAt,
    baseFingerprint: characterProgressionFingerprint(params.character),
    baseCatalogSnapshotId: params.character.catalogSnapshotId,
    targetCatalogSnapshotId: params.report.manifest.currentCatalogSnapshotId,
    decisions: [],
    origin: params.origin ?? 'diagnostic',
    preventiveContext: params.preventiveContext
  };
};

export const upsertCompatibilityRemediationDecision = (
  plan: CharacterCompatibilityRemediationPlan,
  decision: Omit<CompatibilityRemediationDecision, 'id' | 'createdAt' | 'updatedAt'>,
  at = isoNow()
): CharacterCompatibilityRemediationPlan => {
  const existing = plan.decisions.find((entry) => entry.issueId === decision.issueId);
  const next: CompatibilityRemediationDecision = existing
    ? { ...existing, ...decision, updatedAt: at }
    : { ...decision, id: createId('compatibilityDecision'), createdAt: at, updatedAt: at };
  return {
    ...plan,
    updatedAt: at,
    decisions: [...plan.decisions.filter((entry) => entry.issueId !== decision.issueId), next]
  };
};

export const removeCompatibilityRemediationDecision = (
  plan: CharacterCompatibilityRemediationPlan,
  issueId: string,
  at = isoNow()
): CharacterCompatibilityRemediationPlan => ({
  ...plan,
  updatedAt: at,
  decisions: plan.decisions.filter((entry) => entry.issueId !== issueId)
});

const referenceKind = (reference: CharacterCompatibilityReference): string | undefined =>
  reference.appliedAs ?? reference.kind;

export const listCompatibilityReplacementCandidates = (
  reference: CharacterCompatibilityReference,
  choices: readonly CharacterChoiceItem[]
): CharacterChoiceItem[] => {
  const kind = referenceKind(reference);
  return choices
    .filter((choice) => choice.available)
    .filter((choice) => !kind || choice.kind === kind)
    .filter((choice) => choice.choiceId !== reference.choiceId)
    .filter((choice) => !reference.entityId || choice.catalogEntityId !== reference.entityId)
    .sort((left, right) => left.name.localeCompare(right.name));
};

const identitySet = (reference: CharacterCompatibilityReference): Set<string> => new Set(
  [
    reference.choiceId,
    reference.entityId,
    reference.itemId,
    reference.appliedEntityId,
    reference.choiceId.replace(/^catalog:/, ''),
    reference.choiceId.replace(/^compendium:/, '')
  ].filter((value): value is string => Boolean(value))
);

const removeReferenceStrings = <T>(value: T, identities: Set<string>): T => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry !== 'string' || !identities.has(entry))
      .map((entry) => removeReferenceStrings(entry, identities)) as T;
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') {
      const isReferenceField = key !== 'id' && (
        key.endsWith('ItemId') ||
        key.endsWith('ChoiceId') ||
        key === 'originFeatId' ||
        key === 'startingClassItemId' ||
        key === 'sourceItemId'
      );
      if (isReferenceField && identities.has(entry)) continue;
      output[key] = entry;
      continue;
    }
    if (Array.isArray(entry) && (key.endsWith('ItemIds') || key.endsWith('ChoiceIds'))) {
      output[key] = entry.filter((item) => typeof item !== 'string' || !identities.has(item));
      continue;
    }
    if ((key === 'spellAssignments' || key === 'spellbookAssignments') && entry && typeof entry === 'object') {
      output[key] = Object.fromEntries(Object.entries(entry as Record<string, unknown>).filter(([source, target]) => (
        !identities.has(source) && (typeof target !== 'string' || !identities.has(target))
      )));
      continue;
    }
    output[key] = removeReferenceStrings(entry, identities);
  }
  return output as T;
};

const removedLink = (
  link: CharacterCompendiumLink,
  reference: CharacterCompatibilityReference,
  identities: Set<string>
): boolean => Boolean(
  (reference.linkId && link.id === reference.linkId) ||
  identities.has(link.choiceId ?? '') ||
  identities.has(link.itemId) ||
  identities.has(link.catalogEntityId ?? '') ||
  identities.has(link.appliedEntityId)
);

export const removeCompatibilityReference = (
  character: Character,
  reference: CharacterCompatibilityReference
): Character => {
  const identities = identitySet(reference);
  const entityId = reference.appliedEntityId;
  const next: Character = {
    ...clone(character),
    compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
      link.status !== 'removed' && removedLink(link, reference, identities)
        ? { ...link, status: 'removed' as const, notes: [link.notes, 'Removido por plano explícito de compatibilidade.'].filter(Boolean).join('\n') }
        : link
    )
  };

  switch (reference.appliedAs) {
    case 'class':
      next.classes = next.classes.filter((entry) => entry.id !== entityId);
      next.level = next.classes.reduce((sum, entry) => sum + entry.level, 0);
      next.subclasses = next.subclasses.filter((entry) => next.classes.some((cls) => cls.id === entry.classId));
      break;
    case 'subclass': next.subclasses = next.subclasses.filter((entry) => entry.id !== entityId); break;
    case 'species': if (!entityId || next.species?.id === entityId) next.species = undefined; break;
    case 'background': if (!entityId || next.background?.id === entityId) next.background = undefined; break;
    case 'feat':
      next.feats = next.feats.filter((entry) => entry.id !== entityId);
      next.featChoices = (next.featChoices ?? []).filter((entry) => !identities.has(entry.featItemId) && entry.featEntityId !== entityId);
      if (next.originFeatId && (identities.has(next.originFeatId) || next.originFeatId === entityId)) next.originFeatId = undefined;
      break;
    case 'weapon':
      next.weapons = next.weapons.filter((entry) => entry.id !== entityId);
      next.weaponMasteries = (next.weaponMasteries ?? []).filter((entry) => !entry.weaponItemId || !identities.has(entry.weaponItemId));
      break;
    case 'armor':
      if (next.armor?.id === entityId) next.armor = undefined;
      next.armors = (next.armors ?? []).filter((entry) => entry.id !== entityId);
      next.armorAccessories = (next.armorAccessories ?? []).filter((entry) => entry.id !== entityId);
      break;
    case 'equipment': next.equipment = next.equipment.filter((entry) => entry.id !== entityId); break;
    case 'magicItem': next.magicItems = next.magicItems.filter((entry) => entry.id !== entityId); break;
    case 'spell':
      next.spells = next.spells.filter((entry) => entry.id !== entityId);
      next.spellbookEntries = (next.spellbookEntries ?? []).filter((entry) => !identities.has(entry.spellItemId));
      break;
    case 'feature': next.features = next.features.filter((entry) => entry.id !== entityId); break;
  }

  next.buildChoices = removeReferenceStrings(next.buildChoices, identities);
  next.pendingChoices = removeReferenceStrings(next.pendingChoices, identities);
  next.featChoices = removeReferenceStrings(next.featChoices, identities);
  next.spellbookEntries = removeReferenceStrings(next.spellbookEntries, identities);
  next.weaponMasteries = removeReferenceStrings(next.weaponMasteries, identities);
  next.companions = removeReferenceStrings(next.companions, identities);
  next.senses = removeReferenceStrings(next.senses, identities);
  return next;
};

const compatibleReplacement = (
  reference: CharacterCompatibilityReference,
  choice: CharacterChoiceItem
): boolean => {
  const expected = referenceKind(reference) as CharacterChoiceKind | undefined;
  return !expected || expected === choice.kind;
};

export const previewCompatibilityRemediation = (
  input: CompatibilityRemediationPreviewInput
): CompatibilityRemediationPreview => {
  const issues: RuleValidationIssue[] = [];
  const changes: CompatibilityRemediationChange[] = [];
  const operations: CharacterProgressionOperation[] = [];
  const referenceByKey = new Map(input.report.manifest.references.map((reference) => [reference.key, reference]));
  const issueById = new Map(input.report.issues.map((issue) => [issue.id, issue]));
  const choiceById = new Map<string, CharacterChoiceItem>();
  for (const choice of input.choices) {
    choiceById.set(choice.choiceId, choice);
    choiceById.set(choice.entityId, choice);
    if (choice.catalogEntityId) choiceById.set(choice.catalogEntityId, choice);
    if (choice.compendiumItemId) choiceById.set(choice.compendiumItemId, choice);
  }

  let projected = clone(input.character);
  if (input.plan.characterId !== input.character.id) {
    issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_CHARACTER_MISMATCH', 'O plano pertence a outro personagem.'));
  }
  if (characterProgressionFingerprint(input.character) !== input.plan.baseFingerprint) {
    issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_CONFLICT', 'A ficha foi alterada depois que o plano começou. Descarte o plano e gere um novo preview.'));
  }
  if (input.plan.targetCatalogSnapshotId !== input.report.manifest.currentCatalogSnapshotId) {
    issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_SNAPSHOT_STALE', 'O catálogo mudou depois que o plano foi criado. Recrie o plano antes de confirmar.'));
  }

  const duplicateIssueIds = input.plan.decisions.filter((entry, index, list) => list.findIndex((candidate) => candidate.issueId === entry.issueId) !== index);
  if (duplicateIssueIds.length) {
    issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_DUPLICATE_DECISION', 'O plano contém mais de uma decisão para a mesma ocorrência.'));
  }

  for (const decision of input.plan.decisions) {
    const sourceIssue = issueById.get(decision.issueId);
    if (!sourceIssue) {
      issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_ISSUE_STALE', `A ocorrência ${decision.issueId} não existe mais no diagnóstico atual.`));
      continue;
    }
    if (decision.kind === 'adoptSnapshot') {
      if (sourceIssue.code !== 'CHARACTER_SNAPSHOT_MISMATCH') {
        issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_INVALID_SNAPSHOT_DECISION', 'A adoção de snapshot só pode resolver uma divergência de snapshot.'));
        continue;
      }
      const previous = projected.catalogSnapshotId;
      projected = { ...projected, catalogSnapshotId: input.plan.targetCatalogSnapshotId };
      changes.push({ decisionId: decision.id, issueId: decision.issueId, kind: decision.kind, label: 'Adotar snapshot atual', beforeChoiceId: previous, afterChoiceId: input.plan.targetCatalogSnapshotId });
      operations.push(progressionOperation('snapshotMigration', `Adotar snapshot ${input.plan.targetCatalogSnapshotId}`, { metadata: { previousSnapshotId: previous ?? null, targetSnapshotId: input.plan.targetCatalogSnapshotId } }));
      continue;
    }

    const referenceKey = decision.referenceKey ?? sourceIssue.referenceKey;
    const reference = referenceKey ? referenceByKey.get(referenceKey) : undefined;
    if (!reference) {
      issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_REFERENCE_MISSING', `A referência da ocorrência ${sourceIssue.title} não pôde ser localizada.`));
      continue;
    }
    projected = removeCompatibilityReference(projected, reference);

    if (decision.kind === 'remove') {
      changes.push({ decisionId: decision.id, issueId: decision.issueId, kind: decision.kind, label: `Remover ${reference.label}`, beforeChoiceId: reference.choiceId, beforeEntityId: reference.appliedEntityId });
      operations.push(progressionOperation('reconciliation', `Remover referência incompatível: ${reference.label}`, { choiceIds: [reference.choiceId], metadata: { issueId: decision.issueId, referenceKey: reference.key } }));
      continue;
    }

    const replacement = decision.replacementChoiceId ? choiceById.get(decision.replacementChoiceId) : undefined;
    if (!replacement) {
      issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_REPLACEMENT_MISSING', `A substituição escolhida para ${reference.label} não está disponível.`));
      continue;
    }
    if (!replacement.available) {
      issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_REPLACEMENT_BLOCKED', `${replacement.name} está bloqueado pelos filtros atuais.`));
      continue;
    }
    if (!compatibleReplacement(reference, replacement)) {
      issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_KIND_MISMATCH', `${replacement.name} não possui o mesmo tipo mecânico de ${reference.label}.`));
      continue;
    }
    const application = applyCharacterChoice({ character: projected, choice: replacement });
    issues.push(...application.issues);
    if (!application.ok) continue;
    projected = application.character;
    changes.push({ decisionId: decision.id, issueId: decision.issueId, kind: decision.kind, label: `Substituir ${reference.label} por ${replacement.name}`, beforeChoiceId: reference.choiceId, afterChoiceId: replacement.choiceId, beforeEntityId: reference.appliedEntityId, afterEntityId: application.link?.appliedEntityId });
    operations.push(progressionOperation('reconciliation', `Substituir referência incompatível: ${reference.label} → ${replacement.name}`, { choiceIds: [reference.choiceId, replacement.choiceId], metadata: { issueId: decision.issueId, referenceKey: reference.key } }));
  }

  const requiredIssueIds = input.report.issues.filter((entry) => entry.severity === 'error').map((entry) => entry.id);
  const decided = new Set(input.plan.decisions.map((entry) => entry.issueId));
  const unresolved = requiredIssueIds.filter((id) => !decided.has(id));
  if (unresolved.length) {
    issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_INCOMPLETE', `${unresolved.length} ocorrência(s) bloqueante(s) ainda não possui(em) decisão explícita.`));
  }

  const afterReport = buildCharacterCompatibilityReport({
    character: projected,
    snapshot: input.snapshot,
    filterState: input.filterState,
    choices: input.choices,
    now: input.now
  });
  if (afterReport.blockingIssueCount > 0) {
    issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_BLOCKERS_REMAIN', `O preview ainda contém ${afterReport.blockingIssueCount} incompatibilidade(s) bloqueante(s).`));
  }
  const validation = validateCharacterRules(projected);
  issues.push(...validation.issues.filter((entry) => entry.severity === 'error').map((entry) => ({ ...entry, code: `COMPATIBILITY_REMEDIATION_${entry.code}` })));

  const summary = summarizeProgressionChange(progressionSnapshot(input.character), progressionSnapshot(projected));
  if (!summary.changedPaths.length) {
    issues.push(remediationIssue('error', 'COMPATIBILITY_REMEDIATION_NO_CHANGES', 'O plano não produz nenhuma alteração na ficha.'));
  }
  const blockingIssues = issues.filter((entry) => entry.severity === 'error');
  return {
    ok: blockingIssues.length === 0,
    plan: input.plan,
    projectedCharacter: projected,
    beforeReport: input.report,
    afterReport,
    changes,
    impact: {
      replacements: changes.filter((entry) => entry.kind === 'replace').length,
      removals: changes.filter((entry) => entry.kind === 'remove').length,
      snapshotMigrations: changes.filter((entry) => entry.kind === 'adoptSnapshot').length,
      referencesBefore: input.report.manifest.counts.total,
      referencesAfter: afterReport.manifest.counts.total,
      blockingIssuesBefore: input.report.blockingIssueCount,
      blockingIssuesAfter: afterReport.blockingIssueCount,
      changedPaths: summary.changedPaths,
      summary
    },
    operations,
    issues,
    blockingIssues,
    warnings: issues.filter((entry) => entry.severity !== 'error')
  };
};
