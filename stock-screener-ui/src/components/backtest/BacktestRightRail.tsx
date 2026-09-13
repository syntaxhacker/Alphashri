// BacktestRightRail — fixed right column holding the collapsible panels.
// Width resizes on the DOM node during the gesture (rAF) and commits on release.
import { useRef } from "react";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { RAIL_MAX_WIDTH, RAIL_MIN_WIDTH } from "./useBacktestLayout";

interface BacktestRightRailProps {
  width: number;
  onWidthChange: (width: number) => void;
  children: React.ReactNode;
}

export function BacktestRightRail({ width, onWidthChange, children }: BacktestRightRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  const beginResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = railRef.current?.getBoundingClientRect().width ?? width;
    const el = railRef.current;
    if (el) el.style.willChange = "width";
    let raf = 0;
    let next = startW;
    const apply = () => { raf = 0; if (el) el.style.width = `${next}px`; };
    const move = (ev: PointerEvent) => {
      next = Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, startW - (ev.clientX - startX)));
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
      ref={railRef}
      data-testid="backtest-rail"
      sx={{
        flex: "0 0 auto",
        width,
        minWidth: RAIL_MIN_WIDTH,
        maxWidth: RAIL_MAX_WIDTH,
        height: "100%",
        minHeight: 0,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        bgcolor: palette.NT_BG,
        borderLeft: `1px solid ${palette.BORDER}`,
        overflow: "hidden",
      }}
    >
      <Box
        role="separator"
        aria-label="Resize right panel"
        onPointerDown={beginResize}
        sx={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize",
          touchAction: "none", zIndex: 3, "&:hover": { bgcolor: palette.PRIMARY, opacity: 0.35 },
        }}
      />
      {children}
    </Box>
  );
}
