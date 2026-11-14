import { Text, Skeleton, Stack } from "@/ui";
import { Box } from "@/ui";
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { API_BASE } from "@/api/config";
import * as palette from "@/ui/palette";

interface HistoryPoint {
  time: string;
  price: number;
}

export function LiveSpotChart(props: { underlying: string }) {
  const [history, setHistory] = createSignal<HistoryPoint[]>([]);
  const [loading, setLoading] = createSignal(true);

  createEffect(() => {
    const underlying = props.underlying;
    if (!underlying) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/api/options/spot-history/${underlying}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.history) setHistory(data.history);
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    onCleanup(() => {
      cancelled = true;
    });
  });

  const svgParams = createMemo(() => {
    const points = history();
    if (points.length < 2) return null;
    const prices = points.map((h) => h.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    const width = 200;
    const height = 40;
    const padding = 2;

    const pointList = points
      .map((h, i) => {
        const x = (i / (points.length - 1)) * width;
        const y = height - ((h.price - min) / range) * (height - padding * 2) - padding;
        return `${x},${y}`;
      })
      .join(" ");

    const last = points[points.length - 1];
    const isPositive = last.price >= points[0].price;
    return {
      points: pointList,
      min,
      max,
      lastPrice: last.price,
      color: isPositive ? palette.POSITIVE : palette.NEGATIVE,
    };
  });

  return (
    <Show when={loading()} fallback={
      <Show when={svgParams()}>
        {(sp) => (
          <Box className="flex live-spot-chart" data-testid="options-live-spot-chart" alignItems="center" justifyContent="center" gap={1} p={1}>
            <Box className="flex flex-col items-center relative spot-chart-svg-container">
              <svg width="200" height="40" style={{ display: "block" }} className="spot-chart-svg">
                <defs>
                  <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color={sp().color} stop-opacity="0.3" />
                    <stop offset="100%" stop-color={sp().color} stop-opacity="0" />
                  </linearGradient>
                </defs>
                <polyline
                  fill="none"
                  stroke={sp().color}
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  points={sp().points}
                  style={{
                    "stroke-dasharray": "1000",
                    "stroke-dashoffset": "1000",
                    animation: "dash 2s ease-out forwards",
                  }}
                />
                <path d={`M 0,40 L ${sp().points} L 200,40 Z`} fill="url(#gradient)" style={{ opacity: "0", animation: "fadeIn 1s ease-out 1s forwards" }} />
              </svg>
              <Text size="xs" className="text-fin-text-muted spot-chart-range" data-testid="options-spot-chart-range">
                {sp().min.toFixed(2)} – {sp().max.toFixed(2)}
              </Text>
              <style>
                {`
                  @keyframes dash { to { "stroke-dashoffset": 0; } }
                  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                `}
              </style>
            </Box>
            <Stack spacing={0} className="spot-chart-info" data-testid="options-spot-chart-info" align="center">
              <Text size="sm" fw={700} className={`spot-price-value ${sp().color}`}>
                {sp().lastPrice.toFixed(2)}
              </Text>
              <Text size="sm" className="text-fin-text-muted spot-trend-label">
                Trend (5m)
              </Text>
            </Stack>
          </Box>
        )}
      </Show>
    }>
      <Skeleton h={40} w={200} radius="sm" />
    </Show>
  );
}
