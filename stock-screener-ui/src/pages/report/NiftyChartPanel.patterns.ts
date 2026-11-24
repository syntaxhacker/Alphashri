import { createMemo, createSignal, type Accessor } from "solid-js";
import type { ReplayCandle } from "@/types/replay";
import type { PatternOverlayLine } from "./niftyPatternOverlay";
import type { ChartSource } from "./niftyReportStore";
import { useNiftyPatternScan } from "./useNiftyPatternScan";
import type { ChartTimeframe } from "./NiftyChartPanel.constants";
import {
  computePatternOverlay,
  computePatternOverlayCount,
  computePatternSourceState,
  computeScanAnnotation,
  computeScanBadge,
} from "./NiftyChartPanel.annotations";

interface PatternInputs {
  chartSource: Accessor<ChartSource>;
  chartTf: Accessor<ChartTimeframe>;
  chartCandles: Accessor<ReplayCandle[]>;
  emaData: Accessor<PatternOverlayLine[]>;
}

/** Pattern scan state, overlays and badges. Owned as one unit so the scan
 *  result, the in-chart lines and the footer strip can never disagree about
 *  which timeframe was examined. */
export function createChartPatterns(inputs: PatternInputs) {
  const { state: patternScan, scan: scanPatterns } = useNiftyPatternScan();
  // Default ON: a scan that returns a pattern should draw it. The chip toggles.
  const [drawPattern, setDrawPattern] = createSignal(true);

  const patternOverlay = createMemo(() =>
    computePatternOverlay(
      patternScan(),
      inputs.chartSource(),
      drawPattern(),
      inputs.chartCandles(),
      inputs.chartTf(),
    ),
  );

  const scanAnnotation = createMemo(() =>
    computeScanAnnotation(
      patternScan(),
      inputs.chartSource(),
      inputs.chartCandles(),
      inputs.chartTf(),
    ),
  );

  const scanBadge = createMemo(() => computeScanBadge(patternScan(), inputs.chartSource()));

  const patternSourceState = createMemo(() =>
    computePatternSourceState(patternScan(), inputs.chartSource()),
  );
  const patternOverlayCount = createMemo(() =>
    computePatternOverlayCount(patternScan(), inputs.chartSource()),
  );

  const chartEmaData = createMemo(() => {
    const overlay = patternOverlay();
    return overlay ? [...inputs.emaData(), ...overlay.lines] : inputs.emaData();
  });

  return {
    patternScan,
    scanPatterns,
    drawPattern,
    setDrawPattern,
    patternOverlay,
    scanAnnotation,
    scanBadge,
    patternSourceState,
    patternOverlayCount,
    chartEmaData,
  };
}
