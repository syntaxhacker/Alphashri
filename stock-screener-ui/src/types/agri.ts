export interface AgriSnapshot {
  key: string;
  label: string;
  date: string;
  modal: number;   // median modal price ₹/quintal
  min: number;
  max: number;
  markets: number;
}

export interface AgriSeriesPoint {
  date: string;    // YYYY-MM-DD
  arrival: string; // DD/MM/YYYY as reported
  modal: number;
}

export interface AgriSelected {
  key: string;
  label: string;
}

export interface AgriPricesResponse {
  ok: boolean;
  source: string;
  rows_loaded: number;
  snapshot: AgriSnapshot[];
  selected: AgriSelected | null;
  series: AgriSeriesPoint[];
}

export interface AgriCommodity {
  key: string;
  label: string;
}

export interface AgriCommoditiesResponse {
  ok: boolean;
  commodities: AgriCommodity[];
}
