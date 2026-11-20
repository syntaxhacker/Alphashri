import { ErrorBoundary, Show, Suspense, createMemo, lazy } from "solid-js";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";
import { ReplayUnavailable } from "./BreadthStrip";
import { ReportProvider, useNiftyReport } from "./ReportContext";
import type { DeskDockTab } from "./DeskDock";
import { ReportToolbar } from "./ReportToolbar";
import {
  REPORT_FONT,
  REPORT_GUTTER,
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

// Desktop desk surface: strip / chart / dock. The chart track is 70fr so it
// lands at ~56% of the viewport after the fixed chrome (~174px above the row);
// the dock track keeps ~210px so an open drawer and the 26px tab bar both fit.
// The chart row also carries its own 58vh cap for tall viewports. Mobile keeps
// the flex-column flow unchanged.
const DESK_CONTENT_GRID_CLASS =
  "min-[1200px]:grid min-[1200px]:grid-rows-[auto_minmax(0,70fr)_minmax(0,30fr)]";

function SectionError(props: { name: string; error: unknown }) {
  return (
    <Box
      data-testid="nifty-section-error"
      style={{
        "border-left": `2px solid ${palette.NEGATIVE}`,
        "border-radius": "2px",
        "background-color": palette.TINT_NEGATIVE,
        padding: "4px 6px",
        "font-family": palette.MONO,
        "font-size": `${REPORT_FONT.micro}px`,
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
        "border-radius": "2px",
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
      class={`flex flex-col h-full min-h-0 w-full overflow-hidden ${REPORT_SECTION_ALIGN.panel}`}
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "min-height": "0px",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <Box
        {...{ [REPORT_SECTION_ATTR]: true }}
        className="w-full shrink-0"
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
          className="flex flex-wrap items-center gap-x-2 w-full min-w-0 shrink-0 min-h-6 px-2 py-[2px] text-[11px]"
          style={{
            "background-color": palette.SURFACE_ALT,
            "border-left": `2px solid ${palette.PRIMARY}`,
          }}
        >
          <Text
            size="xs"
            span
            fw={800}
            style={{ color: palette.PRIMARY, "letter-spacing": "0.08em", "white-space": "nowrap" }}
          >
            REPLAY{replayTime() ? ` ${replayTime()}` : ""}
          </Text>
          <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
            Playhead values below · live-only bands
          </Text>
          <ReplayUnavailable noun="Movers" />
          <ReplayUnavailable noun="Breadth" />
        </Box>
      </Show>

      <Show when={store.data.error()}>
        <Box style={{ padding: "4px" }}>
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
          class={`flex-1 min-h-0 flex flex-col gap-2 ${REPORT_SECTION_ALIGN.content} ${isDesk() ? `overflow-hidden ${DESK_CONTENT_GRID_CLASS}` : "overflow-auto"}`}
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
