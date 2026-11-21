/**
 * Coalesce simultaneous identical requests. An entry lives only while its
 * flight is pending, so this is never a result cache: a later request for the
 * same key always goes to the network, and a different key never shares a
 * payload. Callers keep their own controls and own result state.
 */

interface Flight {
  promise: Promise<unknown>;
  controller: AbortController;
  refs: number;
}

const flights = new Map<string, Flight>();

/**
 * `key` must encode every parameter that changes the response. The first caller
 * supplies the loader; later callers with the same key join it. Each caller may
 * pass its own signal — the shared flight is cancelled only once every caller
 * has aborted, so closing one window cannot break another.
 */
export function dedupeInFlight<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal,
): Promise<T | null> {
  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const created: Flight = { controller, promise: Promise.resolve(), refs: 0 };
    created.promise = Promise.resolve()
      .then(() => load(controller.signal))
      .finally(() => {
        if (flights.get(key) === created) flights.delete(key);
      });
    // A caller that aborts before the flight settles must not leave an
    // unhandled rejection behind.
    void created.promise.catch(() => {});
    flights.set(key, created);
    flight = created;
  }

  const joined = flight as Flight & { promise: Promise<T> };
  joined.refs += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    joined.refs -= 1;
    if (joined.refs <= 0) {
      joined.controller.abort();
      // A cancelled flight must leave the map even though its loader may never
      // settle; otherwise a later window would join a promise nobody awaits.
      if (flights.get(key) === joined) flights.delete(key);
    }
  };

  if (callerSignal?.aborted) {
    release();
    return Promise.resolve(null);
  }
  const onAbort = () => release();
  callerSignal?.addEventListener("abort", onAbort, { once: true });
  const promise = joined.promise as Promise<T>;
  return promise.then(
    (value) => {
      callerSignal?.removeEventListener("abort", onAbort);
      release();
      return value;
    },
    (error: unknown) => {
      callerSignal?.removeEventListener("abort", onAbort);
      release();
      throw error;
    },
  );
}
