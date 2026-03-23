export type {
  Stock,
  SummaryItem,
  ProfileFilter,
  ProfileMeta,
  ScreenerData,
  ScreenerOption,
  ChangeNotification,
  NotifFilter,
  SortDirection,
} from "../../types";

import type { Stock, SummaryItem, SortDirection } from "../../types";

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
