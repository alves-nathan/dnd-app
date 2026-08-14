import type { BetaFeedbackEntry, BetaFeedbackExport } from './betaFeedback';
import { summarizeBetaFeedbackTriage } from './betaFeedback';
import type { BetaNativeEvidenceValidationResult } from './betaNativeEvidence';

export type BetaPromotionStatus = 'blocked' | 'needsReview' | 'ready';

export interface BetaPromotionIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface BetaPromotionEvaluationInput {
  appVersion: string;
  easProjectId?: string;
  localGateStatus?: string;
  expectedGitSha?: string;
  androidEvidence: BetaNativeEvidenceValidationResult;
  iosEvidence: BetaNativeEvidenceValidationResult;
  feedbackExport?: BetaFeedbackExport;
  feedbackEntries?: BetaFeedbackEntry[];
}

export interface BetaPromotionEvaluation {
  status: BetaPromotionStatus;
  issues: BetaPromotionIssue[];
  summary: {
    appVersion: string;
    platformsReady: number;
    unresolvedBlockingFeedback: number;
    unresolvedHighFeedback: number;
    unresolvedOtherFeedback: number;
    feedbackEntryCount: number;
  };
}

const add = (
  issues: BetaPromotionIssue[],
  severity: BetaPromotionIssue['severity'],
  code: string,
  message: string
): void => {
  issues.push({ severity, code, message });
};

export const evaluateBetaPromotion = (
  input: BetaPromotionEvaluationInput
): BetaPromotionEvaluation => {
  const issues: BetaPromotionIssue[] = [];

  if (!input.easProjectId?.trim()) {
    add(issues, 'error', 'PROMOTION_EAS_PROJECT_ID_MISSING', 'O projeto precisa estar vinculado ao EAS.');
  }
  if (input.localGateStatus !== 'passed') {
    add(issues, 'error', 'PROMOTION_LOCAL_GATE_NOT_PASSED', 'O gate local precisa estar aprovado.');
  }

  for (const [platform, validation] of [
    ['Android', input.androidEvidence],
    ['iOS', input.iosEvidence]
  ] as const) {
    if (!validation.promotionReady) {
      add(issues, 'error', `PROMOTION_${platform.toUpperCase()}_NOT_READY`, `A evidência ${platform} ainda não está pronta para promoção.`);
    }
  }

  const feedbackEntries = input.feedbackExport?.entries ?? input.feedbackEntries;
  if (!feedbackEntries) {
    add(issues, 'error', 'PROMOTION_FEEDBACK_EXPORT_MISSING', 'Exporte e revise o feedback do ciclo beta antes da promoção.');
  }

  const triage = summarizeBetaFeedbackTriage(feedbackEntries ?? []);
  if (triage.unresolvedBlocking > 0) {
    add(issues, 'error', 'PROMOTION_BLOCKING_FEEDBACK_OPEN', `${triage.unresolvedBlocking} feedback(s) bloqueante(s) continuam abertos.`);
  }
  if (triage.unresolvedHigh > 0) {
    add(issues, 'error', 'PROMOTION_HIGH_FEEDBACK_OPEN', `${triage.unresolvedHigh} feedback(s) de severidade alta continuam abertos.`);
  }
  if (triage.unresolvedMedium > 0 || triage.unresolvedLow > 0) {
    add(
      issues,
      'warning',
      'PROMOTION_NON_BLOCKING_FEEDBACK_OPEN',
      `${triage.unresolvedMedium + triage.unresolvedLow} feedback(s) não bloqueante(s) permanecem abertos.`
    );
  }

  const hasErrors = issues.some((issue) => issue.severity === 'error');
  const hasWarnings = issues.some((issue) => issue.severity === 'warning');
  const status: BetaPromotionStatus = hasErrors ? 'blocked' : hasWarnings ? 'needsReview' : 'ready';

  return {
    status,
    issues,
    summary: {
      appVersion: input.appVersion,
      platformsReady: [input.androidEvidence, input.iosEvidence].filter((entry) => entry.promotionReady).length,
      unresolvedBlockingFeedback: triage.unresolvedBlocking,
      unresolvedHighFeedback: triage.unresolvedHigh,
      unresolvedOtherFeedback: triage.unresolvedMedium + triage.unresolvedLow,
      feedbackEntryCount: feedbackEntries?.length ?? 0
    }
  };
};
