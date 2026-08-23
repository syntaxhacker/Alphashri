import { useRef, useEffect, useCallback } from "react";

interface UseEChartsOptions {
  isDark: boolean;
  onChartClick?: (params: any) => void;
}

interface UseEChartsReturn {
  chartRef: React.RefObject<HTMLDivElement | null>;
  chartInstance: React.MutableRefObject<any>;
  setChartOption: (option: any) => Promise<void>;
}

async function loadEcharts(): Promise<any> {
  if ((window as any).echarts) return (window as any).echarts;
  const mod = await import("echarts");
  const lib = (mod as any).default ?? mod;
  (window as any).echarts = lib;
  return lib;
}

export function useECharts(options: UseEChartsOptions): UseEChartsReturn {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const isDarkRef = useRef(options.isDark);
  const onChartClickRef = useRef(options.onChartClick);
  const { onChartClick } = options;

  isDarkRef.current = options.isDark;
  onChartClickRef.current = onChartClick;

  const setChartOption = useCallback(async (option: any) => {
    if (!chartRef.current) return;
    const echartsLib = await loadEcharts();
    if (!echartsLib) return;

    if (!chartInstance.current) {
      chartInstance.current = echartsLib.init(chartRef.current, null);
      if (onChartClickRef.current) {
        chartInstance.current.on("click", onChartClickRef.current);
      }
    }

    chartInstance.current.setOption(option, true);
    chartInstance.current.resize();
  }, []);

  useEffect(() => {
    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener("resize", handleResize);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && chartRef.current) {
      ro = new ResizeObserver(() => chartInstance.current?.resize());
      ro.observe(chartRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      ro?.disconnect();
      if (chartInstance.current) {
        chartInstance.current.dispose();
        chartInstance.current = null;
      }
    };
  }, []);

  return { chartRef, chartInstance, setChartOption };
}
