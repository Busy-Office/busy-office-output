/**
 * Delivery worker loop: drains the delivery queue by calling
 * `DeliveryQueue.processNext` repeatedly. Deliberately simple — a
 * `setInterval`-driven poll loop is enough for the single-process `serve`
 * topology; a more sophisticated scheduler is not required.
 *
 * `drainOnce` is the deterministic building block: it processes every
 * currently-due job and returns once `processNext` reports none left — no
 * timers, no waiting, so tests drive it directly instead of racing a real
 * interval (this is exactly what this task's end-to-end test does).
 * `startWorker` is the thin real-process wrapper `serve()` uses, guarding
 * against overlapping runs with a busy flag (a slow drain outliving its own
 * interval tick must not start a second, concurrent drain against the same
 * queue).
 */
import type { ChannelSender } from './delivery/channel-sender.js';
import type { DeliveryAttemptResult, DeliveryQueue } from './delivery/delivery-queue.js';

/**
 * Process every job currently due (`DeliveryQueue.listDue`, indirectly, via
 * repeated `processNext` calls) and return once none remain. One call may
 * process zero, one, or many jobs. `now` is forwarded to `processNext` for
 * deterministic tests (see `sqlite-delivery-queue.ts`'s own `now` param).
 */
export async function drainOnce(
  queue: DeliveryQueue,
  sender: ChannelSender,
  now?: string,
): Promise<DeliveryAttemptResult[]> {
  const results: DeliveryAttemptResult[] = [];
  for (;;) {
    const result = await queue.processNext(sender, now);
    if (result === undefined) break;
    results.push(result);
  }
  return results;
}

export interface Worker {
  /** Stop the interval loop. Safe to call once; in-flight drains are not
   * cancelled, only future ticks. */
  stop(): void;
}

/**
 * Real-process wrapper around `drainOnce`: polls every `intervalMs` (default
 * 1s — plenty for an embedded single-process deployment; not configurable
 * beyond this task's scope). Overlap-safe: if a drain is still running when
 * the next tick fires, that tick is skipped rather than starting a second
 * concurrent drain against the same queue/sender.
 */
export function startWorker(queue: DeliveryQueue, sender: ChannelSender, intervalMs = 1000): Worker {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void drainOnce(queue, sender)
      .catch((err: unknown) => {
        // Structured, payload-free: no archive bytes or recipients ever
        // reach this catch (drainOnce/processNext never surface them).
        // eslint-disable-next-line no-console
        console.error('[worker] drain error', err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        busy = false;
      });
  }, intervalMs);
  // Don't hold a process open on this timer alone (short-lived tests, `tsx`
  // one-shot runs) — real `serve()` processes stay alive on the HTTP
  // server's own listening socket regardless.
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
  };
}
