/** Lets work finish after the answer is sent, when the Workers runtime allows it. */
export function waitUntil(
  c: { executionCtx: { waitUntil(promise: Promise<unknown>): void } },
  promise: Promise<unknown>,
): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // No execution context (outside the Workers runtime): nothing outlives the request.
    void promise.catch(() => {});
  }
}
