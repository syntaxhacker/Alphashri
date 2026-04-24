import { useRef, useCallback } from "react";

interface UseChartZoomOptions {
  chartInstance: React.MutableRefObject<any>;
}

interface UseChartZoomReturn {
  allTimesRef: React.MutableRefObject<string[]>;
  zoomToTradeByTime: (entryTime: string, exitTime: string) => void;
  zoomToTradeByIndex: (startIdx: number, endIdx: number, total: number) => void;
}

function parseTimeToHHMM(isoTime: string): string {
  if (isoTime.includes("T")) return isoTime.split("T")[1].substring(0, 5);
  if (isoTime.includes(" ")) return isoTime.split(" ")[1].substring(0, 5);
  return isoTime.substring(0, 5);
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

        const total = times.length;
        const { start, end } = computeZoomRange(entryIdx, exitIdx, total);
        const startPct = (start / total) * 100;
        const endPct = ((end + 1) / total) * 100;

        chartInstance.current.dispatchAction({
          type: "dataZoom",
          dataZoomIndex: 0,
          start: startPct,
          end: endPct,
        });
        chartInstance.current.dispatchAction({
          type: "dataZoom",
          dataZoomIndex: 1,
          start: startPct,
          end: endPct,
        });
      }, 100);
    },
    [chartInstance],
  );

  const zoomToTradeByIndex = useCallback(
    (startIdx: number, endIdx: number, total: number) => {
      setTimeout(() => {
        if (!chartInstance.current) return;
        const { start, end } = computeZoomRange(startIdx, endIdx, total);
        const startPct = (start / total) * 100;
        const endPct = ((end + 1) / total) * 100;
        chartInstance.current.dispatchAction({
          type: "dataZoom",
          dataZoomIndex: 0,
          start: startPct,
          end: endPct,
        });
        chartInstance.current.dispatchAction({
          type: "dataZoom",
          dataZoomIndex: 1,
          start: startPct,
          end: endPct,
        });
      }, 150);
    },
    [chartInstance],
  );

  return { allTimesRef, zoomToTradeByTime, zoomToTradeByIndex };
}
