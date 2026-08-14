import { createReleasePlan, defaultReleasePlanInput } from '../release/releaseReadiness';

describe('releaseReadiness', () => {
  it('creates a release plan with commands and checklist', () => {
    const plan = createReleasePlan({ ...defaultReleasePlanInput, hasProjectId: true, compatibilityGate: 'ready', validationScore: 100 });
    expect(plan.gate).toBe('ready');
    expect(plan.commands.some((command) => command.id === 'build.dev.android')).toBe(true);
    expect(plan.checklist.every((check) => check.status === 'pass')).toBe(true);
    expect(plan.markdown).toContain('npm run build:dev:android');
  });

  it('blocks release when native identifiers are missing', () => {
    const plan = createReleasePlan({ ...defaultReleasePlanInput, androidPackage: undefined, iosBundleIdentifier: undefined, hasProjectId: true, compatibilityGate: 'ready' });
    expect(plan.gate).toBe('blocked');
    expect(plan.issues.some((issue) => issue.code.includes('APP_IDENTITY_ANDROID'))).toBe(true);
    expect(plan.issues.some((issue) => issue.severity === 'error')).toBe(true);
  });

  it('warns when EAS project id is not configured yet', () => {
    const plan = createReleasePlan({ ...defaultReleasePlanInput, hasProjectId: false, compatibilityGate: 'ready' });
    expect(plan.gate).toBe('needsReview');
    expect(plan.issues.some((issue) => issue.code.includes('EAS_PROJECTID'))).toBe(true);
  });
});
