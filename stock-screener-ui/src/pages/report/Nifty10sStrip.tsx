import { For, Show } from "solid-js";
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

export function Nifty10sStrip(props: Nifty10sStripProps) {
  return (
    <Show when={props.points && props.points.length >= 2 ? props.points : null}>
      {(points) => {

  const pts = points();
  const last = pts[pts.length - 1];
  const i10 = indexAgo(pts, pts.length - 1, 10);
  const i60 = indexAgo(pts, pts.length - 1, 60);
  const d10 = { ce: last.ce - pts[i10].ce, pe: last.pe - pts[i10].pe };
  const d60 = { ce: last.ce - pts[i60].ce, pe: last.pe - pts[i60].pe };

  // Classify on the 1-minute window. OI direction alone is ambiguous: put OI
  // building is BULLISH if puts were written (premium fell) and BEARISH if
  // they were bought (premium rose). The premium move is the tiebreaker.
  const NOISE = props.noise ?? FLOW_NOISE;
  const lastPremCe = last.cePrem ?? null;
  const lastPremPe = last.pePrem ?? null;
  const basePremCe = pts[i60].cePrem ?? null;
  const basePremPe = pts[i60].pePrem ?? null;
  const dPremCe =
    lastPremCe != null && basePremCe != null ? lastPremCe - basePremCe : null;
  const dPremPe =
    lastPremPe != null && basePremPe != null ? lastPremPe - basePremPe : null;

  const read = readFlow(d60, dPremCe, dPremPe, NOISE);
  const tone = read ? (read.bias === "bull" ? palette.POSITIVE : palette.NEGATIVE) : palette.TEXT_MUTED;
  const burst = Math.abs(d10.ce) >= 1e6 || Math.abs(d10.pe) >= 1e6;

  // Bias per snapshot over the same 1-minute window: a word flips every few
  // seconds, a ribbon shows whether the read is persistent or just noise.
  const ribbonStart = Math.max(0, pts.length - RIBBON_BARS);
  const ribbon: (FlowRead | null)[] = [];
  for (let i = ribbonStart; i < pts.length; i++) ribbon.push(rollingRead(pts, i, NOISE));
  const bullCount = ribbon.filter((r) => r?.bias === "bull").length;
  const bearCount = ribbon.filter((r) => r?.bias === "bear").length;
  const flatCount = ribbon.length - bullCount - bearCount;

  return (
    <div
      data-testid="nifty-10s-strip"
      data-state={read ? read.bias : "balanced"}
      class="flex items-center w-full min-w-0 shrink-0 overflow-hidden whitespace-nowrap"
      style={{
        gap: "8px",
        height: "20px",
        "min-height": "20px",
        "padding-left": "8px",
        "padding-right": "8px",
        border: `1px solid ${palette.TERM_BORDER}`,
        "border-radius": "4px",
        "background-color": palette.TERM_HEADER,
        "font-family": palette.MONO,
        "font-size": "9px",
      }}
    >
      <span style={{ color: palette.TEXT_MUTED, "font-weight": 700, "letter-spacing": "0.08em", "flex-shrink": 0 }}>
        OI 1m
      </span>
      <span
        data-testid="nifty-10s-ce"
        style={{ color: d60.ce < 0 ? palette.POSITIVE : palette.NEGATIVE, "font-weight": 800, "flex-shrink": 0 }}
      >
        CE {fmtDelta(d60.ce)}
      </span>
      <span
        data-testid="nifty-10s-pe"
        style={{ color: d60.pe > 0 ? palette.POSITIVE : palette.NEGATIVE, "font-weight": 800, "flex-shrink": 0 }}
      >
        PE {fmtDelta(d60.pe)}
      </span>
      <span
        data-testid="nifty-10s-state"
        style={{ color: tone, "font-weight": 800, "letter-spacing": "0.04em", "flex-shrink": 0 }}
        title="Premium vs the delta-implied move (ATM delta 0.5). IV expansion can read as buying."
      >
        {read ? (read.bias === "bull" ? "↑ BULLISH" : "↓ BEARISH") : "FLAT"}
      </span>
      <Show when={read}>
        <span
          data-testid="nifty-10s-reason"
          style={{ color: palette.TEXT_MUTED, "font-weight": 600, "flex-shrink": 0 }}
        >
          {read?.reason}
        </span>
      </Show>
      <Show when={burst}>
        <span
          data-testid="nifty-10s-burst"
          style={{ color: palette.WARNING, "font-weight": 800, "letter-spacing": "0.06em", "flex-shrink": 0 }}
          title={`last 10 s: CE ${fmtDelta(d10.ce)} · PE ${fmtDelta(d10.pe)}`}
        >
          ⚡ BURST
        </span>
      </Show>
      <span
        data-testid="nifty-10s-counts"
        style={{ color: palette.TEXT_MUTED, "font-weight": 700, "flex-shrink": 0, display: "inline-flex", gap: "4px" }}
        title={`${ribbon.length} snapshots · ${bullCount} bullish · ${bearCount} bearish · ${flatCount} flat · last 10 s CE ${fmtDelta(d10.ce)} / PE ${fmtDelta(d10.pe)}`}
      >
        <span style={{ color: palette.POSITIVE }}>{bullCount}↑</span>
        <span style={{ color: palette.NEGATIVE }}>{bearCount}↓</span>
      </span>
      <svg
        data-testid="nifty-10s-ribbon"
        width={ribbon.length * (BLOCK_W + BLOCK_GAP)}
        height={12}
        viewBox={`0 0 ${ribbon.length * (BLOCK_W + BLOCK_GAP)} 12`}
        style={{ display: "block", "flex-shrink": 0 }}
        aria-hidden
      >
        <For each={ribbon}>{(r, i) => (
          <rect
            x={i() * (BLOCK_W + BLOCK_GAP)}
            y={0}
            width={BLOCK_W}
            height={12}
            rx={0.5}
            fill={r ? (r.bias === "bull" ? palette.POSITIVE : palette.NEGATIVE) : palette.TEXT_MUTED}
            opacity={r ? 0.9 : 0.22}
          />
        )}</For>
      </svg>
      <span
        style={{ color: palette.TEXT_MUTED, "flex-shrink": 0 }}
        title={`${pts.length} snapshots · ${pts[0].t.slice(11, 19)} → ${last.t.slice(11, 19)}`}
      >
        {last.t.slice(11, 19)}
      </span>
    </div>
      )}}
    </Show>
  );
}
