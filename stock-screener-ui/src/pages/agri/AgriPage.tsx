import { createEffect, createSignal, createMemo, onMount, Show, For } from "solid-js";
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
import { fetchAgriCommodities, fetchAgriPrices } from "@/api/agri";
import type { AgriCommodity, AgriCommoditiesResponse, AgriPricesResponse } from "@/types/agri";
import { useColorScheme } from "@/ui/hooks";
import { POSITIVE, NEGATIVE, PRIMARY } from "@/ui/palette";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import { Icon } from "../../components/common/Icons";
import { EChart } from "../heatmap/EChart";

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
  const { isDark } = useColorScheme();
  const [commodity, setCommodity] = createSignal<AgriCommodity>(COMMODITY_OPTIONS[0]);

  const [commoditiesData, setCommoditiesData] = createSignal<AgriCommoditiesResponse | null>(null);
  const [commoditiesLoading, setCommoditiesLoading] = createSignal(true);

  const [prices, setPrices] = createSignal<AgriPricesResponse | null>(null);
  const [pricesLoading, setPricesLoading] = createSignal(true);
  const [pricesError, setPricesError] = createSignal<string | null>(null);

  onMount(() => {
    fetchAgriCommodities()
      .then(setCommoditiesData)
      .catch(() => {
        // Best-effort: fall back to the static option list.
      })
      .finally(() => setCommoditiesLoading(false));
  });

  const options = createMemo<AgriCommodity[]>(() => commoditiesData()?.commodities ?? COMMODITY_OPTIONS);

  const fetchPrices = async () => {
    setPricesLoading(true);
    setPricesError(null);
    try {
      const data = await fetchAgriPrices(commodity().key);
      setPrices(data);
    } catch (err) {
      setPricesError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setPricesLoading(false);
    }
  };

  // Re-fetch on commodity change and on mount (createEffect runs on mount).
  createEffect(() => {
    commodity();
    void fetchPrices();
  });

  const refresh = () => void fetchPrices();

  const snapshot = createMemo(() => prices()?.snapshot.find((s) => s.key === commodity().key) ?? null);
  const series = createMemo(() => prices()?.series ?? []);

  const latest = () => snapshot()?.modal ?? null;
  const prev7d = createMemo(() =>
    nearestOnOrBefore(series(), new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)),
  );
  const prev30d = createMemo(() =>
    nearestOnOrBefore(series(), new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
  );
  const prev180d = createMemo(() =>
    nearestOnOrBefore(series(), new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)),
  );
  const chg7d = () => (latest() != null ? pctChange(latest() as number, prev7d()) : null);
  const chg30d = () => (latest() != null ? pctChange(latest() as number, prev30d()) : null);
  const chg180d = () => (latest() != null ? pctChange(latest() as number, prev180d()) : null);

  // ---- ECharts option -----------------------------------------------------
  const option = createMemo(() => {
    const data = series();
    if (data.length === 0) return {};
    const dark = isDark();
    const dates = data.map((p) => p.date);
    const values = data.map((p) => p.modal);
    return {
      "background-color": "transparent",
      tooltip: {
        trigger: "axis",
        "background-color": dark ? palette.alpha(palette.BG_COLOR, 0.85) : "#fff",
        textStyle: { color: dark ? palette.TEXT_COLOR : "#000" },
      },
      grid: { left: 60, right: 40, top: 40, bottom: 60 },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { "font-size": "10px", color: dark ? palette.TEXT_MUTED_COLOR : palette.TEXT_MUTED_COLOR },
        axisLine: { lineStyle: { color: dark ? palette.BORDER_COLOR : palette.TEXT_MUTED_COLOR } },
      },
      yAxis: {
        type: "value",
        axisLabel: { "font-size": "10px", color: dark ? palette.TEXT_MUTED_COLOR : palette.TEXT_MUTED_COLOR, formatter: "₹{value}" },
        axisLine: { lineStyle: { color: dark ? palette.BORDER_COLOR : palette.TEXT_MUTED_COLOR } },
        splitLine: { lineStyle: { color: dark ? palette.SURFACE_ALT : palette.TEXT_COLOR, type: "dashed" } },
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
  });

  const statColor = (v: number | null): string => {
    if (v == null) return "dimmed";
    return v > 0 ? POSITIVE : v < 0 ? NEGATIVE : "dimmed";
  };

  const pct = (v: number | null): string =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  const isLoading = () => commoditiesLoading() || pricesLoading();
  const snapshotCount = () => prices()?.snapshot.length ?? 0;

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
          <Text size="xs" c="dimmed" style={{ "text-transform": "uppercase", "font-size": "10px" }} fw={700}>
            Commodity
          </Text>
          <Select
            data={options().map((o) => ({ value: o.key, label: o.label }))}
            value={commodity().key}
            onChange={(v) => setCommodity(options().find((o) => o.key === v) ?? options()[0])}
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
            leftSection={<Icon name="refresh" size={14} />}
            onClick={refresh}
            disabled={isLoading()}
            data-testid="agri-refresh"
          >
            Refresh
          </Button>
        </Box>
      </ToolbarRow>

      <Show when={pricesError()}>
        <Badge color="error" data-testid="agri-error">{pricesError()}</Badge>
      </Show>

      {/* Stat strip: selected commodity latest price + changes */}
      <Box
        className="flex min-h-0 items-center gap-3 rounded border border-fin-border bg-fin-surface p-3"
        data-testid="agri-stat-strip"
      >
        <Box className="min-w-0">
          <Text size="xs" c="dimmed" data-testid="agri-stat-date">
            {snapshot() ? snapshot()!.date : "—"}
          </Text>
          <Text size="lg" fw={700} className="font-mono tabular-nums" data-testid="agri-stat-price">
            {formatInr(latest())}
          </Text>
          <Text
            size="xs"
            c={statColor(chg7d())}
            data-testid="agri-stat-chg7d"
          >
            {chg7d() == null ? "—" : `${pct(chg7d())} 1w`}
          </Text>
        </Box>
        <Divider orientation="vertical" style={{ height: "32px", "margin-left": "8px", "margin-right": "8px" }} />
        <Box className="min-w-0">
          <Text size="xs" c="dimmed">1 month</Text>
          <Text size="sm" fw={600} c={statColor(chg30d())} className="font-mono tabular-nums" data-testid="agri-stat-chg30d">
            {pct(chg30d())}
          </Text>
        </Box>
        <Divider orientation="vertical" style={{ height: "32px", "margin-left": "8px", "margin-right": "8px" }} />
        <Box className="min-w-0">
          <Text size="xs" c="dimmed">6 months</Text>
          <Text size="sm" fw={600} c={statColor(chg180d())} className="font-mono tabular-nums" data-testid="agri-stat-chg180d">
            {pct(chg180d())}
          </Text>
        </Box>
        <Box className="flex-1 min-w-0" />
        <Badge color="info" size="xs" data-testid="agri-stat-markets">
          {snapshot() ? `${snapshot()!.markets} markets` : "—"}
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
              {snapshot() ? snapshot()!.date : "—"}
            </Text>
          </ToolbarRow>
          <Box
            className="min-h-0 flex-1 overflow-auto rounded border border-fin-border bg-fin-surface"
            data-testid="agri-table"
          >
            <table className="w-full border-collapse text-[11px]" data-testid="agri-table-element">
              <thead>
                <tr className="bg-fin-surface-alt">
                  <th className="px-2 py-1.5 text-left text-[10px] text-fin-text-muted">Commodity</th>
                  <th className="px-2 py-1.5 text-left text-[10px] text-fin-text-muted">Date</th>
                  <th className="px-2 py-1.5 text-right text-[10px] text-fin-text-muted">Modal</th>
                  <th className="px-2 py-1.5 text-right text-[10px] text-fin-text-muted">Min</th>
                  <th className="px-2 py-1.5 text-right text-[10px] text-fin-text-muted">Max</th>
                  <th className="px-2 py-1.5 text-center text-[10px] text-fin-text-muted">Markets</th>
                </tr>
              </thead>
              <tbody>
                <Show
                  when={snapshotCount() > 0}
                  fallback={
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-fin-text-muted">No prices available.</td>
                    </tr>
                  }
                >
                  <For each={prices()?.snapshot ?? []}>
                    {(r) => (
                      <tr
                        className="[&_td]:border-b [&_td]:border-fin-border [&_td]:px-2 [&_td]:py-1"
                        data-testid={`agri-row-${r.key}`}
                      >
                        <td>{r.label}</td>
                        <td>{r.date}</td>
                        <td className="text-right font-mono tabular-nums">{formatInr(r.modal)}</td>
                        <td className="text-right font-mono tabular-nums">{formatInr(r.min)}</td>
                        <td className="text-right font-mono tabular-nums">{formatInr(r.max)}</td>
                        <td className="text-center font-mono tabular-nums">{r.markets}</td>
                      </tr>
                    )}
                  </For>
                </Show>
              </tbody>
            </table>
          </Box>
        </Box>

        {/* Right: chart */}
        <Box
          className="flex min-h-0 flex-1 flex-col gap-1 rounded border border-fin-border bg-fin-surface p-2"
          data-testid="agri-chart-region"
        >
          <ToolbarRow justify="space-between" gap={8} className="min-h-0">
            <Text size="sm" fw={600} data-testid="agri-chart-title">
              Modal price trend — {commodity().label}
            </Text>
            <Text size="xs" c="dimmed" data-testid="agri-chart-range">
              {series().length} sessions
            </Text>
          </ToolbarRow>
          <Box
            className="min-h-[300px] min-w-0 flex-1 flex"
            data-testid="agri-chart"
          >
            <EChart option={option()} />
          </Box>
          <Show when={series().length === 0}>
            <Box className="flex flex-1 items-center justify-center text-fin-text-muted">
              No price history yet. Run the collector to build it:
              <br />python scripts/market/agri_collect.py
            </Box>
          </Show>
        </Box>
      </Box>

      <LoadingOverlay visible={isLoading()} data-testid="agri-loading" />
    </Box>
  );
}
