export type AddToastReason =
  | "stream_incomplete"
  | "poll_failed"
  | "timeout_preserved_card"
  | "async_failure_preserved_card";

export function createRunToastDeduper() {
  const shownByRun = new Map<string, Set<AddToastReason>>();

  return {
    shouldShow(runId: string | number, reason: AddToastReason) {
      const key = String(runId);
      const shown = shownByRun.get(key);
      if (shown?.has(reason)) return false;
      if (shown) {
        shown.add(reason);
      } else {
        shownByRun.set(key, new Set([reason]));
      }
      return true;
    },
    resetAll() {
      shownByRun.clear();
    },
  };
}
