import { useEffect } from "react";
import { useLivePrices } from "../../hooks/useLivePrices";
import { getPaperTradingState, setPositions } from "../../state/paperTrading";
import type { PaperPosition } from "../../types/paperTrading";

export function LivePriceUpdater() {
  const { subscribe } = useLivePrices();

  useEffect(() => {
    const unsub = subscribe((symbol, price) => {
      if (price.ltp <= 0) return;
      const state = getPaperTradingState();
      const updated = state.positions.map((pos: PaperPosition) => {
        if (pos.symbol !== symbol) return pos;
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
