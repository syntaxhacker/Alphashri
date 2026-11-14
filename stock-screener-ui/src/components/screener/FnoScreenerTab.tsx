import { Show, createEffect, createMemo, createSignal, For, onCleanup } from "solid-js";
import { IconRefresh } from "./icons";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Loader,
  Select,
  SegmentedControl,
  Text,
  Tabs,
  TabsList,
  Tab,
  ToolbarRow,
} from "@/ui";
import { CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";
import { RangeInput } from "../common/RangeInput";
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

/** Cost per lot in ₹ — the old select capped at 15k, so 20k gives headroom. */
const COST_DOMAIN: [number, number] = [0, 20000];
const COST_STEP = 500;

const POP_DOMAIN: [number, number] = [0, 100];

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
  const [preset, setPreset] = createSignal<FnoScreenerPreset>("cheap_momentum");
  const [expiry, setExpiry] = createSignal<string>("");
  const [costMin, setCostMin] = createSignal<number | undefined>(undefined);
  const [costMax, setCostMax] = createSignal<number | undefined>(undefined);
  const [popMin, setPopMin] = createSignal<number | undefined>(undefined);
  const [popMax, setPopMax] = createSignal<number | undefined>(undefined);
  const [viewMode, setViewMode] = createSignal<"symbol" | "contract">("symbol");
  const [data, setData] = createSignal<FnoScreenerResponse | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<Error | null>(null);
  let abortController: AbortController | null = null;

  const fetchData = async (params: FnoScreenerParams) => {
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
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
  };

  // Fetch on mount and whenever preset / expiry / cost cap / POP floor change.
  // Stale in-flight requests are aborted via the AbortController above.
  createEffect(() => {
    const p = preset();
    const e = expiry();
    const mc = costMax();
    const pop = popMin();
    void fetchData(screenerParams(p, e, mc, pop));
  });

  onCleanup(() => abortController?.abort());

  const handleRefresh = () => {
    void fetchData(screenerParams(preset(), expiry(), costMax(), popMin(), true));
  };

  // The API filters one end of each pair (`max_cost`, `min_pop`); the opposite
  // thumb is applied to the fetched rows so the control stays a real range.
  const withinRange = (row: FnoScreenerRow): boolean => {
    const lo = costMin();
    const hi = costMax();
    const pLo = popMin();
    const pHi = popMax();
    return (
      (lo === undefined || row.cost_lot >= lo) &&
      (hi === undefined || row.cost_lot <= hi) &&
      (pLo === undefined || row.pop >= pLo) &&
      (pHi === undefined || row.pop <= pHi)
    );
  };

  const rows = () => (data()?.rows ?? []).filter(withinRange);
  // Symbol mode dedupes by symbol, keeping the first row per symbol (the
  // backend already sorts by the selected preset, so the first is the best
  // candidate). Contract mode shows every row. Both are pure derivations —
  // switching modes never refetches.
  const displayRows = createMemo(() => {
    const allRows = rows();
    if (viewMode() === "contract") return allRows;
    const seen = new Set<string>();
    const deduped: FnoScreenerRow[] = [];
    for (const row of allRows) {
      if (seen.has(row.symbol)) continue;
      seen.add(row.symbol);
      deduped.push(row);
    }
    return deduped;
  });
  const symbolCount = createMemo(() => new Set(rows().map((row) => row.symbol)).size);
  const showLoading = () => isLoading() && rows().length === 0;
  const showError = () => error() !== null && rows().length === 0;
  const backendIssue = createMemo(() => {
    const d = data();
    return d && d.errors.length > 0
      ? d.errors[0]?.error || d.warnings[0] || "Upstream options data unavailable"
      : null;
  });
  const showEmpty = () =>
    !isLoading() && error() === null && rows().length === 0 && backendIssue() === null;

  const columns = createMemo(() => buildFnoColumns());

  return (
    <CompactPanel testId="fno-panel" scrollable>
      <Box className="flex h-full min-h-0 flex-col gap-1">
        <ToolbarRow gap={8} data-testid="fno-toolbar">
          <Text size="sm" fw={700} data-testid="fno-title">
            F&amp;O MOMENTUM
          </Text>
          <Box className="max-w-full min-w-0 flex-shrink-0 overflow-x-auto">
            <Tabs
              value={preset()}
              onChange={(v) => v && setPreset(v as FnoScreenerPreset)}
              data-testid="fno-preset-tabs"
            >
              <TabsList>
                <For each={PRESET_OPTIONS}>
                  {({ value, label }) => (
                    <Tab value={value} data-testid={`fno-preset-${value}`}>
                      {label}
                    </Tab>
                  )}
                </For>
              </TabsList>
            </Tabs>
          </Box>
          <Box
            className="flex min-h-0 min-w-0 flex-1 items-center justify-end gap-16"
          >
            <Show when={data()}>
              <>
                <Text
                  size="xs"
                  c="dimmed"
                  data-testid="fno-as-of"
                  className="hidden whitespace-nowrap md:block font-mono tabular-nums"
                >
                  as of {data()!.as_of.slice(11, 16)}
                </Text>
                <Text
                  size="xs"
                  c="dimmed"
                  data-testid="fno-row-count"
                  className="whitespace-nowrap font-mono tabular-nums"
                >
                  {symbolCount()} symbols / {rows().length} contracts
                </Text>
                <Show when={data()!.stale}>
                  <Badge size="xs" color="warning" data-testid="fno-stale-badge">
                    STALE
                  </Badge>
                </Show>
                <ActionIcon
                  size="sm"
                  onClick={handleRefresh}
                  loading={isLoading()}
                  data-testid="fno-refresh"
                  aria-label="Refresh F&O screener"
                >
                  <IconRefresh size={14} />
                </ActionIcon>
              </>
            </Show>
          </Box>
        </ToolbarRow>

        {/* Controls get their own row: a 69px range sharing a line with the
            30px selects stacks at 1366px and triples the header height. */}
        <Show when={data()}>
          <ToolbarRow gap={8} className="pt-1" data-testid="fno-filters">
            <Select
              placeholder="Expiry"
              value={expiry() || undefined}
              onChange={(v) => setExpiry(v ?? "")}
              data={data()!.expiries.map((e) => ({
                value: e.date,
                label: `${e.date} (${e.days_to_expiry} DTE)`,
              }))}
              size="xs"
              w={190}
              data-testid="fno-expiry-select"
            />
            <SegmentedControl
              size="xs"
              value={viewMode()}
              onChange={(v) => setViewMode(v as "symbol" | "contract")}
              data={[
                { value: "symbol", label: "Best per symbol" },
                { value: "contract", label: "All contracts" },
              ]}
              data-testid="fno-view-mode"
            />
            {/* gap-8 inside the pair: each thumb overhangs its track by ~7px,
                so a smaller gap makes two ranges look like one 4-thumb slider. */}
            <Box className="flex flex-wrap items-center gap-8">
              <Box w={200} className="shrink-0">
                <RangeInput
                  label="Cost / lot"
                  min={costMin() ?? null}
                  max={costMax() ?? null}
                  onMinChange={(v) => setCostMin(v ?? undefined)}
                  onMaxChange={(v) => setCostMax(v ?? undefined)}
                  domain={COST_DOMAIN}
                  step={COST_STEP}
                  formatValue={(v) => `₹${Math.round(v / 1000)}k`}
                  size="xs"
                  testId="fno-max-cost-select"
                />
              </Box>
              <Box w={200} className="shrink-0">
                <RangeInput
                  label="POP"
                  min={popMin() ?? null}
                  max={popMax() ?? null}
                  onMinChange={(v) => setPopMin(v ?? undefined)}
                  onMaxChange={(v) => setPopMax(v ?? undefined)}
                  domain={POP_DOMAIN}
                  formatValue={(v) => `${v}%`}
                  size="xs"
                  testId="fno-min-pop"
                />
              </Box>
            </Box>
          </ToolbarRow>
        </Show>

        <Show when={showLoading()}>
          <Box
            data-testid="fno-loading"
            className="flex items-center justify-center gap-2 py-8"
          >
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Scanning F&amp;O setups…</Text>
          </Box>
        </Show>
        <Show when={showError()}>
          <Alert color="error" data-testid="fno-error">
            {`F&O screener failed: ${error()?.message ?? "unknown error"}`}
          </Alert>
        </Show>
        <Show when={!showLoading() && !showError() && rows().length === 0 && backendIssue()}>
          <Alert color="warning" data-testid="fno-upstream-warning">
            {backendIssue()}
          </Alert>
        </Show>
        <Show when={showEmpty()}>
          <Box data-testid="fno-empty" className="py-8 text-center">
            <Text size="sm" c="dimmed">
              No F&amp;O matches for these filters — widen the cost or POP range.
            </Text>
          </Box>
        </Show>
        <Show when={!showLoading() && !showError() && rows().length > 0}>
          <TanStackTable<FnoScreenerRow>
            data={displayRows()}
            columns={columns()}
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
        </Show>
      </Box>
    </CompactPanel>
  );
}

