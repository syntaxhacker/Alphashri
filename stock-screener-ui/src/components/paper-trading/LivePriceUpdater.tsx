import { useEffect } from "react";
import { useLivePrices } from "../../hooks/useLivePrices";
import { getPaperTradingState, setPositions } from "../../state/paperTrading";
import type { PaperPosition } from "../../types/paperTrading";

export function LivePriceUpdater() {
  const { subscribe } = useLivePrices();

  useEffect(() => {
    const unsub = subscribe((prices) => {
      const state = getPaperTradingState();
      const updated = state.positions.map((pos: PaperPosition) => {
        const live = prices[pos.symbol];
        if (live && live.ltp > 0) {
          const side = pos.side === "BUY" ? 1 : -1;
          const pnl = side * (live.ltp - pos.entry_price) * pos.quantity;
          const pnlPct = side * ((live.ltp - pos.entry_price) / pos.entry_price) * 100;
          return { ...pos, current_price: live.ltp, pnl, pnl_pct: pnlPct };
        }
        return pos;
      });
      setPositions(updated);
    });
    return () => unsub();
  }, [subscribe]);

  return <div data-testid="live-price-updater" style={{ display: "none" }} />;
}
