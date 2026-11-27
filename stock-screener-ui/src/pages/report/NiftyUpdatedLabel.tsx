import { Text } from "@/ui";
import { formatReportClock } from "./reportFormat";
import { useNiftySpotTick } from "./niftyStreamSolid";

interface NiftyUpdatedLabelProps {
  marketClosed: boolean;
  sessionDate?: string | null;
  updatedAtMs: number | null;
  isStale: boolean;
}

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
    /*
     * Only claim a live feed when one is actually arriving. The header used to
     * say "· live (WS)" whenever the market was open, so during a WebSocket
     * outage it sat next to the STALE badge asserting both that the data was
     * stale and that it was live. On a trading surface that is the worst kind
     * of wrong: the numbers look current and are not.
     */
    const suffix = props.isStale ? "· reconnecting" : "· live (WS)";
    return `Updated ${formatReportClock(shownMs())} ${suffix}`;
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
