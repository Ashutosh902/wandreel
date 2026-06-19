export function shouldIgnoreAuthRefreshResult(input: {
  resultAborted: boolean;
  currentRequestId: number | null;
  requestId: number;
  currentAuthVersion: number;
  requestAuthVersion: number;
}) {
  return (
    input.resultAborted ||
    input.currentRequestId !== input.requestId ||
    input.currentAuthVersion !== input.requestAuthVersion
  );
}
