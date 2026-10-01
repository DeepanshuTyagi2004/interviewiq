import type { Logger } from "./logger.js";

/**
 * Fire-and-forget work that must not block the request (the Java `@Async` methods: LeetCode
 * collection after connect, prep regeneration). Errors are logged, never thrown to the caller.
 * In-flight tasks are tracked so shutdown — and tests — can wait for them to settle.
 */
export class BackgroundTasks {
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly log: Logger) {}

  run(name: string, task: () => Promise<unknown>): void {
    const p: Promise<void> = Promise.resolve()
      .then(task)
      .then(
        () => undefined,
        (err: unknown) => {
          this.log.warn({ err, task: name }, "background task failed");
        },
      )
      .finally(() => {
        this.inFlight.delete(p);
      });
    this.inFlight.add(p);
  }

  /** Wait until every task started so far (and any they start) has settled. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  get size(): number {
    return this.inFlight.size;
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
