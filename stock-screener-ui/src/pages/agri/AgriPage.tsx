import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import {
  Badge,
  Box,
  Button,
  Select,
  Text,
  ToolbarRow,
  useColorScheme,
  useMediaQuery,
} from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";
import { TanStackTable } from "@/components/common/TanStackTable";
import { EChart } from "@/components/common/EChart";
import { fetchAgriFilters, fetchAgriPrices } from "@/api/agri";
import type {
  AgriChartMode,
  AgriFiltersResponse,
  AgriPricesParams,
  AgriPricesResponse,
  AgriRangeKey,
} from "@/types/agri";
import {
  AGRICULTURE_UNIT,
  AGRI_CHART_MODES,
  AGRI_COMMODITIES,
  AGRI_DEFAULT_CHART_MODE,
  AGRI_DEFAULT_RANGE,
  AGRI_GROUPS,
  AGRI_RANGE_KEYS,
  AGRI_RANGE_PRESETS,
  agriCommodity,
  agriCommodityLabel,
  agriGroupLabel,
  agriRange,
  formatAgriPrice,
  formatArrivals,
  formatChangePct,
} from "@/config/agri";
import { buildAgriChartOption } from "./agriChartOption";
import { agriRangeStart, formatAgriSessionDate } from "./agriDates";
import { agriColumns, type AgriTableViewRow } from "./agriColumns";

type SelectOption = { value: string; label: string; group?: string };
const DEFAULT_COMPARE = ["wheat", "tomato", "onion"];

function paramValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * `/api/agri/filters` ships plain name strings today but the TS contract also
 * admits `{key,label}` options — accept both so a backend shape change cannot
 * silently empty every cascade select.
 */
function selectOptions(value: unknown): SelectOption[] {
  if (!Array.isArray(value)) return [];
  const options: SelectOption[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item) options.push({ value: item, label: item });
      continue;
    }
    const record = toRecord(item);
    if (!record) continue;
    const key = String(record.key ?? record.value ?? "");
    if (!key) continue;
    options.push({
      value: key,
      label: String(record.label ?? record.name ?? key),
      ...(typeof record.group === "string" ? { group: record.group } : {}),
    });
  }
  return options;
}

function toneForChange(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "dimmed";
  return value > 0 ? "success" : "error";
}

