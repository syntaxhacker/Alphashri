import { Show, Switch, Match, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Text, Badge, Loader, Alert, Tabs, TabsList, Tab, TabsPanel, Tooltip, Box, Stack } from "@/ui";
import {
  IconAlertCircle,
  IconTable,
  IconChartBar,
  IconClock,
} from "@/patterns/icons";
import dayjs from "dayjs";
import { getChainLiveState, CHAIN_POLL_INTERVAL_MS } from "../../../hooks/chainLiveState";
import { OptionChainTable } from "./OptionChainTable";
import { ChainSummary } from "./ChainSummary";
import { OIAnalysis } from "./OIAnalysis";
import { LiveSpotChart } from "./LiveSpotChart";

interface OptionChainPanelProps {
  selectedUnderlying: string;
  selectedExpiry: string;
  loading: boolean;
  error: string | null;
  filters: any;
  spotPrice: number | null;
  refreshChain: () => void;
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  timestamp?: string;
  summary?: any;
}

export function OptionChainPanel(props: OptionChainPanelProps) {
  let inFlight = false;
  const [nowMs, setNowMs] = createSignal(Date.now());

  const tick = async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (inFlight) return;
    inFlight = true;
    try {
      await props.refreshChain();
    } finally {
      inFlight = false;
      setNowMs(Date.now());
    }
  };

  createEffect(() => {
    const id = window.setInterval(() => {
      void tick();
    }, CHAIN_POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    onCleanup(() => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    });
  });

  const liveState = createMemo(() => getChainLiveState(props.timestamp, nowMs()));

  return (
    <Stack id="chain-panel" spacing={1} className="w-full" data-testid="options-chain-panel">
      {/* Spot + sync state only: the underlying/expiry/type filters and the
          guide/refresh actions live in the page's context band. */}
      <Box
        id="chain-header"
        data-testid="options-chain-header"
        className="flex w-full flex-wrap items-center gap-2 p-2"
      >
        <LiveSpotChart underlying={props.selectedUnderlying} />
        <Show when={props.timestamp && !props.loading}>
          <Tooltip label={`Data as of ${dayjs(props.timestamp).format("DD MMM YYYY, HH:mm:ss")}`}>
            <Badge variant="light" color="secondary" leftSection={<IconClock size={12} />} data-testid="options-chain-timestamp">
              {dayjs(props.timestamp).format("HH:mm:ss")}
            </Badge>
          </Tooltip>
          <Badge
            variant="light"
            color={liveState().live ? "success" : "warning"}
            data-testid="options-chain-live-badge"
            title={liveState().live ? "Chain is live (auto-refreshes every 15s)" : `Chain data is ${liveState().label.toLowerCase()}`}
          >
            · {liveState().label}
          </Badge>
        </Show>
        <Text size="xs" c="dimmed" data-testid="options-chain-selection">
          {props.selectedUnderlying} · {props.selectedExpiry}
        </Text>
      </Box>

      {/* Error State */}
      <Show when={props.error}>
        <Alert
          id="chain-error"
          icon={<IconAlertCircle size={16} />}
          color="error"
          variant="light"
          data-testid="chain-error-alert"
        >
          {props.error}
        </Alert>
      </Show>

      {/* Content */}
      <Switch>
        <Match when={props.loading && props.strikeMatrix.length === 0}>
          <Box id="chain-loading" data-testid="chain-loading" className="flex w-full items-center justify-center gap-2 py-8">
            <Loader size="md" />
            <Text c="dimmed">Loading option chain...</Text>
          </Box>
        </Match>
        <Match when={props.strikeMatrix.length === 0}>
          <Alert id="chain-no-data" icon={<IconAlertCircle size={16} />} color="warning" variant="light" data-testid="no-data-alert">
            No options data available. Select an underlying and expiry to view the chain.
          </Alert>
        </Match>
        <Match when={true}>
          <Box className="w-full">
            <Tabs id="chain-view-tabs" defaultValue="table" data-testid="chain-view-tabs" style={{ width: "100%" }}>
              <TabsList data-testid="options-chain-view-tabs-list">
                <Tab value="table" leftSection={<IconTable size={14} />} data-testid="chain-tab-table">
                  Option Chain Table
                </Tab>
                <Tab value="analysis" leftSection={<IconChartBar size={14} />} data-testid="chain-tab-analysis">
                  Deep OI Analysis
                </Tab>
              </TabsList>

              <TabsPanel value="table" data-testid="options-chain-table-panel">
                <Stack spacing={1} className="w-full">
                  <ChainSummary strikeMatrix={props.strikeMatrix} spotPrice={props.spotPrice} selectedExpiry={props.selectedExpiry} summary={props.summary} />
                  <OptionChainTable strikeMatrix={props.strikeMatrix} filters={props.filters} spotPrice={props.spotPrice} onRowClick={(contract) => console.log("clicked", contract)} />
                </Stack>
              </TabsPanel>

              <TabsPanel value="analysis" data-testid="options-chain-analysis-panel">
                <Box className="w-full">
                  <OIAnalysis strikeMatrix={props.strikeMatrix} spotPrice={props.spotPrice} />
                </Box>
              </TabsPanel>
            </Tabs>
          </Box>
        </Match>
      </Switch>
    </Stack>
  );
}
