/**
 * Explicit cache for the Home Monitor's derived arrays.
 *
 * The catalyst store publishes a new payload object on every tick, even when a
 * tick only moves the clock. Each region used to rebuild its rows from that
 * object, so one clock-only snapshot re-derived every panel. Entries here are
 * addressed by every dimension that can change the answer — session, universe,
 * layout and domain — expire after a TTL, and are compared against a content
 * fingerprint before a hit is served. A force refresh drops the whole cache.
 *
 * Nothing here starts a fetch or holds a subscription: the catalyst store owns
 * the poll and the 30 s cadence; this module only memoises the pure projections.
 */

/** Matches the catalyst poll floor: a derived row older than one tick is stale. */
export const HOME_DERIVED_TTL_MS = 30_000;
const MAX_ENTRIES = 24;

interface Entry {
  at: number;
  fingerprint: string;
  value: unknown;
}

const entries = new Map<string, Entry>();
let opaqueSeq = 0;

export interface HomeCacheScope {
  /** Session date of the snapshot (IST `as_of` day); a new session cannot hit. */
  session: string;
  /** Market/universe the rows were derived for. */
  universe: string;
  /** Desk surface the rows were derived on. */
  layout: string;
}

function fingerprintOf(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    // A non-serialisable input must never score a hit — derive fresh instead.
    return `opaque:${++opaqueSeq}`;
  }
}

/**
 * Return the cached projection only when the key, fingerprint and TTL all
 * still hold. `force` is the explicit escape hatch: it bypasses and replaces
 * the entry even when the other dimensions are unchanged.
 */
export function readHomeDerived<T>(
  domain: string,
  scope: HomeCacheScope,
  fingerprint: unknown,
  derive: () => T,
  options: { force?: boolean; ttlMs?: number } = {},
): T {
  const key = JSON.stringify([domain, scope.session, scope.universe, scope.layout]);
  const fp = fingerprintOf(fingerprint);
  const now = Date.now();
  const hit = entries.get(key);

  if (options.force) {
    entries.delete(key);
  } else if (
    hit
    && hit.fingerprint === fp
    && now - hit.at < (options.ttlMs ?? HOME_DERIVED_TTL_MS)
  ) {
    return hit.value as T;
  }

  const value = derive();
  entries.set(key, { at: now, fingerprint: fp, value });
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  return value;
}

/** Force refresh: the next read of every domain re-derives from its payload. */
export function clearHomeDerivedCache(): void {
  entries.clear();
}
