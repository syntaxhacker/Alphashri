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
  AgriSnapshot,
} from "@/types/agri";
import {
  AGRICULTURE_UNIT,
  AGRI_ARRIVALS_UNIT,
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
import { buildEdaOption } from "./agriEdaOptions";
import { monthlyBox, monthlyHeatmap, seasonality, summariseEda, supplyDemand } from "./agriEda";
import { agriRangeStart, formatAgriSessionDate } from "./agriDates";
import { agriColumns, type AgriTableViewRow } from "./agriColumns";

type SelectOption = { value: string; label: string; group?: string };
type Mover = { key: string; label: string; change: number };

const DEFAULT_COMPARE = ["wheat", "tomato", "onion"];
const MICRO_LABEL = "text-[10px] font-bold uppercase tracking-[0.08em] text-fin-text-muted whitespace-nowrap";
const SEGMENT_TRACK = "inline-flex items-center gap-0.5 rounded-[6px] border border-fin-border bg-fin-surface p-[2px]";
const CONTROL_CELL = "flex flex-nowrap items-center min-w-0";
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function paramValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function normalizeChartMode(value: string): AgriChartMode | "" {
  if (value === "ohlc") return "band";
  if (value === "arrivals" || value === "scatter" || value === "supply-demand") return "supplyDemand";
  return AGRI_CHART_MODES.some((item) => item.key === value) ? (value as AgriChartMode) : "";
}

function monthAbbr(month: number | null): string {
  return month == null ? "—" : MONTH_ABBR[month - 1] ?? "—";
}

function formatEdaPct(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
}

function formatCorrelation(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
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

/** Two gainers and two losers from the snapshot's 1-month change, no API work. */
function moversFromSnapshot(snapshot: AgriSnapshot[]): { gainers: Mover[]; losers: Mover[] } | null {
  const ranked = snapshot
    .filter((row) => typeof row.chg_1m_pct === "number" && Number.isFinite(row.chg_1m_pct))
    .map((row) => ({ key: row.key, label: row.label || agriCommodityLabel(row.key, row.key), change: row.chg_1m_pct as number }))
    .sort((a, b) => b.change - a.change);
  const seen = new Set<string>();
  const pick = (rows: Mover[]): Mover[] => {
    const out: Mover[] = [];
    for (const row of rows) {
      if (seen.has(row.key) || row.change === 0) continue;
      seen.add(row.key);
      out.push(row);
      if (out.length === 2) break;
    }
    return out;
  };
  const gainers = pick(ranked);
  const losers = pick([...ranked].reverse());
  return gainers.length > 0 && losers.length > 0 ? { gainers, losers } : null;
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
  const resolvedMode = normalizeChartMode(initialMode);
  const legacyMode = initialMode !== "" && resolvedMode !== initialMode;

  const [group, setGroup] = createSignal(paramValue(searchParams.group));
  const [commodity, setCommodity] = createSignal(initialCommodity);
  const [state, setState] = createSignal(paramValue(searchParams.state));
  const [district, setDistrict] = createSignal(paramValue(searchParams.district));
  const [market, setMarket] = createSignal(paramValue(searchParams.market));
  const [range, setRange] = createSignal<AgriRangeKey>(
    AGRI_RANGE_KEYS.includes(initialRange as AgriRangeKey) ? (initialRange as AgriRangeKey) : AGRI_DEFAULT_RANGE,
  );
  const [mode, setMode] = createSignal<AgriChartMode>(resolvedMode || AGRI_DEFAULT_CHART_MODE);
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
    if (mode() === "compare" || mode() === "heatmap") {
      params.compare = compare().slice(0, 3);
    }
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
      if (!legacyMode) return;
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
    else if (paramValue(searchParams.mode) !== "") next.mode = "";
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
  const movers = createMemo(() => moversFromSnapshot(prices()?.snapshot ?? []));

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

  const chartSeries = createMemo(() =>
    series().map((point) => ({
      date: point.date,
      modal: point.modal,
      min: point.min,
      max: point.max,
      arrivals_qtl: point.arrivals_qtl,
      market_count: point.market_count,
    })),
  );
  const edaBoxes = createMemo(() => monthlyBox(series()));
  const edaScatter = createMemo(() => supplyDemand(series()));
  const edaSeasonality = createMemo(() => seasonality(series()).months);
  const edaSummary = createMemo(() => summariseEda(series()));
  const edaRows = createMemo(() =>
    monthlyHeatmap([
      {
        key: commodity(),
        label: agriCommodityLabel(commodity(), commodity()),
        points: chartSeries().map((point) => ({ date: point.date, modal: point.modal })),
      },
      ...comparison().map((entry) => ({
        key: entry.key,
        label: entry.label,
        points: entry.points.map((point) => ({ date: point.date, modal: point.modal })),
      })),
    ]),
  );
  const edaInput = createMemo(() => ({
    boxes: edaBoxes(),
    scatter: edaScatter(),
    rows: edaRows(),
    series: chartSeries(),
    seasonality: edaSeasonality(),
    unit: AGRICULTURE_UNIT,
    arrivalsUnit: AGRI_ARRIVALS_UNIT,
    rolling: 7,
    isDark: isDark(),
  }));
  const chartOption = createMemo<Record<string, unknown>>(() => {
    const current = mode();
    if (current === "band" || current === "compare") {
      return buildAgriChartOption({
        mode: current,
        series: chartSeries(),
        comparison: comparison().map((entry) => ({
          key: entry.key,
          label: entry.label,
          points: entry.points.map((point) => ({ date: point.date, modal: point.modal })),
        })),
        unit: AGRICULTURE_UNIT,
        isDark: isDark(),
        asOf: asOf() ?? undefined,
      });
    }
    return buildEdaOption(current, edaInput());
  });
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
        <Box className="flex flex-wrap items-center gap-2 min-w-0" data-testid="agri-scan-group">
          <Text size="xs" fw={700} className={MICRO_LABEL}>Scan</Text>
          <Box className={CONTROL_CELL}>
            <Text size="xs" c="dimmed" className={`${MICRO_LABEL} hidden sm:inline`}>Commodity group</Text>
            <Box className="w-[104px] max-sm:w-[96px]">
              <Select
                data={groupOptions()}
                value={group()}
                onChange={changeGroup}
                placeholder="All groups"
                size="sm"
                style={{ width: "100%" }}
                data-testid="agri-group-select"
              />
            </Box>
          </Box>
          <Box className={CONTROL_CELL}>
            <Text size="xs" c="dimmed" className={`${MICRO_LABEL} hidden sm:inline`}>Commodity</Text>
            <Box className="w-[120px] max-sm:w-[104px]">
              <Select
                data={commodityOptions()}
                value={commodity()}
                onChange={changeCommodity}
                size="sm"
                style={{ width: "100%" }}
                data-testid="agri-commodity-select"
              />
            </Box>
          </Box>
        </Box>

        <Box className="hidden h-5 w-px shrink-0 bg-fin-border md:block" aria-hidden="true" />

        <Box className="flex flex-nowrap items-center gap-2 min-w-0" data-testid="agri-range-group">
          <Text size="xs" c="dimmed" className={MICRO_LABEL}>Range</Text>
          <Box className={SEGMENT_TRACK} data-testid="agri-range-strip">
            <For each={AGRI_RANGE_PRESETS}>
              {(preset) => (
                <Button
                  size="xs"
                  radius="sm"
                  variant={range() === preset.key ? "default" : "subtle"}
                  color={range() === preset.key ? "primary" : undefined}
                  className={range() === preset.key ? "font-semibold" : undefined}
                  onClick={() => setRange(preset.key)}
                  title={preset.description}
                  data-testid={`agri-range-${preset.key}`}
                >
                  {preset.label}
                </Button>
              )}
            </For>
          </Box>
        </Box>

        <Box className="hidden h-5 w-px shrink-0 bg-fin-border lg:block" aria-hidden="true" />

        <Box className="flex flex-nowrap items-center gap-1 min-w-0" data-testid="agri-geo-group" title="Geography">
          <Text size="xs" c="dimmed" className={MICRO_LABEL}>Geo</Text>
          <Box className="w-[108px] max-sm:w-[96px]">
            <Select
              data={stateOptions()}
              value={state()}
              onChange={(value) => {
                setState(value ?? "");
                setDistrict("");
                setMarket("");
              }}
              size="sm"
              style={{ width: "100%" }}
              data-testid="agri-state-select"
            />
          </Box>
          <Box className="w-[116px] max-sm:w-[104px]">
            <Select
              data={districtOptions()}
              value={district()}
              onChange={(value) => {
                setDistrict(value ?? "");
                setMarket("");
              }}
              disabled={!state()}
              size="sm"
              style={{ width: "100%" }}
              data-testid="agri-district-select"
            />
          </Box>
          <Box className="w-[116px] max-sm:w-[104px]">
            <Select
              data={marketOptions()}
              value={market()}
              onChange={(value) => setMarket(value ?? "")}
              disabled={!district()}
              size="sm"
              style={{ width: "100%" }}
              data-testid="agri-market-select"
            />
          </Box>
        </Box>

        <Box className="min-w-0 flex-1" />

        <Box className="flex flex-nowrap items-center gap-2 min-w-0" data-testid="agri-context">
          <Box className="flex items-center gap-1.5 whitespace-nowrap" data-testid="agri-freshness" data-tone={freshness().tone}>
            <Box
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ "background-color": freshness().colour }}
              data-testid="agri-freshness-dot"
            />
            <Text size="xs" c="dimmed" style={{ "font-size": "10px" }}>Data as of</Text>
            <Text size="xs" fw={700} style={{ "font-size": "11px", color: freshness().colour }}>
              {asOf() ? formatAgriSessionDate(asOf()) : "no data"}
            </Text>
            <Text size="xs" c="dimmed" style={{ "font-size": "10px" }}>·</Text>
            <Text size="xs" fw={700} style={{ "font-size": "11px", color: freshness().colour }}>
              {freshness().stale}
            </Text>
            <Text size="xs" c="dimmed" style={{ "font-size": "10px" }}>
              · {kpis()?.market_count ?? 0} mandis
            </Text>
          </Box>
          <Show when={dataSource() && dataSource() !== "db"}>
            <Badge color="warning" size="xs" data-testid="agri-data-source">
              {dataSource()}
            </Badge>
          </Show>
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={pricesLoading() || filtersLoading()}
            data-testid="agri-refresh"
          >
            Refresh
          </Button>
        </Box>
      </ToolbarRow>

      <Show when={warnings().length > 0}>
        <Box className="shrink-0 px-1">
          <Text
            size="xs"
            c="dimmed"
            truncate
            title={warnings().join(" · ")}
            data-testid="agri-warnings"
            style={{ "font-size": "10px" }}
          >
            {warnings().join(" · ")}
          </Text>
        </Box>
      </Show>

      <ToolbarRow gap={8} className="shrink-0 px-1" data-testid="agri-kpi-head">
        <Text size="xs" fw={700} style={{ "font-size": "10px", "letter-spacing": "0.08em", "text-transform": "uppercase", color: palette.PRIMARY }}>
          Market snapshot
        </Text>
        <Text size="xs" c="dimmed" style={{ "font-size": "10px" }}>
          Prices ₹/quintal · arrivals qtl · change vs. prior period
        </Text>
      </ToolbarRow>
      <CompactStatGrid cols={statCols()} data-testid="agri-kpis">
        <CompactStat
          label="Modal price"
          value={formatAgriPrice(kpis()?.modal)}
          hint={asOf() ? `${formatAgriSessionDate(asOf())} · ₹/quintal` : "₹/quintal"}
          data-testid="agri-kpi-modal"
        />
        <CompactStat
          label="1 week"
          value={formatChangePct(kpis()?.chg_1w_pct)}
          tone={toneForChange(kpis()?.chg_1w_pct)}
          hint="price change"
          data-testid="agri-kpi-chg1w"
        />
        <CompactStat
          label="1 month"
          value={formatChangePct(kpis()?.chg_1m_pct)}
          tone={toneForChange(kpis()?.chg_1m_pct)}
          hint="price change"
          data-testid="agri-kpi-chg1m"
        />
        <CompactStat
          label="6 months"
          value={formatChangePct(kpis()?.chg_6m_pct)}
          tone={toneForChange(kpis()?.chg_6m_pct)}
          hint="price change"
          data-testid="agri-kpi-chg6m"
        />
        <CompactStat
          label="Min – max"
          value={`${formatAgriPrice(kpis()?.min)}–${formatAgriPrice(kpis()?.max)}`}
          hint="₹/quintal"
          data-testid="agri-kpi-range"
        />
        <CompactStat
          label="Mandis reporting"
          value={String(kpis()?.market_count ?? 0)}
          hint="markets in this quote set"
          data-testid="agri-kpi-markets"
        />
        <CompactStat
          label="Arrivals"
          value={formatArrivals(kpis()?.arrivals_qtl)}
          hint="quintals"
          data-testid="agri-kpi-arrivals"
        />
        <CompactStat
          label="MSP"
          value={formatAgriPrice(kpis()?.msp)}
          tone={kpis()?.msp == null ? "dimmed" : undefined}
          hint={kpis()?.msp == null ? "No MSP notified" : `${formatChangePct(kpis()?.distance_to_msp_pct)} vs MSP · ₹/quintal`}
          data-testid="agri-kpi-msp"
        />
      </CompactStatGrid>

      <Show when={movers()}>
        {(data) => (
          <ToolbarRow gap={4} wrap={false} className="shrink-0 overflow-x-auto px-1" data-testid="agri-movers">
            <Text size="xs" fw={700} className={MICRO_LABEL}>Top movers · 1M</Text>
            <For each={data().gainers}>
              {(mover) => (
                <Text size="xs" c="success" className="whitespace-nowrap" style={{ "font-size": "11px" }}>
                  ▲ {mover.label} {formatChangePct(mover.change)}
                </Text>
              )}
            </For>
            <Box className="mx-1 h-3 w-px shrink-0 bg-fin-border" aria-hidden="true" />
            <For each={data().losers}>
              {(mover) => (
                <Text size="xs" c="error" className="whitespace-nowrap" style={{ "font-size": "11px" }}>
                  ▼ {mover.label} {formatChangePct(mover.change)}
                </Text>
              )}
            </For>
          </ToolbarRow>
        )}
      </Show>

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
        <CompactPanel
          testId="agri-loading-panel"
          className="shrink-0"
          title="Mandi quotes"
          description="Fetching the latest snapshot…"
        >
          <InlineLoader data-testid="agri-loading" message="Loading mandi prices…" />
        </CompactPanel>
      </Show>

      <Show when={!pricesLoading() && !pricesError()}>
        <Box data-testid="agri-body" className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          <ToolbarRow gap={8} className="shrink-0 px-1" data-testid="agri-eda-head">
            <Text size="xs" fw={700} style={{ "font-size": "10px", "letter-spacing": "0.08em", "text-transform": "uppercase", color: palette.PRIMARY }}>
              EDA summary
            </Text>
            <Text size="xs" c="dimmed" style={{ "font-size": "10px" }}>
              derived from the active window · unavailable inputs read —
            </Text>
          </ToolbarRow>
          <Box
            className="grid shrink-0 grid-cols-2 gap-1 md:grid-cols-3 xl:grid-cols-6"
            data-testid="agri-eda-summary"
          >
            <CompactStat
              label="Window trend"
              value={formatChangePct(edaSummary().trendPct)}
              tone={toneForChange(edaSummary().trendPct)}
              hint="first → last modal"
              data-testid="agri-eda-trend"
            />
            <CompactStat
              label="Realized volatility"
              value={formatEdaPct(edaSummary().volatilityPct)}
              hint="modal coefficient of variation"
              data-testid="agri-eda-volatility"
            />
            <CompactStat
              label="Best month"
              value={monthAbbr(edaSummary().bestMonth)}
              hint="highest average modal"
              data-testid="agri-eda-best"
            />
            <CompactStat
              label="Worst month"
              value={monthAbbr(edaSummary().worstMonth)}
              hint="lowest average modal"
              data-testid="agri-eda-worst"
            />
            <CompactStat
              label="Arrivals corr."
              value={formatCorrelation(edaSummary().arrivalsCorrelation)}
              hint="Pearson r · not causality"
              data-testid="agri-eda-correlation"
            />
            <CompactStat
              label="Outliers"
              value={series().length === 0 ? "—" : String(edaSummary().outlierCount)}
              tone={edaSummary().outlierCount > 0 ? "warning" : undefined}
              hint="outside 1.5×IQR fence"
              data-testid="agri-eda-outliers"
            />
          </Box>
          <CompactPanel
            testId="agri-chart-panel"
            className="flex min-h-0 flex-col"
            scrollable
            style={{ flex: isMobile() ? "1 1 0%" : "3 2 0%", "min-height": isMobile() ? "208px" : "280px" }}
            title={`Modal price — ${agriCommodityLabel(commodity(), commodity())}`}
            description={`${agriRange(range())?.label ?? range()} · ${series().length} sessions · ₹/quintal${asOf() ? ` · from ${formatAgriSessionDate(agriRangeStart(asOf(), agriRange(range())?.days ?? null))}` : ""}`}
          >
            <ToolbarRow gap={8} className="shrink-0 px-1 pb-1" data-testid="agri-mode-row">
              <Text size="xs" c="dimmed" className={MICRO_LABEL}>View</Text>
              <Show
                when={isMobile()}
                fallback={
                  <Box className={`${SEGMENT_TRACK} max-w-full flex-wrap`} data-testid="agri-mode-strip">
                    <For each={AGRI_CHART_MODES}>
                      {(item) => (
                        <Button
                          size="xs"
                          radius="sm"
                          variant={mode() === item.key ? "default" : "subtle"}
                          color={mode() === item.key ? "primary" : undefined}
                          className={mode() === item.key ? "font-semibold" : undefined}
                          title={item.description}
                          onClick={() => setMode(item.key)}
                          data-testid={`agri-mode-${item.key}`}
                        >
                          {item.label}
                        </Button>
                      )}
                    </For>
                  </Box>
                }
              >
                <Box className="w-[132px]" data-testid="agri-mode-select-cell">
                  <Select
                    data={AGRI_CHART_MODES.map((item) => ({ value: item.key, label: item.label }))}
                    value={mode()}
                    onChange={(value) => { if (value) setMode(value as AgriChartMode); }}
                    size="sm"
                    style={{ width: "100%" }}
                    data-testid="agri-mode-select"
                  />
                </Box>
              </Show>
            </ToolbarRow>

            <Show when={mode() === "compare"}>
              <ToolbarRow gap={4} data-testid="agri-compare-strip" className="shrink-0 px-1 pb-1">
                <Text size="xs" c="dimmed" className={MICRO_LABEL}>Compare</Text>
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
              <Box className="flex min-h-0 flex-1" data-testid="agri-chart-region">
                <EChart option={chartOption()} data-testid="agri-chart" />
              </Box>
            </Show>
          </CompactPanel>

          <CompactPanel
            testId="agri-table-panel"
            className="flex min-h-0 flex-col"
            scrollable
            style={{ flex: isMobile() ? "1 1 0%" : "2 1 0%", "min-height": isMobile() ? "176px" : "220px" }}
            title="Latest mandi quotes"
            description={`${tableRows().length} quotes · ${formatAgriSessionDate(asOf())}`}
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
              <Box className="flex min-h-0 flex-1 flex-col" data-testid="agri-table-region">
                <TanStackTable
                  data={tableRows()}
                  columns={columns()}
                  dataTestId="agri-quotes-table"
                  stickyHeader
                  fillContainer
                  dense
                  bare
                  rowWindowSize={80}
                  minTableWidth={1168}
                  onRowClick={applyRowFilters}
                  getRowTestId={(row) => `agri-row-${row.key}`}
                  ariaLabel="Agricultural mandi prices"
                />
                <Show when={isMobile()}>
                  <Text size="xs" c="dimmed" className="shrink-0 px-2 pb-1" data-testid="agri-table-scroll-hint" style={{ "font-size": "10px" }}>
                    Swipe left / right to see all columns →
                  </Text>
                </Show>
              </Box>
            </Show>
          </CompactPanel>
        </Box>
      </Show>
    </Box>
  );
}
