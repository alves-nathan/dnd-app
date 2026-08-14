import type { CharacterChoiceItem } from '../catalog/characterChoiceTypes';
import type {
  CatalogFilterState,
  CatalogSnapshot,
  FilterImpactReport
} from '../catalog/types';
import type { Character } from '../types';
import {
  buildCharacterCompatibilityReport,
  type CharacterCompatibilityIssue,
  type CharacterCompatibilityReference,
  type CharacterCompatibilityReport
} from './characterCompatibility';
import {
  createCompatibilityRemediationPlan,
  type CharacterCompatibilityRemediationPlan
} from './compatibilityRemediation';

export interface CatalogChangeAffectedReference {
  referenceKey: string;
  choiceId: string;
  entityId: string;
  label: string;
  role: string;
  kind?: string;
  sourceBookId?: string;
  categoryIds: string[];
  beforeStatus: CharacterCompatibilityReference['status'];
  afterStatus: CharacterCompatibilityReference['status'];
}

export interface CatalogChangeCharacterImpact {
  characterId: string;
  characterName: string;
  statusBefore: CharacterCompatibilityReport['status'];
  statusAfter: CharacterCompatibilityReport['status'];
  blockingIssuesBefore: number;
  blockingIssuesAfter: number;
  newBlockingIssueCount: number;
  newWarningCount: number;
  newIssues: CharacterCompatibilityIssue[];
  affectedReferences: CatalogChangeAffectedReference[];
  affectedEntityIds: string[];
  affectedBookIds: string[];
  affectedCategoryIds: string[];
  reportBefore: CharacterCompatibilityReport;
  reportAfter: CharacterCompatibilityReport;
}

export interface CatalogChangeSharedImpactGroup {
  kind: 'entity' | 'book' | 'category';
  key: string;
  label: string;
  characterIds: string[];
  characterNames: string[];
  referenceCount: number;
}

export interface CatalogChangeCharacterImpactPreview {
  schemaVersion: 'dnd-catalog-character-impact.v1';
  generatedAt: string;
  catalogSnapshotId: string;
  catalogVersion: string;
  label: string;
  impact: FilterImpactReport;
  affectedCharacters: CatalogChangeCharacterImpact[];
  groups: CatalogChangeSharedImpactGroup[];
  counts: {
    charactersScanned: number;
    affectedCharacters: number;
    newlyBlockedCharacters: number;
    affectedReferences: number;
    affectedEntities: number;
    affectedBooks: number;
    affectedCategories: number;
    newBlockingIssues: number;
    newWarnings: number;
  };
  requiresAcknowledgement: boolean;
}

export interface CatalogChangePreventivePlanResult {
  plans: CharacterCompatibilityRemediationPlan[];
  skippedCharacterIds: string[];
}

const unique = (values: readonly string[]): string[] => Array.from(new Set(values)).sort();

const groupImpacts = (
  affectedCharacters: readonly CatalogChangeCharacterImpact[],
  snapshot: CatalogSnapshot
): CatalogChangeSharedImpactGroup[] => {
  const groups = new Map<string, {
    kind: CatalogChangeSharedImpactGroup['kind'];
    key: string;
    label: string;
    characterIds: Set<string>;
    characterNames: Set<string>;
    referenceKeys: Set<string>;
  }>();

  const include = (
    kind: CatalogChangeSharedImpactGroup['kind'],
    key: string,
    label: string,
    character: CatalogChangeCharacterImpact,
    referenceKey: string
  ) => {
    const mapKey = `${kind}:${key}`;
    const group = groups.get(mapKey) ?? {
      kind,
      key,
      label,
      characterIds: new Set<string>(),
      characterNames: new Set<string>(),
      referenceKeys: new Set<string>()
    };
    group.characterIds.add(character.characterId);
    group.characterNames.add(character.characterName);
    group.referenceKeys.add(`${character.characterId}:${referenceKey}`);
    groups.set(mapKey, group);
  };

  for (const character of affectedCharacters) {
    for (const reference of character.affectedReferences) {
      include('entity', reference.entityId, reference.label, character, reference.referenceKey);
      if (reference.sourceBookId) {
        include('book', reference.sourceBookId, reference.sourceBookId, character, reference.referenceKey);
      }
      for (const categoryId of reference.categoryIds) {
        const category = snapshot.categoryById.get(categoryId);
        include(
          'category',
          categoryId,
          category?.name['pt-BR'] ?? category?.name.en ?? category?.key ?? categoryId,
          character,
          reference.referenceKey
        );
      }
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      kind: group.kind,
      key: group.key,
      label: group.label,
      characterIds: Array.from(group.characterIds).sort(),
      characterNames: Array.from(group.characterNames).sort(),
      referenceCount: group.referenceKeys.size
    }))
    .sort((left, right) => {
      const characterDifference = right.characterIds.length - left.characterIds.length;
      if (characterDifference) return characterDifference;
      return left.label.localeCompare(right.label, 'pt-BR');
    });
};

