import { createMemo, Show, type JSX } from "solid-js";
import type { DockPanelApi } from "../../components/dock/types";
import * as palette from "@/ui/palette";
import { NiftyChartPanel } from "./NiftyChartPanel";
import { NiftyWallsCard } from "./NiftyWallsCard";
import { NiftyFlowStrip } from "./NiftyFlowStrip";
import { NiftyFlowChart } from "./NiftyFlowChart";
import { IndexMoversStrip } from "./IndexMoversStrip";
import { buildFlowSeries } from "./niftyFlowSeries";
import type { NiftyReportStore } from "./niftyReportStore";
import type { ReportWindowContext } from "./reportWindowTypes";

export interface ReportWindowContentProps {
  context: ReportWindowContext;
  api: DockPanelApi;
}

/**
 * The dock titlebar already names the window. Each real panel carries its own
 * heading for the standalone report rail, so hide only that heading inside a
 * window — its actions, values and testids stay mounted.
 */
export const WINDOW_TITLE_SUPPRESSION_CLASS = [
  "[&_.report-window-inner-title]:hidden",
  "[&_[data-header-role='title']]:hidden",
  "[&_[data-compact-card-header]>span:first-child]:hidden",
  "[&_[data-compact-header]>div:first-child]:hidden",
  "[&_[data-testid='nifty-positioning-panel']>div:first-child]:hidden",
  "[&_[data-testid='movers-strip']>span:first-child>[data-report-text='label']]:hidden",
  "[&_[data-testid='nifty-flowstrip-legend']>span:first-child]:hidden",
].join(" ");

/** One scroll owner per window: the frame owns the viewport; the body only
 *  lays out children and never introduces a second scroll container. */
function WindowBody(props: { testId: string; children: JSX.Element }): JSX.Element {
  return (
    <div
      data-testid={props.testId}
      data-scroll-owner="frame"
      class={`flex h-full min-h-0 w-full min-w-0 flex-col ${WINDOW_TITLE_SUPPRESSION_CLASS}`}
    >
      {props.children}
    </div>
  );
}

function StatusLine(props: {
  testId: string;
  reason: string;
  loading?: boolean;
}): JSX.Element {
  return (
    <div
      data-testid={props.testId}
      data-state={props.loading ? "loading" : "empty"}
      role="status"
      class="flex min-h-7 w-full min-w-0 items-start gap-2 px-2 py-1 text-ui-micro"
      style={{
        "background-color": palette.SURFACE_ALT,
        color: palette.TEXT_MUTED,
      }}
    >
      <span
        class="shrink-0 font-extrabold uppercase tracking-[0.08em]"
        style={{ color: props.loading ? palette.PRIMARY : palette.TEXT_MUTED }}
      >
        {props.loading ? "LOADING" : "NO DATA"}
      </span>
      <span
        data-testid={`${props.testId}-reason`}
        class="min-w-0 whitespace-normal break-words"
      >
        {props.reason}
      </span>
    </div>
  );
}

const NO_STORE = "Report store not connected — live data unavailable here.";
const NOT_CAPTURED = "Not captured in replay";

const replaying = (store: NiftyReportStore): boolean => store.selection.mode() === "eod";

function loadingReport(store: NiftyReportStore): boolean {
  return Boolean(store.data.loading()) && !store.data.booted();
}

function maxWallsOf(store: NiftyReportStore) {
  const walls = store.walls.data();
  return walls ? { calls: walls.calls, puts: walls.puts } : null;
}

