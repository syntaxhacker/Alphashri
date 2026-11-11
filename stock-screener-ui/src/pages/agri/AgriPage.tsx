import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Divider,
  LoadingOverlay,
  Select,
  Text,
  ToolbarRow,
} from "@/ui";
import { useAsyncData } from "@/hooks/useAsyncData";
import { fetchAgriCommodities, fetchAgriPrices } from "@/api/agri";
import type { AgriCommodity } from "@/types/agri";
import { useECharts } from "@/hooks/useECharts";
import { useColorScheme } from "@/ui/hooks";
import { POSITIVE, NEGATIVE, PRIMARY } from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import { IconRefresh } from "@tabler/icons-react";

const COMMODITY_OPTIONS: AgriCommodity[] = [
  { key: "rice", label: "Rice" },
  { key: "wheat", label: "Wheat" },
  { key: "arhar_tur", label: "Arhar (Tur) Dal" },
  { key: "urad", label: "Urad Dal" },
  { key: "moong", label: "Moong Dal" },
  { key: "masoor", label: "Masoor Dal" },
  { key: "chana", label: "Chana / Gram Dal" },
  { key: "soyabean", label: "Soyabean" },
  { key: "onion", label: "Onion" },
  { key: "potato", label: "Potato" },
  { key: "tomato", label: "Tomato" },
];

function pctChange(now: number, then: number | null | undefined): number | null {
  if (!then || then <= 0) return null;
  return ((now - then) / then) * 100;
}

function nearestOnOrBefore(
  series: { date: string; modal: number }[],
  target: string,
): number | null {
  let best: { date: string; modal: number } | null = null;
  for (const p of series) {
    if (p.date <= target && (!best || p.date > best.date)) best = p;
  }
  return best ? best.modal : null;
}

function formatInr(v: number | null): string {
  if (v == null) return "—";
  return `₹${formatNumberIN(Math.round(v))}/q`;
}

