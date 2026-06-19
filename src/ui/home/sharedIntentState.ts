export type SharedIntentPlan =
  | "prefill_only"
  | "wait_for_auth"
  | "wait_for_analysis"
  | "consume_and_process";

export function getSharedIntentPlan(input: {
  isAuthenticated: boolean;
  isAnalyzing: boolean;
  hasExtractedUrl: boolean;
}): SharedIntentPlan {
  if (!input.hasExtractedUrl) {
    return "prefill_only";
  }
  if (!input.isAuthenticated) {
    return "wait_for_auth";
  }
  if (input.isAnalyzing) {
    return "wait_for_analysis";
  }
  return "consume_and_process";
}

export function shouldResetAddFlowForAuthStatus(status?: string | null) {
  return status === "unauthenticated";
}
