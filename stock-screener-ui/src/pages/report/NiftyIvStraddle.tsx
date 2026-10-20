import { memo, useMemo } from "react";
import * as palette from "@/ui/palette";
import { MiniLineChart, type MiniSeries } from "@/components/common/charts/MiniLineChart";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";
import { EmptyState } from "@/components/common/states";
import type { NiftyReference, NiftyRegimeBlock, NiftyTape, NiftyTapeRow } from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";

/** Rendered for any absent/null field so a stat never shows a blank/NaN. */
export const IV_DASH = "—";

/**
 * Tolerant numeric coercion: `null`/`undefined`/empty-string are absent (not
 * zero), so a dead ATM leg is skipped instead of counted as premium 0.
 */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Exact average of the present values (callers guarantee at least one). */
function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface StraddlePoint {
  t: string;
  straddle: number;
}

export interface IvPoint {
  t: string;
  iv: number;
}

/**
 * Rolling ATM straddle premium per tape row — `atm_ce_ltp + atm_pe_ltp`.
 * A row is skipped when either leg is null/non-positive (expiry-day tape can
 * carry a single dead leg), mirroring the backend `straddle_from_tape`.
 */
export function buildStraddleSeries(rows: NiftyTapeRow[]): StraddlePoint[] {
  const out: StraddlePoint[] = [];
  for (const r of rows ?? []) {
    const ce = numOrNull(r?.atm_ce_ltp);
    const pe = numOrNull(r?.atm_pe_ltp);
    if (ce !== null && pe !== null && ce > 0 && pe > 0) {
      out.push({ t: String(r.t), straddle: ce + pe });
    }
  }
  return out;
}

/**
 * Rolling ATM IV % per tape row — the average of the two ATM leg IVs. Rows
 * where both legs are missing are skipped; when only one leg carries an IV,
 * that leg's value is used.
 */
export function buildIvSeries(rows: NiftyTapeRow[]): IvPoint[] {
  const out: IvPoint[] = [];
  for (const r of rows ?? []) {
    const ce = numOrNull(r?.atm_ce_iv);
    const pe = numOrNull(r?.atm_pe_iv);
    if (ce === null && pe === null) continue;
    const vals: number[] = [];
    if (ce !== null) vals.push(ce);
    if (pe !== null) vals.push(pe);
    out.push({ t: String(r.t), iv: mean(vals) });
  }
  return out;
}

/** Last row's non-null average ATM IV, or `null` when the tape had none. */
export function lastAtmIv(rows: NiftyTapeRow[]): number | null {
  const series = buildIvSeries(rows);
  return series.length ? series[series.length - 1].iv : null;
}

/** Last row's usable straddle premium (`ce + pe`), or `null`. */
export function lastStraddle(rows: NiftyTapeRow[]): number | null {
  const series = buildStraddleSeries(rows);
  return series.length ? series[series.length - 1].straddle : null;
}

/** ISO timestamp or bare `HH:MM[:SS]` → `HH:MM`; falls back to the raw string. */
export function formatIvTime(t: string | null | undefined): string {
  const raw = String(t ?? "").trim();
  if (!raw) return IV_DASH;
  if (raw.includes("T")) {
    const after = raw.split("T")[1] ?? "";
    if (after.length >= 5) return after.slice(0, 5);
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  return raw;
}

/**
 * Parse a candle timestamp to epoch ms. Accepts ISO datetimes (with or
 * without a timezone offset, `Z` included) and bare `HH:MM[:SS]` clock
 * strings; anything else returns `null`.
 */
function parseCandleMs(t: string | null | undefined): number | null {
  const raw = String(t ?? "").trim();
  if (!raw) return null;
  const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (timeOnly) {
    const h = Number(timeOnly[1]);
    const mi = Number(timeOnly[2]);
    const s = Number(timeOnly[3] ?? 0);
    return ((h * 60 + mi) * 60 + s) * 1000;
  }
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  const embedded = /(\d{1,2}):(\d{2})/.exec(raw);
  if (embedded) {
    const h = Number(embedded[1]);
    const mi = Number(embedded[2]);
    return ((h * 60 + mi) * 60) * 1000;
  }
  return null;
}

/**
 * Median spacing (minutes) of candle timestamps, for RV annualisation.
 * Mirrors the backend `_infer_bar_minutes`: needs at least three usable
 * timestamps, otherwise the caller's default (1 minute) is returned.
 */
export function inferBarMinutes(candles?: ReplayCandle[], defaultMin = 1): number {
  const times: number[] = [];
  for (const c of candles ?? []) {
    const ms = parseCandleMs(c?.time);
    if (ms !== null) times.push(ms);
  }
  if (times.length < 3) return defaultMin;
  times.sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = (times[i] - times[i - 1]) / 60_000;
    if (d > 0) deltas.push(d);
  }
  if (!deltas.length) return defaultMin;
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median =
    deltas.length % 2 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2;
  return Math.max(1, median);
}

