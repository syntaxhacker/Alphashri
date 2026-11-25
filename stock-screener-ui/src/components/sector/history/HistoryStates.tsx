import { Show, createMemo, type JSX } from "solid-js";
import { Box, Button, Loader, Text } from "@/ui";
import { CompactPanel } from "../../common/compact";
import type { SectorHistoryMarket } from "../../../types/sectorHistory";

const ERROR_FALLBACK = "Sector history is temporarily unavailable. Try again.";
const FETCH_FAILURE =
  /sector_history_unavailable|failed to fetch|network|load failed|fetch failed/i;

function errorCopy(raw: string | null): { primary: string; code: string } {
  const value = (raw ?? "").trim();
  if (!value) return { primary: ERROR_FALLBACK, code: "" };
  return FETCH_FAILURE.test(value)
    ? { primary: ERROR_FALLBACK, code: value }
    : { primary: value, code: "" };
}

function StatePanel(props: {
  testId: string;
  title: string;
  description: string;
  action?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <Box className="flex flex-1 min-h-0 items-start justify-center overflow-y-auto p-2">
      <CompactPanel
        testId={props.testId}
        title={props.title}
        description={props.description}
        action={props.action}
        className="w-full max-w-[520px]"
      >
        {props.children}
      </CompactPanel>
    </Box>
  );
}

export function HistoryLoadingState() {
  return (
    <StatePanel
      testId="sector-history-loading"
      title="Loading sector history"
      description="Fetching monthly sector ranks, seasonality and risk metrics."
      action={<Loader size="xs" />}
    />
  );
}

export function HistoryEmptyState(props: {
  market: SectorHistoryMarket;
  years: number;
  onRefresh: () => void;
}) {
  const marketLabel = () => (props.market === "india" ? "India" : "US");
  return (
    <StatePanel
      testId="sector-history-empty"
      title="No sector history"
      description={`No history is available for ${marketLabel()} over ${props.years}Y.`}
      action={
        <Button
          variant="outline"
          size="xs"
          onClick={props.onRefresh}
          data-testid="sector-history-empty-refresh"
        >
          Refresh
        </Button>
      }
    />
  );
}

export function HistoryErrorState(props: { error: string; onRetry: () => void }) {
  const copy = createMemo(() => errorCopy(props.error));
  return (
    <StatePanel
      testId="sector-history-error"
      title="Sector history unavailable"
      description={copy().primary}
      action={
        <Button
          variant="outline"
          color="error"
          size="xs"
          onClick={props.onRetry}
          data-testid="sector-history-retry"
        >
          Retry
        </Button>
      }
    >
      <Show when={copy().code}>
        <details data-testid="sector-history-error-details" class="mt-1">
          <summary class="cursor-pointer select-none text-ui-micro text-fin-text-muted">
            Details
          </summary>
          <Text
            data-testid="sector-history-error-code"
            c="dimmed"
            className="mt-1 text-ui-micro font-mono break-all"
          >
            {copy().code}
          </Text>
        </details>
      </Show>
    </StatePanel>
  );
}

/** One overview section is missing data; the rest of the tab still renders. */
export function HistoryPanelEmpty(props: { testId: string; message: string }) {
  return (
    <Box
      data-testid={props.testId}
      className="flex min-h-[96px] items-center justify-center px-2 py-4"
    >
      <Text c="dimmed" className="text-ui-micro text-center">
        {props.message}
      </Text>
    </Box>
  );
}
