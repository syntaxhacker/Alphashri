// useTickReplayFeed — data hook for tick-replay pages. The page supplies fetcher(s);
// the hook owns loading/error state. SmcTrades merges inv+retest; SmcPoc swaps nq/mock.
import { useEffect, useState } from "react";
import type { Bar, ReplayTrade } from "./types";

export interface TickReplayFeed<T extends ReplayTrade = ReplayTrade> {
  bars: Bar[];
  trades: T[];
  loading: boolean;
  error?: string;
  basis?: number;
}

export default function useTickReplayFeed<T extends ReplayTrade = ReplayTrade>(
  load: () => Promise<{ bars: Bar[]; trades: T[]; error?: string; basis?: number }>,
  deps: unknown[],
): TickReplayFeed<T> {
  const [state, setState] = useState<TickReplayFeed<T>>({ bars: [], trades: [], loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    load()
      .then((d) => {
        if (live) setState({ bars: d.bars, trades: d.trades, loading: false, error: d.error, basis: d.basis });
      })
      .catch(() => {
        if (live) setState({ bars: [], trades: [], loading: false, error: "fetch failed" });
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
