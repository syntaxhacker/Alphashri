/**
 * Shared math for the standalone support/resistance lines that both pattern
 * builders draw (`patternChartOption` for ECharts, `patternTVData` for
 * TradingView). Extracted so the view gate + endpoint mapping cannot drift.
 */
import type { AxisPoint } from "./trendlineMapping";
import type { PatternHitDTO, TrendLine, TrendlinesView } from "@/types/chartPatterns";
import { mapTimeSegment } from "./trendlineMapping";
import { NEGATIVE, POSITIVE } from "@/ui/palette";

export interface StandaloneLineResult {
  name: "TLS" | "TLR";
  color: string;
  points: AxisPoint[];
  line: TrendLine;
}

/** Filter standalone trend lines by the `trendlinesView` gate. `hit` supplies
 *  the fallback `trend_lines` when no explicit list is passed. */
export function resolveVisibleStandalone(
  standaloneTrendLines: TrendLine[] | undefined,
  hit: PatternHitDTO | null | undefined,
  trendlinesView: TrendlinesView,
): TrendLine[] {
  const standalone = standaloneTrendLines ?? hit?.trend_lines ?? [];
  return trendlinesView === "none"
    ? []
    : standalone.filter((line) => trendlinesView === "both" ? true : line?.kind === trendlinesView);
}

/** Map one standalone line to its chart name, colour and axis points. Returns
 *  `null` when the line is absent or its segment falls outside the window, so
 *  callers can skip it (`if (!mapped) return;`). */
export function mapStandaloneLine(line: TrendLine, times: string[]): StandaloneLineResult | null {
  if (!line) return null;
  const name = line.kind === "support" ? "TLS" : "TLR";
  const color = line.kind === "support" ? POSITIVE : NEGATIVE;
  const points = mapTimeSegment(line.start_date, line.start_price, line.end_date, line.end_price, times);
  if (!points || points.length === 0) return null;
  return { name, color, points, line };
}
