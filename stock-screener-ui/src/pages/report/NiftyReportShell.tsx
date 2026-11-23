import { ErrorBoundary, Show, Suspense, createMemo, lazy } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";
import { ReplayUnavailable } from "./BreadthStrip";
import { ReportProvider, useNiftyReport } from "./ReportContext";
import { NiftyFuturesPanel } from "./NiftyFuturesPanel";
import { NiftyItmPeFlowPanel } from "./NiftyItmPeFlow";
import type { NiftyFutures, NiftyItmPeFlow } from "@/types/niftyReport";
import type { DeskDockTab } from "./DeskDock";
import { ReportToolbar } from "./ReportToolbar";
import {
  REPORT_FONT,
  REPORT_GUTTER,
  REPORT_PAD,
  REPORT_RADIUS,
  REPORT_SECTION_ALIGN,
  REPORT_SECTION_ATTR,
} from "./reportTokens";

// Each report section owns its own lazy boundary: the shell chrome (toolbar,
// date controls) paints from this small chunk while the heavy panels stream in
// behind height-matched skeletons.
const ReportDecisionStrip = lazy(() =>
  import("./ReportDecisionStrip").then((m) => ({ default: m.ReportDecisionStrip })),
);
const ReportStrips = lazy(() =>
  import("./ReportStrips").then((m) => ({ default: m.ReportStrips })),
);
const ReportWorkspace = lazy(() =>
  import("./ReportWorkspace").then((m) => ({ default: m.ReportWorkspace })),
);
const ReportAnalytics = lazy(() =>
  import("./ReportAnalytics").then((m) => ({ default: m.ReportAnalytics })),
);
const ReportOverlays = lazy(() =>
  import("./ReportOverlays").then((m) => ({ default: m.ReportOverlays })),
);
const NiftyPressureDesk = lazy(() =>
  import("./NiftyPressureDesk").then((m) => ({ default: m.NiftyPressureDesk })),
);

// Desktop desk surface: strip / chart / dock. The chart track is 70fr so it
// lands at ~56% of the viewport after the fixed chrome (~174px above the row);
// the dock track keeps ~210px so an open drawer and the 26px tab bar both fit.
// The chart row also carries its own 58vh cap for tall viewports. Mobile keeps
// the flex-column flow unchanged.
const DESK_CONTENT_GRID_CLASS =
  "min-[1200px]:grid min-[1200px]:grid-rows-[auto_minmax(0,70fr)_minmax(0,30fr)]";

/**
 * The stat strip's per-cell minimums are tuned for the 1600px desk — PRICE
 * alone asks for 547px — so at 390 the groups overflow the viewport and the
 * value ellipsis cuts figures mid-number (`22,363.…`, `22,4…`). Below 600px
 * the groups stack and each group's cells flow two-per-row (~180px each in a
 * 390px viewport), which holds a full 17px mono price. The ellipsis is
 * disabled: a truncated price is a wrong price. Full text stays in the DOM and
 * each cell's title/hint still carries the explanation.
 */
const REPORT_NARROW_KPI_CLASS = [
  // One group per row, each owning the full strip width (overrides the inline
  // `min-width: <sum of cell minimums>px` and the 1600-tuned flex weight).
  "max-[600px]:[&_[data-testid='nifty-decision-stats']]:flex-col",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']]:flex-nowrap!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']>*]:min-w-full!",
  // Two cells per row inside every group. Inline `flex: 1 1 0%` would otherwise
  // shrink every base to zero and keep all cells on one clipped row.
  "max-[600px]:[&_[data-testid^='nifty-stat-group-']>:last-child]:flex-wrap",
  "max-[600px]:[&_[data-testid^='nifty-stat-group-']>:last-child>*]:grow-0!",
  "max-[600px]:[&_[data-testid^='nifty-stat-group-']>:last-child>*]:shrink-0!",
  "max-[600px]:[&_[data-testid^='nifty-stat-group-']>:last-child>*]:basis-[calc(50%_-_2px)]!",
  "max-[600px]:[&_[data-testid^='nifty-stat-group-']>:last-child>*]:min-w-0!",
  // Never end a numeric readout in an ellipsis.
  "max-[600px]:[&_[data-testid$='-value']]:text-clip!",
  "max-[600px]:[&_[data-testid$='-value']]:overflow-visible!",
].join(" ");

