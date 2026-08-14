import { createBetaFeedbackEntry, createBetaFeedbackExport, updateBetaFeedbackEntry } from '../release/betaFeedback';
import { evaluateBetaPromotion } from '../release/betaPromotion';
import type { BetaNativeEvidenceValidationResult } from '../release/betaNativeEvidence';

const readyEvidence: BetaNativeEvidenceValidationResult = {
  status: 'ready',
  promotionReady: true,
  issues: []
};

const baseInput = () => ({
  appVersion: '0.1.0',
  easProjectId: 'project-id',
  localGateStatus: 'passed',
  androidEvidence: readyEvidence,
  iosEvidence: readyEvidence
});

describe('beta promotion gate', () => {
  it('is ready only after both platforms and feedback are closed', () => {
    const resolved = updateBetaFeedbackEntry(
      createBetaFeedbackEntry({
        platform: 'android',
        severity: 'blocking',
        category: 'characterCreation',
        summary: 'Crash no wizard'
      }, '2026-07-14T10:00:00.000Z'),
      { status: 'resolved' },
      '2026-07-14T11:00:00.000Z'
    );

    const result = evaluateBetaPromotion({
      ...baseInput(),
      feedbackExport: createBetaFeedbackExport([resolved], '2026-07-14T12:00:00.000Z')
    });

    expect(result.status).toBe('ready');
    expect(result.summary.platformsReady).toBe(2);
  });

  it('blocks unresolved high severity feedback', () => {
    const high = createBetaFeedbackEntry({
      platform: 'ios',
      severity: 'high',
      category: 'backup',
      summary: 'Restauração incompleta'
    });

    const result = evaluateBetaPromotion({
      ...baseInput(),
      feedbackEntries: [high]
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.code === 'PROMOTION_HIGH_FEEDBACK_OPEN')).toBe(true);
  });

  it('requires a feedback export and a linked EAS project', () => {
    const result = evaluateBetaPromotion({
      ...baseInput(),
      easProjectId: undefined
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['PROMOTION_EAS_PROJECT_ID_MISSING', 'PROMOTION_FEEDBACK_EXPORT_MISSING'])
    );
  });
});