export function AgriPage() {
  const { isDark } = useColorScheme();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialCommodity = paramValue(searchParams.commodity) ||
    AGRI_COMMODITIES.find((item) => item.key === "onion")?.key ||
    AGRI_COMMODITIES[0]?.key ||
    "";
  const initialRange = paramValue(searchParams.range);
  const initialMode = paramValue(searchParams.mode);

  const [group, setGroup] = createSignal(paramValue(searchParams.group));
  const [commodity, setCommodity] = createSignal(initialCommodity);
  const [state, setState] = createSignal(paramValue(searchParams.state));
  const [district, setDistrict] = createSignal(paramValue(searchParams.district));
  const [market, setMarket] = createSignal(paramValue(searchParams.market));
  const [range, setRange] = createSignal<AgriRangeKey>(
    AGRI_RANGE_KEYS.includes(initialRange as AgriRangeKey) ? (initialRange as AgriRangeKey) : AGRI_DEFAULT_RANGE,
  );
  const [mode, setMode] = createSignal<AgriChartMode>(
    AGRI_CHART_MODES.some((item) => item.key === initialMode) ? (initialMode as AgriChartMode) : AGRI_DEFAULT_CHART_MODE,
  );
  const [compare, setCompare] = createSignal<string[]>(
    DEFAULT_COMPARE.filter((key) => key !== initialCommodity).slice(0, 3),
  );

  const [filtersData, setFiltersData] = createSignal<AgriFiltersResponse | null>(null);
  const [filtersLoading, setFiltersLoading] = createSignal(true);
  const [filtersError, setFiltersError] = createSignal<string | null>(null);
  const [prices, setPrices] = createSignal<AgriPricesResponse | null>(null);
  const [pricesLoading, setPricesLoading] = createSignal(true);
  const [pricesError, setPricesError] = createSignal<string | null>(null);
  const [ready, setReady] = createSignal(false);
  const [retryToken, setRetryToken] = createSignal(0);

  const isMobile = useMediaQuery("(max-width: 640px)");
  const isMid = useMediaQuery("(max-width: 1180px)");
  const statCols = () => (isMobile() ? 2 : isMid() ? 4 : 8);

  function loadFilters() {
    const controller = new AbortController();
    setFiltersLoading(true);
    setFiltersError(null);
    fetchAgriFilters(controller.signal)
      .then((data) => {
        setFiltersData(data);
        setReady(true);
      })
      .catch((error: unknown) => {
        setFiltersError(error instanceof Error ? error.message : "Failed to load agri filters");
      })
      .finally(() => setFiltersLoading(false));
    onCleanup(() => controller.abort());
  }

  onMount(loadFilters);

  let activeController: AbortController | null = null;
  let requestSeq = 0;
  async function loadPrices(params: AgriPricesParams) {
    const requestId = ++requestSeq;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    setPricesLoading(true);
    setPricesError(null);
    try {
      const data = await fetchAgriPrices(params, controller.signal);
      if (requestId !== requestSeq || controller.signal.aborted) return;
      setPrices(data);
    } catch (error: unknown) {
      if (requestId !== requestSeq || controller.signal.aborted) return;
      setPricesError(error instanceof Error ? error.message : "Failed to load agri prices");
    } finally {
      if (requestId === requestSeq) setPricesLoading(false);
    }
  }
  onCleanup(() => activeController?.abort());

  createEffect(() => {
    if (!ready()) return;
    const token = retryToken();
    const params: AgriPricesParams = {
      commodity: commodity(),
      range: range(),
    };
    if (mode() === "compare") params.compare = compare().slice(0, 3);
    const selectedGroup = group();
    const selectedState = state();
    const selectedDistrict = district();
    const selectedMarket = market();
    if (selectedGroup) params.group = selectedGroup;
    if (selectedState) params.state = selectedState;
    if (selectedDistrict) params.district = selectedDistrict;
    if (selectedMarket) params.market = selectedMarket;
    void token;
    void loadPrices(params);
  });

  let firstWrite = true;
  createEffect(() => {
    const nextState = {
      commodity: commodity(),
      group: group(),
      state: state(),
      district: district(),
      market: market(),
      range: range(),
      mode: mode(),
    };
    if (firstWrite) {
      firstWrite = false;
      return;
    }
    // Solid Router's setSearchParams merges with Object.entries(), so it needs a
    // plain object — a URLSearchParams instance is silently ignored.
    const next: Record<string, string> = {};
    if (nextState.commodity) next.commodity = nextState.commodity;
    if (nextState.group) next.group = nextState.group;
    if (nextState.state) next.state = nextState.state;
    if (nextState.district) next.district = nextState.district;
    if (nextState.market) next.market = nextState.market;
    if (nextState.range !== AGRI_DEFAULT_RANGE) next.range = nextState.range;
    if (nextState.mode !== AGRI_DEFAULT_CHART_MODE) next.mode = nextState.mode;
    if (new URLSearchParams(next).toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  });

  function commodityOptionsFor(selectedGroup: string): SelectOption[] {
    const fromApi = selectOptions(filtersData()?.commodities);
    const pool = fromApi.length
      ? fromApi
      : AGRI_COMMODITIES.map((item) => ({ value: item.key, label: item.label, group: item.group }));
    if (!selectedGroup) return pool;
    return pool.filter((option) => {
      if (option.group) return option.group === selectedGroup;
      return agriCommodity(option.value)?.group === selectedGroup;
    });
  }

  const groupOptions = createMemo<SelectOption[]>(() => {
    const fromApi = selectOptions(filtersData()?.groups);
    return [
      { value: "", label: "All groups" },
      ...(fromApi.length
        ? fromApi
        : AGRI_GROUPS.map((item) => ({ value: item.key, label: item.label }))),
    ];
  });
  const commodityOptions = createMemo(() => commodityOptionsFor(group()));
  const stateOptions = createMemo(() => [
    { value: "", label: "All India" },
    ...selectOptions(filtersData()?.states),
  ]);
  const districtOptions = createMemo(() => [
    { value: "", label: "All districts" },
    ...selectOptions(filtersData()?.districts),
  ]);
  const marketOptions = createMemo(() => [
    { value: "", label: "All mandis" },
    ...selectOptions(filtersData()?.markets),
  ]);

  function changeGroup(value: string | null) {
    const next = value ?? "";
    setGroup(next);
    const available = commodityOptionsFor(next);
    if (available.length > 0 && !available.some((option) => option.value === commodity())) {
      setCommodity(available[0].value);
    }
  }

  function changeCommodity(value: string | null) {
    const next = value ?? "";
    if (!next) return;
    setCommodity(next);
    setCompare((previous) => {
      if (previous.includes(next)) return previous;
      const replacement = DEFAULT_COMPARE.find((key) => key !== next && !previous.includes(key));
      return replacement ? [replacement, ...previous].slice(0, 3) : previous;
    });
  }

  function toggleCompare(key: string) {
    setCompare((previous) =>
      previous.includes(key)
        ? previous.filter((item) => item !== key)
        : [...previous, key].slice(-3),
    );
  }

  const kpis = createMemo(() => prices()?.kpis ?? null);
  const asOf = createMemo(() => prices()?.as_of ?? filtersData()?.as_of ?? null);
  const freshnessDays = createMemo(
    () => prices()?.freshness_days ?? filtersData()?.freshness_days ?? null,
  );
  const dataSource = createMemo(() => prices()?.data_source ?? "");
  const warnings = createMemo(() => prices()?.warnings ?? []);
  const series = createMemo(() => prices()?.series ?? []);
  const comparison = createMemo(() => prices()?.comparison ?? []);

  const freshness = createMemo(() => {
    const days = freshnessDays();
    const tone = days == null || days > 7 ? "error" : days <= 1 ? "success" : "warning";
    const colour = tone === "success" ? palette.POSITIVE : tone === "warning" ? palette.WARNING : palette.NEGATIVE;
    const stale = days == null
      ? "never collected"
      : days <= 0
        ? "as of today"
        : `${days} day${days === 1 ? "" : "s"} stale`;
    return { tone, colour, stale };
  });

  const chartOption = createMemo(() =>
    buildAgriChartOption({
      mode: mode(),
      series: series().map((point) => ({
        date: point.date,
        modal: point.modal,
        min: point.min,
        max: point.max,
        arrivals_qtl: point.arrivals_qtl,
        market_count: point.market_count,
      })),
      comparison: comparison().map((entry) => ({
        key: entry.key,
        label: entry.label,
        points: entry.points.map((point) => ({ date: point.date, modal: point.modal })),
      })),
      unit: AGRICULTURE_UNIT,
      isDark: isDark(),
      asOf: asOf() ?? undefined,
    }),
  );
  const canDraw = createMemo(() => Object.keys(chartOption()).length > 0);

  const tableRows = createMemo<AgriTableViewRow[]>(() => {
    const quotes = prices()?.quotes ?? [];
    const key = commodity();
    if (quotes.length > 0) {
      return quotes.map((quote, index) => ({
        key: `${quote.date}-${quote.market}-${quote.variety}-${index}`,
        commodity: agriCommodityLabel(key, key),
        group: agriGroupLabel(agriCommodity(key)?.group ?? group()),
        state: quote.state,
        district: quote.district,
        market: quote.market,
        variety: quote.variety,
        min: quote.min,
        modal: quote.modal,
        max: quote.max,
        arrivals_qtl: quote.arrivals_qtl,
        date: quote.date,
        commodityKey: key,
        stateName: quote.state,
        districtName: quote.district,
        marketName: quote.market,
      }));
    }
    return (prices()?.snapshot ?? []).map((snapshot) => ({
      key: `snapshot-${snapshot.key}`,
      commodity: snapshot.label || agriCommodityLabel(snapshot.key, snapshot.key),
      group: snapshot.group ?? "",
      state: "",
      district: "",
      market: "",
      variety: "",
      min: snapshot.min,
      modal: snapshot.modal,
      max: snapshot.max,
      arrivals_qtl: null,
      date: snapshot.date ?? "",
      commodityKey: snapshot.key,
      stateName: "",
      districtName: "",
      marketName: "",
    }));
  });
  const columns = createMemo(() => agriColumns(asOf()));

  function applyRowFilters(row: AgriTableViewRow) {
    batch(() => {
      if (row.commodityKey) setCommodity(row.commodityKey);
      if (row.stateName) setState(row.stateName);
      if (row.districtName) setDistrict(row.districtName);
      if (row.marketName) setMarket(row.marketName);
    });
  }

  function refresh() {
    setRetryToken((value) => value + 1);
  }

  function retryFilters() {
    setFiltersData(null);
    setReady(false);
    loadFilters();
  }

  const emptyCopy = () =>
    asOf()
      ? `No mandi prices recorded for this selection as of ${formatAgriSessionDate(asOf())}.`
      : "No mandi prices have been collected yet.";

  return (
    <Box
      data-testid="agri-page"
      className="flex h-full w-full min-h-0 flex-col gap-2 overflow-hidden p-2"
    >
      <ToolbarRow gap={8} data-testid="agri-toolbar" className="shrink-0">
        <Box className="flex items-center gap-1">
          <Text size="xs" c="dimmed" fw={700} style={{ "font-size": "10px", "text-transform": "uppercase" }}>
            Group
          </Text>
          <Select
            data={groupOptions()}
            value={group()}
            onChange={changeGroup}
            placeholder="All groups"
            clearable
            size="sm"
            w={128}
            data-testid="agri-group-select"
          />
        </Box>
        <Box className="flex items-center gap-1">
          <Text size="xs" c="dimmed" fw={700} style={{ "font-size": "10px", "text-transform": "uppercase" }}>
            Commodity
          </Text>
          <Select
            data={commodityOptions()}
            value={commodity()}
            onChange={changeCommodity}
            size="sm"
            w={150}
            data-testid="agri-commodity-select"
          />
        </Box>
        <Box className="flex items-center gap-1" data-testid="agri-range-strip">
          <For each={AGRI_RANGE_PRESETS}>
            {(preset) => (
              <Button
                size="xs"
                variant={range() === preset.key ? "filled" : "subtle"}
                onClick={() => setRange(preset.key)}
                title={preset.description}
                data-testid={`agri-range-${preset.key}`}
              >
                {preset.label}
              </Button>
            )}
          </For>
        </Box>
        <Box className="flex items-center gap-1">
          <Select
            data={stateOptions()}
            value={state()}
            onChange={(value) => {
              setState(value ?? "");
              setDistrict("");
              setMarket("");
            }}
            placeholder="All India"
            clearable
            size="sm"
            w={116}
            data-testid="agri-state-select"
          />
          <Select
            data={districtOptions()}
            value={district()}
            onChange={(value) => {
              setDistrict(value ?? "");
              setMarket("");
            }}
            placeholder="All districts"
            clearable
            disabled={!state()}
            size="sm"
            w={124}
            data-testid="agri-district-select"
          />
          <Select
            data={marketOptions()}
            value={market()}
            onChange={(value) => setMarket(value ?? "")}
            placeholder="All mandis"
            clearable
            disabled={!district()}
            size="sm"
            w={124}
            data-testid="agri-market-select"
          />
        </Box>
        <Box className="min-w-0 flex-1" />
        <Button
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={pricesLoading() || filtersLoading()}
          data-testid="agri-refresh"
        >
          Refresh
        </Button>
      </ToolbarRow>

      <Box
        data-testid="agri-freshness"
        data-tone={freshness().tone}
        className="flex shrink-0 items-center gap-2 rounded border px-2 py-1"
        style={{
          "background-color": palette.alpha(freshness().colour, 0.1),
          "border-color": palette.alpha(freshness().colour, 0.35),
        }}
      >
        <Box
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ "background-color": freshness().colour }}
          data-testid="agri-freshness-dot"
        />
        <Text size="xs" fw={700} style={{ color: freshness().colour }}>
          {asOf() ? `Data as of ${formatAgriSessionDate(asOf())}` : "No data collected yet"}
          {" · "}{freshness().stale}
          {" · "}{kpis()?.market_count ?? 0} mandis reporting
        </Text>
        <Show when={dataSource() && dataSource() !== "db"}>
          <Badge color="warning" size="xs" data-testid="agri-data-source">
            {dataSource()}
          </Badge>
        </Show>
        <Box className="min-w-0 flex-1" />
        <Show when={warnings().length > 0}>
          <Text size="xs" c="dimmed" data-testid="agri-warnings" truncate>
            {warnings().join(" · ")}
          </Text>
        </Show>
      </Box>

      <CompactStatGrid cols={statCols()} data-testid="agri-kpis">
        <CompactStat
          label="Modal (₹/quintal)"
          value={formatAgriPrice(kpis()?.modal)}
          hint={asOf() ? formatAgriSessionDate(asOf()) : undefined}
          data-testid="agri-kpi-modal"
        />
        <CompactStat
          label="1 week"
          value={formatChangePct(kpis()?.chg_1w_pct)}
          tone={toneForChange(kpis()?.chg_1w_pct)}
          data-testid="agri-kpi-chg1w"
        />
        <CompactStat
          label="1 month"
          value={formatChangePct(kpis()?.chg_1m_pct)}
          tone={toneForChange(kpis()?.chg_1m_pct)}
          data-testid="agri-kpi-chg1m"
        />
        <CompactStat
          label="6 months"
          value={formatChangePct(kpis()?.chg_6m_pct)}
          tone={toneForChange(kpis()?.chg_6m_pct)}
          data-testid="agri-kpi-chg6m"
        />
        <CompactStat
          label="Min–Max (₹/quintal)"
          value={`${formatAgriPrice(kpis()?.min)}–${formatAgriPrice(kpis()?.max)}`}
          data-testid="agri-kpi-range"
        />
        <CompactStat
          label="Mandis reporting"
          value={String(kpis()?.market_count ?? 0)}
          data-testid="agri-kpi-markets"
        />
        <CompactStat
          label="Arrivals (qtl)"
          value={formatArrivals(kpis()?.arrivals_qtl)}
          data-testid="agri-kpi-arrivals"
        />
        <CompactStat
          label="MSP (₹/quintal)"
          value={formatAgriPrice(kpis()?.msp)}
          tone={kpis()?.msp == null ? "dimmed" : undefined}
          hint={kpis()?.msp == null ? "No MSP notified" : formatChangePct(kpis()?.distance_to_msp_pct)}
          data-testid="agri-kpi-msp"
        />
      </CompactStatGrid>

      <Show when={filtersError()}>
        <ErrorAlert
          message={filtersError() ?? "Failed to load agri filters"}
          data-testid="agri-filters-error"
          withRetry
          onRetry={retryFilters}
        />
      </Show>
      <Show when={pricesError()}>
        <ErrorAlert
          message={pricesError() ?? "Failed to load agri prices"}
          data-testid="agri-error"
          withRetry
          onRetry={refresh}
        />
      </Show>
      <Show when={pricesLoading() && !pricesError()}>
        <InlineLoader data-testid="agri-loading" message="Loading mandi prices…" />
      </Show>

      <Show when={!pricesLoading() && !pricesError()}>
        <Box data-testid="agri-body" className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          <CompactPanel
            testId="agri-chart-panel"
            className="flex min-h-0 flex-col"
            scrollable
            style={{ flex: "3 1 0%", "min-height": isMobile() ? "220px" : "320px" }}
            title={`Modal price — ${agriCommodityLabel(commodity(), commodity())}`}
            description={`${agriRange(range())?.label ?? range()} · ${series().length} sessions · ₹/quintal${asOf() ? ` · from ${formatAgriSessionDate(agriRangeStart(asOf(), agriRange(range())?.days ?? null))}` : ""}`}
            action={
              <ToolbarRow gap={4} data-testid="agri-mode-strip">
                <For each={AGRI_CHART_MODES}>
                  {(item) => (
                    <Button
                      size="xs"
                      variant={mode() === item.key ? "filled" : "subtle"}
                      title={item.description}
                      onClick={() => setMode(item.key)}
                      data-testid={`agri-mode-${item.key}`}
                    >
                      {item.label}
                    </Button>
                  )}
                </For>
              </ToolbarRow>
            }
          >
            <Show when={mode() === "compare"}>
              <ToolbarRow gap={4} data-testid="agri-compare-strip" className="shrink-0">
                <Text size="xs" c="dimmed">Compare</Text>
                <For each={DEFAULT_COMPARE}>
                  {(key) => (
                    <Button
                      size="xs"
                      variant={compare().includes(key) ? "light" : "subtle"}
                      onClick={() => toggleCompare(key)}
                      data-testid={`agri-compare-${key}`}
                    >
                      {agriCommodityLabel(key, key)}
                    </Button>
                  )}
                </For>
              </ToolbarRow>
            </Show>
            <Show
              when={canDraw()}
              fallback={
                <EmptyState
                  kind="no-data"
                  data-testid="agri-chart-empty"
                  title="No chart history for this selection"
                  description={emptyCopy()}
                  hint={range() !== "max" ? "Try MAX to show the full collected history" : undefined}
                  action={
                    range() !== "max" ? (
                      <Button size="xs" variant="light" onClick={() => setRange("max")} data-testid="agri-empty-max">
                        Show MAX
                      </Button>
                    ) : undefined
                  }
                />
              }
            >
              <Box className="flex min-h-0 flex-1" style={{ "min-height": "280px" }} data-testid="agri-chart-region">
                <EChart
                  option={chartOption()}
                  style={{ height: isMobile() ? "220px" : "420px" }}
                  data-testid="agri-chart"
                />
              </Box>
            </Show>
          </CompactPanel>

          <CompactPanel
            testId="agri-table-panel"
            className="flex min-h-0 flex-col"
            scrollable
            style={{ flex: "2 1 0%", "min-height": "240px", "max-height": "46vh" }}
            title="Latest mandi prices"
            description={`${tableRows().length} rows · ${formatAgriSessionDate(asOf())}`}
          >
            <Show
              when={tableRows().length > 0}
              fallback={
                <EmptyState
                  kind="no-data"
                  data-testid="agri-table-empty"
                  title="No mandi quotes for this selection"
                  description={emptyCopy()}
                />
              }
            >
              <Box
                className="min-h-0 flex-1 overflow-hidden"
                style={{
                  height: isMobile() ? "260px" : "calc(46vh - 56px)",
                  "max-height": isMobile() ? "260px" : "calc(46vh - 56px)",
                }}
                data-testid="agri-table-region"
              >
                <TanStackTable
                  data={tableRows()}
                  columns={columns()}
                  dataTestId="agri-quotes-table"
                  stickyHeader
                  fillContainer
                  dense
                  rowWindowSize={80}
                  minTableWidth={980}
                  onRowClick={applyRowFilters}
                  getRowTestId={(row) => `agri-row-${row.key}`}
                  ariaLabel="Agricultural mandi prices"
                />
              </Box>
            </Show>
          </CompactPanel>
        </Box>
      </Show>
    </Box>
  );
}