export const buildCatalogChangeCharacterImpact = (params: {
  label: string;
  characters: readonly Character[];
  snapshot: CatalogSnapshot;
  beforeFilterState: CatalogFilterState;
  afterFilterState: CatalogFilterState;
  choices: readonly CharacterChoiceItem[];
  impact: FilterImpactReport;
  now?: () => Date;
}): CatalogChangeCharacterImpactPreview => {
  const disabledEntityIds = new Set(params.impact.disabledEntityIds);
  const affectedCharacters: CatalogChangeCharacterImpact[] = [];

  for (const character of params.characters) {
    const reportBefore = buildCharacterCompatibilityReport({
      character,
      snapshot: params.snapshot,
      filterState: params.beforeFilterState,
      choices: params.choices,
      now: params.now
    });
    const reportAfter = buildCharacterCompatibilityReport({
      character,
      snapshot: params.snapshot,
      filterState: params.afterFilterState,
      choices: params.choices,
      now: params.now
    });
    const beforeIssueIds = new Set(reportBefore.issues.map((issue) => issue.id));
    const newIssues = reportAfter.issues.filter((issue) => !beforeIssueIds.has(issue.id));
    const beforeReferenceByKey = new Map(
      reportBefore.manifest.references.map((reference) => [reference.key, reference])
    );
    const affectedReferences = reportAfter.manifest.references
      .filter((reference): reference is CharacterCompatibilityReference & { entityId: string } =>
        Boolean(reference.entityId) && disabledEntityIds.has(reference.entityId!)
      )
      .filter((reference) => {
        const before = beforeReferenceByKey.get(reference.key);
        return before?.status !== 'disabled' && reference.status === 'disabled';
      })
      .map((reference): CatalogChangeAffectedReference => {
        const before = beforeReferenceByKey.get(reference.key);
        const entry = params.snapshot.entryById.get(reference.entityId);
        return {
          referenceKey: reference.key,
          choiceId: reference.choiceId,
          entityId: reference.entityId,
          label: reference.label,
          role: reference.role,
          kind: reference.kind,
          sourceBookId: reference.sourceBookId,
          categoryIds: entry?.categoryIds.slice() ?? [],
          beforeStatus: before?.status ?? 'available',
          afterStatus: reference.status
        };
      });

    const newBlockingIssueCount = newIssues.filter((issue) => issue.severity === 'error').length;
    const newWarningCount = newIssues.filter((issue) => issue.severity === 'warning').length;
    if (!affectedReferences.length && !newBlockingIssueCount && !newWarningCount) continue;

    affectedCharacters.push({
      characterId: character.id,
      characterName: character.name,
      statusBefore: reportBefore.status,
      statusAfter: reportAfter.status,
      blockingIssuesBefore: reportBefore.blockingIssueCount,
      blockingIssuesAfter: reportAfter.blockingIssueCount,
      newBlockingIssueCount,
      newWarningCount,
      newIssues,
      affectedReferences,
      affectedEntityIds: unique(affectedReferences.map((reference) => reference.entityId)),
      affectedBookIds: unique(affectedReferences.map((reference) => reference.sourceBookId).filter((value): value is string => Boolean(value))),
      affectedCategoryIds: unique(affectedReferences.flatMap((reference) => reference.categoryIds)),
      reportBefore,
      reportAfter
    });
  }

  affectedCharacters.sort((left, right) => {
    const blockingDifference = right.newBlockingIssueCount - left.newBlockingIssueCount;
    if (blockingDifference) return blockingDifference;
    return left.characterName.localeCompare(right.characterName, 'pt-BR');
  });

  const groups = groupImpacts(affectedCharacters, params.snapshot);
  const affectedEntityIds = unique(affectedCharacters.flatMap((character) => character.affectedEntityIds));
  const affectedBookIds = unique(affectedCharacters.flatMap((character) => character.affectedBookIds));
  const affectedCategoryIds = unique(affectedCharacters.flatMap((character) => character.affectedCategoryIds));
  const counts = {
    charactersScanned: params.characters.length,
    affectedCharacters: affectedCharacters.length,
    newlyBlockedCharacters: affectedCharacters.filter((character) => character.newBlockingIssueCount > 0).length,
    affectedReferences: affectedCharacters.reduce((sum, character) => sum + character.affectedReferences.length, 0),
    affectedEntities: affectedEntityIds.length,
    affectedBooks: affectedBookIds.length,
    affectedCategories: affectedCategoryIds.length,
    newBlockingIssues: affectedCharacters.reduce((sum, character) => sum + character.newBlockingIssueCount, 0),
    newWarnings: affectedCharacters.reduce((sum, character) => sum + character.newWarningCount, 0)
  };

  return {
    schemaVersion: 'dnd-catalog-character-impact.v1',
    generatedAt: (params.now ?? (() => new Date()))().toISOString(),
    catalogSnapshotId: params.snapshot.snapshotId,
    catalogVersion: params.snapshot.catalogVersion,
    label: params.label,
    impact: params.impact,
    affectedCharacters,
    groups,
    counts,
    requiresAcknowledgement: counts.affectedCharacters > 0 || params.impact.hardDependencyBreaks.length > 0
  };
};

