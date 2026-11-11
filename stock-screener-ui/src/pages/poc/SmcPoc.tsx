// SmcPoc — trendline + rectangle overlay POC (thin composition over replay/tick).
import { useMemo, useState } from "react";
import { Box, Stack, Text, Switch, Chip, Card } from "@/ui";
import * as palette from "@/ui/palette";
import {
  TickReplayChart, genMockBars, useTickReplayFeed,
  type Bar, type ReplayTrend, type ReplayZone,
} from "@/components/replay/tick";

export default function SmcPoc() {
  const [source, setSource] = useState<"mock" | "nq">("nq");
  const [showRect, setShowRect] = useState(true);
  const [showTrend, setShowTrend] = useState(true);

  const { bars, loading } = useTickReplayFeed(async () => {
    if (source !== "nq") return { bars: genMockBars(260), trades: [] };
    const j = await fetch("/api/poc/nq?period=5d&interval=15m").then((r) => r.json());
    if (Array.isArray(j.bars) && j.bars.length > 10) {
      const cleaned: Bar[] = j.bars.map((b: Bar) => ({
        time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0,
      }));
      return { bars: cleaned, trades: [] };
    }
    return { bars: genMockBars(260), trades: [] };
  }, [source]);

  const zones: ReplayZone[] = useMemo(() => {
    if (!showRect || bars.length < 80) return [];
    const a = bars[20];
    const b = bars[60];
    const c = bars[140];
    const d = bars[180];
    if (!a || !b || !c || !d) return [];
    return [
      { kind: "supply", t1: a.time, t2: b.time, top: Math.max(...bars.slice(20, 61).map((x) => x.high)), bottom: Math.min(...bars.slice(20, 61).map((x) => x.low)), label: "SUPPLY" },
      { kind: "demand", t1: c.time, t2: d.time, top: Math.max(...bars.slice(140, 181).map((x) => x.high)), bottom: Math.min(...bars.slice(140, 181).map((x) => x.low)), label: "DEMAND" },
    ];
  }, [bars, showRect]);

  const trends: ReplayTrend[] = useMemo(() => {
    if (!showTrend || bars.length < 70) return [];
    const p1 = bars[10];
    const p2 = bars[65];
    if (!p1 || !p2) return [];
    return [{ t1: p1.time, p1: p1.low, t2: p2.time, p2: p2.high }];
  }, [bars, showTrend]);

;

  return (
    <Box
      className="h-[calc(100vh-48px)] flex flex-col p-2 gap-2 max-w-none m-0"
      style={{ backgroundColor: palette.NT_BG }}
      data-testid="smc-poc"
    >
      <Stack direction="row" spacing={1} className="flex-wrap items-center px-2">
        <Text size="sm" fw={600} style={{ color: "#E5E7EB" }}>
          POC — Trendline + Rectangle
        </Text>
        <Text size="xs" style={{ color: "#9CA3AF" }}>
          {source === "nq" ? "NQ=F 15m" : "Mock 1m"} ·
          <span style={{ color: "#A78BFA" }}>rect</span>{" "}
          <span style={{ color: palette.NT_TREND }}>trend</span>
        </Text>
        <Chip size="sm" label={`${bars.length} bars`} style={{ backgroundColor: "#1F2937", color: "#9CA3AF", height: 20 }} />
        {loading && <Chip size="sm" label="loading…" style={{ backgroundColor: "#1F2937", color: "#58A6FF", height: 20 }} />}
        <Box className="flex-1" />
        <span className="flex items-center gap-2" style={{ fontSize: 12, color: "#E5E7EB" }}>
          <Switch size="sm" checked={source === "nq"} onChange={(e) => setSource(e.currentTarget.checked ? "nq" : "mock")} color="primary" />
          Real NQ
        </span>
        <span className="flex items-center gap-2" style={{ fontSize: 12, color: "#A78BFA" }}>
          <Switch size="sm" checked={showRect} onChange={(e) => setShowRect(e.currentTarget.checked)} color="info" />
          Rect
        </span>
        <span className="flex items-center gap-2" style={{ fontSize: 12, color: palette.NT_TREND }}>
          <Switch size="sm" checked={showTrend} onChange={(e) => setShowTrend(e.currentTarget.checked)} color="primary" />
          Trend
        </span>
      </Stack>
      <Card
        className="flex-1 min-h-0 flex flex-col"
        style={{ backgroundColor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, overflow: "hidden" }}
        data-testid="smc-card"
      >
        <Box className="flex-1 min-h-0 p-0 relative flex" style={{ paddingBottom: 0 }}>
          <Box className="absolute inset-0" data-testid="smc-chart">
            <TickReplayChart bars={bars} zones={zones} trends={trends} height={600} />
          </Box>
        </Box>
      </Card>
    </Box>
  );
}
