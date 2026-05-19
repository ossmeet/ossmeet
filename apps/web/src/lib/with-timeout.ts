/** Wrap async work with a rejection timeout. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T>;
export function withTimeout<T>(factory: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T>;
export function withTimeout<T>(
  promiseOrFactory: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`Timed out after ${ms}ms`));
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
  });
  const promise = typeof promiseOrFactory === "function"
    ? promiseOrFactory(controller.signal)
    : promiseOrFactory;
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}
