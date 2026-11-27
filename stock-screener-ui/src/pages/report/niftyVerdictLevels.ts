/**
 * Actionable desk-plan levels as chart price lines.
 *
 * The verdict strip and the chart must name the same three levels. Both read
 * the same `buildDeskPlan(report)` output; this module only turns the ACTIVE
 * side's numeric levels into `MarkLineData`. It never invents a level: a
 * neutral plan, an inactive side, or any missing/non-finite number yields no
 * lines at all.
 */

import * as palette from "@/ui/palette";
import type { NiftyReport } from "@/types/niftyReport";
import type { MarkLineData } from "@/utils/chart/types";
import { formatNumberIN } from "@/utils/ui-helpers";
import { buildDeskPlan } from "./deskPlan";
import {
  candlePriceRange,
  levelBelongsToScale,
  mergeCollidingLabels,
} from "./niftyChartMath";

type VerdictCode = "SELL" | "BUY" | "CUT" | "TGT";

function verdictLine(
  code: VerdictCode,
  level: number,
  report: NiftyReport,
  color: string,
  type: string,
  width: number,
): MarkLineData {
  return {
    yAxis: level,
    includeInScale: levelBelongsToScale(level, report.spot, candlePriceRange(report)),
    lineStyle: { color, type, width },
    label: {
      position: "insideEndTop",
      formatter: `${code} ${formatNumberIN(Math.round(level))}`,
    },
  };
}

/**
 * Horizontal lines for the active side's entry trigger, stop and target.
 *
 * `labelGapPct` is the caller's height-aware collision gap: 0 (the default)
 * keeps all three labels, while a compact panel can pass
 * `labelGapPctFor(report, height)` to merge labels that would overlap.
 */
export function verdictMarkLines(
  report: NiftyReport,
  labelGapPct = 0,
): MarkLineData[] {
  const plan = buildDeskPlan(report);
  if (plan.bias === "neutral") return [];

  const side = plan.bias === "bearish" ? plan.bear : plan.bull;
  if (side.bias !== plan.bias) return [];

  const trigger = side.triggerLevel;
  const stop = side.stop;
  const target = side.target;
  if (
    trigger === null ||
    stop === null ||
    target === null ||
    !Number.isFinite(trigger) ||
    !Number.isFinite(stop) ||
    !Number.isFinite(target)
  ) {
    return [];
  }

  const bear = plan.bias === "bearish";
  const lines: MarkLineData[] = [
    verdictLine(
      bear ? "SELL" : "BUY",
      trigger,
      report,
      bear ? palette.NEGATIVE : palette.POSITIVE,
      "solid",
      2,
    ),
    verdictLine("CUT", stop, report, palette.NEGATIVE, "dashed", 1),
    verdictLine("TGT", target, report, palette.POSITIVE, "dashed", 1),
  ];
  return mergeCollidingLabels(lines, report.spot, labelGapPct);
}