/**
 * The phone report is a dashboard, not a vertical list of cards. The stat
 * strip's groups become titled rows and their cells read label/value on one
 * line, so the secondary stats read as a dense grid when their disclosure is
 * opened. The primary call is owned by the decision strip's hero band; the
 * shell never re-opens or hides that component's disclosures. All overrides
 * are max-width gated; 1600 keeps the tuned strip.
 */
const REPORT_NARROW_DASHBOARD_CLASS = [
  // 16px group titles beside a two-per-row cell grid (4px gutters, 8px groups).
  "max-[600px]:[&_[data-testid='nifty-decision-stats']]:gap-2!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid^='nifty-stat-group-']]:flex-row!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid^='nifty-stat-group-']]:items-start!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid^='nifty-stat-group-']]:gap-1!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-label']]:w-[88px]!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-label']]:shrink-0!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-label']]:text-ui-title!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-label']]:leading-5!",
  // 13px values, 12px labels; one line per cell, no second border per cell.
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-cells']]:flex-1!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-cells']]:gap-1!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-cells']>*]:flex-row!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-cells']>*]:items-center!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-cells']>*]:justify-between!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-cells']>*]:gap-2!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-cells']>*]:min-w-0!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-cells']>*]:border-l-0!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-cells']>*]:px-1!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-cells']>*]:py-0.5!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-cells']>*>*:first-child]:text-ui-micro!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-value']]:text-ui-body!",
  "max-[600px]:[&_[data-testid='nifty-decision-stats']_[data-testid$='-value']]:shrink-0!",
  // The decision strip owns the default-visible hero call. Its "MORE STATS"
  // disclosure stays deliberately collapsed; the shell does not reach into it.
].join(" ");

/**
 * Phone paint order. The DOM already follows the phone reading order
 * (stat → chart → flow → strips → analytics), so only the bands the decision
 * strip and desk dock return as default-order siblings need an explicit slot;
 * without one they would paint above the hero. Values stay unique so no two
 * bands tie for a viewport position. Focus order follows the DOM, so no
 * positive tabindex is needed (or allowed).
 *
 * The dock's rule carries the breakpoint as a trailing variant so the
 * chart-first rhythm contract keeps its single `max-[600px]:order-3` literal.
 */
const REPORT_MOBILE_ORDER_CLASS = [
  "max-[600px]:[&_[data-testid='nifty-stat-strip']]:order-1",
  "max-[600px]:[&_[data-testid='nifty-main-row']]:order-2",
  "[&_[data-testid='desk-dock-region']]:max-[600px]:order-3",
  // The flow-windows band is a disclosure wrapper with no band testid of its
  // own. :has() pins the wrapper that owns the panel without reaching into the
  // disclosure's open state (a force-open rule would desync its toggle).
  "max-[600px]:[&_[data-open]:has([data-testid='nifty-flow-windows'])]:order-4",
  // Decision-strip tail: these were the default-order siblings above the fold.
  "max-[600px]:[&_[data-testid='movers-strip']]:order-6",
  "max-[600px]:[&_[data-testid='nifty-context-rail']]:order-7",
  "max-[600px]:[&_[data-testid='nifty-setup-radar']]:order-8",
  "max-[600px]:[&_[data-testid='nifty-report-strips']]:order-9",
  "max-[600px]:[&_[data-testid='nifty-analytics-row']]:order-10",
  "max-[600px]:[&_[data-testid='nifty-iv-skew-row']]:order-11",
].join(" ");

/**
 * The desk keeps the same paint sequence as the old DOM (hero → decision tail
 * → flow → chart → rail → dock). With the DOM in phone order, negative orders
 * restore it without moving a lazy boundary or changing a 1600 grid row: the
 * hero leads, its own tail follows, and the flow band keeps its slot just above
 * the chart.
 */
