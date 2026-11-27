import { Show, createSignal } from "solid-js";
import { Box, useMediaQuery } from "@/ui";
import { useNiftyReport } from "./ReportContext";
import { REPORT_SECTION_ATTR } from "./reportTokens";
import { createDecisionView } from "./ReportDecisionStrip.derive";
import { DecisionHero } from "./ReportDecisionStrip.hero";
import { MoreStats } from "./ReportDecisionStrip.moreStats";
import { ContextRail, FlowWindowsSection, MoversSection } from "./ReportDecisionStrip.tail";
import { DECISION_STRIP_STYLE } from "./ReportDecisionStrip.format";

// Stable public surface: every decision/closed-state contract, constant and
// pure helper keeps its import path through the facade.
export * from "./ReportDecisionStrip.format";

export function ReportDecisionStrip() {
  const store = useNiftyReport();
  const narrow = useMediaQuery("(max-width: 600px)");
  // SESSION/15m/5m flow and the legacy verdict body each collapse behind one
  // disclosure so the chart row keeps its height on a phone.
  const [flowOpen, setFlowOpen] = createSignal(false);
  const [verdictOpen, setVerdictOpen] = createSignal(false);

  const view = createDecisionView(store, narrow);

  return (
    <Show when={view.report()}>
      <Box
        data-testid="nifty-stat-strip"
        {...{ [REPORT_SECTION_ATTR]: true }}
        className="flex flex-col border border-[var(--desk-border)] rounded-[4px] overflow-hidden w-full max-w-full min-w-0 shrink-0 px-2"
        style={DECISION_STRIP_STYLE}
      >
        {/* The first viewport gets one decision band. Everything below it is
            detail and stays behind the single More stats disclosure. */}
        <DecisionHero view={view} />
        <MoreStats
          view={view}
          open={verdictOpen()}
          onToggle={() => setVerdictOpen((v) => !v)}
        />
      </Box>

      <FlowWindowsSection
        view={view}
        open={flowOpen()}
        onToggle={() => setFlowOpen((v) => !v)}
      />
      <MoversSection view={view} />
      <ContextRail view={view} />
    </Show>
  );
}
