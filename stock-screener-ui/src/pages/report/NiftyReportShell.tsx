import { Show } from "solid-js";
import { Box } from "@/ui";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";
import { ReportProvider, useNiftyReport } from "./ReportContext";
import { ReportToolbar } from "./ReportToolbar";
import { ReportDecisionStrip } from "./ReportDecisionStrip";
import { ReportStrips } from "./ReportStrips";
import { ReportWorkspace } from "./ReportWorkspace";
import { ReportAnalytics } from "./ReportAnalytics";
import { ReportOverlays } from "./ReportOverlays";

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
          <ReportDecisionStrip />
          <ReportStrips />
          <ReportWorkspace />
          <ReportAnalytics />
        </Box>
      </Show>

      <ReportOverlays />
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
