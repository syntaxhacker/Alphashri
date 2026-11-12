import { formatNumberIN } from "@/utils/ui-helpers";
import { createMemo, For, Show } from "solid-js";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { LocalCompactPanel, LocalCompactStat } from "./reportBits";
import { MiniLineChart } from "@/components/common/charts/MiniLineChart";
import type {
  MiniMarker,
  MiniSeries,
} from "@/components/common/charts/MiniLineChart";
import type { NiftyStrike } from "@/types/niftyReport";

/**
 * "Price × IV" panel for the Nifty report — the per-strike volatility smile.
 *
 * Why it exists: the delta ladder answers who is positioned where, and the
 * gamma profile answers where hedging will bite. The smile answers what the
 * market is *charging* for that risk: when puts trade above calls (put skew),
 * downside protection is bid and premium selling is paid; when the wings are
 * flat, the surface is not pricing a directional event.
 *
 * The backend already ships `iv` on every leg (`build_leg`), but Upstox quotes
 * greeks for a subset of strikes — mostly near the money — and the rest arrive
 * as `0.0`. Those are dropped (never plotted as a genuine 0% IV), and the
 * chart breaks its line across the gaps instead of inventing a value.
 *
 * Rendered with the dependency-free inline-SVG `MiniLineChart`, same as the
 * GEX profile: these are static monitoring visuals, not interactive charts.
 */

/** IV window (±500) — narrower than the chain/delta ±750 ladder so the wings
 *  stay readable inside the 3fr cell of the vol-surface row. */
const IV_WINDOW_PTS = 500;

/**
 * Sanity cut for a quoted IV. On expiry day, a leg with a few rupees of time
 * value left can print 300-500%, which is a Black-Scholes artefact rather than
 * a tradeable vol. Those legs are clipped from the chart and the caption says
 * how many, so the smile never becomes a single wing spike.
 */
export const IV_MAX_PCT = 120;

/** Rendered for any absent field so a stat never shows blank/NaN. */
export const IV_DASH = "—";

/** IV as a positive percentage, or `null` when the leg had no greeks. */
function ivOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** One strike of the smile: CE IV and PE IV are independently optional. */
interface IvSkewPoint {
  strike: number;
  ceIv: number | null;
  peIv: number | null;
}

/**
 * Build the smile across the ±`width` band around spot, ascending by strike.
 * Rows without a usable strike or without either IV are dropped. When spot is
 * absent the whole chain is returned (old snapshots carry no spot) so the
 * panel still draws something instead of going blank.
 */
export function buildIvSkewPoints(
  strikes: NiftyStrike[],
  spot: number | null | undefined,
  width: number = IV_WINDOW_PTS,
): IvSkewPoint[] {
  const rows = Array.isArray(strikes) ? strikes : [];
  const points = rows
    .map((s): IvSkewPoint => ({
      strike: Number(s?.strike),
      ceIv: ivOrNull(s?.ce?.iv),
      peIv: ivOrNull(s?.pe?.iv),
    }))
    .filter(
      (p) =>
        Number.isFinite(p.strike) &&
        p.strike > 0 &&
        (p.ceIv !== null || p.peIv !== null),
    )
    .sort((a, b) => a.strike - b.strike);

  if (!Number.isFinite(spot as number) || (spot as number) <= 0) return points;
  const near = points.filter(
    (p) => Math.abs(p.strike - (spot as number)) <= width,
  );
  return near.length > 0 ? near : points;
}

