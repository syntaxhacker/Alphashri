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

// Sector Correlation types
export interface SectorCorrelationSector {
  name: string;
  beta_vs_index: number;
  relative_strength_5d: number;
  relative_strength_1m: number;
  relative_strength_3m: number;
  rank_current: number;
  rank_change_1m: number;
}

export interface SectorCorrelationResponse {
  sectors: SectorCorrelationSector[];
  correlation_matrix: number[][];
  sector_names: string[];
  last_updated: string;
  cached?: boolean;
}

export interface SectorState {
  data: SectorResponse | null;
  loading: boolean;
  error: string | null;
  market: "india" | "america";
}
