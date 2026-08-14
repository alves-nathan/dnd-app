import type { CharacterChoiceItem } from '../catalog/characterChoiceTypes';
import type { CatalogFilterState, CatalogSnapshot } from '../catalog/types';
import type { Character } from '../types';
import { buildCharacterCompatibilityReport, type CharacterCompatibilityReport } from './characterCompatibility';
import {
  previewCompatibilityRemediation,
  type CharacterCompatibilityRemediationPlan,
  type CompatibilityRemediationPreview
} from './compatibilityRemediation';
import type { CompatibilityRemediationRecoverySummary, CompatibilityRemediationRecoveryStatus } from './compatibilityRemediationRecovery';

export interface CompatibilityRemediationBatchCharacter {
  characterId: string;
  characterName: string;
  report: CharacterCompatibilityReport;
  plan?: CharacterCompatibilityRemediationPlan;
  recoveryStatus: CompatibilityRemediationRecoveryStatus;
  preview?: CompatibilityRemediationPreview;
  canCommit: boolean;
}

export interface CompatibilityRemediationAffectedGroup {
  kind: 'entity' | 'book';
  key: string;
  label: string;
  characterIds: string[];
  issueCount: number;
  activePlanCount: number;
}

export interface CompatibilityRemediationBatchOverview {
  characters: CompatibilityRemediationBatchCharacter[];
  groups: CompatibilityRemediationAffectedGroup[];
  aggregate: {
    characters: number;
    charactersWithIssues: number;
    activePlans: number;
    recoveredPlans: number;
    conflictedPlans: number;
    staleCatalogPlans: number;
    readyPlans: number;
    decisions: number;
    replacements: number;
    removals: number;
    snapshotMigrations: number;
    blockingIssuesBefore: number;
    blockingIssuesAfter: number;
  };
}

const recoveryStatusFor = (
  characterId: string,
  plan: CharacterCompatibilityRemediationPlan | undefined,
  summary: CompatibilityRemediationRecoverySummary
): CompatibilityRemediationRecoveryStatus => {
  if (!plan) return 'ready';
  if (summary.conflictedCharacterIds.includes(characterId)) return 'conflicted';
  if (summary.staleCatalogCharacterIds.includes(characterId)) return 'staleCatalog';
  if (summary.pendingAcknowledgementCharacterIds.includes(characterId)) return 'recoverable';
  return 'ready';
};

export const buildCompatibilityRemediationBatchOverview = (params: {
  characters: readonly Character[];
  plans: Record<string, CharacterCompatibilityRemediationPlan>;
  recovery: CompatibilityRemediationRecoverySummary;
  snapshot: CatalogSnapshot;
  filterState: CatalogFilterState;
  choices: readonly CharacterChoiceItem[];
  now?: () => Date;
}): CompatibilityRemediationBatchOverview => {
  const groups = new Map<string, { kind: 'entity' | 'book'; key: string; label: string; characterIds: Set<string>; issueCount: number; activePlanCharacterIds: Set<string> }>();
  const characters = params.characters.map((character): CompatibilityRemediationBatchCharacter => {
    const report = buildCharacterCompatibilityReport({
      character,
      snapshot: params.snapshot,
      filterState: params.filterState,
      choices: params.choices,
      now: params.now
    });
    const plan = params.plans[character.id];
    const recoveryStatus = recoveryStatusFor(character.id, plan, params.recovery);
    const preview = plan ? previewCompatibilityRemediation({ character, report, plan, snapshot: params.snapshot, filterState: params.filterState, choices: params.choices, now: params.now }) : undefined;

    for (const issue of report.issues) {
      const descriptors: Array<{ kind: 'entity' | 'book'; key?: string; label?: string }> = [
        { kind: 'entity', key: issue.entityId ?? issue.choiceId, label: issue.entityId ?? issue.choiceId },
        { kind: 'book', key: issue.sourceBookId, label: issue.sourceBookId }
      ];
      for (const descriptor of descriptors) {
        if (!descriptor.key) continue;
        const groupKey = `${descriptor.kind}:${descriptor.key}`;
        const current = groups.get(groupKey) ?? {
          kind: descriptor.kind,
          key: descriptor.key,
          label: descriptor.label ?? descriptor.key,
          characterIds: new Set<string>(),
          issueCount: 0,
          activePlanCharacterIds: new Set<string>()
        };
        current.characterIds.add(character.id);
        current.issueCount += 1;
        if (plan) current.activePlanCharacterIds.add(character.id);
        groups.set(groupKey, current);
      }
    }

    return {
      characterId: character.id,
      characterName: character.name?.trim() || 'Personagem sem nome',
      report,
      plan,
      recoveryStatus,
      preview,
      canCommit: recoveryStatus === 'ready' && Boolean(preview?.ok)
    };
  });

  const planned = characters.filter((entry) => entry.plan);
  return {
    characters,
    groups: Array.from(groups.values())
      .filter((group) => group.characterIds.size > 1 || group.activePlanCharacterIds.size > 0)
      .map((group) => ({
        kind: group.kind,
        key: group.key,
        label: group.label,
        characterIds: Array.from(group.characterIds),
        issueCount: group.issueCount,
        activePlanCount: group.activePlanCharacterIds.size
      }))
      .sort((left, right) => right.characterIds.length - left.characterIds.length || left.label.localeCompare(right.label)),
    aggregate: {
      characters: characters.length,
      charactersWithIssues: characters.filter((entry) => entry.report.requiresReview).length,
      activePlans: planned.length,
      recoveredPlans: planned.filter((entry) => entry.recoveryStatus === 'recoverable').length,
      conflictedPlans: planned.filter((entry) => entry.recoveryStatus === 'conflicted').length,
      staleCatalogPlans: planned.filter((entry) => entry.recoveryStatus === 'staleCatalog').length,
      readyPlans: planned.filter((entry) => entry.canCommit).length,
      decisions: planned.reduce((sum, entry) => sum + (entry.plan?.decisions.length ?? 0), 0),
      replacements: planned.reduce((sum, entry) => sum + (entry.preview?.impact.replacements ?? 0), 0),
      removals: planned.reduce((sum, entry) => sum + (entry.preview?.impact.removals ?? 0), 0),
      snapshotMigrations: planned.reduce((sum, entry) => sum + (entry.preview?.impact.snapshotMigrations ?? 0), 0),
      blockingIssuesBefore: planned.reduce((sum, entry) => sum + (entry.preview?.impact.blockingIssuesBefore ?? entry.report.blockingIssueCount), 0),
      blockingIssuesAfter: planned.reduce((sum, entry) => sum + (entry.preview?.impact.blockingIssuesAfter ?? entry.report.blockingIssueCount), 0)
    }
  };
};
