import Box from "@mui/material/Box";
import { memo } from "react";
import * as palette from "@/ui/palette";
import { FLOW_NOISE, indexAgo, readFlow, rollingRead } from "./niftyFlowRead";
import type { FlowRead, OiPoint } from "./niftyFlowRead";

export type { OiPoint };

/**
 * Fast OI flow — the 10-second feed.
 *
 * The 1-minute tape hides what happens inside a minute (2026-10-26 09:54: the
 * 22,500/22,600 call OI collapsed 15M in four minutes). The backend aggregates
 * the slim 10 s chain per snapshot, so this strip only receives four numbers
 * per tick and diffs them over time windows.
 *
 * Read:
 *   CE OI falling + PE OI rising  → writers covering calls / adding puts = SQUEEZE ↑
 *   CE OI rising  + PE OI falling → writers adding calls = CAPPED ↓
 *
 * The headline is the 1-MINUTE delta: the poller bursts to 3 s cadence, so two
 * neighbouring samples are often identical and a 10 s-only read shows 0 while a
 * 9M unwind just happened. The 10 s pace and a ⚡ BURST chip cover the instant.
 */

/** One block per 10 s snapshot; 45 blocks ≈ 7.5 minutes of history. */
const RIBBON_BARS = 45;
const BLOCK_W = 3;
const BLOCK_GAP = 1;

export interface Nifty10sStripProps {
  points: OiPoint[];
  /** Optional noise floor (contracts). Defaults to FLOW_NOISE (100k). */
  noise?: number;
}

function fmtDelta(v: number): string {
  if (Math.abs(v) < 1000) return "0";
  const sign = v < 0 ? "−" : "+";
  return Math.abs(v) >= 1e6
    ? `${sign}${(Math.abs(v) / 1e6).toFixed(2)}M`
    : `${sign}${Math.round(Math.abs(v) / 1000)}K`;
}

