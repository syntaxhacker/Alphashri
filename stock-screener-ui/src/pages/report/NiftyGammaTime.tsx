import { memo, useMemo } from "react";
import Box from "@mui/material/Box";
import { MiniLineChart, type MiniSeries } from "@/components/common/charts/MiniLineChart";
import { CompactPanel, CompactStat } from "@/components/common/compact";
import { EmptyState } from "@/components/common/states";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { gexFlipAtSpot } from "./niftyGex";
import type { NiftyGex, NiftyTape, NiftyTapeRow, NiftyWall } from "@/types/niftyReport";

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
 *
 * REPLAY: the panel is fed the FRAME-FILTERED tape rows, so the plotted
 * series stops at the playhead instead of running ahead into minutes the
 * desk has not reached yet. The headline numbers come from the same frame.
 */

/** Rendered for any absent field so a stat never shows a blank cell. */
const GAMMA_DASH = "—";

/**
 * Rendered when the gamma block carries NO option greeks (the backend fell
 * back to open interest as an exposure proxy). Its totals are contract
 * counts, not ₹ Cr/point — a number like "+17,435,535 Cr" is a unit error,
 * so the panel says "n/a" instead of printing it.
 */
const GAMMA_NA = "n/a";

/** One plotted point: a tape timestamp and its (finite) net gamma. */
interface GammaPoint {
  t: string;
  netGex: number;
}

