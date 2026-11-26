import { Show } from "solid-js";
import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Menu,
  MenuDropdown,
  MenuItem,
  MenuTarget,
  SegmentedControl,
  Select,
  Switch,
  Text,
  ToolbarRow,
  Tooltip,
  typeStyle,
} from "@/ui";
import { cn } from "@/ui/cn";
import { IconAdjustmentsHorizontal, IconDotsVertical } from "@/components/common/Icons";
import { PatternScrollRegion } from "@/components/patterns/PatternScrollRegion";
import { SymbolFilter } from "@/components/patterns/SymbolFilter";
import { TimeframeSelect } from "@/components/patterns/TimeframeSelect";
import { LookbackSelect } from "@/components/patterns/LookbackSelect";
import { usePatternsNarrow } from "@/components/patterns/narrowLayout";
import { ResultsSearch } from "@/components/patterns/ResultsSearch";
import { ReplayScanControl, type ReplayScanArgs } from "@/components/patterns/ReplayScanControl";
import { formatAsOfLabel } from "@/components/patterns/datetime";
import type { IndexGroup } from "@/config/indexGroups";
import type { PatternFilters, TFSpec } from "@/types/chartPatterns";
import type { ViewMode } from "./types";

const TOOLBAR_CONTROL_H = "30px";

export interface ResultsToolbarProps {
  filters: () => PatternFilters;
  setFilter: (key: string, value: any) => void;
  selectSymbols: (symbols: string[]) => void;
  timeframes: () => TFSpec[];
  timeframe: () => string;
  tfSelection: () => string[];
  setTimeframe: (value: string) => void;
  setSelectedTimeframes?: (value: string[]) => void;
  lookbackBars: () => number | null;
  setLookbackBars: (value: number | null) => void;
  scanReplay?: (args: ReplayScanArgs) => void;
  replayAsOf: () => string | null;
  computeTrendlines: () => boolean;
  setComputeTrendlines: (value: boolean) => void;
  view: () => ViewMode;
  changeView: (view: ViewMode) => void;
  universe: () => string;
  indexGroup: () => IndexGroup;
  changeIndexGroup: (group: IndexGroup) => void;
  activeFilterCount: () => number;
  activeFilterGroups: () => string[];
  openFilters: () => void;
  copyCsv: () => void;
  copySymbols: () => void;
  resultCount: () => number;
  rawResultCount: () => number;
  scanning: () => boolean;
  emptyCustom: () => boolean;
  forceRefresh: () => void;
  copyMsg: () => string | null;
  copyFailed: () => boolean;
  streaming: () => boolean;
  total: () => number;
}

