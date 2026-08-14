import { compatibilityReportToMarkdown, createCompatibilitySuiteInputFromExamples, runCompatibilitySuite } from '../hardening/compatibilitySuite';

describe('compatibilitySuite', () => {
  it('runs the full hardening suite over the example library without thrown failures', () => {
    const report = runCompatibilitySuite(createCompatibilitySuiteInputFromExamples());

    expect(report.summary.totalChecks).toBeGreaterThanOrEqual(9);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.readinessScore).toBeGreaterThan(60);
  });

  it('exports a readable markdown report', () => {
    const report = runCompatibilitySuite(createCompatibilitySuiteInputFromExamples());
    const markdown = compatibilityReportToMarkdown(report);

    expect(markdown).toContain('# Relatório de hardening e compatibilidade');
    expect(markdown).toContain('Gate:');
    expect(markdown).toContain('Biblioteca de exemplos íntegra');
  });
});
