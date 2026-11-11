import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Loader,
  NumberInput,
  Select,
  SegmentedControl,
  Text,
  Tabs,
  TabsList,
  Tab,
  ToolbarRow,
} from "@/ui";
import { CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";
import { TanStackTable } from "../common/TanStackTable";
import { PayoffChart } from "@/components/options/PremiumTracker/PayoffChart";
import { buildFnoColumns } from "./fnoColumns";
import {
  fetchFnoScreener,
  FNO_PRESETS,
  type FnoScreenerParams,
  type FnoScreenerPreset,
  type FnoScreenerResponse,
  type FnoScreenerRow,
} from "../../api/fnoScreener";
import { formatPercentage } from "@/utils/ui-helpers";

const DEFAULT_LIMIT = 50;
const MAX_COST_OPTIONS = [3000, 5000, 10000, 15000] as const;

const PRESET_OPTIONS = Object.entries(FNO_PRESETS).map(([value, meta]) => ({
  value: value as FnoScreenerPreset,
  label: meta.label,
}));

function screenerParams(
  preset: FnoScreenerPreset,
  expiry: string,
  maxCost: number | undefined,
  minPop: number | undefined,
  refresh = false,
): FnoScreenerParams {
  return {
    preset,
    ...(expiry ? { expiry } : {}),
    limit: DEFAULT_LIMIT,
    max_cost: maxCost,
    ...(minPop !== undefined ? { min_pop: minPop } : {}),
    ...(refresh ? { refresh: true } : {}),
  };
}

export function FnoScreenerTab() {
  const [preset, setPreset] = useState<FnoScreenerPreset>("cheap_momentum");
  const [expiry, setExpiry] = useState<string>("");
  const [maxCost, setMaxCost] = useState<number | undefined>(undefined);
  const [minPop, setMinPop] = useState<number | undefined>(undefined);
  const [viewMode, setViewMode] = useState<"symbol" | "contract">("symbol");
  const [data, setData] = useState<FnoScreenerResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(
    async (params: FnoScreenerParams) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);
      try {
        const res = await fetchFnoScreener(params, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    },
    [],
  );

  // Fetch on mount and whenever preset / expiry / max cost / min POP change.
  // Stale in-flight requests are aborted via the AbortController above.
  useEffect(() => {
    void fetchData(screenerParams(preset, expiry, maxCost, minPop));
  }, [preset, expiry, maxCost, minPop, fetchData]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleRefresh = useCallback(() => {
    void fetchData(screenerParams(preset, expiry, maxCost, minPop, true));
  }, [preset, expiry, maxCost, minPop, fetchData]);

  const rows = data?.rows ?? [];
  // Symbol mode dedupes by symbol, keeping the first row per symbol (the
  // backend already sorts by the selected preset, so the first is the best
  // candidate). Contract mode shows every row. Both are pure derivations —
  // switching modes never refetches.
  const displayRows = useMemo(() => {
    if (viewMode === "contract") return rows;
    const seen = new Set<string>();
    const deduped: FnoScreenerRow[] = [];
    for (const row of rows) {
      if (seen.has(row.symbol)) continue;
      seen.add(row.symbol);
      deduped.push(row);
    }
    return deduped;
  }, [rows, viewMode]);
  const symbolCount = useMemo(
    () => new Set(rows.map((row) => row.symbol)).size,
    [rows],
  );
  const showLoading = isLoading && rows.length === 0;
  const showError = error !== null && rows.length === 0;
  const backendIssue =
    data && data.errors.length > 0
      ? data.errors[0]?.error || data.warnings[0] || "Upstream options data unavailable"
      : null;
  const showEmpty =
    !isLoading && error === null && rows.length === 0 && backendIssue === null;

  const columns = useMemo(() => buildFnoColumns(), []);

  return (
    <CompactPanel testId="fno-panel" scrollable>
      <Box className="flex h-full min-h-0 flex-col gap-1">
        <ToolbarRow gap={8} data-testid="fno-toolbar">
          <Text size="sm" fw={700} data-testid="fno-title">
            F&O MOMENTUM
          </Text>
          <Box className="max-w-full min-w-0 flex-shrink-0 overflow-x-auto">
            <Tabs
              value={preset}
              onChange={(v) => v && setPreset(v as FnoScreenerPreset)}
              data-testid="fno-preset-tabs"
            >
              <TabsList>
                {PRESET_OPTIONS.map(({ value, label }) => (
                  <Tab key={value} value={value} data-testid={`fno-preset-${value}`}>
                    {label}
                  </Tab>
                ))}
              </TabsList>
            </Tabs>
          </Box>
          {data ? (
            <Box
              className="flex min-h-0 min-w-0 flex-[1_1_100%] flex-wrap items-center gap-x-16 gap-y-2 md:flex-1"
            >
              <Select
                placeholder="Expiry"
                value={expiry || undefined}
                onChange={(v) => setExpiry(v ?? "")}
                data={data.expiries.map((e) => ({
                  value: e.date,
                  label: `${e.date} (${e.days_to_expiry} DTE)`,
                }))}
                size="xs"
                w={190}
                data-testid="fno-expiry-select"
              />
              <Select
                placeholder="Max cost"
                value={maxCost ? String(maxCost) : undefined}
                onChange={(v: string | null) => setMaxCost(v ? Number(v) : undefined)}
                data={MAX_COST_OPTIONS.map((c) => ({ value: String(c), label: `₹${c}` }))}
                size="xs"
                w={140}
                data-testid="fno-max-cost-select"
              />
              <NumberInput
                placeholder="Min POP"
                value={minPop ?? ""}
                onChange={(v: string | number) => setMinPop(typeof v === "number" ? v : undefined)}
                min={0}
                max={100}
                step={1}
                size="xs"
                w={120}
                data-testid="fno-min-pop"
              />
              <SegmentedControl
                size="xs"
                value={viewMode}
                onChange={(v) => setViewMode(v as "symbol" | "contract")}
                data={[
                  { value: "symbol", label: "Best per symbol" },
                  { value: "contract", label: "All contracts" },
                ]}
                data-testid="fno-view-mode"
              />
            </Box>
          ) : null}
          <Box
            className="flex min-h-0 min-w-0 flex-1 items-center justify-end gap-16"
          >
            {data && (
              <>
                <Text
                  size="xs"
                  c="dimmed"
                  data-testid="fno-as-of"
                  className="hidden whitespace-nowrap md:block"
                >
                  as of {data.as_of.slice(11, 16)}
                </Text>
                <Text
                  size="xs"
                  c="dimmed"
                  data-testid="fno-row-count"
                  className="whitespace-nowrap"
                >
                  {symbolCount} symbols / {rows.length} contracts
                </Text>
                {data.stale && (
                  <Badge size="xs" color="warning" data-testid="fno-stale-badge">
                    STALE
                  </Badge>
                )}
                <ActionIcon
                  size="sm"
                  onClick={handleRefresh}
                  loading={isLoading}
                  data-testid="fno-refresh"
                  aria-label="Refresh F&O screener"
                >
                  <IconRefresh size={14} />
                </ActionIcon>
              </>
            )}
          </Box>
        </ToolbarRow>

        {showLoading && (
          <Box
            data-testid="fno-loading"
            className="flex items-center justify-center gap-2 py-8"
          >
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Scanning F&O setups…</Text>
          </Box>
        )}
        {showError && (
          <Alert color="error" data-testid="fno-error">
            {`F&O screener failed: ${error?.message ?? "unknown error"}`}
          </Alert>
        )}
        {!showLoading && !showError && rows.length === 0 && backendIssue && (
          <Alert color="warning" data-testid="fno-upstream-warning">
            {backendIssue}
          </Alert>
        )}
        {showEmpty && (
          <Box data-testid="fno-empty" className="py-8 text-center">
            <Text size="sm" c="dimmed">
              No F&O matches for these filters — loosen max cost or min POP.
            </Text>
          </Box>
        )}
        {!showLoading && !showError && rows.length > 0 && (
          <TanStackTable<FnoScreenerRow>
            data={displayRows}
            columns={columns}
            dataTestId="fno-table"
            loading={false}
            loadingMessage="Scanning F&O setups…"
            emptyMessage="No F&O matches for these filters"
            initialState={{ sorting: [{ id: "move_2pct_est", desc: true }] }}
            enableSorting
            stickyHeader
            fillContainer
            dense
            rowWindowSize={100}
            minTableWidth={1400}
            getRowTestId={(row) => `fno-row-${row.symbol}`}
            getRowCanExpand={() => true}
            renderSubComponent={(row) => <FnoRowDetail row={row} />}
            bare
          />
        )}
      </Box>
    </CompactPanel>
  );
}

function money2(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function FnoRowDetail({ row }: { row: FnoScreenerRow }) {
  const maxLoss = row.cost_lot;
  const legs = [{ strike: row.strike, optionType: "CE", action: "BUY", qty: 1, entry: row.premium }];
  const rangePct = Math.max(12, Math.abs(row.strike / row.spot - 1) * 100 + 5);
  return (
    <Box
      className="flex w-full flex-col gap-1 p-2"
      data-testid="fno-row-detail"
    >
      <Text size="xs" c="dimmed" fw={700} className="text-[10px] uppercase tracking-[0.4px]">
        {row.symbol} · {row.setup}
      </Text>
      <CompactStatGrid cols={4} spacing={0.5}>
        <CompactStat label="Premium" value={money2(row.premium)} data-testid="fno-detail-premium" />
        <CompactStat label="Cost / lot" value={`₹${Math.round(row.cost_lot).toLocaleString("en-IN")}`} data-testid="fno-detail-cost" />
        <CompactStat label="Breakeven" value={money2(row.breakeven)} data-testid="fno-detail-breakeven" />
        <CompactStat label="Max loss" value={`₹${Math.round(maxLoss).toLocaleString("en-IN")}`} tone="error" data-testid="fno-detail-max-loss" />
        <CompactStat label="POP" value={formatPercentage(row.pop)} data-testid="fno-detail-pop" />
        <CompactStat label="1D%" value={formatPercentage(row.d1)} data-testid="fno-detail-d1" />
        <CompactStat label="5D%" value={formatPercentage(row.d5)} data-testid="fno-detail-d5" />
        <CompactStat label="+2% est." value={formatPercentage(row.move_2pct_est)} data-testid="fno-detail-move2" />
      </CompactStatGrid>
      <PayoffChart
        legs={legs}
        spot={row.spot}
        height={180}
        rangePct={rangePct}
        data-testid={`fno-payoff-${row.symbol}`}
      />
    </Box>
  );
}
