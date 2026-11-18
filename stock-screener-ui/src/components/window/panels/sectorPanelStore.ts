import { createMemo, type Accessor } from "solid-js";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";
import type { SectorMarket, SectorState } from "@/state/sector";
import {
  configurePolling,
  getSectorState,
  loadSectorData,
  resetSectorState,
  setMarket,
  subscribe,
} from "@/state/sector";

/**
 * One ref-counted attach point for EVERY sector window type (table, heatmap,
 * movers). Two panel modules keeping private counters fired two identical
 * `/api/sector` requests when they mounted in the same commit. The shared
 * store's `loading` flag starts true before any request exists, so `primed`
 * distinguishes a genuinely in-flight load from a fresh desk that still needs
 * its first fetch.
 */
let mounts = 0;
let inflight: Promise<void> | null = null;
let primed = false;

export function attachSectorPanel(): void {
  mounts += 1;
  // Same-key configurePolling is a no-op in the store — no stacked intervals.
  configurePolling("dashboard", getSectorState().market);
  const current = getSectorState();
  if (current.data || current.error || inflight) return;
  if (primed && current.loading) return;
  primed = true;
  inflight = loadSectorData(current.market).finally(() => {
    inflight = null;
  });
}

export function detachSectorPanel(): void {
  mounts = Math.max(0, mounts - 1);
  // Only the last sector window tears the shared store down; minimizing one of
  // three panels must not blank the others or stop their poll.
  if (mounts === 0) {
    primed = false;
    resetSectorState();
  }
}

export function switchSectorMarket(market: SectorMarket): void {
  if (getSectorState().market === market) return;
  setMarket(market);
  configurePolling("dashboard", market);
  inflight = loadSectorData(market).finally(() => {
    inflight = null;
  });
}

export function useSectorPanelState(): Accessor<SectorState> {
  const version = useStoreSubscription(subscribe);
  return createMemo(() => {
    version();
    return getSectorState();
  });
}
