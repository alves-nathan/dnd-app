export type EldritchInvocationCardAction = 'add' | 'remove';

export const getEldritchInvocationCardAction = (
  selectedCount: number
): EldritchInvocationCardAction => selectedCount > 0 ? 'remove' : 'add';

export const isEldritchInvocationCardDisabled = (input: {
  selectedCount: number;
  selectedTotal: number;
  limit: number;
  hasPrerequisiteIssues?: boolean;
}): boolean => {
  // A selected invocation must remain interactive even when the selection limit
  // is full or a dependency changed, otherwise the user cannot repair the build.
  if (input.selectedCount > 0) return false;
  return input.selectedTotal >= input.limit || input.hasPrerequisiteIssues === true;
};
