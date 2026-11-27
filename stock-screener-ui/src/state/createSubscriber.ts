export function createSubscriber() {
  const subscribers: Set<() => void> = new Set();

  function notify() {
    subscribers.forEach((callback) => callback());
  }

  function subscribe(callback: () => void): () => void {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  return { subscribe, notify };
}

/**
 * Like {@link createSubscriber}, but callers can also register for a subset of
 * fields and pass the changed fields to `notify`.
 *
 * `subscribe` keeps its old meaning — a global listener fires on **every**
 * notify, unchanged — so existing consumers see identical behaviour. Field
 * listeners only fire when one of their registered fields is in the notify's
 * field list, which lets narrow memos avoid recomputing on unrelated writes.
 *
 * A listener registered for several fields fires at most once per notify even
 * if more than one of those fields changed in the same batch.
 */
export function createFieldSubscriber<K extends string>() {
  const globalListeners = new Set<() => void>();
  const byField = new Map<K, Set<() => void>>();

  function notify(fields?: readonly K[]): void {
    for (const listener of globalListeners) listener();
    if (!fields || fields.length === 0) return;

    const due = new Set<() => void>();
    for (const field of fields) {
      const listeners = byField.get(field);
      if (!listeners) continue;
      for (const listener of listeners) due.add(listener);
    }
    for (const listener of due) listener();
  }

  function subscribe(callback: () => void): () => void {
    globalListeners.add(callback);
    return () => {
      globalListeners.delete(callback);
    };
  }

  function subscribeToFields(fields: readonly K[], callback: () => void): () => void {
    for (const field of fields) {
      let listeners = byField.get(field);
      if (!listeners) {
        listeners = new Set();
        byField.set(field, listeners);
      }
      listeners.add(callback);
    }
    return () => {
      for (const field of fields) byField.get(field)?.delete(callback);
    };
  }

  return { subscribe, subscribeToFields, notify };
}
