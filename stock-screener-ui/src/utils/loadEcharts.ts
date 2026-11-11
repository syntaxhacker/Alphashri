/**
 * Dynamically loads ECharts once and caches it on `window`, shared by
 * `useChartInstance` and `useECharts` so the init logic isn't cloned.
 */
export async function loadEcharts(): Promise<any> {
  if ((window as any).echarts) return (window as any).echarts;
  const mod = await import("echarts");
  const lib = (mod as any).default ?? mod;
  (window as any).echarts = lib;
  return lib;
}
