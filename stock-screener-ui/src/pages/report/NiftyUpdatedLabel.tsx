import { Text } from "@/ui";
import { formatReportClock } from "./reportFormat";
import { useNiftySpotTick } from "./niftyStreamSolid";

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
export function NiftyUpdatedLabel(props: NiftyUpdatedLabelProps) {
  const tick = useNiftySpotTick();
  const tickMs = () => {
    const t = tick();
    return t?.ts ? Date.parse(t.ts) : NaN;
  };
  const shownMs = () => {
    const ms = tickMs();
    return Number.isFinite(ms) ? ms : (props.updatedAtMs ?? Date.now());
  };

  const label = () => {
    if (props.marketClosed) {
      return `Market closed${props.sessionDate ? ` · last session ${props.sessionDate}` : ""}`;
    }
    return `Updated ${formatReportClock(shownMs())} · live (WS)`;
  };

  return (
    <Text
      data-testid="nifty-updated-at"
      size="xs"
      c={props.isStale ? "warning" : "dimmed"}
      span
    >
      {label()}
    </Text>
  );
}