/** The four headline stats. Each is `null` when no source carries it. */
interface GammaStats {
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
function gammaClock(t: string): string {
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
function formatGammaLevel(v: number | null | undefined): string {
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

/** Top wall strike from the chain's own wall list (`walls.calls[0]`). */
function wallStrike(walls?: NiftyWall[] | null): number | null {
  const first = Array.isArray(walls) ? walls[0] : undefined;
  return finiteOrNull(first?.strike);
}

/**
 * Headline stats with explicit fallbacks:
 * - `now`    → the FRAME's `gex.netTotal`, else the last tape row's `net_gex`
 * - `flip`   → the spot-aware GEX flip (`gexFlipAtSpot`), else the last tape
 *              row's `flip`
 * - `callWall` → the chain's own `walls.calls[0]`, else the last tape row's wall
 * - `putWall`  → the chain's own `walls.puts[0]`, else the last tape row's wall
 *
 * The GEX **extrema** (`topPositive` / `topNegative`) are deliberately NOT
 * used for the walls: those are the largest gamma strikes, not the OI walls
 * the chain actually quotes, so they pointed at a different strike.
 *
 * `degraded` marks a gamma block built without option greeks (an OI proxy).
 * Its numbers are contract counts, not ₹ Cr/point, so `now`/`flip` are
 * reported as absent and the panel renders "n/a" — never the raw figure.
 */
export function gammaStats(
  rows: NiftyTapeRow[],
  gex?: NiftyGex,
  spot?: number,
  walls?: { calls?: NiftyWall[]; puts?: NiftyWall[] } | null,
  degraded = false,
): GammaStats {
  const list = Array.isArray(rows) ? rows : [];
  const last = list.length > 0 ? list[list.length - 1] : undefined;

  const callWall = wallStrike(walls?.calls) ?? finiteOrNull(last?.walls?.call);
  const putWall = wallStrike(walls?.puts) ?? finiteOrNull(last?.walls?.put);

  if (degraded) {
    // OI proxy: the gamma numbers are not gamma at all. The OI walls stay —
    // they are chain truth, not a proxy.
    return { now: null, flip: null, callWall, putWall };
  }

  // The frame's own book total wins over the tape's last row: the tape row is
  // the previous minute, the frame is what is on screen.
  const now = finiteOrNull(gex?.netTotal) ?? finiteOrNull(last?.net_gex);
  const flip =
    gexFlipAtSpot(gex, Number(spot)) ?? finiteOrNull(last?.flip);

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

/** Plain-language reading of the net-gamma sign — what dealers do next. */
interface GammaRegime {
  label: string;
  tone: string;
  detail: string;
}

export function gammaRegime(now: number | null | undefined): GammaRegime | null {
  const v = finiteOrNull(now);
  if (v === null) return null;
  if (v > 0) {
    return {
      label: "LONG γ",
      tone: palette.TERM_GAMMA,
      detail:
        "Dealers are long gamma — they sell rallies and buy dips, so spot gets pinned. Fades work; breakouts stall.",
    };
  }
  if (v < 0) {
    return {
      label: "SHORT γ",
      tone: palette.TERM_GAMMA_NEG,
      detail:
        "Dealers are short gamma — they chase the move, so dips and rips accelerate. Trends extend; fades get run over.",
    };
  }
  return {
    label: "FLAT γ",
    tone: palette.TERM_FLIP,
    detail: "Net gamma is near zero — no strong pin or squeeze bias right now.",
  };
}

/** `"733 pts above flip"` — how far spot sits from the gamma flip level. */
export function spotVsFlip(
  spot: number | null | undefined,
  flip: number | null | undefined,
): string | null {
  const s = finiteOrNull(spot);
  const f = finiteOrNull(flip);
  if (s === null || f === null) return null;
  const d = s - f;
  if (d === 0) return "at flip";
  const side = d > 0 ? "above" : "below";
  return `${Math.abs(Math.round(d)).toLocaleString("en-IN")} pts ${side} flip`;
}

interface NiftyGammaTimeProps {
  /**
   * The tape rows to plot — in EOD replay the caller passes the rows up to
   * the playhead, so the series is clipped to the frame on screen.
   */
  rows?: NiftyTapeRow[];
  /** Whole-tape source — used only when `rows` is absent. */
  tape?: NiftyTape | null;
  gex?: NiftyGex;
  spot: number;
  /**
   * The chain's own OI walls. The panel reads `calls[0]` / `puts[0]` — the
   * GEX extrema are a different thing (largest gamma strikes) and used to be
   * shown here as if they were the walls.
   */
  walls?: { calls?: NiftyWall[]; puts?: NiftyWall[] } | null;
  /**
   * The gamma block is an OI proxy (no option greeks in this frame). Its
   * totals are contract counts, not ₹ Cr/point → render "n/a", never a number.
   */
  degraded?: boolean;
}

/**
 * Self-contained cumulative-net-gamma panel. Stats and chart are derived
 * purely from the rows (+ GEX fallback); absent data renders dashes and an
 * empty chart state, never an exception.
 */
function NiftyGammaTimeInner({
  rows: rowsProp,
  tape,
  gex,
  spot,
  walls,
  degraded = false,
}: NiftyGammaTimeProps) {
  const rows = useMemo(
    () =>
      Array.isArray(rowsProp)
        ? rowsProp
        : Array.isArray(tape?.rows)
          ? tape.rows
          : [],
    [rowsProp, tape],
  );
  const series = useMemo(() => buildGammaSeries(rows), [rows]);
  const stats = useMemo(
    () => gammaStats(rows, gex, spot, walls, degraded),
    [rows, gex, spot, walls, degraded],
  );
  const chart = useMemo(() => buildGammaChart(series), [series]);
  const regime = useMemo(() => gammaRegime(stats.now), [stats.now]);
  const flipDistance = useMemo(() => spotVsFlip(spot, stats.flip), [spot, stats.flip]);

  return (
    <CompactPanel
      title="Dealer gamma — net per minute"
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
            value={degraded ? GAMMA_NA : formatGammaCr(stats.now)}
            tone={
              degraded
                ? "text.primary"
                : stats.now === null
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
            value={degraded ? GAMMA_NA : formatGammaLevel(stats.flip)}
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

        {/* What the sign actually means for the next move — the panel's whole
            point. Without this the four numbers read as trivia. */}
        {regime && (
          <Box
            data-testid="nifty-gamma-regime"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              flexWrap: "wrap",
              minWidth: 0,
            }}
          >
            <Text
              size="xs"
              span
              fw={700}
              sx={{
                color: regime.tone,
                border: `1px solid ${regime.tone}`,
                borderRadius: 0.75,
                px: 0.5,
                py: 0.1,
                whiteSpace: "nowrap",
              }}
            >
              {regime.label}
            </Text>
            <Text size="xs" span sx={{ color: "text.secondary", minWidth: 0 }}>
              {regime.detail}
            </Text>
            {flipDistance && (
              <Text
                data-testid="nifty-gamma-spot-flip"
                size="xs"
                span
                c="dimmed"
                sx={{ whiteSpace: "nowrap" }}
              >
                Spot {formatGammaLevel(spot)} · {flipDistance}
              </Text>
            )}
          </Box>
        )}

        {series.length === 0 ? (
          <EmptyState
            data-testid="nifty-gamma-time-empty"
            title={degraded ? "No gamma in this frame" : "No gamma tape yet"}
            description={
              degraded
                ? "This frame carries no option greeks — the gamma block is an open-interest proxy, so no ₹ Cr/point figure can be shown."
                : "Net gamma is recorded per minute once the option tape builds."
            }
          />
        ) : (
          // Explicit px height (never vh — vh balloons on tall monitors).
          // 80px still resolves the single net-gamma line + zero line; the
          // line spans the full inner box edge to edge.
          <MiniLineChart
            series={chart.series}
            labels={chart.labels}
            zeroLine={chart.zeroLine}
            height={120}
            testId="nifty-gamma-time-chart"
            formatValue={formatGammaCr}
            emptyMessage="No gamma tape yet"
          />
        )}
        {series.length > 0 && (
          <Text data-testid="nifty-gamma-caption" size="xs" span c="dimmed">
            {degraded
              ? "Open-interest proxy (no option greeks in this frame) — the scale is contracts, not ₹ Cr/point."
              : "Net dealer gamma each minute (₹ Cr) · the 0 line is the gamma flip — above it dealers dampen moves (pinning), below it they amplify them (squeeze)."}
          </Text>
        )}
      </Box>
    </CompactPanel>
  );
}

/** Memoised leaf panel — `tape`/`gex` keep identity between unrelated parent renders. */
export const NiftyGammaTime = memo(NiftyGammaTimeInner);
NiftyGammaTime.displayName = "NiftyGammaTime";
