import { For } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import { hexToRgba } from "@/utils/color";
import type { NiftyGex, NiftyReport } from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";
import { gexSideLevels } from "./NiftyGexProfile";
import {
  buildPatternOverlay,
  buildPatternScanAnnotation,
  patternNoHitLabel,
} from "./niftyPatternOverlay";
import { wallEventOverlay, type WallBurstLike } from "./niftyWallEventOverlay";
import { maxPainTouches } from "./maxPainTouches";
import {
  PATTERN_LOOKBACK_BARS,
  type PatternScanState,
} from "./useNiftyPatternScan";
import type { ChartSource } from "./niftyReportStore";
import type { CandleFeed, ChartTimeframe } from "./NiftyChartPanel.constants";

interface LevelLegendProps {
  live: boolean;
  gex?: NiftyGex;
  spot?: number;
}

export function LevelLegend(props: LevelLegendProps) {
  const live = () => props.live;
  const sides = () => (props.gex ? gexSideLevels(props.gex, props.spot ?? NaN) : null);
  // A present block filters to drawable levels; callers that only pass `live`
  // keep the legacy "show every code" behaviour.
  const show = () => ({
    flip: !props.gex || props.gex.zeroCross != null,
    support: !props.gex || sides()?.below?.kind === "support",
    resistance: !props.gex || sides()?.above?.kind === "resistance",
    fuel:
      !props.gex ||
      sides()?.below?.kind === "fuel" ||
      sides()?.above?.kind === "fuel",
  });
  const items: { code: string; color: string; meaning: string; zone?: boolean }[] = [
    { code: "CW", color: palette.NEGATIVE, meaning: "max-OI call wall above spot · resistance", zone: true },
    { code: "CW↓", color: palette.NEGATIVE, meaning: "call wall below spot · broken resistance / support", zone: true },
    { code: "CW (BELOW)", color: palette.NEGATIVE, meaning: "call wall below spot (no call above) · broken resistance", zone: true },
    { code: "PW", color: palette.POSITIVE, meaning: "max-OI put wall below spot · support", zone: true },
    { code: "PW↑", color: palette.POSITIVE, meaning: "put wall above spot · broken support / resistance", zone: true },
    { code: "PW (ABOVE)", color: palette.POSITIVE, meaning: "put wall above spot (no put below) · broken support", zone: true },
    { code: "MP", color: palette.PRIMARY, meaning: "max pain · expiry magnet", zone: true },
  ];
  if (live()) {
    if (show().flip) {
      items.push(
        { code: "FLIP", color: palette.WARNING, meaning: "gamma flip · dealers switch sides here" },
      );
    }
    if (show().support) {
      items.push(
        { code: "GSUP", color: palette.POSITIVE, meaning: "gamma support · pin magnet below spot" },
      );
    }
    if (show().resistance) {
      items.push(
        { code: "GRES", color: palette.NEGATIVE, meaning: "gamma resistance · pin magnet above spot" },
      );
    }
    if (show().fuel) {
      items.push(
        { code: "GFUEL", color: palette.WARNING, meaning: "gamma fuel · moves accelerate on that side" },
      );
    }
  }
  return (
    // Single dense wrapped row: tight gaps + minimal top pad so the legend
    // costs one ~16px row instead of two. Fonts/symbols untouched.
    <div
      data-testid="nifty-level-legend"
      class="flex flex-wrap"
      style={{ "column-gap": "8px", "row-gap": "4px", "padding-top": "4px" }}
    >
      <For each={items}>{(it) => (
        <div
          class="flex items-center"
          style={{ gap: "8px", "white-space": "nowrap" }}
        >
          <div
            style={{
              width: it.zone ? "12px" : "8px",
              height: "8px",
              "border-radius": it.zone ? "1px" : "50%",
              "background-color": it.zone ? hexToRgba(it.color, 0.18) : it.color,
              border: it.zone ? `1px solid ${it.color}` : "none",
              "flex-shrink": 0,
            }}
          />
          <Text size="xs" fw={700} span>
            {it.code}
          </Text>
          <Text size="xs" c="dimmed" span>
            {it.meaning}
          </Text>
        </div>
      )}</For>
    </div>
  );
}

/** Newest bar across every feed lane. The frozen snapshot and the live poll
 *  are compared with the same clock so a REST poll can only advance the chart
 *  on a genuine session step — never on an identical-bar identity change. */
