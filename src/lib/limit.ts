// Tiny concurrency limiter (p-limit style): at most `max` tasks run at once.
// Queued tasks are bound to the async context they were queued from, so per-job state
// (AsyncLocalStorage credentials) never leaks into a task started by another job's completion.
import { AsyncResource } from "node:async_hooks";

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export function createLimiter(max: number): Limiter {
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    if (active >= max) return;
    const start = queue.shift();
    if (start) start();
  };

  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(
        AsyncResource.bind(() => {
          active++;
          task()
            .then(resolve, reject)
            .finally(() => {
              active--;
              next();
            });
        }),
      );
      next();
    });
}
