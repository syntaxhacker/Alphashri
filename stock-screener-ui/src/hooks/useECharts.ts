import { useRef, useEffect, useCallback } from "react";

interface UseEChartsOptions {
  isDark: boolean;
  onChartClick?: (params: any) => void;
}

interface UseEChartsReturn {
  chartRef: React.RefObject<HTMLDivElement | null>;
  chartInstance: React.MutableRefObject<any>;
  setChartOption: (option: any) => void;
}

export function useECharts(options: UseEChartsOptions): UseEChartsReturn {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const isDarkRef = useRef(options.isDark);
  const onChartClickRef = useRef(options.onChartClick);
  const { onChartClick } = options;

  isDarkRef.current = options.isDark;
  onChartClickRef.current = onChartClick;

  const setChartOption = useCallback((option: any) => {
    if (!chartRef.current) return;
    const echartsLib = (window as any).echarts;
    if (!echartsLib) return;

    if (!chartInstance.current) {
      chartInstance.current = echartsLib.init(chartRef.current, isDarkRef.current ? "dark" : null);
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
