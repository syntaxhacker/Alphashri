import { createRoot } from "solid-js";
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

/**
 * One snapshot hook (hence one fetch and one poll timer) per universe, shared
 * by every market heatmap window showing that universe. Each window keeps its
 * own universe selector; opening a second window on the same universe adds no
 * request, and minimising the last one disposes the root so its timer stops.
 */
export function acquireMarketSnapshot(
  universe: MarketUniverse,
  options: { deferCacheUntilEnabled?: boolean } = {},
): MarketSnapshotEntry {
  let entry = entries.get(universe);
  if (!entry) {
    let created!: MarketSnapshotEntry;
    const dispose = createRoot((done) => {
      const hook = useMarketSnapshotSolid(() => universe, {
        enabled: () => true,
        deferCacheUntilEnabled: options.deferCacheUntilEnabled,
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
