/** Resolves when the browser is idle (or after `timeout` ms at the latest), so background work can't delay first paint. */
export function idle(timeout = 1500): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 50);
  });
}
