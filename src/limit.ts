/**
 * Concurrency limiting.
 *
 * A misconfigured schedule - or a bug in this code - must not be able to run
 * fifty agents at once. The supervisor serialises *scheduled* work; this
 * bounds how much of that work happens simultaneously.
 *
 * Twenty lines rather than a pool library. The behaviour worth having is the
 * ceiling, the FIFO order, and the fact that one failing task does not take the
 * queue with it. A dependency would be more code than the problem, with a
 * larger surface for something this central.
 *
 * The two failure modes this exists to avoid:
 *
 *  - **A silently dropped task.** A limiter that discards queued work when
 *    full is worse than no limiter, because the job looks like it ran.
 *  - **A stalled queue.** If a task's rejection is not caught, everything
 *    behind it waits forever and the schedule looks merely slow.
 */

export type Task = () => Promise<void>;

export const DEFAULT_MAX_CONCURRENT = 2;

/**
 * Run every task, never more than `limit` at a time, in order.
 *
 * Resolves when all have finished. A task that throws is reported through
 * `onError` and the queue continues; if `onError` is absent the error is
 * swallowed rather than allowed to abandon the remaining tasks.
 */
export async function runWithLimit(
  limit: number,
  tasks: readonly Task[],
  onError?: (error: Error, index: number) => void,
): Promise<void> {
  if (tasks.length === 0) return;

  // A limit below 1 would deadlock. Clamped rather than thrown, because this
  // is a helper and the caller validates user input; a test pins that the clamp
  // exists so nobody relies on a 0 behaving sensibly elsewhere.
  const width = Math.max(1, Math.floor(limit));

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      const task = tasks[index];
      if (task === undefined) return;
      try {
        await task();
      } catch (error) {
        // Swallow-and-continue is the whole point: one bad job must not
        // disable every job queued behind it.
        onError?.(error as Error, index);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, worker));
}
