import type { JSX } from "solid-js";
// BacktestRightRail — fixed right column holding the collapsible panels.
// Width resizes on the DOM node during the gesture (rAF) and commits on release.

import * as palette from "@/ui/palette";
import { RAIL_MAX_WIDTH, RAIL_MIN_WIDTH } from "./useBacktestLayout";
import { Box } from "@/ui";
interface BacktestRightRailProps {
  width: number;
  onWidthChange: (width: number) => void;
  children: JSX.Element;
}

export function BacktestRightRail({ width, onWidthChange, children }: BacktestRightRailProps) {
  let railRef: HTMLDivElement | undefined;

  const beginResize = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = railRef?.getBoundingClientRect().width ?? width;
    const el = railRef;
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
      ref={el => (railRef = el)}
      data-testid="backtest-rail"
      className="flex-shrink-0 h-full min-h-0 flex flex-col overflow-hidden"
      style={{
        flex: "0 0 auto",
        width,
        "min-width": RAIL_MIN_WIDTH,
        "max-width": RAIL_MAX_WIDTH,
        height: "100%",
        "min-height": 0,
        position: "relative",
        display: "flex",
        "flex-direction": "column",
        "background-color": palette.NT_BG,
        "border-left": `1px solid ${palette.BORDER}`,
        overflow: "hidden",
      }}
    >
      <Box
        role="separator"
        aria-label="Resize right panel"
        onPointerDown={beginResize}
        className="absolute left-0 top-0 bottom-0 w-[6px] cursor-ew-resize touch-none z-3"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "ew-resize",
          "touch-action": "none",
          "z-index": 3,
        }}
      />
      {children}
    </Box>
  );
}
