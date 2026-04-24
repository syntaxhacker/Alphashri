import { useRef, useCallback } from "react";
import { parseTimeToHHMM } from "../utils/ui-helpers";

interface UseChartZoomOptions {
  chartInstance: React.MutableRefObject<any>;
}

interface UseChartZoomReturn {
  allTimesRef: React.MutableRefObject<string[]>;
  zoomToTradeByTime: (entryTime: string, exitTime: string) => void;
  zoomToTradeByIndex: (startIdx: number, endIdx: number, total: number) => void;
}

function computeZoomRange(
  startIdx: number,
  endIdx: number,
  total: number,
): { start: number; end: number } {
  const span = endIdx - startIdx + 1;
  const minWindow = Math.min(60, total);
  const pad = Math.max(5, Math.floor((minWindow - span) / 2));
  let start = Math.max(0, startIdx - pad);
  let end = Math.min(total - 1, endIdx + pad);
  if (end - start + 1 < minWindow) {
    if (start === 0) end = Math.min(total - 1, minWindow - 1);
    else start = Math.max(0, end - minWindow + 1);
  }
  return { start, end };
}

function dispatchZoom(
  chart: any,
  startIdx: number,
  endIdx: number,
  total: number,
) {
  const { start, end } = computeZoomRange(startIdx, endIdx, total);
  const startPct = (start / total) * 100;
  const endPct = ((end + 1) / total) * 100;
  chart.dispatchAction({
    type: "dataZoom",
    dataZoomIndex: 0,
    start: startPct,
    end: endPct,
  });
  chart.dispatchAction({
    type: "dataZoom",
    dataZoomIndex: 1,
    start: startPct,
    end: endPct,
  });
}

export function useChartZoom(options: UseChartZoomOptions): UseChartZoomReturn {
  const { chartInstance } = options;
  const allTimesRef = useRef<string[]>([]);

  const zoomToTradeByTime = useCallback(
    (entryTime: string, exitTime: string) => {
      setTimeout(() => {
        if (!chartInstance.current || !allTimesRef.current.length) return;
        const times = allTimesRef.current;
        const entryKey = parseTimeToHHMM(entryTime);
        const exitKey = parseTimeToHHMM(exitTime);

        let entryIdx = times.findIndex((t) => t === entryKey);
        if (entryIdx === -1) {
          let best = -1;
          for (let i = 0; i < times.length; i++) {
            if (times[i] <= entryKey) best = i;
            else break;
          }
          entryIdx = best >= 0 ? best : 0;
        }

        let exitIdx = times.findIndex((t) => t === exitKey);
        if (exitIdx === -1) {
          let best = -1;
          for (let i = 0; i < times.length; i++) {
            if (times[i] <= exitKey) best = i;
            else break;
          }
          exitIdx = best >= 0 ? best : times.length - 1;
        }

        dispatchZoom(chartInstance.current, entryIdx, exitIdx, times.length);
      }, 100);
    },
    [chartInstance],
  );

  const zoomToTradeByIndex = useCallback(
    (startIdx: number, endIdx: number, total: number) => {
      setTimeout(() => {
        if (!chartInstance.current) return;
        dispatchZoom(chartInstance.current, startIdx, endIdx, total);
      }, 150);
    },
    [chartInstance],
  );

  return { allTimesRef, zoomToTradeByTime, zoomToTradeByIndex };
}
