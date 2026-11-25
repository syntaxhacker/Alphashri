import {
  ErrorBoundary,
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  untrack,
} from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button, Text, TYPE_CLASS } from "@/ui";
import * as palette from "@/ui/palette";
import { ErrorAlert, InlineLoader } from "@/components/common/states";
import { ReportProvider, useNiftyReport } from "./ReportContext";
import { NiftyFuturesPanel } from "./NiftyFuturesPanel";
import { NiftyItmPeFlowPanel } from "./NiftyItmPeFlow";
import { istSessionDate } from "./niftyDataFreshness";
import { formatReportClock, REPORT_DASH } from "./reportFormat";
import type { DeskDockTab } from "./DeskDock";
import { ReportToolbar } from "./ReportToolbar";
import type { CanvasSize } from "../../components/window/layout";
import type { WindowLayout } from "../../components/window/types";
import type { SavedConfigTransport } from "../../state/savedConfig";
import { ReportWindowDesk } from "./ReportWindowDesk";
import { defaultReportLayout, useReportWindowConfig } from "./reportWindowConfig";
import { getReportPreset, resolveReportPreset } from "./reportWindowPresets";
import {
  REPORT_FONT,
  REPORT_GUTTER,
  REPORT_PAD,
  REPORT_RADIUS,
  REPORT_REPLAY_STRIP_HEIGHT,
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

// Desktop desk surface: strip / chart / rail+dock. The bottom track is content
// sized: the walls rail collapses to one line when no snapshot exists, so a
// fractional bottom track used to reserve ~150px of dead space under the chart.
// `1fr` gives every reclaimed pixel to the chart row; the dock is an overlay
// drawer inside its own band, so it needs no fixed reserve. Mobile keeps the
// flex-column flow unchanged.
const DESK_CONTENT_GRID_CLASS =
  "min-[1200px]:grid min-[1200px]:grid-rows-[auto_minmax(0,1fr)_auto]";

/**
 * LEVEL 1 focus changes layout only — the chart and chain stay mounted, and
 * the report's own scroll container stays the single scroll owner. Every
 * low-frequency band (including the pinned hero) collapses via CSS so no
 * lazy boundary is torn down when F is pressed or restored with Esc.
 */
const REPORT_CHART_FOCUS_CLASS = [
  "[&_[data-testid='nifty-decision-hero']]:hidden!",
  "[&_[data-testid='nifty-kpi-hero']]:hidden!",
  "[&_[data-testid='nifty-stat-strip']]:hidden!",
  "[&_[data-testid='nifty-flow-windows-disclosure']]:hidden!",
  "[&_[data-testid='movers-strip']]:hidden!",
  "[&_[data-testid='nifty-context-rail']]:hidden!",
  "[&_[data-testid='nifty-setup-radar']]:hidden!",
  "[&_[data-testid='desk-dock-region']]:hidden!",
  "[&_[data-testid='nifty-side-col']]:hidden!",
  "[&_[data-testid='nifty-report-strips']]:hidden!",
  "[&_[data-testid='nifty-analytics-row']]:hidden!",
  "[&_[data-testid='nifty-iv-skew-row']]:hidden!",
  "[&_[data-testid='nifty-replay-mode-banner']]:hidden!",
  "[&_[data-testid='nifty-main-row']]:flex-1!",
  "[&_[data-testid='nifty-main-row']]:min-[1200px]:grid-cols-[minmax(0,1fr)]!",
].join(" ");

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
  // The decision band is one 32px row at every width; its detail is a fixed
  // popover, so a phone must never turn the band into a wrapping in-flow block.
  "max-[600px]:[&_[data-testid='nifty-kpi-hero']]:flex-nowrap!",
  "max-[600px]:[&_[data-testid='nifty-kpi-hero']]:overflow-visible!",
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
  "max-[600px]:[&_[data-testid='nifty-replay-mode-banner']]:px-2!",
  "max-[600px]:[&_[data-testid='nifty-report-empty']]:px-2!",
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

/** The no-payload state owns one reason line. When a recorded snapshot exists
 *  it names its clock and session so a closed feed is not read as a missing
 *  report; without one it says so plainly. One left rail, no nested card. */
function NoReportState(props: { reason: string }) {
  return (
    <Box
      data-testid="nifty-report-empty"
      className="w-full min-w-0 px-3 py-2"
      style={{ "border-left": `2px solid ${palette.TEXT_MUTED}` }}
    >
      <Text span className={`${TYPE_CLASS.micro} block font-bold`} style={{ color: palette.TEXT }}>
        No report for this selection
      </Text>
      <Text
        span
        data-testid="nifty-report-empty-reason"
        className={`${TYPE_CLASS.micro} block whitespace-normal`}
        style={{ color: palette.TEXT_MUTED }}
      >
        {props.reason}
      </Text>
    </Box>
  );
}

interface ReportBodyProps {
  transport?: SavedConfigTransport;
  canvas?: CanvasSize;
}

function ReportBody(props: ReportBodyProps) {
  const store = useNiftyReport();
  const isDesk = () => store.ui.isDesk();
  const isWindowDesk = () => store.ui.isWindowDesk();
  const windowConfig = useReportWindowConfig({ transport: props.transport });
  const [presetId, setPresetId] = createSignal("");
  // Until the user picks a preset or moves a frame, the first desk visit opens
  // the full six-panel workspace rather than the foundation's smaller seed. A
  // layout is only persisted once it is actually authored by the user.
  const [deskTouched, setDeskTouched] = createSignal(false);
  const deskLayout = createMemo<WindowLayout>(() => {
    const current = windowConfig.layout();
    if (deskTouched()) return current;
    const full = getReportPreset("full");
    return full
      ? { ...current, windows: resolveReportPreset(full, windowConfig.canvas()) }
      : current;
  });
  const applyPreset = (id: string) => {
    const preset = getReportPreset(id);
    if (!preset) return;
    setDeskTouched(true);
    const current = windowConfig.layout();
    windowConfig.setLayout({
      ...current,
      windows: resolveReportPreset(preset, windowConfig.canvas()),
    });
    setPresetId(id);
  };
  const commitDeskLayout = (next: WindowLayout) => {
    setDeskTouched(true);
    windowConfig.setLayout(next);
  };
  // A saved desk (including a deliberately empty one) is already authored. Only
  // the untouched first-run seed gets the fuller six-panel overlay.
  createEffect(() => {
    if (!windowConfig.hydrated() || deskTouched()) return;
    const current = windowConfig.layout();
    if (current.windows.length === 0) {
      setDeskTouched(true);
      return;
    }
    const seed = defaultReportLayout(windowConfig.canvas()).windows;
    const isSeed =
      current.windows.length === seed.length &&
      current.windows.every((win, index) => win.type === seed[index]?.type);
    if (!isSeed) setDeskTouched(true);
  });

  // The four store-dependent report panels (chart / walls / flow / movers) read
  // the live store from Solid context, which the window registry cannot reach.
  // Hand it through the desk's context bag so those frames render real content.
  createEffect(() => {
    const previous = untrack(() => windowConfig.context());
    windowConfig.setContext({ ...previous, reportStore: store });
  });
  // Some section-level suites mount the shell with a partial UI mock; keep the
  // focus read tolerant so a missing accessor reads as "not focused".
  const focus = () =>
    typeof store.ui.overlayOpen === "function" && store.ui.overlayOpen("chartFocus");
  const replayTime = createMemo(() => {
    const t = store.replay.frameT?.();
    return typeof t === "string" && t.length >= 16 ? t.slice(11, 16) : null;
  });
  // The toolbar's `SNAPSHOT 21:25` and this reason read the same clock. Naming
  // the session keeps a stored snapshot from being mistaken for a live report.
  // With no usable snapshot the reason is its own honest sentence — repeating
  // the title ("No report for this selection") reads as duplicated copy.
  const NO_SNAPSHOT_REASON = "The report request failed. Retry or pick another selection.";
  const noReportReason = createMemo(() => {
    const updatedAtMs = store.data.freshness?.updatedAtMs?.();
    if (typeof updatedAtMs !== "number" || !Number.isFinite(updatedAtMs)) {
      return NO_SNAPSHOT_REASON;
    }
    const clock = formatReportClock(updatedAtMs);
    if (!clock || clock === REPORT_DASH) return NO_SNAPSHOT_REASON;
    return `Snapshot ${clock.slice(0, 5)} · ${istSessionDate(updatedAtMs)} — no live report for this selection`;
  });

  const setFocusOpen = (next: boolean) => store.ui.setOverlayOpen?.("chartFocus", next);
  const closeChartFocus = () => setFocusOpen(false);

  // The two ~190px analytics panels moved out of the chart flow into the same
  // dock every other low-frequency panel uses. A panel with no recorded data
  // gets no tab — an empty drawer is worse than no tab.
  const secondaryTabs = createMemo<DeskDockTab[]>(() => {
    const current = store.data.report();
    const futures = current?.futures ?? null;
    const itm = current?.itm_pe_flow ?? null;
    const tabs: DeskDockTab[] = [];
    if (futures) {
      tabs.push({
        key: "futures",
        label: "Futures basis",
        summary: <span>spot · oi</span>,
        get content() {
          return <NiftyFuturesPanel futures={futures} />;
        },
      });
    }
    if (itm) {
      tabs.push({
        key: "itm",
        label: "ITM PE flow",
        summary: <span>premium</span>,
        get content() {
          return <NiftyItmPeFlowPanel flow={itm} spot={current?.spot ?? 0} />;
        },
      });
    }
    if (!isDesk()) return tabs;
    return [
      ...tabs,
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
      data-chart-focus={focus() ? "true" : "false"}
      class={`flex flex-col h-full min-h-0 w-full overflow-hidden ${REPORT_SECTION_ALIGN.panel} ${REPORT_NARROW_KPI_CLASS} ${REPORT_NARROW_DASHBOARD_CLASS} ${REPORT_MOBILE_CHROME_CLASS} ${focus() ? REPORT_CHART_FOCUS_CLASS : ""}`}
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
        <ReportToolbar presetId={presetId()} onPresetChange={applyPreset} />
      </Box>

      {/* One persistent legend for the whole replay surface: the numbers below
          are sampled at the playhead, while the live-only bands are absent.
          Per-panel labels alone cannot say this about the stat strip. */}
      <Show when={store.selection.mode() === "eod"}>
        <Box
          data-testid="nifty-replay-mode-banner"
          className="flex flex-nowrap items-center gap-x-2 w-full min-w-0 shrink-0 px-3 text-ui-micro"
          style={{
            height: `${REPORT_REPLAY_STRIP_HEIGHT}px`,
            "min-height": `${REPORT_REPLAY_STRIP_HEIGHT}px`,
            "background-color": palette.SURFACE_ALT,
            "border-left": `2px solid ${palette.PRIMARY}`,
          }}
        >
          <Text span fw={800} style={REPLAY_TITLE_STYLE}>
            REPLAY{replayTime() ? ` ${replayTime()}` : ""}
          </Text>
          <Text span style={REPLAY_NOTE_STYLE}>
            Playhead values · live-only bands hidden
          </Text>
        </Box>
      </Show>

      <Show when={store.data.error()}>
        <Box style={{ padding: `${REPORT_PAD.md}px` }}>
          <ErrorAlert message={store.data.error() ?? ""} onRetry={() => void store.data.refresh()} withRetry />
        </Box>
      </Show>

      <Show when={isWindowDesk()}>
        <Box
          data-testid="nifty-report-window-desk-region"
          class="flex-1 min-h-0 w-full min-w-0"
          style={{ flex: 1, "min-height": "0px", overflow: "hidden" }}
        >
          <ReportWindowDesk
            layout={deskLayout()}
            onLayoutChange={commitDeskLayout}
            context={() => windowConfig.context()}
            canvas={windowConfig.canvas()}
            onCanvasChange={(size) => {
              const current = windowConfig.canvas();
              if (current?.w === size.w && current?.h === size.h) return;
              windowConfig.setCanvas(size);
            }}
          />
        </Box>
      </Show>

      <Show when={!isWindowDesk()}>
        <Show
          when={store.data.report()}
          fallback={
            <Box class="flex-1 min-h-0" style={{ flex: 1, "min-height": "0px" }}>
              <Show
                when={store.data.loading() || !store.data.booted()}
                fallback={<NoReportState reason={noReportReason()} />}
              >
                <InlineLoader data-testid="nifty-report-loading" message="Loading index report" />
              </Show>
            </Box>
          }
        >
          <Box
            data-testid="nifty-report-content"
            data-left-edge={String(REPORT_GUTTER.inline)}
            class={`flex-1 min-h-0 flex flex-col gap-2 ${REPORT_SECTION_ALIGN.content} ${REPORT_MOBILE_ORDER_CLASS} ${REPORT_DESK_FLOW_FIRST_CLASS} ${REPORT_MOBILE_UNAVAILABLE_CLASS} ${isDesk() ? `overflow-y-auto overflow-x-hidden ${DESK_CONTENT_GRID_CLASS}` : "overflow-auto"}`}
            style={{
              flex: 1,
              "min-height": "0px",
              display: "flex",
              "flex-direction": "column",
              gap: `${REPORT_GUTTER.section}px`,
              overflow: "auto",
              "overflow-y": "auto",
              "overflow-x": isDesk() ? "hidden" : "auto",
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

          <Show when={focus()}>
            <Box className="flex shrink-0 justify-end w-full min-w-0 px-1 pb-1">
              <Button
                data-testid="nifty-chart-focus-exit"
                type="button"
                size="sm"
                onClick={closeChartFocus}
                aria-label="Exit chart focus (Escape)"
                style={{
                  "background-color": palette.SURFACE_ALT,
                  color: palette.TEXT,
                  "font-size": `${REPORT_FONT.micro}px`,
                  "font-weight": 800,
                }}
              >
                EXIT FOCUS · ESC
              </Button>
            </Box>
          </Show>
        </Show>
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

export interface NiftyReportShellProps extends ReportBodyProps {
  onOpenSymbol?: (s: string) => void;
}

export function NiftyReportShell(props: NiftyReportShellProps) {
  return (
    <ReportProvider onOpenSymbol={props.onOpenSymbol}>
      <ReportBody transport={props.transport} canvas={props.canvas} />
    </ReportProvider>
  );
}
