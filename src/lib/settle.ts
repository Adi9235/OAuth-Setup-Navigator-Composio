// Run tasks with limited concurrency like Promise.allSettled, but stop starting new ones once a task
// fails with a fatal ServiceError (bad key, quota used up...) and rethrow that error.
import { createLimiter } from "./limit";
import { isFatal, type ServiceError } from "./service-error";

export async function settleFailFast<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<PromiseSettledResult<T>[]> {
  const limit = createLimiter(concurrency);
  let fatal: ServiceError | undefined;
  const results = await Promise.allSettled(
    tasks.map((task) =>
      limit(async () => {
        if (fatal) throw fatal;
        try {
          return await task();
        } catch (err) {
          if (isFatal(err)) fatal ??= err;
          throw err;
        }
      }),
    ),
  );
  if (fatal) throw fatal;
  return results;
}
