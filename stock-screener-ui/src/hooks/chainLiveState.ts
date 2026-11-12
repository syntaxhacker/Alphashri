/**
 * `chainLiveState` — framework-free LIVE/STALE derivation for the option chain
 * badge, plus the polling cadence constants.
 *
 * These lived in `src/hooks/useChainLivePolling.ts` (a React hook). The hook
 * itself was dead — `OptionChainPanel` inlines its polling loop — so only the
 * pure parts moved here, where they can be unit-tested without timers.
 */

/** Chain auto-refresh cadence (15s). Exported so tests can assert against it. */
export const CHAIN_POLL_INTERVAL_MS = 15_000;
/** A chain older than two missed polls reads as STALE. */
export const CHAIN_STALE_AFTER_MS = 2 * CHAIN_POLL_INTERVAL_MS;

export interface ChainLiveState {
  /** True when the chain timestamp is fresh enough to trust. */
  live: boolean;
  /** Badge suffix: "LIVE" or "STALE 2m" / "STALE 3h" / "STALE 1d". */
  label: string;
}

/**
 * Derive LIVE/STALE display state from the chain timestamp.
 * Pure function — unit-testable without timers.
 */
export function getChainLiveState(
  timestamp: string | undefined,
  nowMs: number = Date.now(),
): ChainLiveState {
  if (!timestamp) return { live: false, label: "STALE" };
  const ts = new Date(timestamp).getTime();
  if (Number.isNaN(ts)) return { live: false, label: "STALE" };
  const ageMs = nowMs - ts;
  if (ageMs <= CHAIN_STALE_AFTER_MS) return { live: true, label: "LIVE" };
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return { live: false, label: `STALE ${Math.max(1, minutes)}m` };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { live: false, label: `STALE ${hours}h` };
  return { live: false, label: `STALE ${Math.floor(hours / 24)}d` };
}
