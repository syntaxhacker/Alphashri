import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
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
  typeStyle,
} from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel, CompactStat } from "@/components/common/compact";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";
import { TanStackTable } from "@/components/common/TanStackTable";
import { EChart } from "@/components/common/EChart";
import { fetchAgriFilters, fetchAgriPrices, fetchAgriSources } from "@/api/agri";
import type {
  AgriChartMode,
  AgriFiltersResponse,
  AgriPricesParams,
  AgriPricesResponse,
  AgriRangeKey,
  AgriSnapshot,
  AgriSource,
  AgriSourcesResponse,
} from "@/types/agri";
import {
  AGRICULTURE_UNIT,
  AGRI_ARRIVALS_UNIT,
  AGRI_CHART_MODES,
  AGRI_COMMODITIES,
  AGRI_COMPARE_DEFAULTS,
  AGRI_DEFAULT_CHART_MODE,
  AGRI_DEFAULT_RANGE,
  AGRI_GROUPS,
  AGRI_MAX_COMPARE,
  AGRI_RANGE_KEYS,
  AGRI_RANGE_PRESETS,
  AGRI_SOURCE_LOCAL,
  agriCommodity,
  agriCommodityLabel,
  agriDistrictKey,
  agriGroupLabel,
  agriRange,
  agriSourceCompactLabel,
  agriSourceLabel,
  formatAgriPrice,
  formatArrivals,
  formatChangePct,
} from "@/config/agri";
import { buildAgriChartOption } from "./agriChartOption";
import { buildEdaOption } from "./agriEdaOptions";
import { buildAgriHeroOption } from "./agriHeroOption";
import { buildAgriRankOption } from "./agriRankOption";
import { buildAgriSeasonalityOption } from "./agriSeasonalityOption";
import { buildAgriDispersionOption } from "./agriDispersionOption";
import {
  buildDispersionRows,
  buildRankBoard,
  buildSeasonRows,
  buildSparkRows,
  type AgriAnalyticsSeries,
} from "./agriRedesignData";
import { monthlyBox, monthlyHeatmap, seasonality, summariseEda, supplyDemand } from "./agriEda";
import { agriRangeStart, formatAgriSessionDate } from "./agriDates";
import { AGRI_QUOTE_DEFAULT_SORT, agriColumns, type AgriTableViewRow } from "./agriColumns";
import { AgriGroupOverview } from "./AgriGroupOverview";
import { AgriFluctuationMatrix } from "./AgriFluctuationMatrix";
import { AgriSparkGrid } from "./AgriSparkGrid";
import { buildAgriGroupSummaries } from "./agriGroupSummary";

type SelectOption = { value: string; label: string; group?: string };
type Mover = { key: string; label: string; change: number };
type WarningKind = "gap" | "coverage" | "data";

const MICRO_LABEL =
  "text-ui-micro font-bold uppercase tracking-[0.08em] text-fin-text-muted whitespace-nowrap";
const SECTION_LABEL = "text-ui-micro font-bold uppercase tracking-[0.08em] text-fin-primary";
const SECTION_HINT = "text-ui-micro text-fin-text-muted";
const STAT_CARD = "h-full p-2 [&>div]:!h-auto";
const SEGMENT_TRACK =
  "inline-flex items-center gap-0.5 rounded-[6px] border border-fin-border bg-fin-surface p-[2px]";
const CONTROL_CELL = "flex flex-nowrap items-center min-w-0";
const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function paramValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function normalizeChartMode(value: string): AgriChartMode | "" {
  if (value === "ohlc") return "band";
  if (value === "arrivals" || value === "scatter" || value === "supply-demand")
    return "supplyDemand";
  return AGRI_CHART_MODES.some((item) => item.key === value) ? (value as AgriChartMode) : "";
}

function monthAbbr(month: number | null): string {
  return month == null ? "—" : (MONTH_ABBR[month - 1] ?? "—");
}

function formatEdaPct(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
}

