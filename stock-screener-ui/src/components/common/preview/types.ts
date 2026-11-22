import type { ChartPreviewData } from "../../../api/chartPreview";

/** Box passed to the chart children so both sides can (re)create/dispose the ECharts instance. */
export type ChartInstanceBox = { current: EChartsInstance | null };

export interface HoverState {
  visible: boolean;
  symbol: string | null;
  x: number;
  y: number;
  data: ChartPreviewData | null;
  loading: boolean;
  /** Transport failure message — distinct from a successful response with zero candles. */
  error: string | null;
}

export interface ExpandedState {
  visible: boolean;
  symbol: string | null;
  data: ChartPreviewData | null;
  loading: boolean;
  /** Transport failure message — distinct from a successful response with zero candles. */
  error: string | null;
  timeframe: number;
  orMinutes: number;
}

export const createHoverState = (): HoverState => ({
  visible: false,
  symbol: null,
  x: 0,
  y: 0,
  data: null,
  loading: false,
  error: null,
});

export const createExpandedState = (): ExpandedState => ({
  visible: false,
  symbol: null,
  data: null,
  loading: false,
  error: null,
  timeframe: 15,
  orMinutes: 45,
});
