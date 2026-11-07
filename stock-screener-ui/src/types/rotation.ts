export type RotationKind = "sector" | "industry" | "theme";
export type RotationPeriod = "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y";
export type RotationStatus = "booming" | "heating" | "cooling" | "dumping" | "neutral";
export type RotationQuadrant = "leading" | "weakening" | "lagging" | "improving";

export interface RotationMover {
  symbol: string;
  change: number;
}

export interface RotationRow {
  id: string;
  name: string;
  kind: RotationKind;
  slug?: string | null;
  category?: string | null;
  members: number;
  covered: number;
  returns: Record<RotationPeriod, number>;
  rs_1m: number;
  rs_1w: number;
  rs_pct: number;
  mom_pct: number;
  rank: number;
  rank_delta: number;
  breadth: number;
  rel_volume: number;
  quadrant: RotationQuadrant;
  status: RotationStatus;
  top_movers: RotationMover[];
}

export interface RotationRegime {
  benchmark: string;
  benchmark_change: number;
  benchmark_1m: number;
  vix: number | null;
  vix_change: number | null;
  breadth: number;
  label: string;
}

export interface RotationOverviewResponse {
  market: string;
  kind: RotationKind;
  period: RotationPeriod;
  benchmark: string;
  last_updated: string;
  regime: RotationRegime;
  counts: Record<RotationStatus, number>;
  rows: RotationRow[];
}

export interface ThemeDetailResponse {
  theme: {
    slug: string;
    name: string;
    category?: string | null;
    description: string;
    member_count: number;
  };
  constituents: string[];
}