export const createPreventiveCompatibilityPlans = (params: {
  preview: CatalogChangeCharacterImpactPreview;
  characters: readonly Character[];
  existingPlans: Readonly<Record<string, CharacterCompatibilityRemediationPlan>>;
  now?: () => Date;
}): CatalogChangePreventivePlanResult => {
  const characterById = new Map(params.characters.map((character) => [character.id, character]));
  const plans: CharacterCompatibilityRemediationPlan[] = [];
  const skippedCharacterIds: string[] = [];

  for (const impact of params.preview.affectedCharacters) {
    const character = characterById.get(impact.characterId);
    if (!character || params.existingPlans[impact.characterId]) {
      skippedCharacterIds.push(impact.characterId);
      continue;
    }
    plans.push(createCompatibilityRemediationPlan({
      character,
      report: impact.reportAfter,
      now: params.now,
      origin: 'preventiveCatalogChange',
      preventiveContext: {
        label: params.preview.label,
        catalogSnapshotId: params.preview.catalogSnapshotId,
        disabledEntityIds: impact.affectedEntityIds,
        affectedBookIds: impact.affectedBookIds,
        affectedCategoryIds: impact.affectedCategoryIds
      }
    }));
  }

  return { plans, skippedCharacterIds: unique(skippedCharacterIds) };
};

export interface PreventiveCompatibilityPlanReconciliation {
  obsoleteEmptyPlanCharacterIds: string[];
  obsoletePlanWithDecisionsCharacterIds: string[];
  activePreventivePlanCharacterIds: string[];
}

const issueBelongsToPreventiveContext = (
  issue: CharacterCompatibilityIssue,
  plan: CharacterCompatibilityRemediationPlan,
  snapshot: CatalogSnapshot
): boolean => {
  const context = plan.preventiveContext;
  if (!context) return false;
  if (issue.entityId && context.disabledEntityIds.includes(issue.entityId)) return true;
  if (issue.sourceBookId && context.affectedBookIds.includes(issue.sourceBookId)) return true;
  if (issue.entityId) {
    const entry = snapshot.entryById.get(issue.entityId);
    if (entry?.categoryIds.some((categoryId) => context.affectedCategoryIds.includes(categoryId))) return true;
  }
  return false;
};

/**
 * Revalidates preventive plans against a projected filter state. Empty plans
 * that no longer correspond to an incompatibility can be safely discarded;
 * plans containing user decisions are preserved and surfaced for review.
 */
export const reconcilePreventiveCompatibilityPlans = (params: {
  plans: Readonly<Record<string, CharacterCompatibilityRemediationPlan>>;
  characters: readonly Character[];
  snapshot: CatalogSnapshot;
  filterState: CatalogFilterState;
  choices: readonly CharacterChoiceItem[];
  now?: () => Date;
}): PreventiveCompatibilityPlanReconciliation => {
  const characterById = new Map(params.characters.map((character) => [character.id, character]));
  const obsoleteEmptyPlanCharacterIds: string[] = [];
  const obsoletePlanWithDecisionsCharacterIds: string[] = [];
  const activePreventivePlanCharacterIds: string[] = [];

  for (const [characterId, plan] of Object.entries(params.plans)) {
    if (plan.origin !== 'preventiveCatalogChange' || !plan.preventiveContext) continue;
    const character = characterById.get(characterId);
    if (!character) continue;
    const report = buildCharacterCompatibilityReport({
      character,
      snapshot: params.snapshot,
      filterState: params.filterState,
      choices: params.choices,
      now: params.now
    });
    const stillRelevant = report.issues.some((issue) =>
      issueBelongsToPreventiveContext(issue, plan, params.snapshot)
    );
    if (stillRelevant) {
      activePreventivePlanCharacterIds.push(characterId);
    } else if (plan.decisions.length) {
      obsoletePlanWithDecisionsCharacterIds.push(characterId);
    } else {
      obsoleteEmptyPlanCharacterIds.push(characterId);
    }
  }

  return {
    obsoleteEmptyPlanCharacterIds: unique(obsoleteEmptyPlanCharacterIds),
    obsoletePlanWithDecisionsCharacterIds: unique(obsoletePlanWithDecisionsCharacterIds),
    activePreventivePlanCharacterIds: unique(activePreventivePlanCharacterIds)
  };
};
