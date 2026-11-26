import { createMemo, type Accessor } from "solid-js";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";
import type { SectorMarket, SectorState } from "@/state/sector";
import {
  getSectorState,
  loadSectorData,
  resetSectorState,
  restoreSectorState,
  sectorResetGeneration,
  setMarket,
  subscribe,
} from "@/state/sector";

const SECTOR_POLL_MS = 60_000;
const BACKOFF_MAX_MS = 480_000;

/**
 * One ref-counted attach point for EVERY sector window type (table, heatmap,
 * movers, detail). Two panel modules keeping private counters fired two identical
 * `/api/sector` requests when they mounted in the same commit. The shared
 * store's `loading` flag starts true before any request exists, so `primed`
 * distinguishes a genuinely in-flight load from a fresh desk that still needs
 * its first fetch.
 *
 * The timer lives here rather than in `configurePolling` so a desk-wide poll can
 * be paused while the tab is hidden and skipped while the previous read is still
 * in flight. Ref-counting means the last minimised sector window removes the
 * timer without blanking a sibling's frame.
 */
let mounts = 0;
let inflight: Promise<void> | null = null;
let primed = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let visibilityBound = false;
/** A market switch supersedes the old flight; its finally must not clear the new one. */
let generation = 0;
/** A desk rebuild remounts every frame in one commit; carry the last frame across it. */
let rebuildFrame: SectorState | null = null;
let rebuildGeneration = 0;
let rebuildResetToken = -1;

function isHidden(): boolean {
  return typeof document !== "undefined" && (document.hidden === true || document.visibilityState === "hidden");
}

function clearTimer(): void {
  if (pollTimer != null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function nextDelay(): number {
  return failures === 0
    ? SECTOR_POLL_MS
    : Math.min(SECTOR_POLL_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
}

function schedule(delay = nextDelay()): void {
  clearTimer();
  if (mounts === 0 || isHidden() || inflight) return;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    if (mounts === 0 || isHidden() || inflight) return;
    void refresh();
  }, delay);
}

function refresh(): void {
  if (mounts === 0 || isHidden() || inflight) return;
  const market = getSectorState().market;
  const token = generation;
  const task = loadSectorData(market)
    .then(() => {
      if (token !== generation) return;
      failures = getSectorState().error != null ? failures + 1 : 0;
    })
    .finally(() => {
      if (token !== generation) return;
      inflight = null;
      schedule();
    });
  inflight = task;
}

function bindVisibility(): void {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (mounts === 0) return;
    if (isHidden()) {
      clearTimer();
      return;
    }
    // Resume with one read now; the settled refresh re-arms the cadence.
    failures = 0;
    void refresh();
    schedule(SECTOR_POLL_MS);
  });
}

export function attachSectorPanel(): void {
  // Adding a window of another type changes the desk key and remounts every
  // panel. Detach then attach happens in the same commit; carry the frame back
  // so the rebuild does not fire a second identical /api/sector request.
  if (rebuildFrame != null && rebuildResetToken === sectorResetGeneration()) {
    restoreSectorState(rebuildFrame);
    rebuildFrame = null;
    rebuildGeneration += 1;
  }
  mounts += 1;
  if (mounts === 1) {
    bindVisibility();
    // Arm synchronously so minimising an unmounted panel always finds one timer.
    schedule(SECTOR_POLL_MS);
  }
  const current = getSectorState();
  if (current.data || current.error || inflight) return;
  if (primed && current.loading) return;
  primed = true;
  void refresh();
}

export function detachSectorPanel(): void {
  mounts = Math.max(0, mounts - 1);
  // Only the last sector window tears the shared store down; minimizing one of
  // three panels must not blank the others or stop their poll.
  if (mounts > 0) return;
  clearTimer();
  generation += 1;
  inflight = null;
  primed = false;
  failures = 0;
  // A genuine close still clears the store immediately. Keep one frame aside
  // for the synchronous remount that a HOME layout change performs.
  rebuildFrame = { ...getSectorState() };
  resetSectorState();
  rebuildResetToken = sectorResetGeneration();
  const token = ++rebuildGeneration;
  setTimeout(() => {
    if (token === rebuildGeneration) rebuildFrame = null;
  }, 0);
}

export function switchSectorMarket(market: SectorMarket): void {
  if (getSectorState().market === market) return;
  generation += 1;
  inflight = null;
  setMarket(market);
  failures = 0;
  schedule(SECTOR_POLL_MS);
  void refresh();
}

export function useSectorPanelState(): Accessor<SectorState> {
  const version = useStoreSubscription(subscribe);
  return createMemo(() => {
    version();
    return getSectorState();
  });
}

/** Test-only teardown: no timer or stale frame survives into the next desk mount. */
export function __resetSectorPanelStore(): void {
  rebuildFrame = null;
  rebuildGeneration += 1;
  clearTimer();
  generation += 1;
  mounts = 0;
  inflight = null;
  primed = false;
  failures = 0;
}