const REPORT_DESK_FLOW_FIRST_CLASS = [
  "min-[1200px]:[&_[data-testid='nifty-stat-strip']]:-order-3",
  "min-[1200px]:[&_[data-testid='nifty-flow-windows-disclosure']]:-order-2",
  "min-[1200px]:[&_[data-testid='movers-strip']]:-order-2",
  "min-[1200px]:[&_[data-testid='nifty-context-rail']]:-order-2",
  "min-[1200px]:[&_[data-testid='nifty-setup-radar']]:-order-2",
].join(" ");

/**
 * Two low-value bands cost the phone its first viewport: an unavailable movers
 * strip is a 24px duplicate of the replay banner's "MOVERS unavailable" note,
 * and the dock wraps to five rows at 390. Hide the placeholder (the populated
 * strip is the one carrying `data-report-spacing`) and keep DESK BAY as one
 * scrollable row. Both rules are max-width gated; 1600 keeps its tuned rhythm.
 */
const REPORT_MOBILE_UNAVAILABLE_CLASS = [
  "max-[600px]:[&_[data-testid='movers-strip']:not([data-report-spacing])]:hidden!",
  "max-[600px]:[&_[data-testid='desk-dock']]:flex-nowrap!",
  "max-[600px]:[&_[data-testid='desk-dock']]:overflow-x-auto!",
].join(" ");

/**
 * Shell-owned chrome is spent only on the hand-off between the compact toolbar
 * (whose own primary row / overflow cue it must never clip) and the data. The
 * replay band loses its extra inset on a phone; its full text stays mounted.
 */
const REPORT_MOBILE_CHROME_CLASS = [
  "max-[600px]:[&_[data-testid='nifty-report-content']]:gap-1!",
  "max-[600px]:[&_[data-testid='nifty-report-content']]:pt-1!",
  "max-[600px]:[&_[data-testid='nifty-replay-mode-banner']]:gap-x-2!",
  "max-[600px]:[&_[data-testid='nifty-replay-mode-banner']]:py-1!",
].join(" ");

/**
 * The replay banner is the one shell-owned band with a title. Promote that
 * title to the 16px value step and leave the explanation at the 12px floor so
 * the band reads as heading + note, not two equal-weight micro labels.
 */
const REPLAY_TITLE_STYLE: JSX.CSSProperties = {
  color: palette.PRIMARY,
  "font-size": `${REPORT_FONT.value}px`,
  "font-weight": 800,
  "letter-spacing": "0.06em",
  "line-height": 1.2,
  "white-space": "nowrap",
};

const REPLAY_NOTE_STYLE: JSX.CSSProperties = {
  color: palette.TEXT_MUTED,
  "font-size": `${REPORT_FONT.micro}px`,
  "line-height": 1.35,
};

/**
 * Futures basis and ITM premium flow sit above the chart because both explain
 * the same question the chart answers: *why* did spot move. A block the payload
 * does not carry is not painted at all — a placeholder row above the chart is
 * worse than no row.
 */
function ReportFlowRow(props: {
  futures: NiftyFutures | null;
  itm: NiftyItmPeFlow | null;
  spot: number;
}) {
  const hasFutures = () => props.futures != null;
  const hasItm = () => props.itm != null;

  return (
    <Show when={hasFutures() || hasItm()}>
      <Box
        data-testid="nifty-flow-above-chart"
        className="grid grid-cols-1 gap-2 w-full max-w-full min-w-0 shrink-0 max-[600px]:order-5 min-[1200px]:-order-1"
        classList={{ "min-[1200px]:grid-cols-2": hasFutures() && hasItm() }}
      >
        <Show when={hasFutures()}>
          <NiftyFuturesPanel futures={props.futures} />
        </Show>
        <Show when={hasItm()}>
          <NiftyItmPeFlowPanel flow={props.itm} spot={props.spot} />
        </Show>
      </Box>
    </Show>
  );
}