export function newestFeedBarMs(feed: CandleFeed): number {
  const times = [
    feed.report.intraday?.at(-1)?.time,
    feed.report.candles?.at(-1)?.time,
    feed.spot?.at(-1)?.t,
    feed.tape?.rows?.at(-1)?.t,
  ];
  let newest = 0;
  for (const value of times) {
    const ms = Date.parse(value ?? "");
    if (Number.isFinite(ms) && ms > newest) newest = ms;
  }
  return newest;
}

export interface FeedView {
  state: string;
  label: string;
  color: string;
  title: string;
}

/** Header status for the chart-lane feed. Short on purpose: the mobile
 *  header is one row and must not steal height from the 111px chart. The
 *  tooltip names the other feed so the two WS labels cannot be confused. */
export function computeFeedView(
  enabled: boolean,
  live: boolean,
  reconnecting: boolean,
  marketClosed: boolean,
  disconnected: boolean,
): FeedView | null {
  if (!enabled) return null;
  const title =
    "Fyers tick feed for this chart's last candle. The page header's 'live (WS)' is the separate Upstox report stream.";
  if (live) {
    return { state: "live", label: "FYERS LIVE", color: palette.POSITIVE, title };
  }
  if (reconnecting) {
    return { state: "reconnecting", label: "FYERS RECON", color: palette.WARNING, title: `${title} REST poll is the fallback.` };
  }
  if (marketClosed) {
    return { state: "market-closed", label: "FYERS CLOSED", color: palette.TEXT_MUTED, title: `${title} REST poll is the fallback.` };
  }
  if (disconnected) {
    return { state: "disconnected", label: "FYERS OFFLINE", color: palette.NEGATIVE, title: `${title} REST poll is the fallback.` };
  }
  return { state: "connecting", label: "FYERS LINK…", color: palette.TEXT_MUTED, title: `${title} REST poll is the fallback.` };
}

export type LastDataState = "replay" | "market closed" | "live";

export function computeLastDataState(
  asOf: string | undefined,
  report: NiftyReport,
): LastDataState {
  if (asOf) return "replay";
  return report.market?.is_open === false ? "market closed" : "live";
}

export interface ScanBadge {
  text: string;
  color: string;
  title: string;
}

/** In-chart result badge. An overlay, not a stacked panel, so the 111px
 *  mobile chart keeps its height. */
export function computeScanBadge(
  scan: PatternScanState,
  chartSource: ChartSource,
): ScanBadge | null {
  if (chartSource !== "patterns" || scan.status !== "ready") return null;
  const hit = scan.hits[0];
  return {
    text: hit
      ? `${scan.tf} · ${hit.pattern_name} · ${Math.round(hit.confidence)}%`
      : patternNoHitLabel(scan.tf, PATTERN_LOOKBACK_BARS),
    color: hit
      ? hit.direction === "bullish"
        ? palette.POSITIVE
        : hit.direction === "bearish"
          ? palette.NEGATIVE
          : palette.TEXT
      : palette.TEXT,
    title: hit
      ? `${hit.pattern_id} · ${hit.status} · ${scan.tf}`
      : `Scanned window: up to ${PATTERN_LOOKBACK_BARS} × ${scan.tf} bars · data through ${scan.dataThrough ?? "unknown"}`,
  };
}

/** Only when the scan matches the DISPLAYED timeframe: a 15m pattern drawn on
 *  1m bars is a lie. Switching TF hides the overlay until the next scan. */
export function computePatternOverlay(
  scan: PatternScanState,
  chartSource: ChartSource,
  drawPattern: boolean,
  candles: ReplayCandle[],
  chartTf: ChartTimeframe,
) {
  if (chartSource !== "patterns" || !drawPattern || scan.status !== "ready" || scan.tf !== chartTf) {
    return null;
  }
  const hit = scan.hits[0];
  if (!hit) return null;
  return buildPatternOverlay(hit, candles);
}

/** A no-result scan still annotates the chart: one muted dot on the last bar
 *  marks that the window was examined. No level is drawn when nothing matched. */
