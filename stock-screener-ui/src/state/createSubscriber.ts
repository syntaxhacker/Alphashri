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
