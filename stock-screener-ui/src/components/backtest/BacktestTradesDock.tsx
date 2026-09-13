// BacktestTradesDock — fixed right-side blotter for the full-bleed chart.
// Never floats, so it can't be lost off-screen. Width resizes on the DOM node
// during the gesture (rAF) and is committed once on pointer-up.
import { useRef } from "react";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { TradeHistoryTable } from ".";
import type { Trade } from "../../types/backtest";
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH } from "./useBacktestWindows";

interface BacktestTradesDockProps {
  width: number;
  symbol: string;
  trades: Trade[];
  sortColumn: string;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
  onRowClick: (tradeNumber: number) => void;
  onClose: () => void;
  onWidthChange: (width: number) => void;
}

export function BacktestTradesDock({
  width,
  symbol,
  trades,
  sortColumn,
  sortDirection,
  onSort,
  onRowClick,
  onClose,
  onWidthChange,
}: BacktestTradesDockProps) {
  const dockRef = useRef<HTMLDivElement>(null);

  const beginResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = dockRef.current?.getBoundingClientRect().width ?? width;
    const el = dockRef.current;
    if (el) el.style.willChange = "width";
    let raf = 0;
    let next = startW;

    const apply = () => {
      raf = 0;
      if (el) el.style.width = `${next}px`;
    };
    const move = (ev: PointerEvent) => {
      next = Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, startW - (ev.clientX - startX)));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (raf) cancelAnimationFrame(raf);
      if (el) el.style.willChange = "";
      onWidthChange(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <Box
      ref={dockRef}
      data-testid="trades-dock"
      sx={{
        flex: "0 0 auto",
        width,
        minWidth: DOCK_MIN_WIDTH,
        maxWidth: DOCK_MAX_WIDTH,
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        bgcolor: palette.SURFACE,
        borderLeft: `1px solid ${palette.BORDER}`,
        overflow: "hidden",
      }}
    >
      {/* resize handle */}
      <Box
        role="separator"
        aria-label="Resize trades panel"
        onPointerDown={beginResize}
        sx={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "ew-resize",
          touchAction: "none",
          zIndex: 2,
          "&:hover": { bgcolor: palette.PRIMARY, opacity: 0.35 },
        }}
      />
      {/* header */}
      <Box sx={{ flex: "0 0 auto", height: 28, display: "flex", alignItems: "center", gap: 1, pl: 1.25, pr: 0.5, bgcolor: palette.SURFACE_ALT, borderBottom: `1px solid ${palette.BORDER}` }}>
        <Box component="span" sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: palette.TEXT, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Trades — {symbol} ({trades.length})
        </Box>
        <Box
          role="button"
          aria-label="Collapse trades panel"
          onClick={onClose}
          sx={{ width: 20, height: 20, display: "grid", placeItems: "center", borderRadius: 0.5, color: palette.TEXT_MUTED, cursor: "pointer", fontSize: 13, "&:hover": { bgcolor: palette.BORDER } }}
        >
          ✕
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
        <TradeHistoryTable
          symbol={symbol}
          trades={trades}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={onSort}
          onRowClick={onRowClick}
          onClose={onClose}
        />
      </Box>
    </Box>
  );
}
