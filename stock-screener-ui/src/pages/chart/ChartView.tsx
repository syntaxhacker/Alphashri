import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Box, Button, Center, Loader, Text, ToolbarRow } from "@/ui";
import { fetchTimeframes } from "@/api/chartPatterns";
import type { TFSpec } from "@/types/chartPatterns";
import { PatternChartBody } from "@/components/patterns/PatternChartBody";
import { PatternChartToolbar } from "@/components/patterns/PatternChartToolbar";
import { useSymbolPatternChart } from "@/hooks/useSymbolPatternChart";

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
function ChartMessage({
  testId,
  title,
  detail,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: ChartMessageProps) {
  return (
    <Box
      data-testid={testId}
      sx={{
        flex: 1,
        minHeight: 0,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
        p: 2,
      }}
    >
      <Text size="sm" fw={600}>
        {title}
      </Text>
      {detail ? (
        <Text size="xs" c="dimmed" style={{ textAlign: "center", maxWidth: 520 }}>
          {detail}
        </Text>
      ) : null}
      {actionLabel || secondaryLabel ? (
        <ToolbarRow gap={8} justify="center">
          {actionLabel ? (
            <Button size="xs" variant="light" onClick={onAction} data-testid="chart-retry-btn">
              {actionLabel}
            </Button>
          ) : null}
          {secondaryLabel ? (
            <Button size="xs" variant="subtle" onClick={onSecondary} data-testid="chart-back-btn">
              {secondaryLabel}
            </Button>
          ) : null}
        </ToolbarRow>
      ) : null}
    </Box>
  );
}

/**
 * Right-hand panel shown when the symbol has candles but no detected pattern
 * on the active timeframe. Offers a one-click switch to a frame that may.
 */
function NoPatternsPanel({
  symbol,
  timeframe,
  timeframes,
  onChange,
}: {
  symbol: string;
  timeframe: string;
  timeframes: TFSpec[];
  onChange: (timeframe: string) => void;
}) {
  const alternatives = useMemo(() => {
    const available = timeframes.filter((tf) => tf.id !== timeframe);
    const preferred = EMPTY_STATE_TIMEFRAMES.filter((id) =>
      available.some((tf) => tf.id === id),
    );
    return preferred.length > 0 ? preferred : available.slice(0, 4).map((tf) => tf.id);
  }, [timeframes, timeframe]);

  const labelFor = (id: string) => timeframes.find((tf) => tf.id === id)?.label ?? id;

  return (
    <Box
      data-testid="chart-no-patterns"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        height: "100%",
        minWidth: 0,
        p: 1,
      }}
    >
      <Text size="sm" fw={600}>
        No patterns detected
      </Text>
      <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
        {symbol} has no detected pattern on {timeframe}. Try another timeframe.
      </Text>
      {alternatives.length > 0 ? (
        <ToolbarRow gap={8} wrap>
          {alternatives.map((id) => (
            <Button
              key={id}
              size="xs"
              variant="subtle"
              onClick={() => onChange(id)}
              data-testid={`chart-empty-timeframe-${id}`}
            >
              {labelFor(id)}
            </Button>
          ))}
        </ToolbarRow>
      ) : null}
    </Box>
  );
}

/**
 * `/chart/:symbol` — the pattern workspace for one symbol.
 *
 * Renders the same toolbar + chart body as the fullscreen pattern view
 * (`PatternChartToolbar` / `PatternChartBody`) as a page instead of a modal:
 * candles with the detected pattern overlays, the pattern list / meta panel,
 * a timeframe selector and as-of replay. URL state (`?tf`, `?asof`, `?from`)
 * makes a view shareable and reload-safe.
 */
const ChartView: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [timeframes, setTimeframes] = useState<TFSpec[]>(FALLBACK_TIMEFRAMES);

  const timeframe = searchParams.get("tf") || DEFAULT_TIMEFRAME;
  const asOf = searchParams.get("asof") || null;
  const fromDate = searchParams.get("from") || null;

  const chart = useSymbolPatternChart({
    symbol: symbol ?? "",
    timeframe,
    asOf,
    fromDate,
  });

  useEffect(() => {
    let active = true;
    fetchTimeframes()
      .then((list) => {
        if (active && list.length > 0) setTimeframes(list);
      })
      .catch(() => {
        /* non-fatal: keep the 1D fallback */
      });
    return () => {
      active = false;
    };
  }, []);

  const setTimeframe = (next: string) => {
    if (next === timeframe) return;
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("tf", next);
        return params;
      },
      { replace: true },
    );
  };

  const setAsOf = (nextAsOf: string | null, nextFrom: string | null) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (nextAsOf) params.set("asof", nextAsOf);
        else params.delete("asof");
        if (nextFrom) params.set("from", nextFrom);
        else params.delete("from");
        return params;
      },
      { replace: true },
    );
  };

  // An unknown/garbled `?tf=` falls back to 1D once the real ladder arrives.
  useEffect(() => {
    if (!timeframes.length) return;
    if (timeframe === DEFAULT_TIMEFRAME) return;
    if (timeframes.some((tf) => tf.id === timeframe)) return;
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("tf", DEFAULT_TIMEFRAME);
        return params;
      },
      { replace: true },
    );
  }, [timeframes, timeframe, setSearchParams]);

  if (!symbol) {
    return (
      <ChartMessage
        testId="chart-view-error"
        title="No symbol specified"
        detail="Open a symbol from the screener, or use /chart/SYMBOL."
        actionLabel="Back to Screener"
        onAction={() => navigate("/")}
      />
    );
  }

  const upper = symbol.toUpperCase();
  const showLoader = chart.loading && chart.candles.length === 0 && !chart.error;
  const showEmpty = !chart.loading && !chart.error && chart.candles.length === 0;

  let content: React.ReactNode;
  if (chart.error) {
    content = (
      <ChartMessage
        testId="chart-error"
        title={`Couldn't load ${upper}`}
        detail={chart.error}
        actionLabel="Retry"
        onAction={chart.reload}
      />
    );
  } else if (showLoader) {
    content = (
      <Center
        data-testid="chart-loading"
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Loader size="sm" />
      </Center>
    );
  } else if (showEmpty) {
    content = (
      <ChartMessage
        testId="chart-empty"
        title={`No chart data for ${upper}`}
        detail={`No candles returned for ${timeframe}. Try another timeframe.`}
        actionLabel="Retry"
        onAction={chart.reload}
      />
    );
  } else {
    content = (
      <PatternChartBody
        fill
        hit={chart.hit}
        hits={chart.hits}
        onSelectHit={chart.selectHit}
        candles={chart.candles}
        overlays={[]}
        trendLines={chart.trendLines}
        asOf={asOf}
        emptyState={
          <NoPatternsPanel
            symbol={upper}
            timeframe={timeframe}
            timeframes={timeframes}
            onChange={setTimeframe}
          />
        }
      />
    );
  }

  return (
    <Box
      data-testid="chart-view"
      id="chart-view"
      sx={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: "background.default",
      }}
    >
      <Box
        data-testid="chart-header"
        sx={{
          flexShrink: 0,
          px: 2,
          py: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
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
          title={upper}
          titleTestId="chart-title"
          titleSize="md"
          timeframe={timeframe}
          timeframes={timeframes}
          onTimeframeChange={setTimeframe}
          loading={chart.loading}
          asOf={asOf}
          fromDate={fromDate}
          onAsOfChange={setAsOf}
        />
      </Box>

      {content}
    </Box>
  );
};

export default ChartView;
