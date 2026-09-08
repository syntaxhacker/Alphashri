// SMC iFVG — validated engine on real NQ ticks (thin composition over replay/tick).
import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import { TZ_IST, TZ_IST_LABEL } from "@/config/constants";
import {
  TradeReplayCard, stackColor, useTickReplayFeed,
  type Bar, type ReplayTrade, type TradeStack,
} from "@/components/replay/tick";

// Real trades from /api/poc/smc-ifvg — SMCIFVGEngine (trading/smc_ifvg.py) run bar-by-bar
// on Dukascopy ticks: history-only signals, tick-accurate fills (ask/bid), SL-first exits.
const DUKA_DATES = ["2026-09-02", "2026-08-26", "2026-07-24", "2026-07-22", "2026-07-10", "2026-07-02"];
const WINDOW = { from: "14:10", to: "19:00" };

const formatTradeTime = (timestamp: number) => {
  const d = new Date(timestamp * 1000);
  const t = d.toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", hour12: false });
  const day = d.toLocaleString("en-IN", { timeZone: TZ_IST, day: "2-digit", month: "short" });
  return `${t} ${day}`;
};

const explainer = (kind: string) =>
  kind === "inv"
    ? "1m close through FVG opposite edge, BOS-aligned. Entry next tick, SL beyond nearest opposing structure."
    : "Pullback into active FVG zone (touch within 2pts). SL beyond zone edge.";

export default function SmcTrades() {
  const [date, setDate] = useState(DUKA_DATES[0]);
  const [windowOnly, setWindowOnly] = useState(true);
  const [earlyInv, setEarlyInv] = useState(false);

  const { bars, trades, loading, error, basis } = useTickReplayFeed(async () => {
    const q = windowOnly ? `&from_ist=${WINDOW.from}&to_ist=${WINDOW.to}` : "";
    const f = earlyInv ? `&flip=3` : "";
    const [mi, mr] = await Promise.all([
      fetch(`/api/poc/smc-ifvg?date=${date}${q}&entries=inv${f}`).then(r => r.json()),
      fetch(`/api/poc/smc-ifvg?date=${date}${q}&entries=retest${f}`).then(r => r.json()),
    ]);
    const allBars = (mi.bars || mr.bars || []) as Bar[];
    const ti = ((mi.trades || []) as Omit<ReplayTrade, "stack">[]).map(t => ({ ...t, stack: "inv" as TradeStack }));
    const tr = ((mr.trades || []) as Omit<ReplayTrade, "stack">[]).map(t => ({ ...t, stack: "retest" as TradeStack }));
    const all = [...ti, ...tr].sort((a, b) => a.time - b.time);
    return { bars: allBars, trades: all, basis: mi.basis ?? mr.basis, error: mi.error && mr.error ? mi.error : undefined };
  }, [date, windowOnly, earlyInv]);

  const net = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter(t => t.pnl > 0).length;
  const netStack = (st: TradeStack) => trades.filter(t => t.stack === st).reduce((a, t) => a + t.pnl, 0);

  return (
    <Box sx={{ p: 2, width: "100%" }} data-testid="smc-trades">
      <Typography variant="h6" sx={{ color: "#E5E7EB", mb: 0.5 }}>SMC iFVG — validated engine on real NQ ticks</Typography>
      <Typography variant="caption" sx={{ color: "#9CA3AF", display: "block", mb: 1 }}>
        trading/smc_ifvg.py · history-only signals · tick fills (ask/bid, SL-first) · structure TP (RR≥3) or trail · NQ=F {basis != null ? `(basis +${basis.toFixed(1)})` : ""} · {TZ_IST_LABEL}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", alignItems: "center" }}>
        {DUKA_DATES.map(d => (
          <Chip
            key={d}
            size="small"
            label={d}
            onClick={() => setDate(d)}
            sx={{
              bgcolor: d === date ? "#2563EB" : "#1F2937",
              color: "#E5E7EB",
              fontWeight: d === date ? 700 : 400,
              cursor: "pointer",
            }}
          />
        ))}
        <FormControlLabel
          control={<Switch size="small" checked={earlyInv} onChange={(_, v) => setEarlyInv(v)} />}
          label="early-inversion catch (experimental)"
          sx={{ color: "#9CA3AF", '& .MuiFormControlLabel-label': { fontSize: 12 } }}
        />
        <FormControlLabel
          control={<Switch size="small" checked={windowOnly} onChange={(_, v) => setWindowOnly(v)} />}
          label={`${WINDOW.from}–${WINDOW.to} window only`}
          sx={{ color: "#9CA3AF", '& .MuiFormControlLabel-label': { fontSize: 12 } }}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
        <Chip size="small" label={`${trades.length ?? 0} trades`} sx={{ bgcolor: "#1F2937", color: "#00FF00" }} />
        <Chip size="small" label={`win ${wins}/${trades.length ?? 0}`} sx={{ bgcolor: "#1F2937", color: "#9CA3AF" }} />
        <Chip size="small" label={`net ${net > 0 ? "+" : ""}${net.toFixed(1)} pts`} color={net > 0 ? "success" : "error"} />
        <Chip size="small" label={`MOMENTUM ${netStack("inv") > 0 ? "+" : ""}${netStack("inv").toFixed(1)}`} sx={{ bgcolor: "#1F2937", color: "#58A6FF", border: `1px solid ${stackColor("inv")}` }} />
        <Chip size="small" label={`REVERSION ${netStack("retest") > 0 ? "+" : ""}${netStack("retest").toFixed(1)}`} sx={{ bgcolor: "#1F2937", color: "#CE9BFC", border: `1px solid ${stackColor("retest")}` }} />
        {loading && <Chip size="small" label="loading ticks…" sx={{ bgcolor: "#1F2937", color: "#58A6FF" }} />}
        {error && <Chip size="small" label={error} color="error" />}
      </Stack>
      {!loading && trades.length === 0 && (
        <Box sx={{ p: 2, color: "#9CA3AF", fontSize: 12 }}>No trades in this view.</Box>
      )}
      {trades.map((tr, i) => (
        <TradeReplayCard
          key={i}
          bars={bars}
          trade={tr}
          index={i}
          timeLabel={(ts) => `${formatTradeTime(ts)} ${TZ_IST_LABEL}`}
          explainer={(t) => explainer(t.kind)}
        />
      ))}
    </Box>
  );
}
