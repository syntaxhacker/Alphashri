// useTickReplayFeed — data hook for tick-replay pages. The page supplies fetcher(s);
// the hook owns loading/error state. SmcTrades merges inv+retest; SmcPoc swaps nq/mock.
import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Bar, ReplayTrade } from "./types";

export interface TickReplayFeed<T extends ReplayTrade = ReplayTrade> {
  /** Reactive accessor for the loaded bars */
  bars: () => Bar[];
  /** Reactive accessor for the loaded trades */
  trades: () => T[];
  /** Reactive accessor for the loading flag */
  loading: () => boolean;
  /** Reactive accessor for the error message, if any */
  error: () => string | undefined;
  /** Reactive accessor for the basis, if provided by the fetcher */
  basis: () => number | undefined;
}

export default function useTickReplayFeed<T extends ReplayTrade = ReplayTrade>(
  load: () => Promise<{ bars: Bar[]; trades: T[]; error?: string; basis?: number }>,
  deps: Array<() => unknown> = [],
): TickReplayFeed<T> {
  const [bars, setBars] = createSignal<Bar[]>([]);
  const [trades, setTrades] = createSignal<T[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [basis, setBasis] = createSignal<number | undefined>(undefined);

  createEffect(() => {
    for (const dep of deps) dep();
    let live = true;
    setLoading(true);
    load()
      .then((d) => {
        if (!live) return;
        setBars(d.bars);
        setTrades(d.trades);
        setError(d.error);
        setBasis(d.basis);
        setLoading(false);
      })
      .catch(() => {
        if (!live) return;
        setBars([]);
        setTrades([]);
        setError("fetch failed");
        setLoading(false);
      });
    onCleanup(() => { live = false; });
  });

  return {
    bars,
    trades,
    loading,
    error,
    basis,
  };
}
