import { createEffect, onCleanup } from "solid-js";
import { getAccessToken } from "../../state/auth";
import { isMarketOpenNow } from "../../state/holidays";
import { readSseStream } from "../../api/sse";
import { API_BASE } from "@/api/config";
import { getPaperTradingState, setPositions } from "../../state/paperTrading";
import type { PaperPosition } from "../../types/paperTrading";

export interface LivePriceEvent {
  instrument_key: string;
  symbol: string;
  ltp: number;
  ltq?: string | number;
  ts?: string;
  /** Forward-compatible: absent on today's frames, present if the stream scopes a tick to one strategy. */
  strategy_id?: number | null;
}

export function LivePriceUpdater() {
  createEffect(() => {
    if (!isMarketOpenNow()) return;

    const controller = new AbortController();
    const token = getAccessToken();
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const sameNumber = (a: number, b: number) => a === b || (Number.isNaN(a) && Number.isNaN(b));

    const applyPrice = (symbol: string, price: LivePriceEvent) => {
      if (!Number.isFinite(price?.ltp) || price.ltp <= 0) return;

      const state = getPaperTradingState();
      // Strategy-aware: if the price event carries strategy_id, only update matching strategies.
      const priceStrategyId = price.strategy_id;
      let changed = false;
      const updated = state.positions.map((pos: PaperPosition) => {
        if (pos.symbol !== symbol) return pos;
        if (priceStrategyId != null && pos.strategy_id !== priceStrategyId) return pos;
        const side = pos.side === "BUY" ? 1 : -1;
        const pnl = side * (price.ltp - pos.entry_price) * pos.quantity;
        const pnlPct = side * ((price.ltp - pos.entry_price) / pos.entry_price) * 100;
        if (
          sameNumber(pos.current_price, price.ltp) &&
          sameNumber(pos.pnl, pnl) &&
          sameNumber(pos.pnl_pct, pnlPct)
        ) {
          return pos;
        }
        changed = true;
        return { ...pos, current_price: price.ltp, pnl, pnl_pct: pnlPct };
      });
      // Dedupe against the positions actually in state, never a symbol-keyed
      // cache: two strategies can hold the same symbol, and a position added by
      // the REST poll still needs the current price when the ltp is unchanged.
      // An unheld-symbol tick must not re-emit the snapshot — every notify
      // rebuilds table rows and the chart even when no value moved.
      if (!changed) return;
      setPositions(updated);
    };

    void (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/paper/live/stream`, {
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          console.warn("[LivePrices] SSE connection failed:", response.status);
          return;
        }
        await readSseStream(
          response,
          (frame) => {
            if (frame.event !== "price" || !frame.data) return;
            try {
              const data = JSON.parse(frame.data) as LivePriceEvent & { type: string };
              if (data.symbol && data.ltp != null) applyPrice(data.symbol, data);
            } catch {
              // skip malformed frame
            }
          },
          { signal: controller.signal },
        );
      } catch (err: unknown) {
        if ((err as { name?: string })?.name !== "AbortError") {
          console.warn("[LivePrices] Connection error:", err);
        }
      }
    })();

    onCleanup(() => controller.abort());
  });

  return <div data-testid="live-price-updater" style={{ display: "none" }} />;
}
