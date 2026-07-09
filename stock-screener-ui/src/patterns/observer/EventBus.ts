/**
 * Typed Event Bus — GoF Observer pattern implementation.
 *
 * This formalises the simple Set-based pub/sub found in `createSubscriber`
 * (src/state/createSubscriber.ts) into a full topic-based event bus with
 * wildcards, once-listeners, and generic type safety.
 *
 * ┌─────────────────────────────────────────────────────┐
 * │              createSubscriber vs EventBus            │
 * ├──────────────────────────┬──────────────────────────┤
 * │ createSubscriber         │ EventBus                 │
 * │──────────────────────────┼──────────────────────────│
 * │ Single implicit channel  │ Named topics (strings)   │
 * │ No payload               │ Typed payload per topic   │
 * │ No wildcards             │ "*" and "prefix:*"       │
 * │ No once()                │ once() support           │
 * │ Callback = () => void    │ Callback = (payload) =>  │
 * └──────────────────────────┴──────────────────────────┘
 */

/** Shape of every event topic → payload mapping. */
export interface AppEvents {
  "price:update": { symbol: string; ltp: number };
  "position:open": { symbol: string; side: string };
  "position:close": { symbol: string; pnl: number };
  "bot:status": { botId: string; status: string };
  "auth:login": undefined;
  "auth:logout": undefined;
  "screener:update": { screener: string; count: number };
}

type Payload<T> = T extends undefined ? [] : [payload: T];
type Callback<T> = T extends undefined ? () => void : (payload: T) => void;

/** Check if a topic matches a pattern that may contain a trailing `:*` wildcard. */
function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2);
    return topic === prefix || topic.startsWith(prefix + ":");
  }
  return pattern === topic;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventMap = Record<string, any>;

export class EventBus<T extends EventMap> {
  private listeners = new Map<string, Set<Callback<T[keyof T]>>>();
  private onceListeners = new Map<string, Set<Callback<T[keyof T]>>>();

  /** Register a listener for a topic. Returns an unsubscribe function. */
  on<K extends keyof T & string>(topic: K, callback: Callback<T[K]>): () => void {
    return this._addListener(topic, callback as Callback<T[keyof T]>, false);
  }

  /** Register a one-time listener — fires at most once, then auto-removes. */
  once<K extends keyof T & string>(topic: K, callback: Callback<T[K]>): () => void {
    return this._addListener(topic, callback as Callback<T[keyof T]>, true);
  }

  /** Remove a previously registered listener. */
  off<K extends keyof T & string>(topic: K, callback: Callback<T[K]>): void {
    const cb = callback as Callback<T[keyof T]>;
    this.listeners.get(topic)?.delete(cb);
    this.onceListeners.get(topic)?.delete(cb);
  }

  /** Emit an event, notifying all matching listeners (exact, wildcard, prefix). */
  emit<K extends keyof T & string>(topic: K, ...args: Payload<T[K]>): void {
    const payload = args[0];

    const fire = (pattern: string, cbs: Set<Callback<T[keyof T]>>) => {
      if (topicMatches(pattern, topic)) {
        cbs.forEach((cb) => {
          try {
            (cb as (...a: unknown[]) => void)(payload);
          } catch (err) {
            console.error(`[EventBus] Listener error on "${topic}":`, err);
          }
        });
      }
    };

    this.listeners.forEach((cbs, pattern) => fire(pattern, cbs));
    this.onceListeners.forEach((cbs, pattern) => {
      fire(pattern, cbs);
      cbs.clear();
    });
  }

  /** Remove all listeners (optionally for a specific topic). */
  clear(topic?: string): void {
    if (topic) {
      this.listeners.delete(topic);
      this.onceListeners.delete(topic);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
  }

  /** @internal shared add logic for on/once */
  private _addListener(
    topic: string,
    callback: Callback<T[keyof T]>,
    once: boolean,
  ): () => void {
    const map = once ? this.onceListeners : this.listeners;
    if (!map.has(topic)) map.set(topic, new Set());
    map.get(topic)!.add(callback);
    return () => {
      map.get(topic)?.delete(callback);
      if (map.get(topic)?.size === 0) map.delete(topic);
    };
  }
}

/** Singleton instance typed against the app's known events. */
export const eventBus = new EventBus<AppEvents>();