function SectionError(props: { name: string; error: unknown }) {
  return (
    <Box
      data-testid="nifty-section-error"
      style={{
        "border-left": `2px solid ${palette.NEGATIVE}`,
        "border-radius": `${REPORT_RADIUS.xs}px`,
        "background-color": palette.TINT_NEGATIVE,
        padding: `${REPORT_PAD.md}px ${REPORT_PAD.lg}px`,
        "font-family": palette.MONO,
        "font-size": `${REPORT_FONT.body}px`,
        "line-height": "1.4",
        "letter-spacing": "0.02em",
        color: palette.TEXT,
        "white-space": "pre-wrap",
      }}
    >
      {props.name} failed: {props.error instanceof Error ? props.error.message : String(props.error)}
    </Box>
  );
}

/** Height-matched placeholder for a streaming section. */
function PanelSkeleton(props: { h: number }) {
  return (
    <Box
      class="w-full min-w-0 shrink-0"
      style={{
        height: `${props.h}px`,
        "background-color": palette.SURFACE_ALT,
        "border-radius": `${REPORT_RADIUS.xs}px`,
      }}
    />
  );
}

function ReportBody() {
  const store = useNiftyReport();
  const isDesk = () => store.ui.isDesk();
  const replayTime = createMemo(() => {
    const t = store.replay.frameT?.();
    return typeof t === "string" && t.length >= 16 ? t.slice(11, 16) : null;
  });

  // The desk surface keeps only the decision strip and the chart above the
  // fold. Low-frequency bands that used to stack above the chart are one dock
  // click away instead; research mode keeps its expanded reading layout.
  const secondaryTabs = createMemo<DeskDockTab[]>(() => {
    if (!isDesk()) return [];
    return [
      {
        key: "strips",
        label: "DESK",
        summary: <span>walls · breadth</span>,
        get content() {
          return (
            <Suspense fallback={<PanelSkeleton h={200} />}>
              <ReportStrips />
            </Suspense>
          );
        },
      },
      {
        key: "analytics",
        label: "DATA",
        summary: <span>tape · flow</span>,
        get content() {
          return (
            <Suspense fallback={<PanelSkeleton h={200} />}>
              <ReportAnalytics />
            </Suspense>
          );
        },
      },
    ];
  });

  return (
    <Box
      data-testid="nifty-report-panel"
      class={`flex flex-col h-full min-h-0 w-full overflow-hidden ${REPORT_SECTION_ALIGN.panel} ${REPORT_NARROW_KPI_CLASS} ${REPORT_NARROW_DASHBOARD_CLASS} ${REPORT_MOBILE_CHROME_CLASS}`}
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "min-height": "0px",
        width: "100%",
        overflow: "hidden",
      }}
    >
      {/* Desktop: 8px under the toolbar hairline + the content's 7px inset.
          At 390 both insets drop to 4px so the strip starts one 8px break
          below the compact toolbar instead of a 16px one. */}
      <Box
        {...{ [REPORT_SECTION_ATTR]: true }}
        id="nifty-report-chrome"
        data-compact-chrome="true"
        className="w-full shrink-0 pb-2 max-[600px]:pb-1! max-[600px]:overflow-visible!"
        data-left-edge={String(REPORT_GUTTER.inline)}
        style={{ "padding-left": `${REPORT_GUTTER.inline}px` }}
      >
        <ReportToolbar />
      </Box>

      {/* One persistent legend for the whole replay surface: the numbers below
          are sampled at the playhead, while the live-only bands are absent.
          Per-panel labels alone cannot say this about the stat strip. */}
      <Show when={store.selection.mode() === "eod"}>
        <Box
          data-testid="nifty-replay-mode-banner"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 w-full min-w-0 shrink-0 px-3 py-2 text-ui-micro"
          style={{
            "background-color": palette.SURFACE_ALT,
            "border-left": `2px solid ${palette.PRIMARY}`,
          }}
        >
          <Text span fw={800} style={REPLAY_TITLE_STYLE}>
            REPLAY{replayTime() ? ` ${replayTime()}` : ""}
          </Text>
          <Text span style={REPLAY_NOTE_STYLE}>
            Playhead values below · live-only bands
          </Text>
          <ReplayUnavailable noun="Movers" />
          <ReplayUnavailable noun="Breadth" />
        </Box>
      </Show>

      <Show when={store.data.error()}>
        <Box style={{ padding: `${REPORT_PAD.md}px` }}>
          <ErrorAlert message={store.data.error() ?? ""} onRetry={() => void store.data.refresh()} withRetry />
        </Box>
      </Show>

      <Show
        when={store.data.report()}
        fallback={
          <Box class="flex-1 min-h-0" style={{ flex: 1, "min-height": "0px" }}>
            <Show
              when={store.data.loading() || !store.data.booted()}
              fallback={
                <EmptyState
                  title="No report for this selection"
                  description="Pick another symbol, expiry or session date to load a report."
                  data-testid="nifty-report-empty"
                />
              }
            >
              <InlineLoader data-testid="nifty-report-loading" message="Loading index report" />
            </Show>
          </Box>
        }
      >
        <Box
          data-testid="nifty-report-content"
          data-left-edge={String(REPORT_GUTTER.inline)}
          class={`flex-1 min-h-0 flex flex-col gap-2 ${REPORT_SECTION_ALIGN.content} ${REPORT_MOBILE_ORDER_CLASS} ${REPORT_DESK_FLOW_FIRST_CLASS} ${REPORT_MOBILE_UNAVAILABLE_CLASS} ${isDesk() ? `overflow-hidden ${DESK_CONTENT_GRID_CLASS}` : "overflow-auto"}`}
          style={{
            flex: 1,
            "min-height": "0px",
            display: "flex",
            "flex-direction": "column",
            gap: `${REPORT_GUTTER.section}px`,
            overflow: isDesk() ? "hidden" : "auto",
            // Keep the horizontal gutter that defines the shared left edge.
            // The toolbar section keeps a 1px top hairline; a top inset one
            // pixel short makes the measured section gap exactly 8px.
            padding: `${REPORT_GUTTER.section - 1}px ${REPORT_GUTTER.inline}px ${REPORT_GUTTER.section}px`,
          }}
        >
          <ErrorBoundary fallback={(err) => <SectionError name="decision strip" error={err} />}>
            <Suspense fallback={<PanelSkeleton h={48} />}>
              <ReportDecisionStrip />
            </Suspense>
          </ErrorBoundary>
          <ErrorBoundary fallback={(err) => <SectionError name="workspace" error={err} />}>
            <Suspense fallback={<PanelSkeleton h={320} />}>
              <ReportWorkspace secondaryTabs={secondaryTabs()} />
            </Suspense>
          </ErrorBoundary>
          {/* Phone reading order: the chart precedes the futures / ITM detail.
              The desk restores flow-above-chart with a breakpoint-only order. */}
          <ErrorBoundary fallback={(err) => <SectionError name="flow panels" error={err} />}>
            <ReportFlowRow
              futures={store.data.report()?.futures ?? null}
              itm={store.data.report()?.itm_pe_flow ?? null}
              spot={store.data.report()?.spot ?? 0}
            />
          </ErrorBoundary>
          <Show when={!isDesk()}>
            <ErrorBoundary fallback={(err) => <SectionError name="desk strips" error={err} />}>
              <Suspense fallback={<PanelSkeleton h={150} />}>
                <ReportStrips />
              </Suspense>
            </ErrorBoundary>
            <ErrorBoundary fallback={(err) => <SectionError name="analytics" error={err} />}>
              <Suspense fallback={<PanelSkeleton h={200} />}>
                <ReportAnalytics />
              </Suspense>
            </ErrorBoundary>
          </Show>
        </Box>
      </Show>

      <ErrorBoundary fallback={(err) => <SectionError name="overlays" error={err} />}>
        <Suspense fallback={null}>
          <ReportOverlays />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={(err) => <SectionError name="pressure desk" error={err} />}>
        <Suspense fallback={null}>
          <NiftyPressureDesk
            open={store.ui.deskOpen()}
            walls={store.walls.data()}
            onClose={() => store.ui.setDeskOpen(false)}
          />
        </Suspense>
      </ErrorBoundary>
    </Box>
  );
}

export function NiftyReportShell(props: { onOpenSymbol?: (s: string) => void }) {
  return (
    <ReportProvider onOpenSymbol={props.onOpenSymbol}>
      <ReportBody />
    </ReportProvider>
  );
}
