export interface UnifiedCandle {
  time: string;
  date?: string;
  time_str?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface UnifiedTrade {
  id: number;
  entry_price: number;
  exit_price?: number;
  entry_time: string;
  exit_time?: string;
  exit_reason?: string;
  quantity: number;
  side?: "BUY" | "SELL";
  pnl?: number;
  costs?: number;
  stop_loss?: number;
  take_profit?: number;
  candle_idx?: number;
  exit_candle_idx?: number;
}

export interface UnifiedOverlay {
  id: string;
  label: string;
  type: "line" | "box";
  color: string;
  dash?: number[];
  levels: { date?: string; value: number }[];
  showLabel?: boolean;
}

export interface UnifiedLivePosition {
  entry_price: number;
  entry_time?: string;
  side: "BUY" | "SELL";
  stop_loss: number;
  take_profit: number;
  current_price?: number;
  pnl?: number;
  pnl_pct?: number;
  quantity?: number;
}

export interface MarkLineData {
  yAxis: number;
  lineStyle: { color: string; type: string; width: number };
  label: { position: string; formatter: string };
  /** Opt-in: when the chart sets `fitMarkLines`, only lines with this flag
   *  widen the price scale. Keeps far-away reference walls from squashing the
   *  candles while still making actionable levels (e.g. GEX) visible. */
  includeInScale?: boolean;
}

/** Horizontal price zone rendered as a shaded rectangle on the chart. */
export interface PriceAreaData {
  from: number;
  to: number;
  color: string;
  borderColor?: string;
  label?: string;
}

export interface MarkAreaItem {
  from: string;
  to: string;
  fromY?: number;
  toY?: number;
  color: string;
}

export interface ChartInput {
  candles: UnifiedCandle[];
  trades: UnifiedTrade[];
  overlays: UnifiedOverlay[];
  emaData?: { label: string; color: string; data: (number | null)[] }[];
  rsiData?: { period: number; data: (number | null)[] };
  livePosition?: UnifiedLivePosition;
  markLines?: MarkLineData[];
  markAreas?: MarkAreaItem[];
  showVolume: boolean;
  showDataZoomSlider: boolean;
  showLegend: boolean;
  title?: string;
  highlightedTradeId?: number | null;
  showAllTrades?: boolean;
  holidays?: MarketHoliday[];
  isDark: boolean;
}

export interface MarkerConfig {
  name: string;
  filter: (trade: UnifiedTrade) => boolean;
  color: string;
  symbol: string;
  size: number;
  rotate?: number;
}

export interface ChartColors {
  bgColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  gridLineColor: string;
}

/** Visible-bars price range (the rendered candle window) used as the floor for
 *  autoscale math. The axis must always cover this range — never a tight
 *  last-price-anchored slice of it. */
export interface VisibleBarsRange {
  low: number;
  high: number;
}

/** A level may widen the price scale only when it sits within ±this fraction
 *  of spot (≈±136 pts at a 22,690 spot) or inside the visible bars' range
 *  ±`AUTOSCALE_RANGE_PAD_PCT`. Far levels stay drawn as edge badges. */
export const AUTOSCALE_LEVEL_PCT = 0.006;

/** Extra band around the visible candle range, as a fraction of that range,
 *  that still counts as "visible" for scale purposes (i.e. ±5%). */
export const AUTOSCALE_RANGE_PAD_PCT = 0.05;

/** Upper bound on the final visible span, as a multiple of the visible bars'
 *  span. Level extensions may widen the axis to at most 1.3× the bars' range
 *  — beyond that the extra budget is clamped, never the bars themselves. */
export const AUTOSCALE_MAX_SPAN_FACTOR = 1.3;

export interface MarketHoliday {
  date: string;
  description: string;
  type: string;
}
