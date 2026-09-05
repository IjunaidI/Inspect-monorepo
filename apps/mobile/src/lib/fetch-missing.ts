/**
 * INS-092 — partial loads. A screen that needs several resources used to run
 * one `Promise.all` and, when any of them failed, throw the whole screen into
 * its error state and re-fetch EVERYTHING on Retry. This runs only the
 * fetchers whose value is still missing and reports each failure by key, so
 * the screen keeps what it has and Retry asks only for what it lacks.
 *
 * Pure: no React, no I/O of its own — the fetchers are injected.
 */

export type Fetchers<T> = { [K in keyof T]: () => Promise<T[K]> };

export interface FetchFailure<T> {
  key: keyof T;
  error: unknown;
}

export interface FetchOutcome<T> {
  /** `have` merged with every fetch that succeeded this round. */
  values: Partial<T>;
  failures: FetchFailure<T>[];
}

/**
 * Fetch every key of `fetchers` that `have` does not already hold (a key is
 * "held" when its value is not `undefined`). Fetches run concurrently.
 */
export async function fetchMissing<T extends object>(
  have: Partial<T>,
  fetchers: Fetchers<T>,
): Promise<FetchOutcome<T>> {
  const keys = (Object.keys(fetchers) as (keyof T)[]).filter((k) => have[k] === undefined);
  const settled = await Promise.allSettled(keys.map((k) => fetchers[k]()));
  const values: Partial<T> = { ...have };
  const failures: FetchFailure<T>[] = [];
  settled.forEach((result, i) => {
    const key = keys[i];
    if (result.status === 'fulfilled') values[key] = result.value;
    else failures.push({ key, error: result.reason });
  });
  return { values, failures };
}

/** True when every listed key is present — narrows `Partial<T>` to `T`. */
export function isComplete<T extends object>(
  values: Partial<T>,
  keys: readonly (keyof T)[],
): values is T {
  return keys.every((k) => values[k] !== undefined);
}
