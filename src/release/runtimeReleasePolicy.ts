export interface RuntimeReleasePolicyInput {
  isDevelopment: boolean;
  releaseStage?: string;
  e2eSeedEnabled?: boolean;
}

export const isInternalCandidateStage = (releaseStage?: string): boolean =>
  releaseStage === 'beta-candidate';

/**
 * The destructive E2E fixture is available only in development or in the
 * explicitly configured internal beta-candidate build. It remains disabled in
 * preview, beta and production builds even when the route is opened directly.
 */
export const isE2ESeedAllowed = ({
  isDevelopment,
  releaseStage,
  e2eSeedEnabled
}: RuntimeReleasePolicyInput): boolean =>
  isDevelopment || (isInternalCandidateStage(releaseStage) && e2eSeedEnabled === true);
