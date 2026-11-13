import { createEffect, createMemo, createSignal, For, onCleanup, Show, Switch, Match } from "solid-js";
import { useParams, useSearchParams, useNavigate } from "@solidjs/router";
import { Button, Center, Loader, Text, ToolbarRow } from "@/ui";
import { fetchTimeframes, fetchSymbolChart } from "@/api/chartPatterns";
import type { ChartCandle, PatternHitDTO, TrendLine, TFSpec } from "@/types/chartPatterns";
import {
  newestHit,
  sortHitsNewest,
} from "@/components/patterns/FullscreenPatternList";
import { PatternChartBody } from "@/components/patterns/PatternChartBody";
import { PatternChartToolbar } from "@/components/patterns/PatternChartToolbar";

/** Patterns read best on the daily frame; the URL can override it (`?tf=1W`). */
const DEFAULT_TIMEFRAME = "1D";

/** Minimal ladder while `/timeframes` is in flight or unavailable. */
const FALLBACK_TIMEFRAMES: TFSpec[] = [{ id: "1D", label: "1D" } as TFSpec];

/** Quick-switch timeframes offered when the current frame has no patterns. */
const EMPTY_STATE_TIMEFRAMES = ["1D", "1W", "1h", "15m"];

interface ChartMessageProps {
  testId: string;
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/** Centered message used by the error / no-data / missing-symbol states. */
function ChartMessage(props: ChartMessageProps) {
  return (
    <div
      data-testid={props.testId}
      class="flex w-full flex-1 min-h-0 flex-col items-center justify-center gap-3 p-4"
    >
      <Text size="sm" fw={600}>
        {props.title}
      </Text>
      <Show when={props.detail}>
        <Text size="xs" c="dimmed" style={{ "text-align": "center", "max-width": "520px" }}>
          {props.detail}
        </Text>
      </Show>
      <Show when={props.actionLabel || props.secondaryLabel}>
        <ToolbarRow gap={8} justify="center">
          <Show when={props.actionLabel}>
            <Button size="xs" variant="light" onClick={props.onAction} data-testid="chart-retry-btn">
              {props.actionLabel}
            </Button>
          </Show>
          <Show when={props.secondaryLabel}>
            <Button size="xs" variant="subtle" onClick={props.onSecondary} data-testid="chart-back-btn">
              {props.secondaryLabel}
            </Button>
          </Show>
        </ToolbarRow>
      </Show>
    </div>
  );
}

/**
 * Right-hand panel shown when the symbol has candles but no detected pattern
 * on the active timeframe. Offers a one-click switch to a frame that may.
 */
function NoPatternsPanel(props: {
  symbol: string;
  timeframe: string;
  timeframes: TFSpec[];
  onChange: (timeframe: string) => void;
}) {
  const alternatives = createMemo(() => {
    const available = props.timeframes.filter((tf) => tf.id !== props.timeframe);
    const preferred = EMPTY_STATE_TIMEFRAMES.filter((id) =>
      available.some((tf) => tf.id === id),
    );
    return preferred.length > 0 ? preferred : available.slice(0, 4).map((tf) => tf.id);
  });

  const labelFor = (id: string) => props.timeframes.find((tf) => tf.id === id)?.label ?? id;

  return (
    <div
      data-testid="chart-no-patterns"
      class="flex h-full min-w-0 flex-col gap-3 p-2"
    >
      <Text size="sm" fw={600}>
        No patterns detected
      </Text>
      <Text size="xs" c="dimmed" style={{ "overflow-wrap": "anywhere" }}>
        {props.symbol} has no detected pattern on {props.timeframe}. Try another timeframe.
      </Text>
      <Show when={alternatives().length > 0}>
        <ToolbarRow gap={8} wrap>
          <For each={alternatives()}>
            {(id) => (
              <Button
                size="xs"
                variant="subtle"
                onClick={() => props.onChange(id)}
                data-testid={`chart-empty-timeframe-${id}`}
              >
                {labelFor(id)}
              </Button>
            )}
          </For>
        </ToolbarRow>
      </Show>
    </div>
  );
}

interface ChartLoaderState {
  symbol: string;
  hit: PatternHitDTO | null;
  hits: PatternHitDTO[];
  candles: ChartCandle[];
  trendLines: TrendLine[];
  loading: boolean;
  error: string | null;
}

const EMPTY_LISTS = {
  hit: null,
  hits: [] as PatternHitDTO[],
  candles: [] as ChartCandle[],
  trendLines: [] as TrendLine[],
};

/**
 * Inline Solid twin of src/hooks/useSymbolPatternChart (still React). A route
 * has no click — the symbol comes from the URL — so the fetch runs in an
 * effect and the same state shape is exposed (newest hit first).
 * Never throws: a transport error lands in `error` and keeps the previous candles.
 */
function useSymbolPatternChartSolid(args: {
  symbol: () => string;
  timeframe: () => string;
  asOf: () => string | null;
  fromDate: () => string | null;
}) {
  const [state, setState] = createSignal<ChartLoaderState>({
    symbol: args.symbol(),
    ...EMPTY_LISTS,
    loading: Boolean(args.symbol()),
    error: null,
  });
  let requestToken = 0;
  let mounted = true;
  onCleanup(() => {
    mounted = false;
  });

  const load = () => {
    const symbol = args.symbol();
    if (!symbol) {
      setState({ symbol, ...EMPTY_LISTS, loading: false, error: null });
      return;
    }
    const token = ++requestToken;
    // A different symbol must not keep showing the previous chart while the
    // new one loads; a timeframe/as-of change keeps the candles (less flicker).
    setState((prev) =>
      prev.symbol === symbol
        ? { ...prev, loading: true, error: null }
        : { symbol, ...EMPTY_LISTS, loading: true, error: null },
    );

    const asOf = args.asOf();
    const fromDate = args.fromDate();
    const options = {
      detectPatterns: true,
      computeTrendlines: true,
      ...(asOf ? { asOf } : {}),
      ...(fromDate ? { fromDate } : {}),
    };

    void fetchSymbolChart(symbol, args.timeframe(), options)
      .then((chart) => {
        if (!mounted || requestToken !== token) return;
        const hits = sortHitsNewest(chart.hits ?? []);
        setState({
          symbol,
          hit: newestHit(hits),
          hits,
          candles: chart.candles ?? [],
          trendLines: chart.trend_lines ?? [],
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (!mounted || requestToken !== token) return;
        setState((prev) =>
          prev.symbol === symbol
            ? {
                ...prev,
                loading: false,
                error: err instanceof Error ? err.message : "Failed to load chart",
              }
            : prev,
        );
      });
  };

  createEffect(() => {
    // Track every input the fetch depends on; re-runs when any of them change.
    args.symbol();
    args.timeframe();
    args.asOf();
    args.fromDate();
    load();
  });

  const selectHit = (hit: PatternHitDTO) =>
    setState((prev) => (prev.symbol === hit.symbol ? { ...prev, hit } : prev));

  return { state, selectHit, reload: load };
}

/** First value if the param arrived as a (repeated) array, else the string. */
function firstParam(v: string | string[] | undefined): string | null {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw ?? null;
}

const ChartView = () => {
  const params = useParams<{ symbol?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [timeframes, setTimeframes] = createSignal<TFSpec[]>(FALLBACK_TIMEFRAMES);

  const symbol = () => params.symbol ?? "";
  const timeframe = createMemo(() => firstParam(searchParams.tf) || DEFAULT_TIMEFRAME);
  const asOf = createMemo(() => firstParam(searchParams.asof));
  const fromDate = createMemo(() => firstParam(searchParams.from));

  const chart = useSymbolPatternChartSolid({ symbol, timeframe, asOf, fromDate });

  createEffect(() => {
    let active = true;
    fetchTimeframes()
      .then((list) => {
        if (active && list.length > 0) setTimeframes(list);
      })
      .catch(() => {
        /* non-fatal: keep the 1D fallback */
      });
    onCleanup(() => {
      active = false;
    });
  });

  const setTimeframe = (next: string) => {
    if (next === timeframe()) return;
    setSearchParams({ tf: next }, { replace: true });
  };

  const setAsOf = (nextAsOf: string | null, nextFrom: string | null) => {
    setSearchParams(
      {
        asof: nextAsOf ? nextAsOf : null,
        from: nextFrom ? nextFrom : null,
      },
      { replace: true },
    );
  };

  // An unknown/garbled `?tf=` falls back to 1D once the real ladder arrives.
  createEffect(() => {
    const list = timeframes();
    if (!list.length) return;
    const tf = timeframe();
    if (tf === DEFAULT_TIMEFRAME) return;
    if (list.some((spec) => spec.id === tf)) return;
    setSearchParams({ tf: DEFAULT_TIMEFRAME }, { replace: true });
  });

  const showLoader = () =>
    chart.state().loading && chart.state().candles.length === 0 && !chart.state().error;
  const showEmpty = () =>
    !chart.state().loading && !chart.state().error && chart.state().candles.length === 0;

  return (
    <Show
      when={symbol()}
      fallback={
        <ChartMessage
          testId="chart-view-error"
          title="No symbol specified"
          detail="Open a symbol from the screener, or use /chart/SYMBOL."
          actionLabel="Back to Screener"
          onAction={() => navigate("/")}
        />
      }
    >
      <div
        data-testid="chart-view"
        id="chart-view"
        class="flex h-full min-h-0 w-full flex-col overflow-hidden bg-fin-bg"
      >
        <div
          data-testid="chart-header"
          class="shrink-0 border-b border-fin-border px-4 py-2"
        >
          <PatternChartToolbar
            leading={
              <Button
                size="xs"
                variant="subtle"
                onClick={() => navigate(-1)}
                data-testid="chart-back-btn"
              >
                ← Back
              </Button>
            }
            title={symbol().toUpperCase()}
            titleTestId="chart-title"
            titleSize="md"
            timeframe={timeframe()}
            timeframes={timeframes()}
            onTimeframeChange={setTimeframe}
            loading={chart.state().loading}
            asOf={asOf()}
            fromDate={fromDate()}
            onAsOfChange={setAsOf}
          />
        </div>

        <Switch>
          <Match when={chart.state().error}>
            {(err) => (
              <ChartMessage
                testId="chart-error"
                title={`Couldn't load ${symbol().toUpperCase()}`}
                detail={err()}
                actionLabel="Retry"
                onAction={chart.reload}
              />
            )}
          </Match>
          <Match when={showLoader()}>
            <Center
              data-testid="chart-loading"
              className="flex flex-1 min-h-0 items-center justify-center"
            >
              <Loader size="sm" />
            </Center>
          </Match>
          <Match when={showEmpty()}>
            <ChartMessage
              testId="chart-empty"
              title={`No chart data for ${symbol().toUpperCase()}`}
              detail={`No candles returned for ${timeframe()}. Try another timeframe.`}
              actionLabel="Retry"
              onAction={chart.reload}
            />
          </Match>
          <Match when={true}>
            <PatternChartBody
              fill
              hit={chart.state().hit}
              hits={chart.state().hits}
              onSelectHit={chart.selectHit}
              candles={chart.state().candles}
              overlays={[]}
              trendLines={chart.state().trendLines}
              asOf={asOf()}
              emptyState={
                <NoPatternsPanel
                  symbol={symbol().toUpperCase()}
                  timeframe={timeframe()}
                  timeframes={timeframes()}
                  onChange={setTimeframe}
                />
              }
            />
          </Match>
        </Switch>
      </div>
    </Show>
  );
};

export default ChartView;
