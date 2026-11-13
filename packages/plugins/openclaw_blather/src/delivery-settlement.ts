/**
 * The reply resolver queues deliveries; returning from it does not mean the
 * callbacks (or their HTTP sends) have finished. Match OpenClaw's inbound
 * dispatcher lifecycle before reading delivery diagnostics or guard counts.
 */
export async function runWithSettledDelivery<T>(
  dispatcher: { markComplete(): void; waitForIdle(): Promise<void> },
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } finally {
    dispatcher.markComplete();
    await dispatcher.waitForIdle();
  }
}
