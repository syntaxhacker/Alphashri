import { useEffect, useRef } from "react";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { useStoreSubscription } from "./useStoreSubscription";
import {
  getBacktestState,
  subscribe,
  setSelectedStrategy,
  setSelectedVariation,
  setSelectedSymbols,
  setDays,
  setIncludeCosts,
  setParamsKeepVariation,
} from "../state/backtest";
import { getStrategyDefaults } from "../config/backtestDefaults";

const DEFAULT_STRATEGY = "orb";
const DEFAULT_DAYS = 180;
const URL_PARAM_KEY = "p";

const KEY_MAP: Record<string, string> = {
  strategy: "s",
  variation: "v",
  symbols: "y",
  days: "d",
  includeCosts: "c",
  params: "r",
};

const KEY_MAP_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(KEY_MAP).map(([k, v]) => [v, k]),
);

const PARAM_KEY_MAP: Record<string, string> = {
  entry_threshold_pct: "et",
  sl_pct: "sl",
  tp_pct: "tp",
  stop_loss_pct: "sl",
  take_profit_pct: "tp",
  trailing_stop_pct: "ts",
  trailing_activation_pct: "ta",
  max_holding_days: "mh",
  cooldown_days: "cd",
  trade_size: "sz",
  cooldown_bars: "cb",
  enable_shorts: "es",
  enable_filters: "ef",
  enable_trailing_stop: "et2",
  or_minutes: "om",
  breakout_buffer_pct: "bb",
  pivot_type: "pt",
  max_positions: "mp",
  ema_fast_period: "ef2",
  ema_slow_period: "es2",
  timeframe: "tf",
};

const PARAM_KEY_MAP_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(PARAM_KEY_MAP).map(([k, v]) => [v, k]),
);

export type BacktestConfigPayload = {
  strategy?: string;
  variation?: string;
  symbols?: string[];
  days?: number;
  includeCosts?: boolean;
  params?: Record<string, number | string | boolean>;
};

export type BacktestConfigInput = {
  selectedStrategy: string;
  selectedVariation: string | null;
  selectedSymbols: string[];
  days: number;
  includeCosts: boolean;
  params: Record<string, number | string | boolean>;
};

function shortenKeys(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    const short = KEY_MAP[k];
    if (short) {
      out[short] = k === "params" && typeof v === "object" ? shortenParamKeys(v) : v;
    }
  }
  return out;
}

function shortenParamKeys(params: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    out[PARAM_KEY_MAP[k] || k] = v;
  }
  return out;
}

function expandKeys(obj: Record<string, any>): BacktestConfigPayload {
  const out: BacktestConfigPayload = {};
  for (const [k, v] of Object.entries(obj)) {
    const full = KEY_MAP_REVERSE[k];
    if (!full) continue;
    if (full === "params" && typeof v === "object") {
      out.params = expandParamKeys(v);
    } else {
      (out as any)[full] = v;
    }
  }
  return out;
}

function expandParamKeys(params: Record<string, any>): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    out[PARAM_KEY_MAP_REVERSE[k] || k] = v;
  }
  return out;
}

export function encodeConfig(payload: BacktestConfigPayload): string {
  const shortened = shortenKeys(payload as any);
  const json = JSON.stringify(shortened);
  return compressToEncodedURIComponent(json);
}

export function decodeConfig(encoded: string): BacktestConfigPayload | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    return expandKeys(JSON.parse(json));
  } catch {
    return null;
  }
}

export function configToPayload(state: BacktestConfigInput): BacktestConfigPayload {
  const p: BacktestConfigPayload = {};

  if (state.selectedVariation) {
    p.variation = state.selectedVariation;
  }
  if (state.selectedSymbols.length > 0) {
    p.symbols = state.selectedSymbols;
  }
  if (state.days !== DEFAULT_DAYS) {
    p.days = state.days;
  }
  if (!state.includeCosts) {
    p.includeCosts = false;
  }

  const defaults = getStrategyDefaults(state.selectedStrategy);
  const nonDefaultParams: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(state.params)) {
    if (value !== defaults[key]) {
      nonDefaultParams[key] = value;
    }
  }
  const hasNonDefaultParams = Object.keys(nonDefaultParams).length > 0;
  if (hasNonDefaultParams) {
    p.params = nonDefaultParams;
  }

  if (state.selectedStrategy && state.selectedStrategy !== DEFAULT_STRATEGY) {
    p.strategy = state.selectedStrategy;
  } else if (hasNonDefaultParams) {
    p.strategy = state.selectedStrategy;
  }

  return p;
}

export function payloadToUrl(payload: BacktestConfigPayload): string | null {
  if (Object.keys(payload).length === 0) return null;
  return `${URL_PARAM_KEY}=${encodeConfig(payload)}`;
}

export function urlToPayload(searchParams: URLSearchParams): BacktestConfigPayload | null {
  const encoded = searchParams.get(URL_PARAM_KEY);
  if (!encoded) return null;
  return decodeConfig(encoded);
}

export function useBacktestQueryParams() {
  useStoreSubscription(subscribe);
  const state = getBacktestState();
  const pendingPayload = useRef<BacktestConfigPayload | null>(null);
  const syncDone = useRef(false);

  useEffect(() => {
    if (syncDone.current) return;
    const searchParams = new URLSearchParams(window.location.search);
    const payload = urlToPayload(searchParams);
    if (!payload) {
      syncDone.current = true;
      return;
    }
    pendingPayload.current = payload;
  }, []);

  useEffect(() => {
    if (syncDone.current || !pendingPayload.current) return;
    if (state.variations.length === 0) return;
    const payload = pendingPayload.current;

    if (payload.variation) {
      setSelectedVariation(payload.variation);
    } else if (payload.strategy) {
      const s = getBacktestState();
      const template = s.variations.find(
        (v) =>
          v.is_template && v.strategy_type.toLowerCase() === (payload.strategy || "").toLowerCase(),
      );
      if (template) {
        setSelectedVariation(template.id);
      } else {
        setSelectedStrategy(payload.strategy);
      }
    }
    if (payload.symbols) {
      setSelectedSymbols(payload.symbols);
    }
    if (payload.days !== undefined) {
      setDays(payload.days);
    }
    if (payload.includeCosts !== undefined) {
      setIncludeCosts(payload.includeCosts);
    }
    if (payload.params) {
      const overrides: Record<string, number | string | boolean> = {};
      for (const [key, value] of Object.entries(payload.params)) {
        overrides[key] = value;
      }
      if (Object.keys(overrides).length > 0) {
        setParamsKeepVariation(overrides);
      }
    }
    syncDone.current = true;
    pendingPayload.current = null;
  }, [state.variations.length]);

  useEffect(() => {
    if (!syncDone.current) return;
    const id = setTimeout(() => {
      const currentState = getBacktestState();
      const payload = configToPayload(currentState);
      const qs = payloadToUrl(payload);
      const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      const fullNewUrl = `${window.location.origin}${newUrl}`;
      const currentHref = window.location.href;
      if (currentHref !== fullNewUrl) {
        window.history.replaceState(null, "", newUrl);
      }
    }, 50);
    return () => clearTimeout(id);
  }, [
    syncDone.current,
    state.selectedStrategy,
    state.selectedVariation,
    state.selectedSymbols,
    state.days,
    state.includeCosts,
    state.params,
  ]);
}
