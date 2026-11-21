// SmcPoc — trendline + rectangle overlay POC (thin composition over replay/tick).
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { Box, Stack, Text, Switch, Chip, Card } from "@/ui";
import * as palette from "@/ui/palette";
import {
  TickReplayChart, genMockBars,
  type Bar, type ReplayTrend, type ReplayZone,
} from "@/components/replay/tick";

export default function SmcPoc() {
  const [source, setSource] = createSignal<"mock" | "nq">("nq");
  const [showRect, setShowRect] = createSignal(true);
  const [showTrend, setShowTrend] = createSignal(true);

  const [feed, setFeed] = createSignal<{ bars: Bar[]; loading: boolean }>({ bars: [], loading: true });

  createEffect(() => {
    const src = source();
    let live = true;
    setFeed({ bars: [], loading: true });

    const load = async (): Promise<{ bars: Bar[] }> => {
      if (src !== "nq") return { bars: genMockBars(260) };
      try {
        const j = await fetch("/api/poc/nq?period=5d&interval=15m").then((r) => r.json());
        if (Array.isArray(j.bars) && j.bars.length > 10) {
          return {
            bars: j.bars.map((b: Bar) => ({
              time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0,
            })),
          };
        }
      } catch {
        // fall through to the mock feed
      }
      return { bars: genMockBars(260) };
    };

    load()
      .then(({ bars }) => {
        if (live) setFeed({ bars, loading: false });
      })
      .catch(() => {
        if (live) setFeed({ bars: [], loading: false });
      });

    onCleanup(() => {
      live = false;
    });
  });

  const bars = () => feed().bars;
  const loading = () => feed().loading;

  const zones = createMemo<ReplayZone[]>(() => {
    if (!showRect() || bars().length < 80) return [];
    const b = bars();
    const a = b[20], c = b[140], d = b[180];
    if (!a || !c || !d || !b[60]) return [];
    return [
      { kind: "supply", t1: a.time, t2: b[60].time, top: Math.max(...b.slice(20, 61).map((x) => x.high)), bottom: Math.min(...b.slice(20, 61).map((x) => x.low)), label: "SUPPLY" },
      { kind: "demand", t1: c.time, t2: d.time, top: Math.max(...b.slice(140, 181).map((x) => x.high)), bottom: Math.min(...b.slice(140, 181).map((x) => x.low)), label: "DEMAND" },
    ];
  });

  const trends = createMemo<ReplayTrend[]>(() => {
    if (!showTrend() || bars().length < 70) return [];
    const b = bars();
    const p1 = b[10], p2 = b[65];
    if (!p1 || !p2) return [];
    return [{ t1: p1.time, p1: p1.low, t2: p2.time, p2: p2.high }];
  });

  return (
    <Box
      className="h-[calc(100vh-48px)] flex flex-col p-2 gap-2 max-w-none m-0"
      style={{ "background-color": palette.NT_BG }}
      data-testid="smc-poc"
    >
      <Stack direction="row" spacing={1} className="flex-wrap items-center px-2">
        <Text size="sm" fw={600} style={{ color: palette.TEXT_COLOR }}>
          POC — Trendline + Rectangle
        </Text>
        <Text size="xs" style={{ color: palette.TEXT_MUTED_COLOR }}>
          {source() === "nq" ? "NQ=F 15m" : "Mock 1m"} ·
          <span style={{ color: palette.PIVOT_CUSTOM }}>rect</span>{" "}
          <span style={{ color: palette.NT_TREND }}>trend</span>
        </Text>
        <Chip size="sm" label={`${bars().length} bars`} style={{ "background-color": palette.SURFACE_ALT, color: palette.TEXT_MUTED_COLOR, height: "20px" }} />
        <Show when={loading()}>
          <Chip size="sm" label="loading…" style={{ "background-color": palette.SURFACE_ALT, color: palette.INFO, height: "20px" }} />
        </Show>
        <Box className="flex-1" />
        <span className="flex items-center gap-2" style={{ "font-size": "12px", color: palette.TEXT_COLOR }}>
          <Switch size="sm" checked={source() === "nq"} onChange={(e) => setSource(e.currentTarget.checked ? "nq" : "mock")} color="primary" />
          Real NQ
        </span>
        <span className="flex items-center gap-2" style={{ "font-size": "12px", color: palette.PIVOT_CUSTOM }}>
          <Switch size="sm" checked={showRect()} onChange={(e) => setShowRect(e.currentTarget.checked)} color="info" />
          Rect
        </span>
        <span className="flex items-center gap-2" style={{ "font-size": "12px", color: palette.NT_TREND }}>
          <Switch size="sm" checked={showTrend()} onChange={(e) => setShowTrend(e.currentTarget.checked)} color="primary" />
          Trend
        </span>
      </Stack>
      <Card
        className="flex-1 min-h-0 flex flex-col"
        style={{ "background-color": palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, overflow: "hidden" }}
        data-testid="smc-card"
      >
        <Box className="flex-1 min-h-0 p-0 relative flex" style={{ "padding-bottom": 0 }}>
          <Box className="absolute inset-0" data-testid="smc-chart">
            <TickReplayChart bars={bars()} zones={zones()} trends={trends()} height={600} />
          </Box>
        </Box>
      </Card>
    </Box>
  );
}
