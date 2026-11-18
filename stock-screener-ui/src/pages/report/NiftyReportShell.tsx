import { ErrorBoundary, Show, Suspense, lazy } from "solid-js";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyFutures, NiftyItmPeFlow } from "@/types/niftyReport";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";
import { ReportProvider, useNiftyReport } from "./ReportContext";
import { ReportToolbar } from "./ReportToolbar";
import { NiftyFuturesPanel } from "./NiftyFuturesPanel";
import { NiftyItmPeFlowPanel } from "./NiftyItmPeFlow";

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

function SectionError(props: { name: string; error: unknown }) {
  return (
    <Box
      data-testid="nifty-section-error"
      style={{
        border: "1px solid " + palette.NEGATIVE,
        "border-radius": "2px",
        padding: "4px 6px",
        "font-family": palette.MONO,
        "font-size": "10px",
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

/**
 * Futures positioning and ITM put flow sit side by side directly above the
 * chart: they answer "who is positioned how" before the price panel answers
 * "where did it go". A block that is absent (older backend) is not painted at
 * all — an empty placeholder row above the chart is worse than no row.
 */
export function ReportFlowRow(props: {
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
        class="grid grid-cols-1 gap-1 w-full max-w-full min-w-0 shrink-0"
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

function ReportBody() {
  const store = useNiftyReport();

  return (
    <Box
      data-testid="nifty-report-panel"
      class="flex flex-col h-full min-h-0 w-full overflow-hidden"
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "min-height": "0px",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <ReportToolbar />

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
          class="flex-1 min-h-0 flex flex-col gap-1 overflow-auto"
          style={{
            flex: 1,
            "min-height": "0px",
            display: "flex",
            "flex-direction": "column",
            gap: "4px",
            overflow: "auto",
            padding: "4px",
          }}
        >
          <ErrorBoundary fallback={(err) => <SectionError name="decision strip" error={err} />}>
            <Suspense fallback={<PanelSkeleton h={48} />}>
              <ReportDecisionStrip />
            </Suspense>
          </ErrorBoundary>
          <ErrorBoundary fallback={(err) => <SectionError name="flow panels" error={err} />}>
            <Show when={store.data.report()}>
              {(current) => (
                <ReportFlowRow
                  futures={current().futures ?? null}
                  itm={current().itm_pe_flow ?? null}
                  spot={current().spot}
                />
              )}
            </Show>
          </ErrorBoundary>
          <ErrorBoundary fallback={(err) => <SectionError name="workspace" error={err} />}>
            <Suspense fallback={<PanelSkeleton h={320} />}>
              <ReportWorkspace />
            </Suspense>
          </ErrorBoundary>
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
