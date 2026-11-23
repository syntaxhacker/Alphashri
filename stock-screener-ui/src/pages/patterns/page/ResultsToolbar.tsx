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
import { IconAdjustmentsHorizontal, IconDotsVertical } from "@/components/common/Icons";
import { SymbolFilter } from "@/components/patterns/SymbolFilter";
import { TimeframeSelect } from "@/components/patterns/TimeframeSelect";
import { LookbackSelect } from "@/components/patterns/LookbackSelect";
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
  return (
    <Box className="flex w-full min-w-0 flex-row flex-nowrap items-center gap-2">
      <ToolbarRow
        justify="flex-start"
        gap={8}
        wrap={false}
        className="min-w-0"
        data-testid="patterns-results-toolbar"
      >
        <Box
          data-testid="patterns-scan-scope"
          role="group"
          aria-label="Scan setup"
          className="flex shrink-0 items-center gap-2"
        >
          <Box className="w-[210px] shrink-0">
            <SymbolFilter
              filters={props.filters()}
              setFilter={props.setFilter}
              onChange={props.selectSymbols}
              placeholder="Search symbol…"
              helperText=""
            />
          </Box>
          <TimeframeSelect
            timeframes={props.timeframes()}
            value={props.tfSelection()}
            onChange={(next) => {
              if (props.setSelectedTimeframes) props.setSelectedTimeframes(next);
              else props.setTimeframe(next[0] ?? props.timeframe());
            }}
          />
          <LookbackSelect value={props.lookbackBars()} onChange={props.setLookbackBars} />
        </Box>
        <Divider orientation="vertical" style={{ height: "18px", "align-self": "center" }} />
        <Box role="group" aria-label="Scan options" className="flex shrink-0 items-center gap-2">
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
                onChange={(e) => props.setComputeTrendlines((e.currentTarget as HTMLInputElement).checked)}
                data-testid="patterns-compute-trendlines"
              />
            </Box>
          </Tooltip>
        </Box>
      </ToolbarRow>
      <ToolbarRow
        justify="flex-end"
        gap={8}
        wrap={false}
        className="ml-auto shrink-0"
        data-testid="patterns-results-view-toolbar"
      >
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
            <MenuItem
              onClick={props.copyCsv}
              disabled={props.resultCount() === 0}
              data-testid="patterns-copy-csv"
            >
              Copy CSV
            </MenuItem>
            <MenuItem
              onClick={props.copySymbols}
              disabled={props.resultCount() === 0}
              data-testid="patterns-copy-symbols"
            >
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
      </ToolbarRow>
    </Box>
  );
}