/** Both rows of scan/result controls rendered below the UniverseBar band. */
export function ResultsToolbar(props: ResultsToolbarProps) {
  const narrow = usePatternsNarrow();

  const scanSetup = () => (
    <Box
      data-testid="patterns-scan-scope"
      role="group"
      aria-label="Scan setup"
      className={cn(
        "flex shrink-0 items-center gap-2",
        narrow() && "w-full shrink-0 flex-wrap gap-1",
      )}
    >
      <Box className={narrow() ? "w-[116px] shrink-0" : "w-[210px] shrink-0"}>
        <SymbolFilter
          filters={props.filters()}
          setFilter={props.setFilter}
          onChange={props.selectSymbols}
          placeholder="Search symbol…"
          helperText=""
        />
      </Box>
      <Box className={narrow() ? "shrink-0" : undefined}>
        <TimeframeSelect
          timeframes={props.timeframes()}
          value={props.tfSelection()}
          onChange={(next) => {
            if (props.setSelectedTimeframes) props.setSelectedTimeframes(next);
            else props.setTimeframe(next[0] ?? props.timeframe());
          }}
        />
      </Box>
      <Box className={narrow() ? "shrink-0" : undefined}>
        <LookbackSelect value={props.lookbackBars()} onChange={props.setLookbackBars} />
      </Box>
    </Box>
  );

  const scanOptions = () => (
    <Box
      role="group"
      aria-label="Scan options"
      className={cn(
        "flex shrink-0 items-center gap-2",
        narrow() && "w-full flex-wrap gap-1",
      )}
    >
      <ReplayScanControl onReplayScan={props.scanReplay} />
      {props.replayAsOf() ? (
        <Text size="xs" c="dimmed" data-testid="patterns-scan-asof">
          {`as of ${formatAsOfLabel(props.replayAsOf() ?? "")}`}
        </Text>
      ) : null}
      <Tooltip label="Draw standalone support / resistance lines (TLS = support, TLR = resistance)">
        <Box className="inline-flex">
          <Switch
            label="TLS/TLR"
            size="sm"
            checked={props.computeTrendlines()}
            onChange={(checked) => props.setComputeTrendlines(checked)}
            data-testid="patterns-compute-trendlines"
          />
        </Box>
      </Tooltip>
    </Box>
  );

  const viewControls = () => (
    <>
      <ResultsSearch filters={props.filters()} setFilter={props.setFilter} />
      <SegmentedControl
        data={[
          { value: "matrix", label: "Matrix" },
          { value: "list", label: "List" },
          { value: "grid", label: "Grid" },
        ]}
        value={props.view()}
        onChange={(v) => {
          if (v === "matrix" || v === "list" || v === "grid") props.changeView(v);
        }}
        size="xs"
        data-testid="patterns-view-toggle"
      />
      {props.tfSelection().length > 1 ? (
        <Text
          size="xs"
          c="dimmed"
          style={{ ...typeStyle("micro"), "white-space": "nowrap" }}
          data-testid="patterns-multi-tf-hint"
        >
          {`List/Grid: ${props.timeframe()}`}
        </Text>
      ) : null}
      {props.universe() === "indices" ? (
        <Select
          data={[
            { value: "all", label: "All" },
            { value: "big", label: "Big" },
            { value: "others", label: "Other" },
          ]}
          value={props.indexGroup()}
          onChange={(v) => {
            if (v === "all" || v === "big" || v === "others") props.changeIndexGroup(v);
          }}
          leftSection={<Text size="xs" c="dimmed" style={typeStyle("micro")}>IDX</Text>}
          w={106}
          size="xs"
          data-testid="patterns-index-group"
        />
      ) : null}
      <Tooltip
        label={
          props.activeFilterGroups().length > 0
            ? `${props.activeFilterCount()} active — ${props.activeFilterGroups().join(", ")}`
            : "No filters applied (press F)"
        }
      >
        <Box className="inline-flex">
          <Button
            size="xs"
            variant="filled"
            leftSection={<IconAdjustmentsHorizontal size={14} />}
            onClick={props.openFilters}
            data-testid="patterns-open-filters"
            style={{ height: TOOLBAR_CONTROL_H }}
          >
            {props.activeFilterCount() > 0 ? `Filters (${props.activeFilterCount()})` : "Filters"}
          </Button>
        </Box>
      </Tooltip>
      <Menu data-testid="patterns-overflow-menu">
        <MenuTarget>
          <ActionIcon
            variant="outline"
            size="sm"
            aria-label="More actions"
            data-testid="patterns-overflow"
            style={{ width: TOOLBAR_CONTROL_H, height: TOOLBAR_CONTROL_H }}
          >
            <IconDotsVertical size={14} />
          </ActionIcon>
        </MenuTarget>
        <MenuDropdown data-testid="patterns-overflow-dropdown">
          <MenuItem onClick={props.copyCsv} disabled={props.resultCount() === 0} data-testid="patterns-copy-csv">
            Copy CSV
          </MenuItem>
          <MenuItem onClick={props.copySymbols} disabled={props.resultCount() === 0} data-testid="patterns-copy-symbols">
            Copy symbols
          </MenuItem>
          <MenuItem
            onClick={props.forceRefresh}
            disabled={props.scanning() || props.emptyCustom()}
            data-testid="patterns-force-refresh"
          >
            Force refresh
          </MenuItem>
        </MenuDropdown>
      </Menu>
      {props.copyMsg() ? (
        <Text size="xs" c={props.copyFailed() ? "error" : "success"} data-testid="patterns-copy-toast">
          {props.copyMsg()}
        </Text>
      ) : null}
      {props.streaming() && props.rawResultCount() > 0 ? (
        <Text size="xs" c="dimmed" data-testid="patterns-streaming">
          {`loading more… ${props.rawResultCount()} of ${props.total()}`}
        </Text>
      ) : null}
    </>
  );

  const controls = () => (
    <Box
      className={cn(
        narrow()
          ? "flex w-full min-w-0 flex-col gap-1"
          : "flex w-max min-w-full flex-row flex-nowrap items-center gap-2",
      )}
    >
      <ToolbarRow
        justify="flex-start"
        gap={8}
        wrap={narrow()}
        className="min-w-0"
        data-testid="patterns-results-toolbar"
      >
        {scanSetup()}
        <Divider
          orientation="vertical"
          style={{ height: "18px", "align-self": "center" }}
          className={narrow() ? "hidden" : undefined}
        />
        {scanOptions()}
      </ToolbarRow>
      <ToolbarRow
        justify={narrow() ? "flex-start" : "flex-end"}
        gap={8}
        wrap={narrow()}
        className={narrow() ? "min-w-0" : "ml-auto shrink-0"}
        data-testid="patterns-results-view-toolbar"
      >
        {viewControls()}
      </ToolbarRow>
    </Box>
  );

  // Narrow widths wrap into a normal flow container: no sideways scrollport
  // means no stranded sideways-scroll cue. Desktop keeps the single scroll
  // line and the dense table below it.
  return (
    <Show
      when={narrow()}
      fallback={
        <PatternScrollRegion
          testId="patterns-results-toolbar-scroll-region"
          cueTestId="patterns-results-toolbar-scroll-cue"
          ariaLabel="Pattern filters and result controls, scroll sideways for more"
          className="w-full"
          cueClassName="px-1 pb-0.5"
        >
          {controls()}
        </PatternScrollRegion>
      }
    >
      <Box className="w-full min-w-0 py-0.5">{controls()}</Box>
    </Show>
  );
}