export function AgriPage() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const [commodity, setCommodity] = useState<AgriCommodity>(COMMODITY_OPTIONS[0]);

  const { data: commoditiesData, loading: commoditiesLoading } = useAsyncData({
    fetchFn: () => fetchAgriCommodities(),
    autoFetch: true,
  });

  const options = commoditiesData?.commodities ?? COMMODITY_OPTIONS;

  const {
    data: prices,
    loading: pricesLoading,
    error: pricesError,
    execute: refresh,
  } = useAsyncData({
    fetchFn: () => fetchAgriPrices(commodity.key),
    autoFetch: true,
  });

  const snapshot = useMemo(
    () => prices?.snapshot.find((s) => s.key === commodity.key) ?? null,
    [prices, commodity.key],
  );
  const series = prices?.series ?? [];

  const latest = snapshot?.modal ?? null;
  const prev7d = useMemo(
    () => nearestOnOrBefore(series, new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)),
    [series],
  );
  const prev30d = useMemo(
    () => nearestOnOrBefore(series, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
    [series],
  );
  const prev180d = useMemo(
    () => nearestOnOrBefore(series, new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)),
    [series],
  );
  const chg7d = latest != null ? pctChange(latest, prev7d) : null;
  const chg30d = latest != null ? pctChange(latest, prev30d) : null;
  const chg180d = latest != null ? pctChange(latest, prev180d) : null;

  // ---- ECharts option -----------------------------------------------------
  const { chartRef, setChartOption } = useECharts({ isDark });
  const option = useMemo(() => {
    if (series.length === 0) return {};
    const dates = series.map((p) => p.date);
    const values = series.map((p) => p.modal);
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "rgba(20,20,20,0.85)" : "#fff",
        textStyle: { color: isDark ? "#F0F6FC" : "#000" },
      },
      grid: { left: 60, right: 40, top: 40, bottom: 60 },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { fontSize: 10, color: isDark ? "#8B949E" : "#6E7681" },
        axisLine: { lineStyle: { color: isDark ? "#30363D" : "#D1D5DB" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { fontSize: 10, color: isDark ? "#8B949E" : "#6E7681", formatter: "₹{value}" },
        axisLine: { lineStyle: { color: isDark ? "#30363D" : "#D1D5DB" } },
        splitLine: { lineStyle: { color: isDark ? "#161B22" : "#E5E7EB", type: "dashed" } },
      },
      series: [
        {
          type: "line",
          data: values,
          smooth: true,
          symbolSize: 4,
          itemStyle: { color: PRIMARY },
          lineStyle: { color: PRIMARY, width: 2 },
          areaStyle: { color: PRIMARY, opacity: 0.12 },
        },
      ],
    };
  }, [series, colorScheme, isDark]);

  useMemo(() => {
    void setChartOption(option);
  }, [setChartOption, option]);

  const statColor = (v: number | null): string => {
    if (v == null) return "dimmed";
    return v > 0 ? POSITIVE : v < 0 ? NEGATIVE : "dimmed";
  };

  const pct = (v: number | null): string =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const isLoading = commoditiesLoading || pricesLoading;

  return (
    <Box
      data-testid="agri-page"
      className="flex w-full min-h-0 flex-col gap-2 p-3"
    >
      <ToolbarRow
        justify="space-between"
        gap={8}
        data-testid="agri-toolbar"
        className="min-h-0"
      >
        <Box className="flex shrink-0 items-center gap-2">
          <Text size="xs" c="dimmed" style={{ textTransform: "uppercase", fontSize: 10 }} fw={700}>
            Commodity
          </Text>
          <Select
            data={options.map((o) => ({ value: o.key, label: o.label }))}
            value={commodity.key}
            onChange={(v) => setCommodity(options.find((o) => o.key === v) ?? options[0])}
            size="sm"
            w={170}
            data-testid="agri-commodity-select"
          />
        </Box>
        <Box className="flex-1 min-w-0" />
        <Box className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            leftSection={<IconRefresh size={14} />}
            onClick={handleRefresh}
            disabled={isLoading}
            data-testid="agri-refresh"
          >
            Refresh
          </Button>
        </Box>
      </ToolbarRow>

      {pricesError ? (
        <Badge color="error" data-testid="agri-error">{pricesError}</Badge>
      ) : null}

      {/* Stat strip: selected commodity latest price + changes */}
      <Box
        className="flex min-h-0 items-center gap-3 rounded border border-fin-border bg-fin-surface p-3"
        data-testid="agri-stat-strip"
      >
        <Box className="min-w-0">
          <Text size="xs" c="dimmed" data-testid="agri-stat-date">
            {snapshot ? snapshot.date : "—"}
          </Text>
          <Text size="lg" fw={700} className="font-mono" data-testid="agri-stat-price">
            {formatInr(latest)}
          </Text>
          <Text
            size="xs"
            c={statColor(chg7d)}
            data-testid="agri-stat-chg7d"
          >
            {chg7d == null ? "—" : `${pct(chg7d)} 1w`}
          </Text>
        </Box>
        <Divider orientation="vertical" style={{ height: 32, marginLeft: 8, marginRight: 8 }} />
        <Box className="min-w-0">
          <Text size="xs" c="dimmed">1 month</Text>
          <Text size="sm" fw={600} c={statColor(chg30d)} data-testid="agri-stat-chg30d">
            {pct(chg30d)}
          </Text>
        </Box>
        <Divider orientation="vertical" style={{ height: 32, marginLeft: 8, marginRight: 8 }} />
        <Box className="min-w-0">
          <Text size="xs" c="dimmed">6 months</Text>
          <Text size="sm" fw={600} c={statColor(chg180d)} data-testid="agri-stat-chg180d">
            {pct(chg180d)}
          </Text>
        </Box>
        <Box className="flex-1 min-w-0" />
        <Badge color="info" size="xs" data-testid="agri-stat-markets">
          {snapshot ? `${snapshot.markets} markets` : "—"}
        </Badge>
      </Box>

      <Box
        className="flex min-h-0 flex-1 min-w-0 flex-col gap-2"
        data-testid="agri-body"
      >
        {/* Left: all-commodities latest prices table */}
        <Box
          className="flex min-h-0 flex-1 flex-col gap-1"
          data-testid="agri-table-region"
        >
          <ToolbarRow justify="space-between" gap={8} className="min-h-0">
            <Text size="sm" fw={600} data-testid="agri-table-title">
              Latest mandi prices — all commodities
            </Text>
            <Text size="xs" c="dimmed" data-testid="agri-table-date">
              {snapshot ? snapshot.date : "—"}
            </Text>
          </ToolbarRow>
          <Box
            className="min-h-0 flex-1 overflow-auto rounded border border-fin-border bg-fin-surface"
            data-testid="agri-table"
          >
            <Box
              component="table"
              className="w-full border-collapse text-[11px]"
              data-testid="agri-table-element"
            >
              <thead>
                <Box component="tr" className="bg-fin-surface-alt">
                  <Box
                    component="th"
                    className="px-2 py-1.5 text-left text-[10px] text-fin-text-muted"
                  >
                    Commodity
                  </Box>
                  <Box
                    component="th"
                    className="px-2 py-1.5 text-left text-[10px] text-fin-text-muted"
                  >
                    Date
                  </Box>
                  <Box
                    component="th"
                    className="px-2 py-1.5 text-right text-[10px] text-fin-text-muted"
                  >
                    Modal
                  </Box>
                  <Box
                    component="th"
                    className="px-2 py-1.5 text-right text-[10px] text-fin-text-muted"
                  >
                    Min
                  </Box>
                  <Box
                    component="th"
                    className="px-2 py-1.5 text-right text-[10px] text-fin-text-muted"
                  >
                    Max
                  </Box>
                  <Box
                    component="th"
                    className="px-2 py-1.5 text-center text-[10px] text-fin-text-muted"
                  >
                    Markets
                  </Box>
                </Box>
              </thead>
              <tbody>
                {(prices?.snapshot.length ?? 0) === 0 ? (
                  <Box component="tr">
                    <Box component="td" colSpan={6} className="py-4 text-center text-fin-text-muted">
                      No prices available.
                    </Box>
                  </Box>
                ) : (
                  prices!.snapshot.map((r) => (
                    <Box
                      component="tr"
                      key={r.key}
                      className="[&_td]:border-b [&_td]:border-fin-border [&_td]:px-2 [&_td]:py-1"
                      data-testid={`agri-row-${r.key}`}
                    >
                      <Box component="td">{r.label}</Box>
                      <Box component="td">{r.date}</Box>
                      <Box component="td" className="text-right">{formatInr(r.modal)}</Box>
                      <Box component="td" className="text-right">{formatInr(r.min)}</Box>
                      <Box component="td" className="text-right">{formatInr(r.max)}</Box>
                      <Box component="td" className="text-center">{r.markets}</Box>
                    </Box>
                  ))
                )}
              </tbody>
            </Box>
          </Box>
        </Box>

        {/* Right: chart */}
        <Box
          className="flex min-h-0 flex-1 flex-col gap-1 rounded border border-fin-border bg-fin-surface p-2"
          data-testid="agri-chart-region"
        >
          <ToolbarRow justify="space-between" gap={8} className="min-h-0">
            <Text size="sm" fw={600} data-testid="agri-chart-title">
              Modal price trend — {commodity.label}
            </Text>
            <Text size="xs" c="dimmed" data-testid="agri-chart-range">
              {series.length} sessions
            </Text>
          </ToolbarRow>
          <Box
            ref={chartRef}
            className="min-h-[300px] min-w-0 flex-1"
            data-testid="agri-chart"
          />
          {series.length === 0 && (
            <Box className="flex flex-1 items-center justify-center text-fin-text-muted">
              No price history yet. Run the collector to build it:
              <br />python scripts/market/agri_collect.py
            </Box>
          )}
        </Box>
      </Box>

      <LoadingOverlay visible={isLoading} data-testid="agri-loading" />
    </Box>
  );
}
