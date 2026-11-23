import { Show, createEffect, createMemo, createSignal, For, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
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
import { CompactPanel } from "../common/compact";
import { RangeInput } from "../common/RangeInput";
import { TanStackTable } from "../common/TanStackTable";
import { PayoffChartCore, type PayoffSnapshot } from "@/components/options-dock/PayoffChartCore";
import type { DockLeg } from "@/state/optionsDock";
import { buildFnoColumns } from "./fnoColumns";
import {
  fetchFnoScreener,
  FNO_PRESETS,
  type FnoScreenerParams,
  type FnoScreenerPreset,
  type FnoScreenerResponse,
  type FnoScreenerRow,
} from "../../api/fnoScreener";
import { formatPercentage, formatNumber } from "@/utils/ui-helpers";
import * as palette from "@/ui/palette";

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
  const navigate = useNavigate();
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

  const rows = () => (Array.isArray(data()?.rows) ? data()!.rows : []).filter(withinRange);
  const expiries = () => (Array.isArray(data()?.expiries) ? data()!.expiries : []);
  const asOfTime = () => {
    const raw = data()?.as_of;
    const match = typeof raw === "string" ? /T(\d{2}:\d{2})/.exec(raw) : null;
    return match ? match[1] : "—";
  };
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
    const errors = Array.isArray(d?.errors) ? d!.errors : [];
    const warnings = Array.isArray(d?.warnings) ? d!.warnings : [];
    if (errors.length === 0) return null;
    // `FnoScreenerResponse.errors` carries `{symbol, stage, error}` objects
    // (see `api/options_screener.py`); an older payload used bare strings.
    // Read it structurally so either shape surfaces a message instead of
    // `undefined`.
    const first = errors[0];
    if (typeof first === "string") return first || warnings[0] || "Upstream options data unavailable";
    return first?.error || warnings[0] || "Upstream options data unavailable";
  });
  const showEmpty = () =>
    !isLoading() && error() === null && rows().length === 0 && backendIssue() === null;

  const columns = createMemo(() => buildFnoColumns((sym) => navigate(`/chart/${sym}`)));

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
                  as of {asOfTime()}
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
              data={expiries().map((e) => ({
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
            renderSubComponent={(row) => (
              <FnoRowDetail row={row} expiry={expiry() || data()?.expiry} />
            )}
            bare
          />
        </Show>
      </Box>
    </CompactPanel>
  );
}

function money2(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rupees0(value: number): string {
  return Number.isFinite(value) ? `₹${Math.round(value).toLocaleString("en-IN")}` : "—";
}

/** Whole calendar days to a `YYYY-MM-DD` expiry, on the options model's 365-day year. */
export function expiryYearsFrom(expiry: string | undefined): number | undefined {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return undefined;
  const target = Date.parse(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(target)) return undefined;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(1, Math.ceil((target - today) / 86_400_000)) / 365;
}

/** One metric cell for the FNO detail panel: label over value with optional colour. */
function DetailMetric(props: {
  label: string;
  value: string;
  tone?: string;
  testId?: string;
}) {
  return (
    <Box className="flex min-w-0 flex-col gap-px" data-testid={props.testId}>
      <Text
        size="xs"
        c="dimmed"
        className="truncate uppercase"
        style={{ "font-size": "9px", "letter-spacing": "0.06em", "line-height": "1.1" }}
      >
        {props.label}
      </Text>
      <Text
        size="xs"
        fw={700}
        className="truncate font-mono tabular-nums"
        style={{ "font-size": "11px", "line-height": "1.2", color: props.tone }}
      >
        {props.value}
      </Text>
    </Box>
  );
}

/** Greeks micro-row: Δ Γ Θ ν in a compact horizontal strip. */
function GreekStrip(props: { row: FnoScreenerRow }) {
  const fmtGreek = (v: number, digits = 2): string =>
    Number.isFinite(v) ? v.toFixed(digits) : "—";
  return (
    <Box className="flex items-center gap-3" data-testid="fno-detail-greeks">
      <For each={[
        { label: "Δ", value: fmtGreek(props.row.delta), testId: "fno-detail-delta" },
        { label: "Γ", value: fmtGreek(props.row.gamma, 4), testId: "fno-detail-gamma" },
        { label: "Θ", value: fmtGreek(props.row.theta), tone: palette.NEGATIVE, testId: "fno-detail-theta" },
        { label: "ν", value: fmtGreek(props.row.vega), testId: "fno-detail-vega" },
      ]}>
        {(g) => (
          <Box className="flex items-baseline gap-1" data-testid={g.testId}>
            <Text
              size="xs"
              c="dimmed"
              style={{ "font-size": "10px", "font-style": "italic" }}
            >
              {g.label}
            </Text>
            <Text
              size="xs"
              fw={600}
              className="font-mono tabular-nums"
              style={{ "font-size": "10px", color: g.tone }}
            >
              {g.value}
            </Text>
          </Box>
        )}
      </For>
    </Box>
  );
}

export function FnoRowDetail(props: { row: FnoScreenerRow; expiry?: string }) {
  const row = () => props.row;
  const maxLoss = () => row().cost_lot;
  const [snapshot, setSnapshot] = createSignal<PayoffSnapshot | null>(null);

  const legType = (): "CE" | "PE" => {
    const raw = String(row().call ?? "").trim().toUpperCase();
    return raw === "PE" || raw.split(/\s+/).at(-1) === "PE" ? "PE" : "CE";
  };
  const legs = (): DockLeg[] => [
    {
      key: `fno-${row().symbol}-${legType()}-${row().strike}`,
      expiry: props.expiry ?? "",
      side: "buy",
      type: legType(),
      strike: row().strike,
      premium: row().premium,
      lots: 1,
      lotSize: 1,
    },
  ];
  const ivDecimal = () => {
    const iv = row().iv;
    return Number.isFinite(iv) && iv > 0 ? iv / 100 : Number.NaN;
  };

  const pnlTone = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? undefined : v > 0 ? palette.POSITIVE : v < 0 ? palette.NEGATIVE : undefined;

  return (
    <Box
      className="flex w-full flex-col border-t border-b border-fin-border bg-fin-bg"
      style={{ "border-color": palette.BORDER }}
      data-testid="fno-row-detail"
    >
      {/* ── Header strip ─────────────────────────────────────────── */}
      <Box
        className="flex items-center gap-3 px-3 py-1.5"
        style={{ "background-color": palette.SURFACE_ALT, "border-bottom": `1px solid ${palette.BORDER}` }}
        data-testid="fno-detail-header"
      >
        <Text
          size="xs"
          fw={700}
          className="font-mono tabular-nums uppercase"
          style={{ "font-size": "11px", "letter-spacing": "0.08em", color: palette.PRIMARY }}
        >
          {row().symbol}
        </Text>
        <Badge size="xs" variant="filled" color={legType() === "CE" ? "info" : "warning"}>
          {row().strike} {legType()}
        </Badge>
        <Badge size="xs" variant="light" color="secondary">
          {row().setup}
        </Badge>
        <Show when={props.expiry}>
          <Text
            size="xs"
            c="dimmed"
            className="font-mono tabular-nums"
            style={{ "font-size": "10px" }}
          >
            EXP {props.expiry}
          </Text>
        </Show>
        <Box className="ml-auto flex items-center gap-4">
          <Show when={snapshot()}>
            <Text
              size="xs"
              fw={700}
              className="font-mono tabular-nums"
              style={{
                "font-size": "10px",
                color: pnlTone(snapshot()?.expectedPnl),
              }}
              data-testid="fno-detail-epnl-header"
            >
              E[P&L] {snapshot()?.expectedPnl != null && Number.isFinite(snapshot()!.expectedPnl)
                ? (snapshot()!.expectedPnl > 0 ? "+" : "") + formatNumber(Math.round(snapshot()!.expectedPnl))
                : "—"}
            </Text>
          </Show>
          <GreekStrip row={row()} />
        </Box>
      </Box>

      {/* ── Body: chart + metrics side-by-side ───────────────────── */}
      <Box className="flex min-h-0 gap-0">
        {/* Left: Payoff chart — takes the majority of width */}
        <Box className="flex min-w-0 flex-1 flex-col" style={{ "min-height": "200px" }}>
          <PayoffChartCore
            legs={legs()}
            spot={row().spot}
            iv={ivDecimal()}
            dteYears={expiryYearsFrom(props.expiry)}
            height={200}
            onSnapshot={setSnapshot}
            data-testid={`fno-payoff-${row().symbol}`}
          />
        </Box>

        {/* Right: Risk / position metrics in a compact vertical stack */}
        <Box
          className="flex shrink-0 flex-col justify-between border-l border-fin-border py-2 px-3"
          style={{ width: "200px", "background-color": palette.SURFACE }}
          data-testid="fno-detail-metrics"
        >
          {/* Primary metrics */}
          <Box className="flex flex-col gap-2">
            <DetailMetric label="Spot" value={money2(row().spot)} testId="fno-detail-spot" />
            <DetailMetric label="Strike" value={money2(row().strike)} testId="fno-detail-strike" />
            <DetailMetric label="Premium" value={money2(row().premium)} testId="fno-detail-premium" />
            <Box
              className="border-t border-fin-border pt-2"
              style={{ "border-color": palette.alpha(palette.BORDER, 0.5) }}
            >
              <DetailMetric label="Cost / lot" value={rupees0(row().cost_lot)} testId="fno-detail-cost" />
            </Box>
            <DetailMetric label="Breakeven" value={money2(row().breakeven)} testId="fno-detail-breakeven" />
            <DetailMetric
              label="Max loss"
              value={rupees0(maxLoss())}
              tone={palette.NEGATIVE}
              testId="fno-detail-max-loss"
            />
          </Box>

          {/* Separator */}
          <Box
            className="my-1.5 border-t border-fin-border"
            style={{ "border-color": palette.alpha(palette.BORDER, 0.5) }}
          />

          {/* Probability & momentum */}
          <Box className="flex flex-col gap-2">
            <DetailMetric
              label="POP"
              value={formatPercentage(row().pop)}
              tone={row().pop >= 50 ? palette.POSITIVE : palette.NEGATIVE}
              testId="fno-detail-pop"
            />
            <Box className="flex gap-4">
              <DetailMetric label="1D%" value={formatPercentage(row().d1)} testId="fno-detail-d1" />
              <DetailMetric label="5D%" value={formatPercentage(row().d5)} testId="fno-detail-d5" />
            </Box>
            <DetailMetric
              label="+2% est."
              value={formatPercentage(row().move_2pct_est)}
              testId="fno-detail-move2"
            />
            <Box className="flex gap-4">
              <DetailMetric
                label="IV"
                value={formatPercentage(row().iv)}
                testId="fno-detail-iv"
              />
              <DetailMetric
                label="OI"
                value={Number.isFinite(row().oi) ? formatNumber(row().oi) : "—"}
                testId="fno-detail-oi"
              />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
