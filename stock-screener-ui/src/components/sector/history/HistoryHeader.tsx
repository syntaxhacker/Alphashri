import { Show } from "solid-js";
import { ActionIcon, Box, Loader, Select, Text, ToolbarRow } from "@/ui";
import { IconClock, IconRefresh } from "../../screener/icons";
import type { SectorHistoryMarket } from "../../../types/sectorHistory";
import { CompactToggle } from "../CompactToggle";

export type HistoryView = "overview" | "lab";

const YEAR_OPTIONS = [
  { label: "3Y", value: "3" },
  { label: "5Y", value: "5" },
  { label: "10Y", value: "10" },
];

export interface HistoryHeaderProps {
  market: SectorHistoryMarket;
  years: number;
  view: HistoryView;
  loading: boolean;
  asOf: string;
  cached: boolean | null;
  onYearsChange: (years: number) => void;
  onViewChange: (view: HistoryView) => void;
  onRefresh: () => void;
}

export function HistoryHeader(props: HistoryHeaderProps) {
  const marketLabel = () => (props.market === "india" ? "India" : "US");

  return (
    <ToolbarRow
      gap={8}
      data-testid="sector-history-header"
      className="shrink-0 flex-wrap border-b border-fin-border px-2"
      style={{ "min-height": "32px" }}
    >
      <Text fw={700} className="text-ui-micro whitespace-nowrap">
        Sector History
      </Text>
      <Text
        c="dimmed"
        data-testid="sector-history-market-label"
        className="text-ui-micro font-mono whitespace-nowrap"
      >
        {marketLabel()}
      </Text>
      <Box className="w-[78px] min-w-[64px] shrink-0">
        <Select
          value={String(props.years)}
          onChange={(value) => {
            if (value != null) props.onYearsChange(Number(value));
          }}
          data={YEAR_OPTIONS}
          size="xs"
          className="text-ui-micro"
          aria-label="Sector history lookback"
          data-testid="sector-history-years"
        />
      </Box>
      <CompactToggle
        testId="sector-history-view-toggle"
        label="Sector history view"
        value={props.view}
        options={[
          { value: "overview", label: "Overview" },
          { value: "lab", label: "Rotation Lab" },
        ]}
        onChange={(value) => props.onViewChange(value === "lab" ? "lab" : "overview")}
      />
      <Box className="ml-auto flex items-center gap-2">
        <Show when={props.loading}>
          <Loader size="xs" />
        </Show>
        <Show when={props.asOf}>
          <Box className="flex items-center gap-1">
            <IconClock size={12} className="text-fin-text-muted" />
            <Text
              c="dimmed"
              data-testid="sector-history-asof"
              className="text-ui-micro font-mono tabular-nums whitespace-nowrap"
            >
              As of {props.asOf}
            </Text>
          </Box>
        </Show>
        <Show when={props.cached !== null}>
          <Text
            fw={700}
            c={props.cached ? "dimmed" : "success"}
            data-testid="sector-history-cached"
            className="text-ui-micro tracking-[0.4px] whitespace-nowrap"
          >
            {props.cached ? "CACHED" : "LIVE"}
          </Text>
        </Show>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label="Refresh sector history"
          onClick={props.onRefresh}
          data-testid="sector-history-refresh"
        >
          <IconRefresh size={14} />
        </ActionIcon>
      </Box>
    </ToolbarRow>
  );
}