const Nifty10sStripInner = function Nifty10sStrip({ points, noise = FLOW_NOISE }: Nifty10sStripProps) {
  if (!points || points.length < 2) return null;

  const last = points[points.length - 1];
  const i10 = indexAgo(points, points.length - 1, 10);
  const i60 = indexAgo(points, points.length - 1, 60);
  const d10 = { ce: last.ce - points[i10].ce, pe: last.pe - points[i10].pe };
  const d60 = { ce: last.ce - points[i60].ce, pe: last.pe - points[i60].pe };

  // Classify on the 1-minute window. OI direction alone is ambiguous: put OI
  // building is BULLISH if puts were written (premium fell) and BEARISH if
  // they were bought (premium rose). The premium move is the tiebreaker.
  const NOISE = noise;
  const lastPremCe = last.cePrem ?? null;
  const lastPremPe = last.pePrem ?? null;
  const basePremCe = points[i60].cePrem ?? null;
  const basePremPe = points[i60].pePrem ?? null;
  const dPremCe =
    lastPremCe != null && basePremCe != null ? lastPremCe - basePremCe : null;
  const dPremPe =
    lastPremPe != null && basePremPe != null ? lastPremPe - basePremPe : null;

  const read = readFlow(d60, dPremCe, dPremPe, NOISE);
  const tone = read ? (read.bias === "bull" ? palette.POSITIVE : palette.NEGATIVE) : palette.TEXT_MUTED;
  const burst = Math.abs(d10.ce) >= 1e6 || Math.abs(d10.pe) >= 1e6;

  // Bias per snapshot over the same 1-minute window: a word flips every few
  // seconds, a ribbon shows whether the read is persistent or just noise.
  const ribbonStart = Math.max(0, points.length - RIBBON_BARS);
  const ribbon: (FlowRead | null)[] = [];
  for (let i = ribbonStart; i < points.length; i++) ribbon.push(rollingRead(points, i, NOISE));
  const bullCount = ribbon.filter((r) => r?.bias === "bull").length;
  const bearCount = ribbon.filter((r) => r?.bias === "bear").length;
  const flatCount = ribbon.length - bullCount - bearCount;

  return (
    <Box
      data-testid="nifty-10s-strip"
      data-state={read ? read.bias : "balanced"}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        height: 20,
        minHeight: 20,
        px: 1,
        border: `1px solid ${palette.TERM_BORDER}`,
        borderRadius: "4px",
        bgcolor: palette.TERM_HEADER,
        width: "100%",
        minWidth: 0,
        flexShrink: 0,
        fontFamily: palette.MONO,
        fontSize: 9,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <Box component="span" sx={{ color: palette.TEXT_MUTED, fontWeight: 700, letterSpacing: "0.08em", flexShrink: 0 }}>
        OI 1m
      </Box>
      <Box
        component="span"
        data-testid="nifty-10s-ce"
        sx={{ color: d60.ce < 0 ? palette.POSITIVE : palette.NEGATIVE, fontWeight: 800, flexShrink: 0 }}
      >
        CE {fmtDelta(d60.ce)}
      </Box>
      <Box
        component="span"
        data-testid="nifty-10s-pe"
        sx={{ color: d60.pe > 0 ? palette.POSITIVE : palette.NEGATIVE, fontWeight: 800, flexShrink: 0 }}
      >
        PE {fmtDelta(d60.pe)}
      </Box>
      <Box
        component="span"
        data-testid="nifty-10s-state"
        sx={{ color: tone, fontWeight: 800, letterSpacing: "0.04em", flexShrink: 0 }}
        title="Premium vs the delta-implied move (ATM delta 0.5). IV expansion can read as buying."
      >
        {read ? (read.bias === "bull" ? "↑ BULLISH" : "↓ BEARISH") : "FLAT"}
      </Box>
      {read ? (
        <Box
          component="span"
          data-testid="nifty-10s-reason"
          sx={{ color: palette.TEXT_MUTED, fontWeight: 600, flexShrink: 0 }}
        >
          {read.reason}
        </Box>
      ) : null}
      {burst ? (
        <Box
          component="span"
          data-testid="nifty-10s-burst"
          sx={{ color: palette.WARNING, fontWeight: 800, letterSpacing: "0.06em", flexShrink: 0 }}
          title={`last 10 s: CE ${fmtDelta(d10.ce)} · PE ${fmtDelta(d10.pe)}`}
        >
          ⚡ BURST
        </Box>
      ) : null}
      <Box
        component="span"
        data-testid="nifty-10s-counts"
        sx={{ color: palette.TEXT_MUTED, fontWeight: 700, flexShrink: 0, display: "inline-flex", gap: "4px" }}
        title={`${ribbon.length} snapshots · ${bullCount} bullish · ${bearCount} bearish · ${flatCount} flat · last 10 s CE ${fmtDelta(d10.ce)} / PE ${fmtDelta(d10.pe)}`}
      >
        <Box component="span" sx={{ color: palette.POSITIVE }}>{bullCount}↑</Box>
        <Box component="span" sx={{ color: palette.NEGATIVE }}>{bearCount}↓</Box>
      </Box>
      <svg
        data-testid="nifty-10s-ribbon"
        width={ribbon.length * (BLOCK_W + BLOCK_GAP)}
        height={12}
        viewBox={`0 0 ${ribbon.length * (BLOCK_W + BLOCK_GAP)} 12`}
        style={{ display: "block", flexShrink: 0 }}
        aria-hidden
      >
        {ribbon.map((r, i) => (
          <rect
            key={i}
            x={i * (BLOCK_W + BLOCK_GAP)}
            y={0}
            width={BLOCK_W}
            height={12}
            rx={0.5}
            fill={r ? (r.bias === "bull" ? palette.POSITIVE : palette.NEGATIVE) : palette.TEXT_MUTED}
            opacity={r ? 0.9 : 0.22}
          />
        ))}
      </svg>
      <Box
        component="span"
        sx={{ color: palette.TEXT_MUTED, flexShrink: 0 }}
        title={`${points.length} snapshots · ${points[0].t.slice(11, 19)} → ${last.t.slice(11, 19)}`}
      >
        {last.t.slice(11, 19)}
      </Box>
    </Box>
  );
};

export const Nifty10sStrip = memo(Nifty10sStripInner);
Nifty10sStrip.displayName = "Nifty10sStrip";
