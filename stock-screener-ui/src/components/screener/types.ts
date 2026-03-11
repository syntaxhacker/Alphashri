export interface Stock {
  symbol: string;
  score: number;
  tv_price: number;
  upstox_price: number;
  broker_diff: number;
  high_52w: number;
  to_52w_high: number;
  time_to_52w?: { days: number; confidence: "HIGH" | "MED" | "LOW" };
  recent_return_5d: number;
  perf_w: number;
  sector: string;
  touched_52w: boolean;
  day_change?: number;
  rsi?: number;
  stoch_k?: number;
  wick_close_pct?: number;
  volume_surge?: number;
  atr_pct?: number;
  adx?: number;
  interest_score?: number;
  gap_pct?: number;
  premarket_change?: number;
  impact_score?: number;
  market_cap_b?: number;
  volume_m?: number;
  reversal_signal?: string;
  rationale?: string;
  is_bullish?: boolean;
  sentiment?: "bullish" | "lean_bull" | "neutral" | "lean_bear" | "bearish";
  [key: string]: any;
}

export interface SummaryItem {
  label: string;
  value: string | number;
  color?: string;
}

export interface ProfileFilter {
  key: string;
  label: string;
  type: "number" | "select";
  min?: number;
  max?: number;
  step?: number;
  default?: number | string;
  options?: string[];
}

export interface ProfileMeta {
  section_labels?: { primary: string; secondary: string };
  filters?: ProfileFilter[];
  default_sort?: { column: string; direction: "asc" | "desc" };
}

export interface ScreenerData {
  approaching: Stock[];
  touched: Stock[];
  last_updated: string;
  provider: string;
  mode: string;
  screener: string;
  profile_meta?: ProfileMeta;
  summary?: SummaryItem[];
  demo_mode?: boolean;
}

export interface Filters {
  minScore: number;
  maxPrice: number;
  minReturn: number;
  sector: string;
  [key: string]: any;
}

export interface ScreenerOption {
  id: string;
  label: string;
  description?: string;
}

export interface ChangeNotification {
  id: number;
  ts: string;
  title: string;
  detail: string;
  kind: "primary" | "secondary";
}

export type NotifFilter = "all" | "primary" | "secondary";

export type SortDirection = "asc" | "desc";

export interface ProfileFilterDef {
  key: string;
  label: string;
  type: "number" | "select";
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
}

export interface ColumnDef {
  key: string;
  label: string;
  width?: number;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  format?: (value: any, stock: Stock) => React.ReactNode;
}

export interface ScreenerPageProps {
  screenerOptions: ScreenerOption[];
  activeScreener: string;
  onScreenerChange: (id: string) => void;

  title: string;
  status: string;
  isLoading: boolean;
  autoRefreshSeconds: number;
  provider: string;
  mode: string;
  onRefresh: () => void;
  onAutoRefreshChange: (value: number) => void;
  onProviderChange: (value: string) => void;
  onModeChange: (value: string) => void;

  filters: Filters;
  sectors: string[];
  profileFilters?: ProfileFilterDef[];
  onFilterChange: (key: string, value: any) => void;
  onResetFilters: () => void;

  stocks: Stock[];
  touchedSymbols: Set<string>;
  summary?: SummaryItem[];

  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;

  error?: string | null;
}

export interface ScreenerNavProps {
  options: ScreenerOption[];
  activeScreener: string;
  onChange: (id: string) => void;
}

export interface ScreenerHeaderProps {
  title: string;
  status: string;
  isLoading: boolean;
  autoRefreshSeconds: number;
  provider: string;
  mode: string;
  onRefresh: () => void;
  onAutoRefreshChange: (value: number) => void;
  onProviderChange: (value: string) => void;
  onModeChange: (value: string) => void;
}

export interface ScreenerFiltersProps {
  minScore: number;
  maxPrice: number;
  minReturn: number;
  sector: string;
  sectors: string[];
  profileFilters?: ProfileFilterDef[];
  profileFilterValues: Record<string, any>;
  onFilterChange: (key: string, value: any) => void;
  onReset: () => void;
}

export interface ScreenerSummaryProps {
  summary: SummaryItem[];
}

export interface ScreenerTableProps {
  stocks: Stock[];
  columns: ColumnDef[];
  touchedSymbols: Set<string>;
  sortColumn: string | null;
  sortDirection: SortDirection;
  onSortChange: (column: string) => void;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
}

export interface StockRowProps {
  stock: Stock;
  columns: ColumnDef[];
  isTouched: boolean;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
}

export interface ScreenerEmptyProps {
  message?: string;
}

export interface ScreenerLoadingProps {
  message?: string;
}

export interface TradingListProps {
  symbols: string[];
  title?: string;
}
