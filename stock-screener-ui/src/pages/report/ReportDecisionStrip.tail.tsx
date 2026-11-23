import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box } from "@/ui";
import { NiftyFlowWindows } from "./NiftyFlowWindows";
import { IndexMoversStrip } from "./IndexMoversStrip";
import { NiftyIntelStrip } from "./NiftyIntelStrip";
import { NiftyGammaStrip } from "./NiftyGammaStrip";
import { SetupRadarStrip } from "./SetupRadarStrip";
import { LiveTapeDisclosure } from "./reportBits";
import { REPORT_SECTION_ATTR } from "./reportTokens";
import type { DecisionView } from "./ReportDecisionStrip.derive";
import { RailClaim, TapeBadgeControl } from "./ReportDecisionStrip.hero";

/** SESSION/15m/5m flow stacks to ~144px on a phone. Collapse it behind the
 *  same disclosure the tape bands use so the chart row keeps that height. */
export function FlowWindowsSection(props: {
  view: DecisionView;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const view = props.view;
  return (
    <Show when={view.flowReport()}>
      {(flow) => (
        <Show
          when={view.narrow()}
          fallback={
            <Box {...{ [REPORT_SECTION_ATTR]: true }} className="contents">
              <NiftyFlowWindows
                report={flow()}
                lastFlip={view.lastFlip()}
                showSessionValue={view.symbol() === "NIFTY"}
              />
            </Box>
          }
        >
          <LiveTapeDisclosure
            open={props.open}
            onToggle={props.onToggle}
            testId="nifty-flow-windows-disclosure"
            label="FLOW WINDOWS"
            openHint="hide"
            closedHint="session · 15m · 5m"
          >
            <NiftyFlowWindows
              report={flow()}
              lastFlip={view.lastFlip()}
              showSessionValue={view.symbol() === "NIFTY"}
            />
          </LiveTapeDisclosure>
        </Show>
      )}
    </Show>
  );
}

export function MoversSection(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  return (
    <Show when={view.symbol() === "NIFTY" || view.symbol() === "SENSEX"}>
      <Box {...{ [REPORT_SECTION_ATTR]: true }} className="contents">
        <IndexMoversStrip
          index={view.symbol() === "NIFTY" ? "NIFTY" : "SENSEX"}
          onExpand={view.store.ui.openMovers}
          liveOnly={view.mode() === "eod" || view.report()?.market?.is_open === false}
        />
      </Box>
    </Show>
  );
}

/** Non-desk research rail: the same decision read, intel and gamma strips. */
export function ContextRail(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  return (
    <Show when={!view.isDesk()}>
      <Box
        data-testid="nifty-context-rail"
        className="flex items-stretch gap-0.5 w-full max-w-full min-w-0 shrink-0 max-[600px]:flex-col max-[600px]:[&>*]:flex-none max-[600px]:[&>*]:w-full"
      >
        <Show when={view.planSummary() != null}>
          <Box className="flex-[38_1_0] min-w-0 flex [&>*]:w-full [&>*]:min-w-0">
            <Box className="flex items-center gap-1 min-w-0">
              <RailClaim view={view} />
              <TapeBadgeControl view={view} />
            </Box>
          </Box>
        </Show>
        <Show when={view.symbol() === "NIFTY"}>
          <Box
            data-testid="nifty-intel-cell"
            className="flex-[34_1_0] min-w-0 flex [&>*]:w-full [&>*]:min-w-0"
          >
            <NiftyIntelStrip
              date={view.mode() === "eod" ? view.date() || null : null}
              expiry={view.expiry() === "nearest" ? null : view.expiry()}
              eod={view.mode() === "eod"}
            />
          </Box>
        </Show>
        <Box
          data-testid="nifty-gamma-cell"
          className="flex-[28_1_0] min-w-0 flex [&>*]:w-full [&>*]:min-w-0"
        >
          <NiftyGammaStrip
            gex={view.gexForDisplay()}
            positioning={view.report()?.positioning}
            spot={view.report()?.spot ?? 0}
          />
        </Box>
      </Box>

      <SetupRadarStrip read={view.setup()} preMove={view.preMove()} />
    </Show>
  );
}
