import type { JSX } from "solid-js";
import { Box } from "@/ui";
import { LiveTapeDisclosure } from "./reportBits";
import type { DecisionView } from "./ReportDecisionStrip.derive";
import { DecisionStats } from "./ReportDecisionStrip.groups";
import { VerdictContent } from "./ReportDecisionStrip.hero";
import { DECISION_CONTEXT_HEIGHT } from "./ReportDecisionStrip.format";

/** The second band is the single disclosure for walls, volatility, evidence
 *  and the FLOW group. The inner gate keeps it genuinely collapsed on a phone
 *  even where the shell promotes the legacy verdict body. */
export function MoreStats(props: {
  view: DecisionView;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const view = props.view;
  return (
    <Box
      data-report-band="more-stats"
      className="w-full min-w-0 shrink-0"
      style={{ "min-height": `${DECISION_CONTEXT_HEIGHT}px` }}
    >
      <LiveTapeDisclosure
        open={props.open}
        onToggle={props.onToggle}
        testId="nifty-verdict-disclosure"
        label="MORE STATS"
        openHint="hide"
        closedHint="walls · volatility · evidence"
      >
        <Box
          className="flex flex-col gap-1 w-full min-w-0"
          style={{ display: props.open ? "flex" : "none" }}
        >
          <DecisionStats view={view} />
          <VerdictContent view={view} />
        </Box>
      </LiveTapeDisclosure>
    </Box>
  );
}