/** INDEX CHART window — the production chart panel, not a shell stand-in. */
export function ReportChartWindow(props: ReportWindowContentProps): JSX.Element {
  const store = () => props.context.reportStore;
  return (
    <WindowBody testId="report-chart-window">
      <Show
        when={store()}
        fallback={<StatusLine testId="chart-empty" reason={NO_STORE} />}
      >
        {(active) => (
          <Show
            when={active().data.report()}
            fallback={
              loadingReport(active()) ? (
                <StatusLine testId="chart-loading" reason="Loading index report…" loading />
              ) : (
                <StatusLine
                  testId="chart-empty"
                  reason={replaying(active()) ? NOT_CAPTURED : "No report data for this selection."}
                />
              )
            }
          >
            {(report) => (
              <NiftyChartPanel
                report={report()}
                mode={active().selection.mode()}
                view={active().ui.view()}
                symbol={active().selection.symbol()}
                asOf={
                  active().selection.mode() === "eod"
                    ? active().replay.frameT() ?? undefined
                    : undefined
                }
                bursts={active().data.effectiveBursts()}
                tape={active().data.tape()}
                spotPoints={active().data.oiPoints()}
                flipAt={active().data.flipAt()}
                maxWalls={maxWallsOf(active())}
                timeframe={active().ui.chartTf()}
                onTimeframeChange={(tf) => active().ui.handleChartTf(tf)}
                onSizeChange={(size) => active().ui.handleChartSize(size)}
                onExpand={props.api.commands.onExpand ?? (() => active().ui.openChartFull())}
                fillContainer
              />
            )}
          </Show>
        )}
      </Show>
    </WindowBody>
  );
}

/** OI WALLS window — the same card the report rail uses, fed by the live store. */
export function ReportWallsWindow(props: ReportWindowContentProps): JSX.Element {
  const store = () => props.context.reportStore;
  return (
    <WindowBody testId="report-walls-window">
      <Show
        when={store()}
        fallback={<StatusLine testId="walls-empty" reason={NO_STORE} />}
      >
        {(active) => (
          <Show
            when={active().walls.data()}
            fallback={
              loadingReport(active()) ? (
                <StatusLine testId="walls-loading" reason="Loading index report…" loading />
              ) : (
                <StatusLine
                  testId="walls-empty"
                  reason={replaying(active()) ? NOT_CAPTURED : "No walls snapshot for this session."}
                />
              )
            }
          >
            {(walls) => (
              <NiftyWallsCard
                walls={walls()}
                unavailableInReplay={replaying(active())}
                onExpand={props.api.commands.onExpand ?? (() => active().walls.openDrawer())}
                onOpenDesk={() => active().ui.setDeskOpen(true)}
              />
            )}
          </Show>
        )}
      </Show>
    </WindowBody>
  );
}

/** FLOW WINDOWS — the live flow strip plus its separate cumulative-flow chart. */
export function ReportFlowWindow(props: ReportWindowContentProps): JSX.Element {
  const store = () => props.context.reportStore;
  const rows = () => store()?.data.tapeRows() ?? [];
  const series = createMemo(() => buildFlowSeries(rows()));
  return (
    <WindowBody testId="report-flow-window">
      <Show
        when={store()}
        fallback={<StatusLine testId="flow-empty" reason={NO_STORE} />}
      >
        {(active) => (
          <Show
            when={rows().length > 0}
            fallback={
              loadingReport(active()) ? (
                <StatusLine testId="flow-loading" reason="Loading index report…" loading />
              ) : (
                <StatusLine
                  testId="flow-empty"
                  reason={replaying(active()) ? NOT_CAPTURED : "No flow prints captured for this session."}
                />
              )
            }
          >
            <div class="flex min-h-0 w-full min-w-0 flex-col gap-2">
              <NiftyFlowStrip rows={rows()} />
              <NiftyFlowChart series={series()} height={180} showAxis />
            </div>
          </Show>
        )}
      </Show>
    </WindowBody>
  );
}

/** INDEX MOVERS — the real strip polls its own endpoint; replay has no feed. */
export function ReportMoversWindow(props: ReportWindowContentProps): JSX.Element {
  const store = () => props.context.reportStore;
  return (
    <WindowBody testId="report-movers-window">
      <Show
        when={store()}
        fallback={<StatusLine testId="movers-empty" reason={NO_STORE} />}
      >
        {(active) => (
          <Show
            when={
              !replaying(active()) &&
              active().data.report()?.market?.is_open !== false
            }
            fallback={
              loadingReport(active()) ? (
                <StatusLine testId="movers-loading" reason="Loading index report…" loading />
              ) : (
                <StatusLine
                  testId="movers-empty"
                  reason={replaying(active()) ? NOT_CAPTURED : "Movers are unavailable for a closed session."}
                />
              )
            }
          >
            <IndexMoversStrip
              index={active().selection.index() === "sensex" ? "SENSEX" : "NIFTY"}
              onExpand={props.api.commands.onExpand ?? (() => active().ui.openMovers())}
            />
          </Show>
        )}
      </Show>
    </WindowBody>
  );
}
