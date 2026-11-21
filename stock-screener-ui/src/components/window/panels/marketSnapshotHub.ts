import { createEffect, createRoot, createSignal, onCleanup } from "solid-js";
import type { MarketUniverse } from "@/types/marketScreener";
import {
  useMarketSnapshotSolid,
  type UseMarketSnapshotResult,
} from "../../market/useMarketSnapshotSolid";

export interface MarketSnapshotEntry {
  hook: UseMarketSnapshotResult;
  refs: number;
  dispose: () => void;
}

const entries = new Map<MarketUniverse, MarketSnapshotEntry>();

/** Three consecutive failures engage backoff; each step doubles, capped at 5 min. */
const FAILURE_LIMIT = 3;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 300_000;

const [visible, setVisible] = createSignal(true);
let visibilityBound = false;

function documentVisible(): boolean {
  return document.visibilityState !== "hidden" && !document.hidden;
}

function bindVisibility(): void {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => setVisible(documentVisible()));
}

/**
 * One snapshot hook (hence one fetch and one poll timer) per universe, shared
 * by every market heatmap window showing that universe. Each window keeps its
 * own universe selector; opening a second window on the same universe adds no
 * request, and minimising the last one disposes the root so its timer stops.
 *
 * The hook owns the cadence; this hub gates it. A hidden desk has no use for a
 * 5-second market scan, and a feed returning 401s must not be retried at that
 * rate — both are expressed as `enabled` flips, which also give us exactly one
 * immediate fetch on resume without a second timer of our own.
 */
export function acquireMarketSnapshot(
  universe: MarketUniverse,
  options: { deferCacheUntilEnabled?: boolean } = {},
): MarketSnapshotEntry {
  bindVisibility();
  let entry = entries.get(universe);
  if (!entry) {
    let created!: MarketSnapshotEntry;
    const dispose = createRoot((done) => {
      const [backedOff, setBackedOff] = createSignal(false);
      let failures = 0;
      let wasLoading = false;
      let backoffTimer: ReturnType<typeof setTimeout> | null = null;
      onCleanup(() => {
        if (backoffTimer != null) clearTimeout(backoffTimer);
        backoffTimer = null;
      });

      const hook = useMarketSnapshotSolid(() => universe, {
        enabled: () => visible() && !backedOff(),
        deferCacheUntilEnabled: options.deferCacheUntilEnabled,
      });

      // The hook clears `error` at the start of every fetch, so a plain error
      // effect would only ever see one failure at a time. Count at the load ->
      // settled edge instead; a successful settle clears the streak.
      createEffect(() => {
        const loading = hook.isLoading();
        const error = hook.error();
        if (loading) {
          wasLoading = true;
          return;
        }
        if (!wasLoading) return;
        wasLoading = false;
        if (!error) {
          failures = 0;
          return;
        }
        failures += 1;
        if (failures < FAILURE_LIMIT || backoffTimer != null) return;
        const delay = Math.min(
          BACKOFF_BASE_MS * 2 ** (failures - FAILURE_LIMIT),
          BACKOFF_MAX_MS,
        );
        failures = 0;
        setBackedOff(true);
        backoffTimer = setTimeout(() => {
          backoffTimer = null;
          setBackedOff(false);
        }, delay);
      });

      created = { hook, refs: 0, dispose: done };
      return done;
    });
    entry = created;
    entry.dispose = dispose;
    entries.set(universe, entry);
  }
  entry.refs += 1;
  return entry;
}

export function releaseMarketSnapshot(entry: MarketSnapshotEntry | null): void {
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.dispose();
  for (const [universe, candidate] of entries) {
    if (candidate === entry) {
      entries.delete(universe);
      break;
    }
  }
}

/** Test-only teardown: no entry survives into the next desk mount. */
export function __resetMarketSnapshotHub(): void {
  for (const entry of entries.values()) entry.dispose();
  entries.clear();
  setVisible(true);
}
