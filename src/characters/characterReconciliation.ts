import type { Character, RuleValidationIssue } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  reconcileCharacterProgression,
  type ProgressionReconciliationResult
} from './progressionReconciliation';
import {
  reconcileCharacterBuild,
  type BuildReconciliationResult
} from './buildReconciliation';

export type CharacterReconciliationStageName = 'progression' | 'build';

export interface CharacterReconciliationStageReport {
  stage: CharacterReconciliationStageName;
  changed: boolean;
  issues: RuleValidationIssue[];
}

export interface CharacterReconciliationSummary {
  appliedFeatureCount: number;
  removedSubclassCount: number;
  removedFeatureCount: number;
  removedResourceCount: number;
  removedFeatCount: number;
  removedSpellCount: number;
  pendingChoiceCount: number;
}

export interface CharacterReconciliationResult {
  character: Character;
  changed: boolean;
  issues: RuleValidationIssue[];
  stages: CharacterReconciliationStageReport[];
  progression: ProgressionReconciliationResult;
  build: BuildReconciliationResult;
  summary: CharacterReconciliationSummary;
}

const snapshotsEqual = (left: Character, right: Character): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const issueKey = (issue: RuleValidationIssue): string => [
  issue.severity,
  issue.code,
  issue.message,
  issue.source?.id ?? ''
].join('\u0000');

const uniqueIssues = (issues: RuleValidationIssue[]): RuleValidationIssue[] => {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = issueKey(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Canonical, catalog-aware character reconciliation entry point.
 *
 * Keep the ordering explicit. Progression reconciliation may remove state that
 * is no longer legal after a level/class change. Build reconciliation then
 * rematerializes derived mechanics and reconciles choices, spell access,
 * proficiencies, HP, spell slots and pending choices against that cleaned
 * snapshot.
 *
 * This service intentionally performs a single deterministic pass. Callers do
 * not need to loop until stable; idempotence is a contract verified by tests.
 */
export const reconcileCharacterSnapshot = (
  character: Character,
  items: StoredCompendiumItem[]
): CharacterReconciliationResult => {
  const progression = reconcileCharacterProgression(character, items);
  const build = reconcileCharacterBuild(progression.character, items);
  const issues = uniqueIssues([...progression.issues, ...build.issues]);

  return {
    character: build.character,
    changed: !snapshotsEqual(character, build.character),
    issues,
    stages: [
      {
        stage: 'progression',
        changed: !snapshotsEqual(character, progression.character),
        issues: progression.issues
      },
      {
        stage: 'build',
        changed: !snapshotsEqual(progression.character, build.character),
        issues: build.issues
      }
    ],
    progression,
    build,
    summary: {
      appliedFeatureCount: progression.appliedFeatureCount,
      removedSubclassCount: progression.removedSubclassCount,
      removedFeatureCount: progression.removedFeatureCount,
      removedResourceCount: progression.removedResourceCount,
      removedFeatCount: build.removedFeatCount,
      removedSpellCount: build.removedSpellCount,
      pendingChoiceCount: build.pendingChoiceCount
    }
  };
};
