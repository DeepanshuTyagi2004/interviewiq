import type { Logger } from "../lib/logger.js";

export interface ScheduledTask {
  stop(): void;
  /** Resolves once any in-progress run has finished. */
  idle(): Promise<void>;
}

/**
 * Minimal in-process scheduler with Spring `@Scheduled` semantics — runs never overlap:
 *  - fixedDelay: the next run starts `delayMs` after the previous one FINISHES
 *  - fixedRate:  runs are due every `periodMs` from the start; an overrunning run just delays the next
 * No queue dependency — same "simple cron" choice the Spring app made (pre-revenue discipline).
 * NOTE: with several API replicas each runs its own schedule; the jobs claim work atomically.
 */
function schedule(
  name: string,
  task: () => Promise<void>,
  initialDelayMs: number,
  nextDelay: (startedAt: number, finishedAt: number) => number,
  log: Logger,
): ScheduledTask {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let running: Promise<void> | null = null;

  const tick = () => {
    if (stopped) return;
    const startedAt = Date.now();
    running = task()
      .catch((err: unknown) => log.error({ err, job: name }, "scheduled job failed"))
      .finally(() => {
        running = null;
        if (!stopped) timer = setTimeout(tick, Math.max(0, nextDelay(startedAt, Date.now())));
      });
  };

  timer = setTimeout(tick, initialDelayMs);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    idle: () => running ?? Promise.resolve(),
  };
}

export function fixedDelay(name: string, task: () => Promise<void>, o: { initialDelayMs: number; delayMs: number }, log: Logger) {
  return schedule(name, task, o.initialDelayMs, () => o.delayMs, log);
}

export function fixedRate(name: string, task: () => Promise<void>, o: { initialDelayMs: number; periodMs: number }, log: Logger) {
  return schedule(name, task, o.initialDelayMs, (startedAt, finishedAt) => startedAt + o.periodMs - finishedAt, log);
}
