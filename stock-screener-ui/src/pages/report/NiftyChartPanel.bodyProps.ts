import type { ComponentProps } from "solid-js";
import type { TradingViewChart } from "@/components/chart/TradingViewChart";
import type { ReplayCandle } from "@/types/replay";
import type { ChartSource } from "./niftyReportStore";
import type { ScanBadge } from "./NiftyChartPanel.annotations";
import type { ChartTimeframe } from "./NiftyChartPanel.constants";
import type { PatternScanState } from "./useNiftyPatternScan";

export type ChartProps = ComponentProps<typeof TradingViewChart>;

export interface ChartBodyProps {
  view: "chart" | "depth";
  offlineEmpty: boolean;
  sessionDate: string;
  chartCandles: ReplayCandle[];
  candlesEverShown: boolean;
  chartHeight: number | null;
  fillContainer: boolean;
  mpTouchesLength: number;
  flipMarkerPresent: boolean;
  patternSourceState: string;
  patternOverlayCount: number;
  chartMarkLines: NonNullable<ChartProps["markLines"]>;
  chartEmaData: NonNullable<ChartProps["emaData"]>;
  touchMarkers: NonNullable<ChartProps["touchMarkers"]>;
  lastDataBoundary: string;
  scanBadge: ScanBadge | null;
  chartSource: ChartSource;
  scanStatus: PatternScanState["status"];
  chartTf: ChartTimeframe;
  symbol: () => string;
  onScanPatterns: () => void;
}
