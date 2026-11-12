import { createEffect, createSignal, onCleanup } from "solid-js";
import { detectPatterns } from "@/api/chartPatterns";
import type { PatternHitDTO } from "@/types/chartPatterns";
import type { ChartTimeframe } from "./NiftyChartPanel";

/**
 * On-demand pattern check for the Nifty chart's selected timeframe.
 *
 * The chart's 1m/5m/15m toggle only re-aggregates candles. This hook asks the
 * real detector for NIFTY on that timeframe and keeps the hits for the strip
 * under the chart.
 *
 * It uses the synchronous `/detect` endpoint, NOT the queued `/scan`: a
 * universe job can own the queue for minutes, and the chart button must answer
 * in seconds.
 */

export type PatternScanState =
  | { status: "idle" }
  | { status: "loading"; tf: ChartTimeframe }
  | { status: "ready"; tf: ChartTimeframe; hits: PatternHitDTO[]; at: number }
  | { status: "error"; tf: ChartTimeframe; message: string };

export const PATTERN_LOOKBACK_BARS = 150;

export interface NiftyPatternScan {
  state: () => PatternScanState;
  scan: (tf: ChartTimeframe) => void;
  reset: () => void;
}

export function useNiftyPatternScan(): NiftyPatternScan {
  const [state, setState] = createSignal<PatternScanState>({ status: "idle" });
  let alive = true;

  onCleanup(() => {
    alive = false;
  });

  const scan = (tf: ChartTimeframe) => {
    setState({ status: "loading", tf });
    void (async () => {
      try {
        const res = await detectPatterns("NIFTY", tf, PATTERN_LOOKBACK_BARS);
        if (!alive) return;
        setState({ status: "ready", tf, hits: res.hits, at: Date.now() });
      } catch (err) {
        if (!alive) return;
        setState({
          status: "error",
          tf,
          message: err instanceof Error ? err.message : "scan failed",
        });
      }
    })();
  };

  const reset = () => setState({ status: "idle" });

  return { state, scan, reset };
}