export function computeScanAnnotation(
  scan: PatternScanState,
  chartSource: ChartSource,
  candles: ReplayCandle[],
  chartTf: ChartTimeframe,
) {
  if (chartSource !== "patterns" || scan.status !== "ready" || scan.hits.length > 0 || scan.tf !== chartTf) {
    return null;
  }
  return buildPatternScanAnnotation({
    candles,
    timeframe: scan.tf,
    lookbackBars: PATTERN_LOOKBACK_BARS,
    hitCount: scan.hits.length,
    markerColor: palette.TEXT_MUTED,
  });
}

/** Chart-input observability: LIVE/OFFLINE never carry a pattern overlay. */
export function computePatternSourceState(
  scan: PatternScanState,
  chartSource: ChartSource,
): string {
  if (chartSource !== "patterns") return "off";
  if (scan.status === "idle" || scan.status === "loading" || scan.status === "error") {
    return scan.status;
  }
  return scan.hits.length > 0 ? "hit" : "none";
}

export function computePatternOverlayCount(
  scan: PatternScanState,
  chartSource: ChartSource,
): number {
  return chartSource === "patterns" && scan.status === "ready" && scan.hits.length > 0 ? 1 : 0;
}

/** Bursts carry the whole session while an EOD replay is clipped at the
 *  playhead. Without this guard a 15:29 break is drawn (and its wall/target
 *  lines added) while the replay clock still reads 09:17 — look-ahead that
 *  makes the chart lie about what was knowable at the time. */
export function computeWallOverlay(
  bursts: WallBurstLike[] | null,
  asOf: string | undefined,
) {
  if (!asOf) return wallEventOverlay(bursts);
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) return wallEventOverlay(bursts);
  const scoped = (bursts ?? []).filter((burst) => {
    if (!burst.t) return true;
    const t = Date.parse(burst.t);
    return !Number.isFinite(t) || t <= cutoff;
  });
  return wallEventOverlay(scoped);
}

export interface FlipMarker {
  time: string;
  value: number;
  shape: "circle";
  color: string;
  position: "aboveBar";
  size: number;
}

/** Flow-flip marker: the candle at/before the flip stamp, drawn as a small
 *  amber dot on its close with no text (lightweight-charts has no vertical
 *  price-line primitive; a marker is the least invasive overlay). */
export function computeFlipMarker(
  flipAt: string | null | undefined,
  candles: ReplayCandle[],
): FlipMarker[] {
  if (!flipAt || candles.length === 0) return [];
  const flipMs = Date.parse(flipAt);
  if (!Number.isFinite(flipMs)) return [];
  let best = candles[0];
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const candle of candles) {
    const ms = Date.parse(candle.time);
    if (!Number.isFinite(ms) || ms > flipMs) continue;
    if (ms >= bestMs) {
      best = candle;
      bestMs = ms;
    }
  }
  return [
    {
      time: best.time,
      value: best.close,
      shape: "circle" as const,
      color: palette.WARNING,
      position: "aboveBar" as const,
      size: 2,
    },
  ];
}

/** Bars whose close sits on the report's max pain (tolerance derived from strike step). */
export function computeMaxPainTouches(candles: ReplayCandle[], report: NiftyReport) {
  return maxPainTouches(
    candles.map((c) => ({ value: c.close, maxPain: report.maxPain, time: c.time })),
    report,
  );
}

export function computePatternStripTitle(
  scan: PatternScanState,
  symbol: () => string,
): string {
  if (scan.status === "idle") return "";
  const tf = scan.tf;
  if (scan.status === "ready") {
    const firstHit = scan.hits[0];
    if (firstHit) {
      const lvl = (v?: number | null) =>
        typeof v === "number" && Number.isFinite(v)
          ? formatNumberIN(Math.round(v))
          : "—";
      // The target is often off-scale by design (it would squash
      // the candles), so the tooltip always carries all three.
      return `${firstHit.pattern_name} · ${firstHit.direction} · ${Math.round(firstHit.confidence)}% · ${firstHit.status} · ${
        firstHit.bars_ago === 0 ? "now" : `${firstHit.bars_ago} bars ago`
      } · BRK ${lvl(firstHit.breakout_level)} · TGT ${lvl(firstHit.target)} · SL ${lvl(firstHit.stop)}`;
    }
    return `No pattern found · up to ${PATTERN_LOOKBACK_BARS} × ${tf} bars · data through ${scan.dataThrough ?? "unknown"}`;
  }
  if (scan.status === "error") return scan.message;
  return `Scanning ${symbol} ${tf}…`;
}