/**
 * Annualised realised vol % from log returns of the candle closes, mirroring
 * the backend `realized_vol_pct`: variance uses an (n-1) denominator, then
 * scales by `sqrt(252 × 375 / bar_minutes)` and ×100. Returns `null` when
 * fewer than three closes are available; a zero-variance series returns 0.
 */
export function realizedVolPct(candles?: ReplayCandle[]): number | null {
  const closes: number[] = [];
  for (const c of candles ?? []) {
    const v = numOrNull(c?.close);
    if (v !== null && v > 0) closes.push(v);
  }
  if (closes.length < 3) return null;

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (!rets.length) return null;

  const avg = mean(rets);
  const variance =
    rets.reduce((acc, r) => acc + (r - avg) ** 2, 0) / (rets.length - 1);
  if (variance <= 0) return 0;

  const barMin = inferBarMinutes(candles);
  const periodsPerYear = 252 * (375 / barMin);
  const vol = Math.sqrt(variance) * Math.sqrt(periodsPerYear) * 100;
  return Math.round(vol * 100) / 100;
}

/** Stable MiniLineChart value formatter — hoisted so the chart never gets a new fn. */
function formatIvChartValue(v: number): string {
  return v.toFixed(2);
}

/** Prefer the regime's IV, else the last usable tape IV. */
export function atmIvNow(
  regime: NiftyRegimeBlock | undefined,
  rows: NiftyTapeRow[],
): number | null {
  if (regime?.iv !== null && regime?.iv !== undefined && Number.isFinite(regime.iv)) {
    return regime.iv;
  }
  return lastAtmIv(rows);
}

/** Prefer the regime's straddle, else the last usable tape straddle. */
export function straddleNow(
  regime: NiftyRegimeBlock | undefined,
  rows: NiftyTapeRow[],
): number | null {
  const r = regime?.straddle_now;
  if (r !== null && r !== undefined && Number.isFinite(r)) return r;
  return lastStraddle(rows);
}

/**
 * Intraday straddle premium change %. Prefers the backend's regime value,
 * then derives it from the regime's open/now, then from the tape series.
 */
export function straddleChangePct(
  regime: NiftyRegimeBlock | undefined,
  series: StraddlePoint[],
): number | null {
  const pct = regime?.straddle_pct;
  if (pct !== null && pct !== undefined && Number.isFinite(pct)) return pct;

  const open = regime?.straddle_open;
  const now = regime?.straddle_now;
  if (
    open !== null &&
    open !== undefined &&
    Number.isFinite(open) &&
    open > 0 &&
    now !== null &&
    now !== undefined &&
    Number.isFinite(now)
  ) {
    return Math.round((now / open - 1) * 100 * 100) / 100;
  }

  if (series.length >= 2) {
    const first = series[0].straddle;
    const last = series[series.length - 1].straddle;
    if (first > 0) return Math.round((last / first - 1) * 100 * 100) / 100;
  }
  return null;
}

/** Prefer the regime's realised vol, else compute it from the candles. */
export function rvNow(
  regime: NiftyRegimeBlock | undefined,
  candles?: ReplayCandle[],
): number | null {
  const rv = regime?.rv;
  if (rv !== null && rv !== undefined && Number.isFinite(rv)) return rv;
  return realizedVolPct(candles);
}

/** Percent to 2 dp with a `%` suffix, or a dash when absent. */
export function fmtIvPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return IV_DASH;
  return `${v.toFixed(2)}%`;
}