/** Point whose strike is closest to `target`, or `null` when empty. */
export function nearestIvPoint(
  points: IvSkewPoint[],
  target: number | null | undefined,
): IvSkewPoint | null {
  if (!Number.isFinite(target as number) || points.length === 0) return null;
  let best: IvSkewPoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const d = Math.abs(p.strike - (target as number));
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/** Mean of the present IVs, or `null` when none are present. */
function meanPresent(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/**
 * IV at the strike whose |delta| sits closest to `target`, inside
 * `tolerance`. Uses the chain rows (not the plotted points) because delta is
 * only carried on the raw legs. Missing/zero greeks are skipped.
 */
export function legIvAtDelta(
  strikes: NiftyStrike[],
  side: "ce" | "pe",
  target: number,
  tolerance = 0.12,
): number | null {
  let best: { dist: number; iv: number } | null = null;
  for (const row of strikes ?? []) {
    const leg = row?.[side];
    const delta = Math.abs(Number(leg?.delta));
    const iv = ivOrNull(leg?.iv);
    if (!Number.isFinite(delta) || delta <= 0 || iv === null) continue;
    const dist = Math.abs(delta - target);
    if (dist > tolerance) continue;
    if (best === null || dist < best.dist) best = { dist, iv };
  }
  return best ? best.iv : null;
}

/** Derived headline numbers for the stat row. */
interface IvSkewStats {
  atmStrike: number | null;
  atmIv: number | null;
  atmCe: number | null;
  atmPe: number | null;
  /** PE IV at the 25-delta strike (downside wing). */
  put25: number | null;
  /** CE IV at the 25-delta strike (upside wing). */
  call25: number | null;
  /** 25-delta risk reversal: put IV − call IV, in vol points. */
  rr25: number | null;
}

/**
 * ATM IV (average of the two ATM legs) and the 25-delta anchors. Every field
 * degrades to `null` independently, so a sparse greeks payload still shows the
 * parts it has.
 */
export function ivSkewStats(
  points: IvSkewPoint[],
  strikes: NiftyStrike[],
  spot: number | null | undefined,
): IvSkewStats {
  const atm = nearestIvPoint(points, spot);
  const atmCe = atm?.ceIv ?? null;
  const atmPe = atm?.peIv ?? null;
  const call25 = legIvAtDelta(strikes, "ce", 0.25);
  const put25 = legIvAtDelta(strikes, "pe", 0.25);

  return {
    atmStrike: atm?.strike ?? null,
    atmIv: meanPresent([atmCe, atmPe]),
    atmCe,
    atmPe,
    put25,
    call25,
    rr25: call25 !== null && put25 !== null ? put25 - call25 : null,
  };
}

/** `18.4%` / `—`. */
export function formatIv(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return IV_DASH;
  return `${v.toFixed(1)}%`;
}

/** `+1.6 vp` / `-0.4 vp` / `0.0 vp` / `—` — vol points, signed. */
export function formatVolPts(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return IV_DASH;
  const rounded = Math.round(v * 10) / 10;
  if (rounded === 0) return "0.0 vp";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} vp`;
}

/** Colour the risk reversal by which wing is richer (leg hue, not P&L). */
export function ivSkewTone(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) {
    return palette.TEXT_MUTED;
  }
  return v > 0 ? palette.TERM_PE : palette.TERM_CE;
}

/** One-line read of the 25-delta skew — the panel's takeaway, or `null`. */
export function ivSkewRead(stats: IvSkewStats): string | null {
  if (stats.rr25 === null) return null;
  const d = stats.rr25;
  if (Math.abs(d) < 0.1) return "25Δ wings flat — no directional vol bid";
  return d > 0
    ? `25Δ puts ${d.toFixed(1)} vp over calls — downside hedging is bid`
    : `25Δ calls ${Math.abs(d).toFixed(1)} vp over puts — upside calls are richer`;
}

/** MiniLineChart-ready props for the smile. */
interface IvSkewChartProps {
  labels: string[];
  series: MiniSeries[];
  markers: MiniMarker[];
  /** Strikes actually plotted (OTM legs only, after the IV sanity cut). */
  band: IvSkewPoint[];
  /** Legs dropped for quoting above `IV_MAX_PCT`. */
  clipped: number;
}

/**
 * Pure chart builder — unit-testable without rendering.
 *
 * Plots the **out-of-the-money smile**: calls only at/above the ATM strike,
 * puts only at/below it. ITM legs are excluded on purpose — they mirror the
 * same OTM price, but their Black-Scholes IV is far noisier (a deep-ITM leg
 * with pennies of time value printed 466% on the 19-Oct expiry tape). Legs
 * above `IV_MAX_PCT` are dropped and counted in `clipped`.
 */
export function buildIvSkewChart(
  points: IvSkewPoint[],
  stats: IvSkewStats,
): IvSkewChartProps {
  const atm = stats.atmStrike;
  let clipped = 0;
  const masked: IvSkewPoint[] = [];
  for (const p of points) {
    const ceAllowed = atm === null || p.strike >= atm;
    const peAllowed = atm === null || p.strike <= atm;
    let ceIv = ceAllowed ? p.ceIv : null;
    let peIv = peAllowed ? p.peIv : null;
    if (ceIv !== null && ceIv > IV_MAX_PCT) {
      ceIv = null;
      clipped += 1;
    }
    if (peIv !== null && peIv > IV_MAX_PCT) {
      peIv = null;
      clipped += 1;
    }
    if (ceIv !== null || peIv !== null) {
      masked.push({ strike: p.strike, ceIv, peIv });
    }
  }

  const labels = masked.map((p) => formatNumberIN(p.strike));
  const series: MiniSeries[] = [
    {
      name: "CE IV",
      points: masked.map((p) => p.ceIv),
      color: palette.TERM_CE,
      axis: 0,
    },
    {
      name: "PE IV",
      points: masked.map((p) => p.peIv),
      color: palette.TERM_PE,
      axis: 0,
    },
  ];

  const markers: MiniMarker[] = [];
  if (atm !== null) {
    const idx = masked.findIndex((p) => p.strike === atm);
    if (idx >= 0) {
      markers.push({ index: idx, label: "ATM", color: palette.TERM_FLIP });
    }
  }

  return { labels, series, markers, band: masked, clipped };
}

interface NiftyIvSkewProps {
  strikes?: NiftyStrike[];
  spot?: number | null;
}

export function NiftyIvSkew(props: NiftyIvSkewProps) {
  const strikes = () => props.strikes;
  const spot = () => props.spot ?? null;
  const rows = createMemo(() => (Array.isArray(strikes()) ? strikes()! : []));
  const points = createMemo(() => buildIvSkewPoints(rows(), spot()));
  const stats = createMemo(() => ivSkewStats(points(), rows(), spot()));
  const chart = createMemo(() => buildIvSkewChart(points(), stats()));
  const read = () => ivSkewRead(stats());
  const band = () => chart().band;
  const coverage = () =>
    [
      band().length > 0
        ? `Band ${formatNumberIN(band()[0].strike)}–${formatNumberIN(band()[band().length - 1].strike)}`
        : null,
      `${band().length} OTM strikes`,
      chart().clipped > 0 ? `${chart().clipped} legs >${IV_MAX_PCT}% clipped` : null,
      "gaps = unquoted greeks",
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <LocalCompactPanel
      title="IV skew (price × σ)"
      testId="nifty-iv-skew-panel"
      style={{
        "background-color": palette.TERM_BG,
        "border": `1px solid ${palette.TERM_BORDER}`,
        "border-color": palette.TERM_BORDER,
        "border-radius": "8px",
      }}
    >
      <div class="flex flex-col gap-[4px] w-full min-w-0">
        <div
          class="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-[4px] w-full min-w-0"
        >
          <LocalCompactStat
            testId="nifty-iv-skew-atm"
            label="ATM IV"
            value={formatIv(stats().atmIv)}
            hint={`CE ${formatIv(stats().atmCe)} · PE ${formatIv(stats().atmPe)}`}
          />
          <LocalCompactStat
            testId="nifty-iv-skew-rr"
            label="25Δ RR"
            value={formatVolPts(stats().rr25)}
            tone={ivSkewTone(stats().rr25) ?? undefined}
            hint="put − call"
          />
          <LocalCompactStat
            testId="nifty-iv-skew-put"
            label="25Δ put IV"
            value={formatIv(stats().put25)}
            tone={palette.TERM_PE}
            hint="downside"
          />
          <LocalCompactStat
            testId="nifty-iv-skew-call"
            label="25Δ call IV"
            value={formatIv(stats().call25)}
            tone={palette.TERM_CE}
            hint="upside"
          />
        </div>

        {/* Legend + the takeaway sentence. Colour stays tied to the leg (CE
            blue / PE orange / ATM gold), never to direction. */}
        <div class="flex items-center gap-[8px] flex-wrap min-w-0">
          <For each={[
            { label: "CALL IV", color: palette.TERM_CE },
            { label: "PUT IV", color: palette.TERM_PE },
            { label: "ATM", color: palette.TERM_FLIP },
          ]}>
            {(k) => (
              <div class="flex items-center gap-[4px]">
                <div
                  aria-hidden
                  class="w-[6px] h-[6px] rounded-full shrink-0"
                  style={{ "background-color": k.color }}
                />
                <Text size="xs" span c="dimmed">
                  {k.label}
                </Text>
              </div>
            )}
          </For>
          <Show when={read()}>
            <Text
              data-testid="nifty-iv-skew-read"
              size="xs"
              span
              title={read()!}
              className="min-w-0 flex-1 overflow-hidden truncate whitespace-nowrap"
              style={{ color: palette.TEXT_MUTED }}
            >
              {read()}
            </Text>
          </Show>
        </div>

        <div class="w-full min-w-0">
          <MiniLineChart
            series={chart().series}
            labels={chart().labels}
            markers={chart().markers}
            height={120}
            formatValue={formatIv}
            testId="nifty-iv-skew-chart"
            emptyMessage="No IV in this expiry"
          />
        </div>

        <Show when={band().length > 0}>
          <Text
            data-testid="nifty-iv-skew-coverage"
            size="xs"
            span
            c="dimmed"
            title="x: strike · y: implied volatility %. Calls are plotted at/above ATM and puts at/below it, so the curve is the out-of-the-money smile. The line breaks where Upstox did not quote greeks for a leg; those strikes are missing data, not zero vol. Legs above the sanity cut are clipped and counted."
            className="whitespace-nowrap overflow-hidden truncate"
          >
            {coverage()}
          </Text>
        </Show>
      </div>
    </LocalCompactPanel>
  );
}
