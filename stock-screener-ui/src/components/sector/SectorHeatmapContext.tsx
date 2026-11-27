import { Show } from "solid-js";
import { Box, Loader, Select } from "@/ui";
import { SECTOR_STOCK_METRICS } from "../heatmap/stockTreemap";
import { CompactToggle } from "./CompactToggle";
import type { ViewMode } from "./SectorHeatmapView";

export interface SectorHeatmapControlProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  metric: string;
  onMetricChange: (metric: string) => void;
  sectorFilter?: string | null;
  sectorOptions?: { value: string; label: string }[];
  onSectorFilterChange?: (sector: string | null) => void;
  loading?: boolean;
  /** Sector-option fetch failed; the selector stays usable but says so. */
  error?: string | null;
}

const VIEW_OPTIONS = [
  { value: "sector", label: "Sectors" },
  { value: "stock", label: "Stocks" },
] as const;

/**
 * The heatmap's own controls belong to the page context band. While they owned a
 * row inside the panel the chart started at 117px instead of the 96px budget.
 */
export function SectorHeatmapControls(props: SectorHeatmapControlProps) {
  const sectorFilterValue = () => props.sectorFilter ?? "";

  return (
    <Box
      data-testid="sector-heatmap-context"
      className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1"
    >
      <CompactToggle
        testId="sector-heatmap-view-toggle"
        label="Heatmap layer"
        value={props.viewMode}
        options={VIEW_OPTIONS}
        onChange={(v) => props.onViewModeChange(v as ViewMode)}
      />
      <Show when={props.viewMode === "stock"}>
        <Select
          size="xs"
          h={22}
          w={130}
          placeholder="Color by"
          value={props.metric}
          onChange={(v) => props.onMetricChange(v || "change_pct")}
          data={SECTOR_STOCK_METRICS}
          data-testid="sector-heatmap-metric"
          aria-label="Heatmap metric"
        />
        <Select
          size="xs"
          h={22}
          w={160}
          placeholder="All sectors"
          value={sectorFilterValue()}
          onChange={(v) => props.onSectorFilterChange?.(v || null)}
          data={[{ value: "", label: "All sectors" }, ...(props.sectorOptions ?? [])]}
          clearable
          data-testid="sector-heatmap-sector-filter"
          aria-label="Heatmap sector filter"
        />
        <Show when={props.loading}>
          <span
            data-testid="sector-heatmap-sector-filter-loading"
            role="status"
            class="inline-flex items-center gap-1 whitespace-nowrap text-ui-micro text-fin-text-muted"
          >
            <Loader size="xs" />
            Sectors…
          </span>
        </Show>
        <Show when={!props.loading && props.error}>
          <span
            data-testid="sector-heatmap-sector-filter-error"
            role="alert"
            title={props.error ?? ""}
            class="whitespace-nowrap text-ui-micro text-fin-text-muted"
          >
            Sectors unavailable
          </span>
        </Show>
        <Show
          when={
            !props.loading &&
            !props.error &&
            (props.sectorOptions ?? []).length === 0
          }
        >
          <span
            data-testid="sector-heatmap-sector-filter-empty"
            role="status"
            class="whitespace-nowrap text-ui-micro text-fin-text-muted"
          >
            No sectors yet
          </span>
        </Show>
      </Show>
      <Show when={props.loading && props.viewMode !== "stock"}>
        <Loader size="xs" />
      </Show>
    </Box>
  );
}