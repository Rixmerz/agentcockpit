/**
 * Promise Timeout Utility
 *
 * Provides timeout wrapper for async operations to prevent infinite hangs
 * in bundled Tauri apps where shell commands may not complete.
 */

export class TimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Operation "${operation}" timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve/reject
 * within the specified time, it throws a TimeoutError.
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operation - Description of the operation (for error messages)
 * @returns The resolved value of the promise
 * @throws TimeoutError if the operation exceeds the timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}
