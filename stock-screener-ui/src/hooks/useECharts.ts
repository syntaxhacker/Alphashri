import { useEffect, useRef } from "react";

interface UseEChartsOptions {
  isDark: boolean;
  onClick?: (params: any) => void;
}

export function useECharts(
  chartRef: React.RefObject<HTMLDivElement | null>,
  option: any,
  { isDark, onClick }: UseEChartsOptions,
) {
  const chartInstance = useRef<any>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!option || (typeof option === "object" && Object.keys(option).length === 0)) return;

    const echartsLib = (window as any).echarts;
    if (!echartsLib) return;

    if (chartInstance.current) chartInstance.current.dispose();

    chartInstance.current = echartsLib.init(chartRef.current, isDark ? "dark" : null);
    chartInstance.current.setOption(option);
    chartInstance.current.resize();

    if (onClick) {
      chartInstance.current.on("click", onClick);
    }

    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener("resize", handleResize);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => chartInstance.current?.resize())
        : null;

    resizeObserver?.observe(chartRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, [option, isDark, onClick, chartRef]);

  return chartInstance;
}