function formatCorrelation(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

/**
 * Backend warnings are plain prose. Grouping them keeps a collection gap
 * visible instead of letting a long list collapse into one muted line.
 */
function warningKind(value: string): WarningKind {
  if (/\bgap\b/i.test(value)) return "gap";
  if (/coverage|partial|missing|unavailable|unit|bundle|quintal/i.test(value)) {
    return "coverage";
  }
  return "data";
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

function normalizeSourceId(value: string | null | undefined): string {
  return value?.trim() || AGRI_SOURCE_LOCAL;
}

/**
 * `/sources` is optional discovery metadata. A partial payload must not turn
 * into an empty select or an unusable URL value, so keep only rows with an id.
 */
function sourceListFrom(value: unknown): AgriSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: AgriSource[] = [];
  for (const item of value) {
    const record = toRecord(item);
    if (!record) continue;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    sources.push({
      id,
      label: typeof record.label === "string" ? record.label : "",
      dataset: typeof record.dataset === "string" ? record.dataset : null,
      as_of: typeof record.as_of === "string" ? record.as_of : null,
      rows: typeof record.rows === "number" && Number.isFinite(record.rows) ? record.rows : 0,
      status: typeof record.status === "string" ? record.status : "",
    });
  }
  return sources;
}

function toneForChange(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "dimmed";
  return value > 0 ? "success" : "error";
}

/** Two gainers and two losers from the snapshot's 1-month change, no API work. */
function moversFromSnapshot(
  snapshot: AgriSnapshot[],
): { gainers: Mover[]; losers: Mover[] } | null {
  const ranked = snapshot
    .filter((row) => typeof row.chg_1m_pct === "number" && Number.isFinite(row.chg_1m_pct))
    .map((row) => ({
      key: row.key,
      label: row.label || agriCommodityLabel(row.key, row.key),
      change: row.chg_1m_pct as number,
    }))
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

  const initialCommodity =
    paramValue(searchParams.commodity) ||
    AGRI_COMMODITIES.find((item) => item.key === "onion")?.key ||
    AGRI_COMMODITIES[0]?.key ||
    "";
  const initialRange = paramValue(searchParams.range);
  const initialMode = paramValue(searchParams.mode);
  const resolvedMode = normalizeChartMode(initialMode);
  const legacyMode = initialMode !== "" && resolvedMode !== initialMode;

  const [source, setSource] = createSignal(normalizeSourceId(paramValue(searchParams.source)));
  const [sourcesData, setSourcesData] = createSignal<AgriSourcesResponse | null>(null);
  const [group, setGroup] = createSignal(paramValue(searchParams.group));
  const [commodity, setCommodity] = createSignal(initialCommodity);
  const [state, setState] = createSignal(paramValue(searchParams.state));
  const [district, setDistrict] = createSignal(paramValue(searchParams.district));
  const [market, setMarket] = createSignal(paramValue(searchParams.market));
  const [range, setRange] = createSignal<AgriRangeKey>(
    AGRI_RANGE_KEYS.includes(initialRange as AgriRangeKey)
      ? (initialRange as AgriRangeKey)
      : AGRI_DEFAULT_RANGE,
  );
  const [mode, setMode] = createSignal<AgriChartMode>(resolvedMode || AGRI_DEFAULT_CHART_MODE);
  const [pageView, setPageView] = createSignal<"overview" | "groups" | "data">("overview");
  const [compareExtras, setCompareExtras] = createSignal<string[]>(
    AGRI_COMPARE_DEFAULTS.filter((key) => key !== initialCommodity).slice(0, AGRI_MAX_COMPARE - 1),
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
  const statCardClass = () => (isMobile() ? `${STAT_CARD} w-[176px] shrink-0` : STAT_CARD);

  let activeSourcesController: AbortController | null = null;
  function loadSources() {
    activeSourcesController?.abort();
    const controller = new AbortController();
    activeSourcesController = controller;
    fetchAgriSources(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        const sources = sourceListFrom(data?.sources);
        setSourcesData({ sources, default: normalizeSourceId(data?.default) });
        // A stale/shared link may name an origin this deployment does not have.
        if (source() !== AGRI_SOURCE_LOCAL && !sources.some((item) => item.id === source())) {
          setSource(AGRI_SOURCE_LOCAL);
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSourcesData({ sources: [], default: AGRI_SOURCE_LOCAL });
        if (source() !== AGRI_SOURCE_LOCAL) setSource(AGRI_SOURCE_LOCAL);
      });
  }
  onMount(loadSources);
  onCleanup(() => activeSourcesController?.abort());

  let activeFilterController: AbortController | null = null;
  function loadFilters() {
    activeFilterController?.abort();
    const controller = new AbortController();
    activeFilterController = controller;
    const selected = source();
    setFiltersLoading(true);
    setFiltersError(null);
    fetchAgriFilters(
      controller.signal,
      selected === AGRI_SOURCE_LOCAL ? undefined : selected,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setFiltersData(data);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFiltersError(error instanceof Error ? error.message : "Failed to load agri filters");
      })
      .finally(() => {
        if (!controller.signal.aborted) setFiltersLoading(false);
      });
  }

  createEffect(() => {
    const selected = source();
    void selected;
    loadFilters();
  });
  onCleanup(() => activeFilterController?.abort());

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

  /** Active commodity first, then up to four extras; never duplicated. */
  function compareKeys(): string[] {
    const active = commodity();
    return [active, ...compareExtras().filter((key) => key !== active)].slice(0, AGRI_MAX_COMPARE);
  }

  createEffect(() => {
    if (!ready()) return;
    const token = retryToken();
    const params: AgriPricesParams = {
      commodity: commodity(),
      range: range(),
    };
    const selectedSource = source();
    if (selectedSource !== AGRI_SOURCE_LOCAL) params.source = selectedSource;
    // The active commodity is the anchor. Requesting the tracked set on every
    // mode gives the rank board, seasonality rows and sparkline cells real
    // paths instead of derived guesses; the cap stays at AGRI_MAX_COMPARE.
    params.compare = compareKeys();
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
      source: source(),
    };
    if (firstWrite) {
      firstWrite = false;
      if (!legacyMode && paramValue(searchParams.source) === "") return;
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
    if (nextState.source !== AGRI_SOURCE_LOCAL) next.source = nextState.source;
    else if (paramValue(searchParams.source) !== "") next.source = "";
    if (new URLSearchParams(next).toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  });

  const commodityFilters = createMemo(() => filtersData()?.commodities ?? []);
  const commodityMetaByKey = createMemo(
    () => new Map(commodityFilters().map((item) => [item.key, item])),
  );
  const groupLabelsByKey = createMemo(
    () =>
      new Map(selectOptions(filtersData()?.groups).map((option) => [option.value, option.label])),
  );
  const availableSources = createMemo(() => sourcesData()?.sources ?? []);
  const sourceOptions = createMemo<SelectOption[]>(() => {
    // A native select uses the option text as its closed label too: show the
    // full name on wide screens, but only the complete dataset tag on mobile.
    const compact = isMobile();
    const labelFor = (id: string, label: string, dataset: string | null) =>
      compact ? agriSourceCompactLabel(id, dataset) : agriSourceLabel(id, label);
    const options: SelectOption[] = [
      { value: AGRI_SOURCE_LOCAL, label: labelFor(AGRI_SOURCE_LOCAL, "Local cache", null) },
      ...availableSources()
        .filter((item) => item.id !== AGRI_SOURCE_LOCAL)
        .map((item) => ({ value: item.id, label: labelFor(item.id, item.label, item.dataset) })),
    ];
    // Keep a URL-selected origin visible even if discovery has not landed yet.
    const selected = source();
    if (selected !== AGRI_SOURCE_LOCAL && !options.some((option) => option.value === selected)) {
      const dataset = availableSources().find((item) => item.id === selected)?.dataset;
      options.push({ value: selected, label: labelFor(selected, "", dataset ?? null) });
    }
    return options;
  });
  const sourceBadge = createMemo(() => {
    const selected = source();
    if (selected === AGRI_SOURCE_LOCAL) return "";
    const meta = availableSources().find((item) => item.id === selected);
    if (meta?.label?.trim()) return meta.label;
    if (meta?.dataset?.trim()) return `Release ${meta.dataset.trim()}`;
    return agriSourceLabel(selected);
  });

  /** Labels prefer the backend registry; the static list is a fallback only. */
  function commodityLabel(key: string, fallback = "—"): string {
    return commodityMetaByKey().get(key)?.label ?? agriCommodityLabel(key, fallback);
  }

  function groupLabel(key: string): string {
    return groupLabelsByKey().get(key) ?? agriGroupLabel(key);
  }

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
  const districtOptions = createMemo<SelectOption[]>(() => {
    const selected = state();
    const geography = filtersData()?.state_districts;
    // `state_districts` is the cascade source. The flat districts list is only
    // a compatibility fallback for payloads from before the cascade existed.
    const names = geography
      ? selected
        ? (geography[selected] ?? [])
        : []
      : selected
        ? selectOptions(filtersData()?.districts).map((option) => option.value)
        : [];
    return [
      { value: "", label: "All districts" },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  });
  const marketOptions = createMemo<SelectOption[]>(() => {
    const selectedState = state();
    const selectedDistrict = district();
    const geography = filtersData()?.district_markets;
    const names = geography
      ? selectedState && selectedDistrict
        ? (geography[agriDistrictKey(selectedState, selectedDistrict)] ?? [])
        : []
      : selectedDistrict
        ? selectOptions(filtersData()?.markets).map((option) => option.value)
        : [];
    return [
      { value: "", label: "All mandis" },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  });

  function changeSource(value: string | null) {
    const next = normalizeSourceId(value);
    if (next === source()) return;
    setSource(next);
  }

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
    // Keep the same array when nothing changed so the price effect does not
    // fire twice for one selection.
    setCompareExtras((previous) =>
      previous.includes(next) ? previous : previous.filter((key) => key !== next),
    );
  }

  function toggleCompare(key: string) {
    if (key === commodity()) return;
    setCompareExtras((previous) => {
      if (previous.includes(key)) return previous.filter((item) => item !== key);
      if (compareKeys().length >= AGRI_MAX_COMPARE) return previous;
      return [...previous, key];
    });
  }

  function addCompare(value: string | null) {
    if (!value || value === commodity()) return;
    setCompareExtras((previous) => {
      if (previous.includes(value)) return previous;
      if (compareKeys().length >= AGRI_MAX_COMPARE) return previous;
      return [...previous, value];
    });
  }

  const compareAddOptions = createMemo<SelectOption[]>(() =>
    commodityOptions()
      .filter((option) => option.value !== commodity() && !compareExtras().includes(option.value))
      .map((option) => ({ value: option.value, label: option.label })),
  );

  const kpis = createMemo(() => prices()?.kpis ?? null);
  const asOf = createMemo(() => prices()?.as_of ?? filtersData()?.as_of ?? null);
  const freshnessDays = createMemo(
    () => prices()?.freshness_days ?? filtersData()?.freshness_days ?? null,
  );
  const dataSource = createMemo(() => prices()?.data_source ?? "");
  const warnings = createMemo(() => prices()?.warnings ?? []);
  const series = createMemo(() => prices()?.series ?? []);
  const comparison = createMemo(() => prices()?.comparison ?? []);
  const snapshot = createMemo(() => prices()?.snapshot ?? []);
  const movers = createMemo(() => moversFromSnapshot(snapshot()));
  const groupSummaries = createMemo(() => buildAgriGroupSummaries(snapshot()));

  const freshness = createMemo(() => {
    const days = freshnessDays();
    const tone = days == null || days > 7 ? "error" : days <= 1 ? "success" : "warning";
    const colour =
      tone === "success"
        ? palette.POSITIVE
        : tone === "warning"
          ? palette.WARNING
          : palette.NEGATIVE;
    const stale =
      days == null
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
  const edaSeasonalityResult = createMemo(() => seasonality(series()));
  const edaSeasonality = createMemo(() => edaSeasonalityResult().months);
  const seasonalityWeak = createMemo(() => edaSeasonalityResult().weak);
  const seasonalityDetail = createMemo(() => {
    const months = edaSeasonality();
    if (months.length === 0) return "No monthly history in this window.";
    const minimum = Math.min(...months.map((month) => month.years));
    return `${months.length} month${months.length === 1 ? "" : "s"} observed · at least ${minimum} year${minimum === 1 ? "" : "s"} per month · need 2+`;
  });
  const edaSummary = createMemo(() => summariseEda(series()));
  const edaRows = createMemo(() =>
    monthlyHeatmap([
      {
        key: commodity(),
        label: commodityLabel(commodity(), commodity()),
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
    if (current === "seasonality" && seasonalityWeak()) return {};
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

  /** One tracked set feeds the hero context, rank board, seasonality and grid. */
  const analyticsSeries = createMemo<AgriAnalyticsSeries[]>(() => [
    {
      key: commodity(),
      label: commodityLabel(commodity(), commodity()),
      points: chartSeries().map((point) => ({ date: point.date, modal: point.modal })),
    },
    ...comparison().map((entry) => ({
      key: entry.key,
      label: entry.label,
      points: entry.points.map((point) => ({ date: point.date, modal: point.modal })),
    })),
  ]);
  const heroOption = createMemo(() =>
    buildAgriHeroOption({
      title: commodityLabel(commodity(), commodity()),
      series: chartSeries(),
      comparison: analyticsSeries().slice(1),
      unit: AGRICULTURE_UNIT,
      isDark: isDark(),
      asOf: asOf() ?? undefined,
      compact: isMobile(),
    }),
  );
  const heroCanDraw = createMemo(() =>
    mode() === "band" ? Object.keys(heroOption()).length > 0 : canDraw(),
  );
  const rankRows = createMemo(() => buildRankBoard(analyticsSeries()));
  const rankOption = createMemo(() =>
    buildAgriRankOption({
      rows: rankRows(),
      selected: commodity(),
      isDark: isDark(),
      compact: isMobile(),
    }),
  );
  const seasonRows = createMemo(() => buildSeasonRows(analyticsSeries()));
  const seasonOption = createMemo(() =>
    buildAgriSeasonalityOption({
      rows: seasonRows(),
      unit: AGRICULTURE_UNIT,
      isDark: isDark(),
      compact: isMobile(),
    }),
  );
  const sparkRows = createMemo(() =>
    buildSparkRows(snapshot(), comparison(), (key, fallback) => commodityLabel(key, fallback)),
  );

  const quotes = createMemo(() => prices()?.quotes ?? []);
  const dispersionRows = createMemo(() => buildDispersionRows(quotes()));
  const dispersionOption = createMemo(() =>
    buildAgriDispersionOption({
      rows: dispersionRows(),
      unit: AGRICULTURE_UNIT,
      isDark: isDark(),
      compact: isMobile(),
    }),
  );
  const quotesTotal = createMemo(() => {
    const total = prices()?.quotes_total;
    if (typeof total !== "number" || !Number.isFinite(total)) return null;
    return total >= quotes().length ? total : null;
  });
  const quoteScope = createMemo(() => {
    const shown = quotes().length;
    const total = quotesTotal();
    const count =
      total != null
        ? `showing ${shown} of ${total} quotes`
        : `${shown} quote${shown === 1 ? "" : "s"} shown`;
    return `${count} · API page, not the full mandi universe`;
  });
  const classifiedWarnings = createMemo(() =>
    warnings().map((text) => ({ text, kind: warningKind(text) })),
  );
  const gapWarnings = createMemo(() =>
    classifiedWarnings().filter((warning) => warning.kind === "gap"),
  );
  const coverageWarnings = createMemo(() =>
    classifiedWarnings().filter((warning) => warning.kind === "coverage"),
  );

  const tableRows = createMemo<AgriTableViewRow[]>(() => {
    const rows = quotes();
    const key = commodity();
    if (rows.length > 0) {
      return rows.map((quote, index) => ({
        key: `${quote.date}-${quote.market}-${quote.variety}-${index}`,
        commodity: commodityLabel(key, key),
        group: groupLabel(
          commodityMetaByKey().get(key)?.group ?? agriCommodity(key)?.group ?? group(),
        ),
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
      commodity: snapshot.label || commodityLabel(snapshot.key, snapshot.key),
      group: groupLabel(snapshot.group ?? ""),
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
      className="flex h-full w-full min-h-0 flex-col gap-2 overflow-hidden bg-fin-bg p-2"
    >
      <ToolbarRow
        gap={8}
        data-testid="agri-toolbar"
        className="sticky top-0 z-20 shrink-0 rounded-[6px] border border-fin-border bg-fin-bg px-2 py-1"
      >
        <Box className="flex flex-wrap items-center gap-2 min-w-0" data-testid="agri-scan-group">
          <Text fw={700} className={MICRO_LABEL}>
            Scan
          </Text>
          <Box className={CONTROL_CELL}>
            <Text c="dimmed" className={`${MICRO_LABEL} hidden sm:inline`}>
              Source
            </Text>
            <Box className="w-[200px] max-sm:w-[132px]">
              <Select
                data={sourceOptions()}
                value={source()}
                onChange={changeSource}
                size="sm"
                style={{ width: "100%" }}
                data-testid="agri-source-select"
                aria-label="Source"
              />
            </Box>
          </Box>
          <Box className={CONTROL_CELL}>
            <Text c="dimmed" className={`${MICRO_LABEL} hidden sm:inline`}>
              Commodity group
            </Text>
            <Box className="w-[104px] max-sm:w-[96px]">
              <Select
                data={groupOptions()}
                value={group()}
                onChange={changeGroup}
                placeholder="All groups"
                size="sm"
                style={{ width: "100%" }}
                data-testid="agri-group-select"
                aria-label="Commodity group"
              />
            </Box>
          </Box>
          <Box className={CONTROL_CELL}>
            <Text c="dimmed" className={`${MICRO_LABEL} hidden sm:inline`}>
              Commodity
            </Text>
            <Box className="w-[120px] max-sm:w-[104px]">
              <Select
                data={commodityOptions()}
                value={commodity()}
                onChange={changeCommodity}
                size="sm"
                style={{ width: "100%" }}
                data-testid="agri-commodity-select"
                aria-label="Commodity"
              />
            </Box>
          </Box>
        </Box>

        <Box className="hidden h-5 w-px shrink-0 bg-fin-border md:block" aria-hidden="true" />

        <Box className="flex flex-nowrap items-center gap-2 min-w-0" data-testid="agri-range-group">
          <Text c="dimmed" className={MICRO_LABEL}>
            Range
          </Text>
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
                  aria-pressed={range() === preset.key}
                >
                  {preset.label}
                </Button>
              )}
            </For>
          </Box>
        </Box>

        <Box className="hidden h-5 w-px shrink-0 bg-fin-border lg:block" aria-hidden="true" />

        <Box
          className="flex flex-nowrap items-center gap-1 min-w-0"
          data-testid="agri-geo-group"
          title="Geography"
        >
          <Text c="dimmed" className={MICRO_LABEL}>
            Geo
          </Text>
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
              aria-label="State"
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
              aria-label="District"
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
              aria-label="Mandi"
            />
          </Box>
        </Box>

        <Box className="min-w-0 flex-1" />

        <Box className="flex flex-wrap items-center gap-2 min-w-0" data-testid="agri-context">
          <Box
            className="flex items-center gap-1.5 whitespace-nowrap"
            data-testid="agri-freshness"
            data-tone={freshness().tone}
          >
            <Box
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ "background-color": freshness().colour }}
              data-testid="agri-freshness-dot"
            />
            <Text size="xs" c="dimmed" style={typeStyle("micro")}>
              Data as of
            </Text>
            <Text size="xs" fw={700} style={{ ...typeStyle("micro"), color: freshness().colour }}>
              {asOf() ? formatAgriSessionDate(asOf()) : "no data"}
            </Text>
            <Text size="xs" c="dimmed" style={typeStyle("micro")}>
              ·
            </Text>
            <Text size="xs" fw={700} style={{ ...typeStyle("micro"), color: freshness().colour }}>
              {freshness().stale}
            </Text>
            <Text size="xs" c="dimmed" style={typeStyle("micro")}>
              · {kpis()?.market_count ?? 0} mandis
            </Text>
          </Box>
          <Show when={sourceBadge()}>
            <Badge color="info" size="xs" data-testid="agri-source-badge" title={sourceBadge()}>
              {sourceBadge()}
            </Badge>
          </Show>
          <Show when={dataSource() && dataSource() !== "db"}>
            <Badge color="warning" size="xs" data-testid="agri-data-source">
              {dataSource()}
            </Badge>
          </Show>
          <Show when={pricesLoading() && prices()}>
            <Badge color="info" size="xs" data-testid="agri-refreshing">
              Refreshing…
            </Badge>
          </Show>
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={pricesLoading() || filtersLoading()}
            title="Reload the current selection without clearing the page"
            data-testid="agri-refresh"
          >
            Refresh
          </Button>
        </Box>
      </ToolbarRow>

      <Show when={warnings().length > 0}>
        <Box
          className="shrink-0 rounded-[6px] border border-fin-border bg-fin-surface px-2 py-1"
          data-testid="agri-warnings"
        >
          <For each={classifiedWarnings()}>
            {(warning) => (
              <Text
                size="xs"
                c="dimmed"
                className="block break-words"
                style={typeStyle("micro")}
                data-testid={
                  warning.kind === "gap"
                    ? "agri-gap-warning"
                    : warning.kind === "coverage"
                      ? "agri-coverage-warning"
                      : "agri-warning"
                }
              >
                <span style={{ "font-weight": 700, "text-transform": "uppercase" }}>
                  {warning.kind}
                </span>{" "}
                {warning.text}
              </Text>
            )}
          </For>
          <Show when={gapWarnings().length === 0 && coverageWarnings().length === 0}>
            <Text size="xs" c="dimmed" className="block break-words" style={typeStyle("micro")}>
              {series().length} sessions · {kpis()?.market_count ?? 0} mandis reporting
            </Text>
          </Show>
        </Box>
      </Show>

      <ToolbarRow gap={8} className="shrink-0 px-1" data-testid="agri-kpi-head">
        <Text fw={700} className={SECTION_LABEL}>
          Market snapshot
        </Text>
        <Text c="dimmed" className={SECTION_HINT}>
          Prices ₹/quintal · arrivals qtl · change vs. prior period
        </Text>
      </ToolbarRow>
      <Box
        data-testid="agri-kpis"
        className={
          isMobile() ? "flex shrink-0 gap-2 overflow-x-auto px-1 pb-1" : "grid shrink-0 gap-2 px-1"
        }
        style={
          isMobile()
            ? undefined
            : { "grid-template-columns": `repeat(${statCols()}, minmax(0, 1fr))` }
        }
      >
        <CompactStat
          label="Modal price"
          value={formatAgriPrice(kpis()?.modal)}
          hint={asOf() ? `${formatAgriSessionDate(asOf())} · ₹/quintal` : "₹/quintal"}
          className={statCardClass()}
          data-testid="agri-kpi-modal"
        />
        <CompactStat
          label="1 week"
          value={formatChangePct(kpis()?.chg_1w_pct)}
          tone={toneForChange(kpis()?.chg_1w_pct)}
          hint="price change"
          className={statCardClass()}
          data-testid="agri-kpi-chg1w"
        />
        <CompactStat
          label="1 month"
          value={formatChangePct(kpis()?.chg_1m_pct)}
          tone={toneForChange(kpis()?.chg_1m_pct)}
          hint="price change"
          className={statCardClass()}
          data-testid="agri-kpi-chg1m"
        />
        <CompactStat
          label="6 months"
          value={formatChangePct(kpis()?.chg_6m_pct)}
          tone={toneForChange(kpis()?.chg_6m_pct)}
          hint="price change"
          className={statCardClass()}
          data-testid="agri-kpi-chg6m"
        />
        <CompactStat
          label="Min – max"
          value={`${formatAgriPrice(kpis()?.min)}–${formatAgriPrice(kpis()?.max)}`}
          hint="₹/quintal"
          className={statCardClass()}
          data-testid="agri-kpi-range"
        />
        <CompactStat
          label="Mandis reporting"
          value={String(kpis()?.market_count ?? 0)}
          hint="markets in this API page"
          className={statCardClass()}
          data-testid="agri-kpi-markets"
        />
        <CompactStat
          label="Arrivals"
          value={formatArrivals(kpis()?.arrivals_qtl)}
          hint="quintals"
          className={statCardClass()}
          data-testid="agri-kpi-arrivals"
        />
        <CompactStat
          label="MSP"
          value={formatAgriPrice(kpis()?.msp)}
          tone={kpis()?.msp == null ? "dimmed" : undefined}
          hint={
            kpis()?.msp == null
              ? "No MSP notified"
              : `${formatChangePct(kpis()?.distance_to_msp_pct)} vs MSP · ₹/quintal`
          }
          className={statCardClass()}
          data-testid="agri-kpi-msp"
        />
      </Box>

      <Show when={movers()}>
        {(data) => (
          <ToolbarRow
            gap={4}
            wrap={false}
            className="shrink-0 overflow-x-auto px-1"
            data-testid="agri-movers"
          >
            <Text fw={700} className={MICRO_LABEL}>
              Top movers · 1M
            </Text>
            <For each={data().gainers}>
              {(mover) => (
                <Text
                  size="xs"
                  c="success"
                  className="whitespace-nowrap"
                  style={typeStyle("micro")}
                >
                  ▲ {mover.label} {formatChangePct(mover.change)}
                </Text>
              )}
            </For>
            <Box className="mx-1 h-3 w-px shrink-0 bg-fin-border" aria-hidden="true" />
            <For each={data().losers}>
              {(mover) => (
                <Text size="xs" c="error" className="whitespace-nowrap" style={typeStyle("micro")}>
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
      <Show when={pricesLoading() && !prices() && !pricesError() && !filtersError()}>
        <CompactPanel
          testId="agri-loading-panel"
          className="shrink-0"
          title="Mandi quotes"
          description="Fetching the latest snapshot…"
        >
          <InlineLoader data-testid="agri-loading" message="Loading mandi prices…" />
        </CompactPanel>
      </Show>

      <Show when={prices()}>
        <Box
          data-testid="agri-body"
          role="region"
          aria-label="Agri workspace"
          tabIndex={isMobile() ? 0 : undefined}
          aria-busy={pricesLoading() ? "true" : undefined}
          className={`flex min-h-0 flex-1 flex-col gap-2 ${isMobile() ? "overflow-y-auto" : "overflow-hidden"}`}
        >
          <ToolbarRow gap={8} className="shrink-0 px-1" data-testid="agri-eda-head">
            <Text fw={700} className={SECTION_LABEL}>
              Workspace
            </Text>
            <Text c="dimmed" className={SECTION_HINT}>
              visuals first · data on demand · unavailable inputs read —
            </Text>
            <Box className="ml-auto flex items-center gap-1" data-testid="agri-view-toggle">
              <Button
                size="xs"
                radius="sm"
                variant={pageView() === "overview" ? "default" : "subtle"}
                color={pageView() === "overview" ? "primary" : undefined}
                className={pageView() === "overview" ? "font-semibold" : undefined}
                onClick={() => setPageView("overview")}
                data-testid="agri-view-chart"
                aria-pressed={pageView() === "overview"}
              >
                Overview
              </Button>
              <Button
                size="xs"
                radius="sm"
                variant={pageView() === "groups" ? "default" : "subtle"}
                color={pageView() === "groups" ? "primary" : undefined}
                className={pageView() === "groups" ? "font-semibold" : undefined}
                onClick={() => setPageView("groups")}
                data-testid="agri-view-groups"
                aria-pressed={pageView() === "groups"}
              >
                Categories
              </Button>
              <Button
                size="xs"
                radius="sm"
                variant={pageView() === "data" ? "default" : "subtle"}
                color={pageView() === "data" ? "primary" : undefined}
                className={pageView() === "data" ? "font-semibold" : undefined}
                onClick={() => setPageView("data")}
                data-testid="agri-view-data"
                aria-pressed={pageView() === "data"}
              >
                Data
              </Button>
            </Box>
          </ToolbarRow>
          <Box
            className={
              isMobile()
                ? "flex shrink-0 gap-2 overflow-x-auto px-1 pb-1"
                : "grid shrink-0 grid-cols-2 gap-2 px-1 md:grid-cols-3 xl:grid-cols-6"
            }
            data-testid="agri-eda-summary"
          >
            <CompactStat
              label="Window trend"
              value={formatChangePct(edaSummary().trendPct)}
              tone={toneForChange(edaSummary().trendPct)}
              hint="first → last modal"
              className={statCardClass()}
              data-testid="agri-eda-trend"
            />
            <CompactStat
              label="Price dispersion"
              value={formatEdaPct(edaSummary().volatilityPct)}
              hint="modal level CV · not returns"
              className={statCardClass()}
              data-testid="agri-eda-volatility"
            />
            <CompactStat
              label="Best month"
              value={monthAbbr(edaSummary().bestMonth)}
              hint="highest average modal"
              className={statCardClass()}
              data-testid="agri-eda-best"
            />
            <CompactStat
              label="Worst month"
              value={monthAbbr(edaSummary().worstMonth)}
              hint="lowest average modal"
              className={statCardClass()}
              data-testid="agri-eda-worst"
            />
            <CompactStat
              label="Arrivals corr."
              value={formatCorrelation(edaSummary().arrivalsCorrelation)}
              hint="Pearson r · not causality"
              className={statCardClass()}
              data-testid="agri-eda-correlation"
            />
            <CompactStat
              label="Outliers"
              value={series().length === 0 ? "—" : String(edaSummary().outlierCount)}
              tone={edaSummary().outlierCount > 0 ? "warning" : undefined}
              hint="outside 1.5×IQR fence"
              className={statCardClass()}
              data-testid="agri-eda-outliers"
            />
          </Box>
          <Show
            when={pageView() === "overview"}
            fallback={
              <Show
                when={pageView() === "groups"}
                fallback={
                  <Box
                    className="flex min-h-0 flex-1 flex-col gap-2"
                    data-testid="agri-data-view"
                  >
                    <CompactPanel
                      testId="agri-table-panel"
                      className="flex min-h-0 flex-col"
                      scrollable
                      style={{
                        flex: isMobile() ? "0 0 320px" : "1 1 0%",
                        "min-height": isMobile() ? "320px" : "240px",
                      }}
                      title="Latest mandi quotes · Data"
                      description={
                        quotes().length > 0
                          ? `${quoteScope()} · ${formatAgriSessionDate(asOf())}`
                          : `${tableRows().length} snapshot rows · ${formatAgriSessionDate(asOf())} · not a mandi universe`
                      }
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
                            bare
                            rowWindowSize={80}
                            minTableWidth={1168}
                            initialSorting={AGRI_QUOTE_DEFAULT_SORT}
                            onRowClick={(row) => {
                              applyRowFilters(row);
                              setPageView("overview");
                            }}
                            getRowTestId={(row) => `agri-row-${row.key}`}
                            ariaLabel="Agricultural mandi prices"
                          />
                          <Text
                            size="xs"
                            c="dimmed"
                            className="shrink-0 px-2 pb-1 break-words text-ui-micro"
                            data-testid="agri-table-scope"
                          >
                            Sorted by modal price (high → low) · {quoteScope()}
                          </Text>
                          <Show when={isMobile()}>
                            <Text
                              size="xs"
                              c="dimmed"
                              className="shrink-0 px-2 pb-1 text-ui-micro"
                              data-testid="agri-table-scroll-hint"
                            >
                              Swipe left / right to see all columns →
                            </Text>
                          </Show>
                        </Box>
                      </Show>
                    </CompactPanel>
                  </Box>
                }
              >
                <Box
                  className="flex min-h-0 flex-1 flex-col gap-2"
                  data-testid="agri-groups-view"
                >
                  <AgriGroupOverview
                    className="shrink-0"
                    groups={groupSummaries()}
                    asOf={asOf()}
                    selected={group()}
                    onSelect={(key) => {
                      setGroup(key);
                      setPageView("overview");
                    }}
                  />
                  <AgriFluctuationMatrix
                    className="shrink-0"
                    rows={snapshot()}
                    group={group() || null}
                    asOf={asOf()}
                    selected={commodity()}
                    onSelect={(key) => {
                      setCommodity(key);
                      setPageView("overview");
                    }}
                  />
                </Box>
              </Show>
            }
          >
            <Box
              data-testid="agri-overview-grid"
              className={
                isMobile()
                  ? "flex min-h-0 flex-1 flex-col gap-2"
                  : "grid min-h-0 flex-1 grid-cols-12 grid-rows-2 gap-2"
              }
            >
              <CompactPanel
                testId="agri-chart-panel"
                className="col-span-12 flex min-h-0 flex-col lg:col-span-8"
                scrollable
                style={{
                  flex: isMobile() ? "0 0 320px" : "1 1 0%",
                  "min-height": isMobile() ? "320px" : "0px",
                }}
                title={`Price focus — ${commodityLabel(commodity(), commodity())}`}
                description={
                  mode() === "band" && asOf()
                    ? `How to read: bold = modal ₹/quintal · thin = tracked commodities · latest as of ${formatAgriSessionDate(asOf())}`
                    : `${agriRange(range())?.label ?? range()} · ${series().length} sessions · ₹/quintal${asOf() ? ` · from ${formatAgriSessionDate(agriRangeStart(asOf(), agriRange(range())?.days ?? null))}` : ""}`
                }
              >
              <ToolbarRow gap={8} className="shrink-0 px-1 pb-1" data-testid="agri-mode-row">
                <Text c="dimmed" className={MICRO_LABEL}>
                  View
                </Text>
                <Show
                  when={isMobile()}
                  fallback={
                    <Box
                      className={`${SEGMENT_TRACK} max-w-full flex-wrap`}
                      data-testid="agri-mode-strip"
                    >
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
                            aria-pressed={mode() === item.key}
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
                      data={AGRI_CHART_MODES.map((item) => ({
                        value: item.key,
                        label: item.label,
                      }))}
                      value={mode()}
                      onChange={(value) => {
                        if (value) setMode(value as AgriChartMode);
                      }}
                      size="sm"
                      style={{ width: "100%" }}
                      data-testid="agri-mode-select"
                      aria-label="Chart view"
                    />
                  </Box>
                </Show>
              </ToolbarRow>

              <Show when={mode() === "compare"}>
                <ToolbarRow gap={4} data-testid="agri-compare-strip" className="shrink-0 px-1 pb-1">
                  <Text c="dimmed" className={MICRO_LABEL}>
                    Compare · max {AGRI_MAX_COMPARE}
                  </Text>
                  <Badge
                    color="info"
                    size="xs"
                    title="The active commodity is always included"
                    data-testid="agri-compare-active"
                  >
                    {commodityLabel(commodity(), commodity())}
                  </Badge>
                  <For each={compareExtras()}>
                    {(key) => (
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => toggleCompare(key)}
                        title={`Remove ${commodityLabel(key, key)} from the comparison`}
                        data-testid={`agri-compare-${key}`}
                      >
                        {commodityLabel(key, key)} ×
                      </Button>
                    )}
                  </For>
                  <Show
                    when={compareAddOptions().length > 0 && compareKeys().length < AGRI_MAX_COMPARE}
                  >
                    <Box className="w-[142px] max-sm:w-[128px]">
                      <Select
                        data={compareAddOptions()}
                        value=""
                        onChange={addCompare}
                        placeholder="Add commodity"
                        size="xs"
                        style={{ width: "100%" }}
                        data-testid="agri-compare-add"
                        aria-label="Add commodity to comparison"
                      />
                    </Box>
                  </Show>
                </ToolbarRow>
              </Show>

              <Show when={mode() === "seasonality" && seasonalityWeak()}>
                <EmptyState
                  kind="no-data"
                  data-testid="agri-seasonality-weak"
                  title="Seasonality is not measurable yet"
                  description={`A month-of-year cycle needs at least two distinct years. ${seasonalityDetail()}`}
                  hint="Showing this on one annual cycle would imply a pattern the data cannot support."
                  action={
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => setMode("band")}
                      data-testid="agri-seasonality-band"
                    >
                      Show price band
                    </Button>
                  }
                />
              </Show>

              <Show when={!(mode() === "seasonality" && seasonalityWeak())}>
                <Show
                  when={heroCanDraw()}
                  fallback={
                    <EmptyState
                      kind="no-data"
                      data-testid="agri-chart-empty"
                      title="No chart history for this selection"
                      description={emptyCopy()}
                      hint={
                        range() !== "max" ? "Try MAX to show the full collected history" : undefined
                      }
                      action={
                        range() !== "max" ? (
                          <Button
                            size="xs"
                            variant="light"
                            onClick={() => setRange("max")}
                            data-testid="agri-empty-max"
                          >
                            Show MAX
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                >
                  <Box
                    className="flex min-h-[240px] flex-1"
                    style={{ "min-height": "240px", flex: "1 1 0%" }}
                    data-testid="agri-chart-region"
                  >
                    <EChart
                      option={mode() === "band" ? heroOption() : chartOption()}
                      data-testid="agri-chart"
                    />
                  </Box>
                </Show>
              </Show>
            </CompactPanel>

            <CompactPanel
              testId="agri-spark-panel"
              className="col-span-12 flex min-h-0 flex-col lg:col-span-4 lg:row-span-2"
              scrollable
              style={{
                flex: isMobile() ? "0 0 auto" : "1 1 0%",
                "min-height": isMobile() ? "260px" : "0px",
              }}
              title="Commodity universe"
              description="Click or press Enter / Space to focus the price chart"
            >
              <Show
                when={sparkRows().length > 0}
                fallback={
                  <EmptyState
                    kind="no-data"
                    data-testid="agri-spark-empty"
                    title="No commodity universe in this payload"
                    description="Waiting for the next snapshot."
                  />
                }
              >
                <AgriSparkGrid
                  rows={sparkRows()}
                  selected={commodity()}
                  onSelect={changeCommodity}
                />
              </Show>
            </CompactPanel>

            <CompactPanel
              testId="agri-rank-panel"
              className="col-span-12 flex min-h-0 flex-col md:col-span-6 lg:col-span-4"
              scrollable
              style={{
                flex: isMobile() ? "0 0 240px" : "1 1 0%",
                "min-height": isMobile() ? "240px" : "0px",
              }}
              title="Rank movement · monthly"
              description="1 = highest modal among commodities priced that month · gaps are not last place"
            >
              <Show
                when={Object.keys(rankOption()).length > 0}
                fallback={
                  <EmptyState
                    kind="no-data"
                    data-testid="agri-rank-empty"
                    title="Not enough months to rank"
                    description="A bump board needs two months across two commodities in this window."
                  />
                }
              >
                <Box
                  className="flex min-h-[200px] flex-1"
                  style={{ "min-height": "200px", flex: "1 1 0%" }}
                  data-testid="agri-rank-region"
                >
                  <EChart option={rankOption()} data-testid="agri-rank-chart" />
                </Box>
              </Show>
            </CompactPanel>

            <CompactPanel
              testId="agri-season-panel"
              className="col-span-12 flex min-h-0 flex-col md:col-span-6 lg:col-span-4"
              scrollable
              style={{
                flex: isMobile() ? "0 0 240px" : "1 1 0%",
                "min-height": isMobile() ? "240px" : "0px",
              }}
              title="Seasonality · commodity × month"
              description={
                seasonRows().length > 0
                  ? seasonRows()
                      .slice(0, 2)
                      .map(
                        (row) =>
                          `${row.label}: ${row.hitRate == null ? "—" : `${Math.round(row.hitRate * 100)}% above`} · n≥${row.minYears ?? "—"}`,
                      )
                      .join(" · ")
                  : "Deviation from each commodity's own observed-month average"
              }
            >
              <Show
                when={Object.keys(seasonOption()).length > 0}
                fallback={
                  <EmptyState
                    kind="no-data"
                    data-testid="agri-season-empty"
                    title="No monthly pattern in this window"
                    description="Seasonality needs at least one dated modal price per month."
                  />
                }
              >
                <Box
                  className="flex min-h-[200px] flex-1"
                  style={{ "min-height": "200px", flex: "1 1 0%" }}
                  data-testid="agri-season-region"
                >
                  <EChart option={seasonOption()} data-testid="agri-season-chart" />
                </Box>
              </Show>
            </CompactPanel>

            <CompactPanel
              testId="agri-dispersion-panel"
              className="col-span-12 flex min-h-0 flex-col md:col-span-6 lg:col-span-4"
              scrollable
              style={{
                flex: isMobile() ? "0 0 240px" : "1 1 0%",
                "min-height": isMobile() ? "240px" : "0px",
              }}
              title="Mandi dispersion"
              description="Dot = modal ₹/quintal · bar = min–max · violet = outside 1.5×IQR"
            >
              <Show
                when={Object.keys(dispersionOption()).length > 0}
                fallback={
                  <EmptyState
                    kind="no-data"
                    data-testid="agri-dispersion-empty"
                    title="No mandi spread for this selection"
                    description={emptyCopy()}
                  />
                }
              >
                <Box
                  className="flex min-h-[220px] flex-1"
                  style={{ "min-height": "220px", flex: "1 1 0%" }}
                  data-testid="agri-dispersion-region"
                >
                  <EChart option={dispersionOption()} data-testid="agri-dispersion-chart" />
                </Box>
              </Show>
            </CompactPanel>
            </Box>
          </Show>
        </Box>
      </Show>
    </Box>
  );
}
