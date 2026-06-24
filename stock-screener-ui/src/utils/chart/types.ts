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

export interface MarketHoliday {
  date: string;
  description: string;
  type: string;
}
