export type SectorHistoryMarket = "india" | "america";

export interface SectorHistorySeries {
  name: string;
  is_benchmark: boolean;
  monthly_returns: (number | null)[];
  ranks: (number | null)[];
}

export interface SectorHistoryRisk {
  name: string;
  max_drawdown: number | null;
  current_drawdown: number | null;
  recovery_days: number | null;
  sharpe: number | null;
  volatility: number | null;
}

export interface SectorHistorySeasonality {
  name: string;
  month: number;
  avg_return: number | null;
  hit_rate: number | null;
  n: number;
}

export interface SectorHistoryPersistenceItem {
  name: string;
  top3_months: number;
  top3_stayed: number;
  top3_persistence_pct: number | null;
  avg_next_rank: number | null;
}

export interface SectorHistoryPersistence {
  by_sector: SectorHistoryPersistenceItem[];
  transition_matrix: (number | null)[][];
  transition_n: number;
}

export interface SectorHistoryResponse {
  market: SectorHistoryMarket;
  years: number;
  cached: boolean;
  months: string[];
  as_of: string;
  last_updated: string;
  source: string;
  disclaimer: string;
  universe: string[];
  series: SectorHistorySeries[];
  risk: SectorHistoryRisk[];
  seasonality: SectorHistorySeasonality[];
  persistence: SectorHistoryPersistence;
}
