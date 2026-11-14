import { createEffect, onCleanup } from "solid-js";
import { getAccessToken } from "../../state/auth";
import { isMarketClosedToday } from "../../state/holidays";
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
}

export function LivePriceUpdater() {
  createEffect(() => {
    if (isMarketClosedToday()) return;

    const controller = new AbortController();
    const prices: Record<string, LivePriceEvent> = {};
    const token = getAccessToken();
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const applyPrice = (symbol: string, price: LivePriceEvent) => {
      if (!Number.isFinite(price?.ltp) || price.ltp <= 0) return;
      const prev = prices[symbol];
      if (prev && prev.ltp === price.ltp) return;
      prices[symbol] = price;

      const state = getPaperTradingState();
      // Strategy-aware: if the price event carries strategy_id, only update matching strategies.
      const priceStrategyId = (price as unknown as { strategy_id?: number | null })?.strategy_id;
      const updated = state.positions.map((pos: PaperPosition) => {
        if (pos.symbol !== symbol) return pos;
        if (priceStrategyId != null && pos.strategy_id !== priceStrategyId) return pos;
        const side = pos.side === "BUY" ? 1 : -1;
        const pnl = side * (price.ltp - pos.entry_price) * pos.quantity;
        const pnlPct = side * ((price.ltp - pos.entry_price) / pos.entry_price) * 100;
        return { ...pos, current_price: price.ltp, pnl, pnl_pct: pnlPct };
      });
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
