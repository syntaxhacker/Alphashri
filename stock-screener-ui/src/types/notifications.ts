export interface PriceSurgeEvent {
  id: number;
  symbol: string;
  move_pct: number;
  direction: string;
  price: number | null;
  screener_id: string;
  screen_label: string;
  created_at: string;
}
