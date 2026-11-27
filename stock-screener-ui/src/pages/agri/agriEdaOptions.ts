import { buildDistributionOption } from "./options/distribution";
import { buildHeatmapOption } from "./options/heatmap";
import { buildRollingOption, ROLLING_WINDOWS } from "./options/rolling";
import { buildSeasonalityOption } from "./options/seasonality";
import { buildSupplyDemandOption } from "./options/supplyDemand";
import type {
  EdaDistributionInput,
  EdaHeatmapInput,
  EdaMode,
  EdaOptionInput,
  EdaRollingInput,
  EdaSeasonalityInput,
  EdaSupplyDemandInput,
  Option,
} from "./options/shared";

export type {
  EdaBox,
  EdaComparisonSeries,
  EdaDistributionInput,
  EdaHeatmapInput,
  EdaHeatmapRow,
  EdaMode,
  EdaOptionInput,
  EdaRollingInput,
  EdaScatter,
  EdaSeasonalityInput,
  EdaSeriesPoint,
  EdaSupplyDemandInput,
} from "./options/shared";

export {
  buildDistributionOption,
  buildHeatmapOption,
  buildRollingOption,
  buildSeasonalityOption,
  buildSupplyDemandOption,
  ROLLING_WINDOWS,
};

function normalizeMode(mode: unknown): EdaMode | "" {
  if (typeof mode !== "string") return "";
  const key = mode.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (key === "distribution" || key === "boxplot" || key === "box") return "distribution";
  if (key === "supply-demand" || key === "supplydemand" || key === "scatter" || key === "regression") {
    return "supplyDemand";
  }
  if (key === "heatmap" || key === "heat") return "heatmap";
  if (key === "rolling" || key === "trend") return "rolling";
  if (key === "seasonality" || key === "seasonal" || key === "season") return "seasonality";
  return "";
}

/** Dispatch an EDA view to its pure option builder. Unknown modes return `{}`. */
export function buildEdaOption(
  mode: EdaMode | string | null | undefined,
  input: EdaOptionInput | null | undefined,
): Option {
  if (!input || typeof input !== "object") return {};
  switch (normalizeMode(mode)) {
    case "distribution":
      return buildDistributionOption(input as EdaDistributionInput);
    case "supplyDemand":
      return buildSupplyDemandOption(input as EdaSupplyDemandInput);
    case "heatmap":
      return buildHeatmapOption(input as EdaHeatmapInput);
    case "rolling":
      return buildRollingOption(input as EdaRollingInput);
    case "seasonality":
      return buildSeasonalityOption(input as EdaSeasonalityInput);
    default:
      return {};
  }
}
