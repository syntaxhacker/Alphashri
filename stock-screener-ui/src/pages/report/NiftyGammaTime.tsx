import { useMemo } from "react";
import Box from "@mui/material/Box";
import { MiniLineChart, type MiniSeries } from "@/components/common/charts/MiniLineChart";
import { CompactPanel, CompactStat } from "@/components/common/compact";
import { EmptyState } from "@/components/common/states";
import * as palette from "@/ui/palette";
import type { NiftyGex, NiftyTape, NiftyTapeRow } from "@/types/niftyReport";

/**
 * "Cumulative net gamma" panel — the intraday trajectory of dealer net gamma
 * (the tape's per-minute `net_gex`), with the session's headline levels
 * (gamma now / flip / call wall / put wall) pulled from the tape or the GEX
 * snapshot as a fallback.
 *
 * Every number is optional in real payloads: older tapes omit `net_gex`,
 * partial GEX blocks omit walls, and a live session may have neither. The
 * helpers below are pure so the series + stat math can be unit-tested, and
 * the panel degrades to dashes / an empty state rather than throwing.
 */

/** Rendered for any absent field so a stat never shows a blank cell. */
export const GAMMA_DASH = "—";

/** One plotted point: a tape timestamp and its (finite) net gamma. */
export interface GammaPoint {
  t: string;
  netGex: number;
}

/** The four headline stats. Each is `null` when no source carries it. */
export interface GammaStats {
  now: number | null;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
}

/**
 * Finite number or `null` — collapses `null`, `undefined`, `NaN`, `""` and
 * junk. `Number(null) === 0` and `Number("") === 0`, so both are guarded
 * explicitly before coercion.
 */
function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * `HH:MM` label for a tape timestamp. Handles IST ISO
 * (`2026-10-14T13:06:00+05:30`), bare clock (`13:06`) and epoch strings;
 * anything unparseable falls back to the raw text (never blank).
 */
export function gammaClock(t: string): string {
  const raw = String(t ?? "").trim();
  if (!raw) return GAMMA_DASH;
  const clock = /(\d{2}:\d{2})/.exec(raw);
  if (clock) return clock[1];
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleTimeString("en-IN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });
  }
  return raw;
}

/** Signed crore gamma: `+5.50 Cr` / `-2.50 Cr`; dash for anything non-finite. */
export function formatGammaCr(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return GAMMA_DASH;
  const sign = v < 0 ? "-" : "+";
  return `${sign}${Math.abs(v).toFixed(2)} Cr`;
}

/** Strike / price with Indian grouping: `25,680`. */
export function formatGammaLevel(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return GAMMA_DASH;
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Area colour follows the sign of the current value. */
export function gammaSignColor(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) && v < 0
    ? palette.TERM_GAMMA_NEG
    : palette.TERM_GAMMA;
}

/**
 * Plot data: keep only rows whose `net_gex` is a finite number, in tape
 * order (oldest → newest). Rows with `null`/`undefined`/`NaN` are dropped so
 * the line never carries gaps the axis would misalign.
 */
export function buildGammaSeries(rows: NiftyTapeRow[]): GammaPoint[] {
  const list = Array.isArray(rows) ? rows : [];
  const out: GammaPoint[] = [];
  for (const r of list) {
    const v = r?.net_gex;
    if (v === null || v === undefined || !Number.isFinite(Number(v))) continue;
    out.push({ t: String(r?.t ?? ""), netGex: Number(v) });
  }
  return out;
}

/**
 * Headline stats with explicit fallbacks:
 * - `now`    → last tape row's `net_gex`, else `gex.netTotal`
 * - `flip`   → `gex.zeroCross`, else last tape row's `flip`
 * - `callWall` → `gex.topPositive[0].strike`, else last tape row's `walls.call`
 * - `putWall`  → `gex.topNegative[0].strike`, else last tape row's `walls.put`
 *
 * `spot` completes the panel's data contract (siblings all take it) and is
 * reserved for spot-relative annotations — it does not resolve any stat.
 */
