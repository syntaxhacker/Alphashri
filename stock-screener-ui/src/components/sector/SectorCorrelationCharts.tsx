/**
 * Stable entry point for the correlation visuals. The boards themselves are
 * DOM, not canvas: direct labels and native buttons keep them legible and
 * keyboard-reachable at every panel width.
 */
export { CorrelationHeatmap } from "../common/CorrelationHeatmap";
export { RankChangeBoard as RotationTimeline } from "./correlation/RankChangeBoard";
export { BetaDotPlot as SectorBetaChart } from "./correlation/BetaDotPlot";
export { RelativeStrengthBoard } from "./correlation/RelativeStrengthBoard";
