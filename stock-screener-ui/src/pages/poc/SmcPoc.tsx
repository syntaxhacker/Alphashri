// SmcPoc — trendline + rectangle overlay POC (thin composition over replay/tick).
import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Chip from "@mui/material/Chip";
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

  // programmatic rectangles + trendlines (no FVG) — ultra simple, 2 rects + 1 trend
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

  return (
    <Box sx={{ height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', p: 1, gap: 1, maxWidth: 'none', m: 0, bgcolor: palette.NT_BG }} data-testid="smc-poc">
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center', px: 1 }} >
        <Typography variant="subtitle2" sx={{ color: "#E5E7EB" }}>POC — Trendline + Rectangle</Typography>
        <Typography variant="caption" sx={{ color: "#9CA3AF" }}>
          {source === "nq" ? "NQ=F 15m" : "Mock 1m"} · <Box component="span" sx={{ color: "#A78BFA" }}>rect</Box> <Box component="span" sx={{ color: palette.NT_TREND }}>trend</Box>
        </Typography>
        <Chip size="small" label={`${bars.length} bars`} sx={{ bgcolor: "#1F2937", color: "#9CA3AF", height: 20 }} />
        {loading && <Chip size="small" label="loading…" sx={{ bgcolor: "#1F2937", color: "#58A6FF", height: 20 }} />}
        <Box sx={{ flex: 1 }} />
        <FormControlLabel control={<Switch size="small" checked={source === "nq"} onChange={(_, v) => setSource(v ? "nq" : "mock")} sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#58A6FF' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#58A6FF' } }} />} label="Real NQ" sx={{ color: "#E5E7EB", m: 0, '& .MuiFormControlLabel-label': { fontSize: 12 } }} />
        <FormControlLabel control={<Switch size="small" checked={showRect} onChange={(_, v) => setShowRect(v)} sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#A78BFA' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#A78BFA' } }} />} label="Rect" sx={{ color: "#A78BFA", m: 0, '& .MuiFormControlLabel-label': { fontSize: 12 } }} />
        <FormControlLabel control={<Switch size="small" checked={showTrend} onChange={(_, v) => setShowTrend(v)} sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: palette.NT_TREND }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: palette.NT_TREND } }} />} label="Trend" sx={{ color: palette.NT_TREND, m: 0, '& .MuiFormControlLabel-label': { fontSize: 12 } }} />
      </Stack>
      <Card elevation={0} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, overflow: "hidden" }}>
        <CardContent sx={{ flex: 1, minHeight: 0, p: 0, position: "relative", display: 'flex', "&:last-child": { pb: 0 } }}>
          <Box sx={{ position: "absolute", inset: 0 }} data-testid="smc-chart">
            <TickReplayChart bars={bars} zones={zones} trends={trends} height={600} />
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
