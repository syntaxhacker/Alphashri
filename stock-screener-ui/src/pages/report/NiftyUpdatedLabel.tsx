import { memo, useEffect, useState } from "react";
import { Text } from "@/ui";
import type { NiftySpotTick } from "@/hooks/useNiftyReportStream";

interface NiftyUpdatedLabelProps {
  /** Live spot tick pushed ~1/second. Consumed here only. */
  tick: NiftySpotTick | null;
  marketClosed: boolean;
  sessionDate?: string | null;
  /** Last report/tape frame time — moves ~30-60s, never per tick. */
  updatedAtMs: number | null;
  isStale: boolean;
}

/**
 * Header "Updated HH:MM:SS · live (WS)" label, isolated behind `React.memo`.
 * The ~1/second `tick` frame owns a tiny local clock here instead of bumping
 * parent state (which re-rendered the entire report tree once per second just
 * to move this label). The tick therefore repaints only this label; the rest
 * of the panel sees `updatedAtMs` from report/tape frames only (~30-60s).
 */
export const NiftyUpdatedLabel = memo(function NiftyUpdatedLabel({
  tick,
  marketClosed,
  sessionDate,
  updatedAtMs,
  isStale,
}: NiftyUpdatedLabelProps) {
  const [tickAtMs, setTickAtMs] = useState<number | null>(null);
  useEffect(() => {
    if (tick) setTickAtMs(Date.now());
  }, [tick]);

  const shownMs = tickAtMs ?? updatedAtMs;
  const updatedAtLabel =
    shownMs === null
      ? ""
      : new Date(shownMs).toLocaleTimeString("en-IN", {
          hour12: false,
          timeZone: "Asia/Kolkata",
        });

  return (
    <Text
      data-testid="nifty-updated-at"
      size="xs"
      c={isStale ? "warning" : "dimmed"}
      span
    >
      {marketClosed
        ? `Market closed${sessionDate ? ` · last session ${sessionDate}` : ""}`
        : `Updated ${updatedAtLabel} · live (WS)`}
    </Text>
  );
});
