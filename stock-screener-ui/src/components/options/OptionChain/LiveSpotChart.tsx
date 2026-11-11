import { Text, Skeleton, Stack } from "@/ui";
import { Box } from "@/ui";
import { useEffect, useState, useMemo } from "react";
import { API_BASE } from "@/api/config";
import * as palette from "@/ui/palette";

interface HistoryPoint {
  time: string;
  price: number;
}

export function LiveSpotChart({ underlying }: { underlying: string }) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHistory() {
      if (!underlying) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/options/spot-history/${underlying}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.history) setHistory(data.history);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, [underlying]);

  const svgParams = useMemo(() => {
    if (history.length < 2) return null;
    const prices = history.map((h) => h.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    const width = 200;
    const height = 40;
    const padding = 2;

    const points = history
      .map((h, i) => {
        const x = (i / (history.length - 1)) * width;
        const y = height - ((h.price - min) / range) * (height - padding * 2) - padding;
        return `${x},${y}`;
      })
      .join(" ");

    return { points, min, max, lastPrice: history[history.length - 1].price };
  }, [history]);

  if (loading) return <Skeleton h={40} w={200} radius="sm" />;
  if (!svgParams) return null;

  const isPositive = history[history.length - 1].price >= history[0].price;
  const color = isPositive ? palette.POSITIVE : palette.NEGATIVE;

  return (
    <Box className="flex live-spot-chart" data-testid="options-live-spot-chart" alignItems="center" justifyContent="center" gap={1} p={1}>
      <Box className="flex flex-col items-center relative spot-chart-svg-container">
        <svg width="200" height="40" style={{ display: "block" }} className="spot-chart-svg">
          <defs>
            <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polyline
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={svgParams.points}
            style={{
              strokeDasharray: 1000,
              strokeDashoffset: 1000,
              animation: "dash 2s ease-out forwards",
            }}
          />
          <path d={`M 0,40 L ${svgParams.points} L 200,40 Z`} fill="url(#gradient)" style={{ opacity: 0, animation: "fadeIn 1s ease-out 1s forwards" }} />
        </svg>
        <Text size="xs" className="text-fin-text-muted spot-chart-range" data-testid="options-spot-chart-range">
          {svgParams.min.toFixed(2)} – {svgParams.max.toFixed(2)}
        </Text>
        <style>
          {`
            @keyframes dash { to { stroke-dashoffset: 0; } }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          `}
        </style>
      </Box>
      <Stack spacing={0} className="spot-chart-info" data-testid="options-spot-chart-info" align="center">
        <Text size="sm" fw={700} className={`spot-price-value ${color}`}>
          {svgParams.lastPrice.toFixed(2)}
        </Text>
        <Text size="sm" className="text-fin-text-muted spot-trend-label">
          Trend (5m)
        </Text>
      </Stack>
    </Box>
  );
}
