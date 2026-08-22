import { useEffect } from "react";
import { useLivePrices } from "../../hooks/useLivePrices";
import { getPaperTradingState, setPositions } from "../../state/paperTrading";
import type { PaperPosition } from "../../types/paperTrading";

export function LivePriceUpdater() {
  const { subscribe } = useLivePrices();

  useEffect(() => {
    const unsub = subscribe((symbol, price) => {
      if (!Number.isFinite(price?.ltp) || price.ltp <= 0) return;
      const state = getPaperTradingState();
      // Strategy-aware: if price event carries strategy_id, only update matching strategy positions.
      // Otherwise update all positions with the same symbol (backward-compatible with current SSE which is symbol-only).
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
    });
    return () => unsub();
  }, [subscribe]);

  return <div data-testid="live-price-updater" style={{ display: "none" }} />;
}
