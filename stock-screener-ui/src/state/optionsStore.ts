import type {
  OptionContract,
  Expiry,
  Underlying,
  Position,
  OptionChainSummary,
} from "../api/upstoxOptions";
import {
  getOptionChain,
  getUnderlyings,
  getExpiries,
  getSpotPrice,
  getPositions,
} from "../api/upstoxOptions";
import { getMoneyness } from "../utils/options";
import { createSubscriber } from "./createSubscriber";

export interface OptionsFilters {
  strikeRange: [number, number];
  optionType: "CE" | "PE" | "BOTH";
  moneyness: "ITM" | "OTM" | "ALL";
  sortBy: string;
  sortOrder: "asc" | "desc";
}

export interface OptionPosition extends Position {}

interface OptionsStore {
  selectedUnderlying: string;
  selectedExpiry: string;
  optionChain: OptionContract[];
  positions: OptionPosition[];
  loading: boolean;
  error: string | null;
  filters: OptionsFilters;
  spotPrice: number | null;
  underlyings: Underlying[];
  expiries: Expiry[];
  lastUpdated?: string;
  summary?: OptionChainSummary;
}

const defaultFilters: OptionsFilters = {
  strikeRange: [0, 1000000],
  optionType: "BOTH",
  moneyness: "ALL",
  sortBy: "strike_price",
  sortOrder: "asc",
};

const initialState: OptionsStore = {
  selectedUnderlying: "",
  selectedExpiry: "",
  optionChain: [],
  positions: [],
  loading: false,
  error: null,
  filters: defaultFilters,
  spotPrice: null,
  underlyings: [],
  expiries: [],
};

let state: OptionsStore = { ...initialState };
let initialized = false;

const { subscribe, notify } = createSubscriber();

export { subscribe };

export function getOptionsState(): OptionsStore {
  return state;
}

function setLoading(loading: boolean): void {
  state = { ...state, loading };
  notify();
}

function setError(error: string | null): void {
  state = { ...state, error };
  notify();
}

export function setUnderlying(underlying: string): void {
  state = {
    ...state,
    selectedUnderlying: underlying,
    selectedExpiry: "",
    optionChain: [],
    spotPrice: null,
    expiries: [],
  };
  notify();
  fetchExpiriesForUnderlying(underlying);
  fetchSpotPriceForUnderlying(underlying);
}

export function setExpiry(expiry: string): void {
  state = { ...state, selectedExpiry: expiry };
  notify();
}

export function setFilters(newFilters: Partial<OptionsFilters>): void {
  state = {
    ...state,
    filters: { ...state.filters, ...newFilters },
  };
  notify();
}

export function resetFilters(): void {
  state = {
    ...state,
    filters: defaultFilters,
  };
  notify();
}

export async function fetchChain(): Promise<void> {
  if (!state.selectedUnderlying || !state.selectedExpiry) {
    setError("Please select underlying and expiry");
    return;
  }

  setLoading(true);
  setError(null);

  try {
    const result = await getOptionChain(state.selectedUnderlying, state.selectedExpiry);
    const contracts: OptionContract[] = [];
    if (result.chain) {
      for (const row of result.chain) {
        if (row.ce) contracts.push(row.ce);
        if (row.pe) contracts.push(row.pe);
      }
    }
    state = {
      ...state,
      optionChain: contracts,
      spotPrice: result.spot || state.spotPrice,
      lastUpdated: result.timestamp,
      summary: result.summary,
      loading: false,
    };
    notify();
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to fetch option chain",
      loading: false,
    };
    notify();
  }
}

export async function fetchPositions(): Promise<void> {
  setLoading(true);
  setError(null);

  try {
    const result = await getPositions();
    state = {
      ...state,
      positions: result.positions || [],
      loading: false,
    };
    notify();
  } catch (error) {
    state = {
      ...state,
      positions: [],
      error: error instanceof Error ? error.message : "Failed to fetch positions",
      loading: false,
    };
    notify();
  }
}

async function fetchExpiriesForUnderlying(underlying: string): Promise<void> {
  try {
    const expiries = await getExpiries(underlying);
    state = { ...state, expiries };
    if (expiries.length > 0 && !state.selectedExpiry) {
      state = { ...state, selectedExpiry: expiries[0].date };
    }
    notify();
  } catch (error) {
    console.error("Failed to fetch expiries:", error);
  }
}

async function fetchSpotPriceForUnderlying(underlying: string): Promise<void> {
  try {
    const result = await getSpotPrice(underlying);
    state = { ...state, spotPrice: result.spot };
    notify();
  } catch (error) {
    console.error("Failed to fetch spot price:", error);
  }
}

export function getAvailableExpiries(): string[] {
  return state.expiries.map((e) => e.date);
}

export function getFilteredChain(): OptionContract[] {
  let { optionChain, filters } = state;

  optionChain = optionChain.filter(
    (c) => c.strike_price >= filters.strikeRange[0] && c.strike_price <= filters.strikeRange[1],
  );

  if (filters.optionType !== "BOTH") {
    optionChain = optionChain.filter((c) => c.instrument_type === filters.optionType);
  }

  if (filters.moneyness !== "ALL" && state.spotPrice) {
    optionChain = optionChain.filter(
      (c) =>
        getMoneyness(c.strike_price, state.spotPrice!, c.instrument_type as "CE" | "PE") ===
        filters.moneyness,
    );
  }

  optionChain.sort((a, b) => {
    const multiplier = filters.sortOrder === "asc" ? 1 : -1;
    const aVal = (a as any)[filters.sortBy];
    const bVal = (b as any)[filters.sortBy];
    return (aVal - bVal) * multiplier;
  });

  return optionChain;
}

export function getStrikeMatrix(): Array<{
  strike: number;
  ce: OptionContract | null;
  pe: OptionContract | null;
}> {
  const strikes = new Map<number, { ce: OptionContract | null; pe: OptionContract | null }>();

  for (const contract of state.optionChain) {
    const existing = strikes.get(contract.strike_price) || { ce: null, pe: null };
    if (contract.instrument_type === "CE") {
      existing.ce = contract;
    } else {
      existing.pe = contract;
    }
    strikes.set(contract.strike_price, existing);
  }

  return Array.from(strikes.entries())
    .map(([strike, data]) => ({ strike, ...data }))
    .sort((a, b) => a.strike - b.strike);
}

export async function initOptionsState(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const underlyings = await getUnderlyings();
    state = { ...state, underlyings };
    if (underlyings.length > 0) {
      const first = underlyings[0].symbol;
      state = { ...state, selectedUnderlying: first };
      notify();
      await fetchExpiriesForUnderlying(first);
      await fetchSpotPriceForUnderlying(first);
    }
    notify();
  } catch (error) {
    console.error("Failed to initialize options state:", error);
  }
}

export function getAvailableUnderlyingSymbols(): string[] {
  return state.underlyings.map((u) => u.symbol);
}

export function getUnderlyingInfo(symbol: string): Underlying | undefined {
  return state.underlyings.find((u) => u.symbol === symbol);
}