/** Price/premium to 2 dp with Indian grouping, or a dash when absent. */
export function fmtIvValue(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return IV_DASH;
  return v.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Signed percent (always shows +/-) to 2 dp, or a dash when absent. */
export function fmtIvSignedPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return IV_DASH;
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

/** Signed points (always shows +/-) to 1 dp, or a dash when absent. */
export function fmtIvSigned(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return IV_DASH;
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(1)}`;
}

/** Up = premium expanding (positive), down = bleeding (negative). */
export function straddlePctTone(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) {
    return palette.TEXT_MUTED;
  }
  return v > 0 ? palette.POSITIVE : palette.NEGATIVE;
}

/** Union of both series' timestamps, de-duped and sorted chronologically. */
function mergeTimes(straddle: StraddlePoint[], iv: IvPoint[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...straddle, ...iv]) {
    if (!seen.has(p.t)) {
      seen.add(p.t);
      out.push(p.t);
    }
  }
  out.sort((a, b) => {
    const ka = formatIvTime(a);
    const kb = formatIvTime(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return out;
}

/**
 * MiniLineChart-ready props: rolling ATM straddle premium (left axis) and ATM
 * IV % (right axis). Each series is aligned to the shared, chronologically
 * sorted time union with `null` where a series has no sample.
 */
export function buildIvStraddleChart(
  straddle: StraddlePoint[],
  iv: IvPoint[],
): { labels: string[]; series: MiniSeries[] } {
  const times = mergeTimes(straddle, iv);
  const straddleByT = new Map(straddle.map((p) => [p.t, p.straddle]));
  const ivByT = new Map(iv.map((p) => [p.t, p.iv]));

  return {
    labels: times.map((t) => formatIvTime(t)),
    series: [
      {
        name: "Straddle",
        points: times.map((t) => (straddleByT.has(t) ? (straddleByT.get(t) as number) : null)),
        color: palette.TERM_SPOT,
        axis: 0,
      },
      {
        name: "ATM IV",
        points: times.map((t) => (ivByT.has(t) ? (ivByT.get(t) as number) : null)),
        color: palette.TERM_GAMMA,
        axis: 1,
      },
    ],
  };
}

export interface NiftyIvStraddleProps {
  /** Per-minute option tape; absent/empty renders the empty state. */
  tape?: NiftyTape | null;
  /** Spot candles used for the realised-vol fallback. */
  candles?: ReplayCandle[];
  /** Backend regime block — authoritative source for IV / straddle / RV. */
  regime?: NiftyRegimeBlock;
  /**
   * Fixed-strike ATM reference. The rolling ATM leg reads ~flat by design, so
   * this pins the day's first ATM strike to show the premium's real move.
   */
  reference?: NiftyReference | null;
}

/**
 * "IV · ATM IV, straddle & RV" panel. A stat row summarises the latest ATM IV,
 * straddle premium + intraday change, and realised vol; a twin-axis chart
 * tracks the rolling straddle premium against ATM IV. Absent/empty tape
 * degrades to a friendly empty state without crashing.
 */
function NiftyIvStraddleInner({ tape, candles, regime, reference }: NiftyIvStraddleProps) {
  const rows = useMemo(
    () => (Array.isArray(tape?.rows) ? tape!.rows : []),
    [tape],
  );

  const straddleSeries = useMemo(() => buildStraddleSeries(rows), [rows]);
  const ivSeries = useMemo(() => buildIvSeries(rows), [rows]);
  const chart = useMemo(
    () => buildIvStraddleChart(straddleSeries, ivSeries),
    [straddleSeries, ivSeries],
  );

  // Derived stats memoised on their true inputs: the helpers re-walk the
  // tape/candles on every call, so invoking them per render re-ran full
  // series builds + sorts on each parent render.
  const atmIv = useMemo(() => atmIvNow(regime, rows), [regime, rows]);
  const straddleVal = useMemo(() => straddleNow(regime, rows), [regime, rows]);
  const straddlePct = useMemo(
    () => straddleChangePct(regime, straddleSeries),
    [regime, straddleSeries],
  );
  const rv = useMemo(() => rvNow(regime, candles), [regime, candles]);

  const hasTape = straddleSeries.length > 0 || ivSeries.length > 0;
  return (
    <CompactPanel
      title="IV · ATM IV, straddle & RV"
      testId="nifty-iv-straddle-panel"
      sx={{
        background: palette.TERM_BG,
        border: `1px solid ${palette.TERM_BORDER}`,
        borderColor: palette.TERM_BORDER,
        borderRadius: 1,
      }}
    >
      <CompactStatGrid>
        <CompactStat
          data-testid="nifty-iv-atm"
          label="ATM IV"
          valueSize="md"
          value={fmtIvPct(atmIv)}
        />
        <CompactStat
          data-testid="nifty-iv-straddle"
          label="Straddle"
          valueSize="md"
          value={fmtIvValue(straddleVal)}
        />
        <CompactStat
          data-testid="nifty-iv-straddle-pct"
          label="Straddle Δ"
          tone={straddlePctTone(straddlePct)}
          valueSize="md"
          value={fmtIvSignedPct(straddlePct)}
        />
        <CompactStat
          data-testid="nifty-iv-rv"
          label="Realised vol"
          valueSize="md"
          value={fmtIvPct(rv)}
        />
        <CompactStat
          data-testid="nifty-iv-ref-pe"
          label={reference?.strike ? `PE ${Math.round(reference.strike)} Δ` : "PE Δ"}
          hint="fixed strike"
          tone={
            reference?.pe_change == null
              ? undefined
              : reference.pe_change > 0
                ? palette.POSITIVE
                : reference.pe_change < 0
                  ? palette.NEGATIVE
                  : undefined
          }
          valueSize="md"
          value={fmtIvSigned(reference?.pe_change)}
        />
      </CompactStatGrid>

      {hasTape ? (
        // Explicit px height (never vh — vh balloons on tall monitors).
        // 100px still resolves the two-series straddle/IV tape; both lines
        // span the full inner box edge to edge.
        <MiniLineChart
          series={chart.series}
          labels={chart.labels}
          height={100}
          testId="nifty-iv-straddle-chart"
          formatValue={formatIvChartValue}
          emptyMessage="No intraday IV tape"
        />
      ) : (
        <EmptyState
          data-testid="nifty-iv-straddle-empty"
          title="No intraday IV tape"
          description="ATM IV and the straddle appear once the option tape has rows."
        />
      )}
    </CompactPanel>
  );
}

/** Memoised leaf panel — tape/regime/candle props keep identity between unrelated parent renders. */
export const NiftyIvStraddle = memo(NiftyIvStraddleInner);
NiftyIvStraddle.displayName = "NiftyIvStraddle";