function money2(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function FnoRowDetail(props: { row: FnoScreenerRow }) {
  const row = () => props.row;
  const maxLoss = () => row().cost_lot;
  // `legs` must rebuild when `props.row` changes (data refetch / view-mode
  // switch re-supplies the same expanded row with a new object). Reading
  // `row()` at body level would pin the first row forever.
  const legs = () => [{ strike: row().strike, optionType: "CE", action: "BUY", qty: 1, entry: row().premium }];
  const rangePct = () => Math.max(12, Math.abs(row().strike / row().spot - 1) * 100 + 5);
  return (
    <Box
      className="flex w-full flex-col gap-1 p-2"
      data-testid="fno-row-detail"
    >
      <Text size="xs" c="dimmed" fw={700} className="text-[10px] uppercase tracking-[0.4px]">
        {row().symbol} · {row().setup}
      </Text>
      <CompactStatGrid cols={4} spacing={0.5}>
        <CompactStat label="Premium" value={money2(row().premium)} data-testid="fno-detail-premium" />
        <CompactStat label="Cost / lot" value={`₹${Math.round(row().cost_lot).toLocaleString("en-IN")}`} data-testid="fno-detail-cost" />
        <CompactStat label="Breakeven" value={money2(row().breakeven)} data-testid="fno-detail-breakeven" />
        <CompactStat label="Max loss" value={`₹${Math.round(maxLoss()).toLocaleString("en-IN")}`} tone="error" data-testid="fno-detail-max-loss" />
        <CompactStat label="POP" value={formatPercentage(row().pop)} data-testid="fno-detail-pop" />
        <CompactStat label="1D%" value={formatPercentage(row().d1)} data-testid="fno-detail-d1" />
        <CompactStat label="5D%" value={formatPercentage(row().d5)} data-testid="fno-detail-d5" />
        <CompactStat label="+2% est." value={formatPercentage(row().move_2pct_est)} data-testid="fno-detail-move2" />
      </CompactStatGrid>
      <PayoffChart
        legs={legs()}
        spot={row().spot}
        height={180}
        rangePct={rangePct()}
        dataTestid={`fno-payoff-${row().symbol}`}
      />
    </Box>
  );
}
