import { fetchWithAuth } from "../state/auth";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

export interface OptionGreeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  iv: number;
}

export interface MarketData {
  ltp: number;
  volume: number;
  oi: number;
  bid_price: number;
  ask_price: number;
  prev_oi: number;
}

export interface OptionContract {
  instrument_key: string;
  trading_symbol: string;
  strike_price: number;
  expiry: string;
  instrument_type: string;
  lot_size?: number;
  tick_size?: number;
  weekly?: boolean;
  market_data?: MarketData;
  option_greeks?: OptionGreeks;
  sentiment?: {
    type: string;
    color: string;
    label: string;
  };
}

export interface Underlying {
  symbol: string;
  name: string;
  instrument_key: string;
  lot_size: number;
  tick_size: number;
}

export interface Expiry {
  date: string;
  weekly: boolean;
  days_to_expiry: number;
}

export interface OptionChainSummary {
  pcr: number;
  max_pain: number;
  expected_move: {
    upper: number;
    lower: number;
    range: number;
  } | null;
  total_ce_oi: number;
  total_pe_oi: number;
  dte: number;
}

export interface OptionChainResponse {
  status: string;
  underlying: string;
  expiry: string;
  spot: number;
  timestamp?: string;
  chain: Array<{
    strike: number;
    ce: OptionContract | null;
    pe: OptionContract | null;
  }>;
  summary?: OptionChainSummary;
}

export interface SpotPriceResponse {
  status: string;
  underlying: string;
  spot: number;
}

export interface Position {
  instrument_key: string;
  trading_symbol: string;
  quantity: number;
  average_price: number;
  current_price?: number;
  pnl?: number;
  option_type: "CE" | "PE";
  strike_price: number;
  expiry: string;
}

export interface PositionsResponse {
  status: string;
  positions: Position[];
}

export async function getUnderlyings(): Promise<Underlying[]> {
  const res = await fetchWithAuth(`${API_BASE}/api/options/underlyings`);
  if (!res.ok) throw new Error("Failed to fetch underlyings");
  const data = await res.json();
  return data.underlyings || [];
}

export async function getExpiries(underlying: string): Promise<Expiry[]> {
  const res = await fetchWithAuth(`${API_BASE}/api/options/expiries/${underlying}`);
  if (!res.ok) throw new Error("Failed to fetch expiries");
  const data = await res.json();
  return data.expiries || [];
}

export async function getOptionChain(
  underlying: string,
  expiryDate: string,
): Promise<OptionChainResponse> {
  const res = await fetchWithAuth(
    `${API_BASE}/api/options/chain/${underlying}?expiry=${expiryDate}`,
  );
  if (!res.ok) throw new Error("Failed to fetch option chain");
  return res.json();
}

export async function getSpotPrice(underlying: string): Promise<SpotPriceResponse> {
  const res = await fetchWithAuth(`${API_BASE}/api/options/spot/${underlying}`);
  if (!res.ok) throw new Error("Failed to fetch spot price");
  return res.json();
}

export async function getPositions(): Promise<PositionsResponse> {
  const res = await fetchWithAuth(`${API_BASE}/api/options/positions`);
  if (!res.ok) throw new Error("Failed to fetch positions");
  return res.json();
}
