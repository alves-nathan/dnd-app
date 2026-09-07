import type { StoredCompendiumItem } from '../compendium/types';
import type { RuleValidationIssue } from '../types';
import {
  getFeatCategory,
  isFeatRepeatable,
  type ProgressionFeatChoiceCategory,
  type ProgressionFeatChoiceRequirements
} from './characterBuildRules';

export interface ProgressionSubclassGroup {
  classItem: StoredCompendiumItem;
  level: number;
  subclasses: StoredCompendiumItem[];
}

export interface ProgressionStepReadinessInput {
  subclassGroups: ProgressionSubclassGroup[];
  selectedSubclassByClass: Record<string, string>;
  featRequirements: ProgressionFeatChoiceRequirements;
  selectedFeatCounts: Record<string, number>;
  items: StoredCompendiumItem[];
  subclassChoiceIssues: RuleValidationIssue[];
  featChoiceIssues: RuleValidationIssue[];
  /** Parent-feat prerequisites that are already resolvable on this step. */
  featPrerequisiteIssues?: RuleValidationIssue[];
  classFeatureChoiceIssues?: RuleValidationIssue[];
  invocationIssues: RuleValidationIssue[];
  unavailableReferences: string[];
}

const positiveInteger = (value: number | undefined): number =>
  Math.max(0, Math.floor(value ?? 0));

const sameCountMap = (
  left: Record<string, number>,
  right: Record<string, number>
): boolean => {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([itemId, count]) => right[itemId] === count);
};

/**
 * Remove subclass selections that no longer belong to the currently selected
 * classes or that stopped being eligible after a class-level change.
 */
export const pruneSelectedSubclassByClass = (
  selectedSubclassByClass: Record<string, string>,
  subclassGroups: ProgressionSubclassGroup[]
): Record<string, string> => {
  const next: Record<string, string> = {};

  for (const group of subclassGroups) {
    const selectedId = selectedSubclassByClass[group.classItem.id];
    if (!selectedId) continue;
    if (group.subclasses.some((subclass) => subclass.id === selectedId)) {
      next[group.classItem.id] = selectedId;
    }
  }

  const currentEntries = Object.entries(selectedSubclassByClass);
  const nextEntries = Object.entries(next);
  const unchanged = currentEntries.length === nextEntries.length
    && currentEntries.every(([classItemId, subclassItemId]) => next[classItemId] === subclassItemId);
  return unchanged ? selectedSubclassByClass : next;
};

/**
 * Reconcile feat selections with the feat slots exposed by the current class
 * progression. This removes stale categories/items and trims counts when a
 * level reduction lowers the number of available feat slots.
 */
export const pruneProgressionFeatCounts = (
  selectedFeatCounts: Record<string, number>,
  items: StoredCompendiumItem[],
  requirements: ProgressionFeatChoiceRequirements
): Record<string, number> => {
  const byId = new Map(items.map((item) => [item.id, item]));
  const remaining: Record<ProgressionFeatChoiceCategory, number> = {
    general: positiveInteger(requirements.general),
    fightingStyle: positiveInteger(requirements.fightingStyle),
    epicBoon: positiveInteger(requirements.epicBoon)
  };
  const next: Record<string, number> = {};

  for (const [itemId, rawCount] of Object.entries(selectedFeatCounts)) {
    const item = byId.get(itemId);
    if (!item || item.type !== 'feat') continue;

    const category = getFeatCategory(item);
    if (category !== 'general' && category !== 'fightingStyle' && category !== 'epicBoon') continue;
    if (remaining[category] <= 0) continue;

    const requested = positiveInteger(rawCount);
    if (!requested) continue;
    const selectable = isFeatRepeatable(item) ? requested : Math.min(1, requested);
    const kept = Math.min(selectable, remaining[category]);
    if (!kept) continue;

    next[itemId] = kept;
    remaining[category] -= kept;
  }

  return sameCountMap(selectedFeatCounts, next) ? selectedFeatCounts : next;
};

const selectedFeatCount = (
  selectedFeatCounts: Record<string, number>,
  items: StoredCompendiumItem[],
  category: ProgressionFeatChoiceCategory
): number => {
  const byId = new Map(items.map((item) => [item.id, item]));
  return Object.entries(selectedFeatCounts).reduce((sum, [itemId, rawCount]) => {
    const item = byId.get(itemId);
    if (!item || getFeatCategory(item) !== category) return sum;
    return sum + positiveInteger(rawCount);
  }, 0);
};

const featCountIssue = (
  category: ProgressionFeatChoiceCategory,
  selected: number,
  required: number
): RuleValidationIssue => {
  const label = category === 'general'
    ? 'feats gerais / ASI'
    : category === 'fightingStyle'
      ? 'Fighting Styles'
      : 'Epic Boons';
  return {
    severity: 'error',
    code: `PROGRESSION_${category.toUpperCase()}_COUNT`,
    message: `Complete ${label} exigidos pela progressão (${selected}/${required}).`
  };
};

/**
 * Central readiness contract for the class-progression step. Keeping this in a
 * pure helper makes the Continue button and the visible issue list use exactly
 * the same rules.
 */
export const getProgressionStepReadinessIssues = ({
  subclassGroups,
  selectedSubclassByClass,
  featRequirements,
  selectedFeatCounts,
  items,
  subclassChoiceIssues,
  featChoiceIssues,
  featPrerequisiteIssues = [],
  classFeatureChoiceIssues = [],
  invocationIssues,
  unavailableReferences
}: ProgressionStepReadinessInput): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];

  for (const group of subclassGroups) {
    if (!group.subclasses.length) continue;
    const selectedId = selectedSubclassByClass[group.classItem.id];
    const selectedIsEligible = Boolean(
      selectedId && group.subclasses.some((subclass) => subclass.id === selectedId)
    );
    if (!selectedIsEligible) {
      issues.push({
        severity: 'error',
        code: 'PROGRESSION_SUBCLASS_REQUIRED',
        message: `Selecione uma subclasse para ${group.classItem.name}.`
      });
    }
  }

  const categories: ProgressionFeatChoiceCategory[] = ['fightingStyle', 'general', 'epicBoon'];
  for (const category of categories) {
    const required = positiveInteger(featRequirements[category]);
    const selected = selectedFeatCount(selectedFeatCounts, items, category);
    if (selected !== required) issues.push(featCountIssue(category, selected, required));
  }

  if (unavailableReferences.length) {
    issues.push({
      severity: 'error',
      code: 'PROGRESSION_REFERENCE_UNAVAILABLE',
      message: 'Há escolhas desta etapa pertencentes a uma fonte inativa ou desabilitada.'
    });
  }

  issues.push(...subclassChoiceIssues, ...featPrerequisiteIssues, ...featChoiceIssues, ...classFeatureChoiceIssues, ...invocationIssues);
  return issues;
};