export function gammaStats(
  rows: NiftyTapeRow[],
  gex?: NiftyGex,
  spot?: number,
): GammaStats {
  void spot;
  const list = Array.isArray(rows) ? rows : [];
  const last = list.length > 0 ? list[list.length - 1] : undefined;

  const now = finiteOrNull(last?.net_gex) ?? finiteOrNull(gex?.netTotal);
  const flip = finiteOrNull(gex?.zeroCross) ?? finiteOrNull(last?.flip);
  const callWall =
    finiteOrNull(gex?.topPositive?.[0]?.strike) ?? finiteOrNull(last?.walls?.call);
  const putWall =
    finiteOrNull(gex?.topNegative?.[0]?.strike) ?? finiteOrNull(last?.walls?.put);

  return { now, flip, callWall, putWall };
}

/**
 * MiniLineChart-ready props: a net-gamma line over tape time with a dashed
 * zero reference line (the gamma-flip boundary).
 */
export function buildGammaChart(series: GammaPoint[]): {
  labels: string[];
  series: MiniSeries[];
  zeroLine: boolean;
} {
  const points = Array.isArray(series) ? series : [];
  return {
    labels: points.map((p) => gammaClock(p.t)),
    series: [
      {
        name: "Net γ",
        points: points.map((p) => p.netGex),
        color: palette.TERM_GAMMA,
        area: true,
        axis: 0,
      },
    ],
    zeroLine: true,
  };
}

export interface NiftyGammaTimeProps {
  tape?: NiftyTape | null;
  gex?: NiftyGex;
  spot: number;
}

/**
 * Self-contained cumulative-net-gamma panel. Stats and chart are derived
 * purely from the tape (+ GEX fallback); absent data renders dashes and an
 * empty chart state, never an exception.
 */
export function NiftyGammaTime({ tape, gex, spot }: NiftyGammaTimeProps) {
  const rows = useMemo(() => (Array.isArray(tape?.rows) ? tape.rows : []), [tape]);
  const series = useMemo(() => buildGammaSeries(rows), [rows]);
  const stats = useMemo(() => gammaStats(rows, gex, spot), [rows, gex, spot]);
  const chart = useMemo(() => buildGammaChart(series), [series]);

  return (
    <CompactPanel
      title="Cumulative net gamma"
      testId="nifty-gamma-time-panel"
      sx={{
        background: palette.TERM_BG,
        border: `1px solid ${palette.TERM_BORDER}`,
        borderColor: palette.TERM_BORDER,
        borderRadius: 1,
      }}
    >
      {/* Tight column + tight stat row: plain grids instead of
          CompactStatGrid (whose wrapper padding costs ~12px). All four
          stats, labels and values are unchanged — only the chrome shrinks.
          No overflow/min-height here: this panel stretches inside its flex
          row, and overflow would drop min-height:auto and collapse it. */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 0.5,
            width: "100%",
            minWidth: 0,
          }}
        >
          <CompactStat
            data-testid="nifty-gamma-now"
            label="Net gamma now"
            valueSize="md"
            value={formatGammaCr(stats.now)}
            tone={
              stats.now === null
                ? "text.primary"
                : stats.now < 0
                  ? palette.TERM_GAMMA_NEG
                  : palette.TERM_GAMMA
            }
          />
          <CompactStat
            data-testid="nifty-gamma-flip"
            label="Flip"
            valueSize="md"
            value={formatGammaLevel(stats.flip)}
            tone={palette.TERM_FLIP}
          />
          <CompactStat
            data-testid="nifty-gamma-callwall"
            label="Call wall"
            valueSize="md"
            value={formatGammaLevel(stats.callWall)}
          />
          <CompactStat
            data-testid="nifty-gamma-putwall"
            label="Put wall"
            valueSize="md"
            value={formatGammaLevel(stats.putWall)}
          />
        </Box>

        {series.length === 0 ? (
          <EmptyState
            data-testid="nifty-gamma-time-empty"
            title="No gamma tape yet"
            description="Net gamma is recorded per minute once the option tape builds."
          />
        ) : (
          // Explicit px height (never vh — vh balloons on tall monitors).
          // 80px still resolves the single net-gamma line + zero line; the
          // line spans the full inner box edge to edge.
          <MiniLineChart
            series={chart.series}
            labels={chart.labels}
            zeroLine={chart.zeroLine}
            height={80}
            testId="nifty-gamma-time-chart"
            formatValue={formatGammaCr}
            emptyMessage="No gamma tape yet"
          />
        )}
      </Box>
    </CompactPanel>
  );
}
