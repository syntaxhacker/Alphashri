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
      sx={{ width: "100%", minHeight: 0, display: "flex", flexDirection: "column", p: 1.5, gap: 1 }}
    >
      <ToolbarRow
        justify="space-between"
        gap={8}
        data-testid="agri-toolbar"
        sx={{ minHeight: 0 }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
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
        <Box sx={{ flex: 1, minWidth: 0 }} />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
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
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
          p: 1.5,
          minHeight: 0,
        }}
        data-testid="agri-stat-strip"
      >
        <Box sx={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" data-testid="agri-stat-date">
            {snapshot ? snapshot.date : "—"}
          </Text>
          <Text size="lg" fw={700} sx={{ fontFamily: "mono" }} data-testid="agri-stat-price">
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
        <Divider orientation="vertical" sx={{ height: 32, mx: 1 }} />
        <Box sx={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed">1 month</Text>
          <Text size="sm" fw={600} c={statColor(chg30d)} data-testid="agri-stat-chg30d">
            {pct(chg30d)}
          </Text>
        </Box>
        <Divider orientation="vertical" sx={{ height: 32, mx: 1 }} />
        <Box sx={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed">6 months</Text>
          <Text size="sm" fw={600} c={statColor(chg180d)} data-testid="agri-stat-chg180d">
            {pct(chg180d)}
          </Text>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }} />
        <Badge color="info" size="xs" data-testid="agri-stat-markets">
          {snapshot ? `${snapshot.markets} markets` : "—"}
        </Badge>
      </Box>

      <Box
        sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}
        data-testid="agri-body"
      >
        {/* Left: all-commodities latest prices table */}
        <Box
          sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 0.5 }}
          data-testid="agri-table-region"
        >
          <ToolbarRow justify="space-between" gap={8} sx={{ minHeight: 0 }}>
            <Text size="sm" fw={600} data-testid="agri-table-title">
              Latest mandi prices — all commodities
            </Text>
            <Text size="xs" c="dimmed" data-testid="agri-table-date">
              {snapshot ? snapshot.date : "—"}
            </Text>
          </ToolbarRow>
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              bgcolor: "background.paper",
            }}
            data-testid="agri-table"
          >
            <Box
              component="table"
              sx={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}
              data-testid="agri-table-element"
            >
              <thead>
                <Box component="tr" sx={{ bgcolor: "action.hover" }}>
                  <Box
                    component="th"
                    sx={{ color: "text.secondary", fontSize: 10, py: 0.75, px: 1, textAlign: "left" }}
                  >
                    Commodity
                  </Box>
                  <Box
                    component="th"
                    sx={{ color: "text.secondary", fontSize: 10, py: 0.75, px: 1, textAlign: "left" }}
                  >
                    Date
                  </Box>
                  <Box
                    component="th"
                    sx={{ color: "text.secondary", fontSize: 10, py: 0.75, px: 1, textAlign: "right" }}
                  >
                    Modal
                  </Box>
                  <Box
                    component="th"
                    sx={{ color: "text.secondary", fontSize: 10, py: 0.75, px: 1, textAlign: "right" }}
                  >
                    Min
                  </Box>
                  <Box
                    component="th"
                    sx={{ color: "text.secondary", fontSize: 10, py: 0.75, px: 1, textAlign: "right" }}
                  >
                    Max
                  </Box>
                  <Box
                    component="th"
                    sx={{ color: "text.secondary", fontSize: 10, py: 0.75, px: 1, textAlign: "center" }}
                  >
                    Markets
                  </Box>
                </Box>
              </thead>
              <tbody>
                {(prices?.snapshot.length ?? 0) === 0 ? (
                  <Box component="tr">
                    <Box component="td" colSpan={6} sx={{ py: 2, textAlign: "center", color: "text.disabled" }}>
                      No prices available.
                    </Box>
                  </Box>
                ) : (
                  prices!.snapshot.map((r) => (
                    <Box
                      component="tr"
                      key={r.key}
                      sx={{ "& td": { py: 0.6, px: 1, borderBottom: "1px solid", borderColor: "divider" } }}
                      data-testid={`agri-row-${r.key}`}
                    >
                      <Box component="td">{r.label}</Box>
                      <Box component="td">{r.date}</Box>
                      <Box component="td" sx={{ textAlign: "right" }}>{formatInr(r.modal)}</Box>
                      <Box component="td" sx={{ textAlign: "right" }}>{formatInr(r.min)}</Box>
                      <Box component="td" sx={{ textAlign: "right" }}>{formatInr(r.max)}</Box>
                      <Box component="td" sx={{ textAlign: "center" }}>{r.markets}</Box>
                    </Box>
                  ))
                )}
              </tbody>
            </Box>
          </Box>
        </Box>

        {/* Right: chart */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 0.5,
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: "background.paper",
            p: 1,
          }}
          data-testid="agri-chart-region"
        >
          <ToolbarRow justify="space-between" gap={8} sx={{ minHeight: 0 }}>
            <Text size="sm" fw={600} data-testid="agri-chart-title">
              Modal price trend — {commodity.label}
            </Text>
            <Text size="xs" c="dimmed" data-testid="agri-chart-range">
              {series.length} sessions
            </Text>
          </ToolbarRow>
          <Box
            ref={chartRef}
            sx={{ flex: 1, minHeight: 300, minWidth: 0 }}
            data-testid="agri-chart"
          />
          {series.length === 0 && (
            <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "text.disabled" }}>
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
