/**
 * Sector Dashboard Types
 */

export interface SectorItem {
  sector: string;
  avg_change: number;
  stock_count: number;
  advances: number;
  declines: number;
  avg_rsi: number;
  avg_adx: number;
  top_movers: string;
}

export interface StockMover {
  symbol: string;
  change: number;
  prev_change?: number;
  delta?: number;
}

export interface SectorResponse {
  sectors: SectorItem[];
  top_stock_movers: StockMover[];
  last_updated: string;
  market: string;
}

export interface SectorState {
  data: SectorResponse | null;
  loading: boolean;
  error: string | null;
  market: "india" | "america";
}
