import { memo } from "react";
import { Text } from "@/ui";
import { formatReportClock } from "./reportFormat";
import { useNiftySpotTick } from "@/hooks/useNiftyReportStream";

interface NiftyUpdatedLabelProps {
  marketClosed: boolean;
  sessionDate?: string | null;
  /** Last report/tape frame time — moves ~30-60s, never per tick. */
  updatedAtMs: number | null;
  isStale: boolean;
}

/**
 * Header "Updated HH:MM:SS · live (WS)" label. Subscribes to the tick store
 * itself, so the ~1/second frame repaints only this label instead of bumping
 * `updatedAtMs` (which re-rendered every consumer) or the panel.
 */
export const NiftyUpdatedLabel = memo(function NiftyUpdatedLabel({
  marketClosed,
  sessionDate,
  updatedAtMs,
  isStale,
}: NiftyUpdatedLabelProps) {
  const tick = useNiftySpotTick();
  const tickMs = tick?.ts ? Date.parse(tick.ts) : NaN;
  const shownMs = Number.isFinite(tickMs) ? tickMs : updatedAtMs ?? Date.now();
  const updatedAtLabel = formatReportClock(shownMs);

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
