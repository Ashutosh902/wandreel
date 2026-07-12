import type { StrollLibraryStatus } from "./strollLibrary";

export const STROLL_DRAFT_AUTOSAVE_DEBOUNCE_MS = 700;
export const STROLL_DRAFT_AUTOSAVE_STICKY_MS = 1400;

export type StrollDraftAutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export function getStrollDraftAutosaveLabel(status: StrollDraftAutosaveStatus) {
  if (status === "pending" || status === "saving") return "Saving changes...";
  if (status === "saved") return "Saved just now";
  if (status === "error") return "Could not save automatically";
  return null;
}

export function getStrollDraftProgressCopy(status: StrollLibraryStatus) {
  if (status === "queued") {
    return "Preparing your Stroll. We are lining up the next step.";
  }
  if (status === "curating") {
    return "Preparing your Stroll. We are checking the route and conditions.";
  }
  if (status === "ready") {
    return "Your Stroll is ready to begin.";
  }
  if (status === "failed") {
    return "This Stroll needs another try. You can adjust it and try again.";
  }
  return "Edit the draft and we will keep it current as you go.";
}
