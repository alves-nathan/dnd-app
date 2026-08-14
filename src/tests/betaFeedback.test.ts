import {
  betaFeedbackExportToJson,
  createBetaFeedbackEntry,
  createBetaFeedbackExport,
  summarizeBetaFeedbackTriage,
  updateBetaFeedbackEntry
} from '../release/betaFeedback';

describe('beta feedback', () => {
  it('creates, updates and exports local feedback without remote telemetry', () => {
    const entry = createBetaFeedbackEntry({
      platform: 'android',
      severity: 'blocking',
      category: 'characterCreation',
      summary: '  Criação fechou ao escolher classe  ',
      steps: 'Abrir criação e escolher Fighter.'
    }, '2026-07-14T10:00:00.000Z');

    const triaged = updateBetaFeedbackEntry(entry, { status: 'triaged' }, '2026-07-14T11:00:00.000Z');
    const exported = createBetaFeedbackExport([triaged], '2026-07-14T12:00:00.000Z');

    expect(entry.summary).toBe('Criação fechou ao escolher classe');
    expect(triaged.status).toBe('triaged');
    expect(exported.privacy.remoteTelemetryEnabled).toBe(false);
    expect(exported.summary.total).toBe(1);
    expect(exported.summary.blocking).toBe(1);
    expect(JSON.parse(betaFeedbackExportToJson(exported)).schemaVersion).toBe('dnd-combat-beta-feedback.v1');
  });

  it('summarizes unresolved severity for the beta closure gate', () => {
    const blocking = createBetaFeedbackEntry({
      platform: 'android',
      severity: 'blocking',
      category: 'performance',
      summary: 'Freeze ao importar'
    });
    const low = createBetaFeedbackEntry({
      platform: 'ios',
      severity: 'low',
      category: 'other',
      summary: 'Texto desalinhado'
    });

    const summary = summarizeBetaFeedbackTriage([blocking, low]);

    expect(summary.releaseGate).toBe('blocked');
    expect(summary.unresolvedBlocking).toBe(1);
    expect(summary.unresolvedLow).toBe(1);
  });

  it('rejects an empty summary', () => {
    expect(() => createBetaFeedbackEntry({
      platform: 'unknown',
      severity: 'low',
      category: 'other',
      summary: '   '
    })).toThrow('resumo');
  });
});
