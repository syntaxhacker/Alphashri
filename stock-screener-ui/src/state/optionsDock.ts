/**
 * Options dock store (app-wide, one per browser tab).
 *
 * Contract the UI depends on:
 *  - `open(symbol)` costs exactly two requests (E1 listing + E2 chain);
 *  - `setExpiry()` costs one (the cached frame paints immediately, the refresh
 *    is still issued so the numbers are live);
 *  - a leg change costs none — `optionsMath` is pure over the in-memory frame.
 *
 * Polling is 10 s for a focused (visible) tab, 30 s for a background one, and
 * does not run at all outside the derivatives session: a closed market's last
 * print *is* the truth, so re-reading it every 10 s only spends the Upstox
 * `options` slice.
 */

import { createStore, produce, unwrap } from "solid-js/store";
import {
  OptionDockError,
  fetchChain,
  fetchUnderlying,
  type ChainRow,
  type DockExpiry,
  type OptionDockChain,
  type UnderlyingInfo,
} from "../api/optionsDock";
import { pickDefaultExpiry, type OptionLeg } from "../utils/optionsMath";
import { isDerivativesOpenIst } from "../utils/marketClock";

export const FOCUSED_POLL_MS = 10_000;
export const BACKGROUND_POLL_MS = 30_000;
/** Distinct `(symbol, expiry)` frames kept in memory. */
export const MAX_FRAMES = 3;
/** Distinct symbols tracked as open; the oldest stops polling first. */
export const MAX_OPEN_SYMBOLS = 5;
export const MAX_LEGS = 4;
export const DEFAULT_RATE_LIMIT_RETRY_MS = 8_000;
const MAX_PERSISTED_SYMBOLS = 20;

export type OptionsDockMode = "chart" | "options";
export type OptionsDockStatus = "idle" | "loading" | "ready" | "error" | "empty";

/** A leg the user owns: the pure-maths shape plus the contract it belongs to. */
export interface DockLeg extends OptionLeg {
  /** Stable identity for `remove`/`lots`/`side` — expiry + type + strike. */
  key: string;
  expiry: string;
}

export interface NewDockLeg {
  side: OptionLeg["side"];
  type: OptionLeg["type"];
  strike: number;
  premium: number;
  lots?: number;
  lotSize?: number;
  expiry?: string;
}

export interface OptionsDockPause {
  retryAfterMs: number;
  reason: "rate_limited";
}

export interface OptionsDockState {
  symbol: string | null;
  mode: OptionsDockMode;
  expiries: DockExpiry[];
  expiry: string | null;
  chain: OptionDockChain | null;
  legs: DockLeg[];
  status: OptionsDockStatus;
  error: { kind: string; message: string } | null;
  asOf: string | null;
  underlying: UnderlyingInfo | null;
  /** Non-null while a 429 has paused refreshing; the last frame stays painted. */
  paused: OptionsDockPause | null;
  refreshing: boolean;
}

function createInitialState(): OptionsDockState {
  return {
    symbol: null,
    mode: "chart",
    expiries: [],
    expiry: null,
    chain: null,
    legs: [],
    status: "idle",
    error: null,
    asOf: null,
    underlying: null,
    paused: null,
    refreshing: false,
  };
}

export const [optionsDockState, setOptionsDockState] = createStore<OptionsDockState>(createInitialState());

/* ------------------------------------------------------------------ */
/* Frame cache + open-symbol LRU                                       */
/* ------------------------------------------------------------------ */

const frameCache = new Map<string, OptionDockChain>();
const openSymbols: string[] = [];

const frameKey = (symbol: string, expiry: string) => `${symbol}|${expiry}`;

function rememberFrame(symbol: string, expiry: string, chain: OptionDockChain): void {
  const key = frameKey(symbol, expiry);
  frameCache.delete(key);
  frameCache.set(key, chain);
  while (frameCache.size > MAX_FRAMES) {
    const oldest = frameCache.keys().next().value as string | undefined;
    if (oldest == null) break;
    frameCache.delete(oldest);
  }
}

function touchSymbol(symbol: string): void {
  const at = openSymbols.indexOf(symbol);
  if (at >= 0) openSymbols.splice(at, 1);
  openSymbols.push(symbol);
  while (openSymbols.length > MAX_OPEN_SYMBOLS) openSymbols.shift();
}

/** Test/introspection hooks — no UI reads these. */
export const __frames = frameCache;
export const __openSymbols = openSymbols;

/* ------------------------------------------------------------------ */
/* Leg persistence                                                      */
/* ------------------------------------------------------------------ */

const LEGS_PREFIX = "options.legs.v1.";
const LEGS_INDEX = "options.legs.v1.index";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isDockLeg(value: unknown): value is DockLeg {
  if (!value || typeof value !== "object") return false;
  const leg = value as Record<string, unknown>;
  return (
    (leg.side === "buy" || leg.side === "sell") &&
    (leg.type === "CE" || leg.type === "PE") &&
    typeof leg.strike === "number" &&
    typeof leg.premium === "number" &&
    typeof leg.lots === "number" &&
    typeof leg.lotSize === "number" &&
    typeof leg.expiry === "string"
  );
}

export function loadPersistedLegs(symbol: string): DockLeg[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(LEGS_PREFIX + symbol.toUpperCase());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isDockLeg)
      .slice(0, MAX_LEGS)
      .map((leg) => ({ ...leg, key: legKey(leg) }));
  } catch {
    return [];
  }
}

function persistLegs(symbol: string | null, legs: DockLeg[]): void {
  const store = storage();
  if (!symbol || !store) return;
  try {
    const upper = symbol.toUpperCase();
    if (legs.length === 0) store.removeItem(LEGS_PREFIX + upper);
    else store.setItem(LEGS_PREFIX + upper, JSON.stringify(legs.map(({ key: _key, ...rest }) => rest)));

    const index = new Set<string>();
    try {
      const parsed: unknown = JSON.parse(store.getItem(LEGS_INDEX) ?? "[]");
      if (Array.isArray(parsed)) for (const item of parsed) if (typeof item === "string") index.add(item);
    } catch {
      // A corrupt index is not worth failing a leg edit over.
    }
    if (legs.length === 0) index.delete(upper);
    else index.add(upper);
    const trimmed = [...index].slice(-MAX_PERSISTED_SYMBOLS);
    store.setItem(LEGS_INDEX, JSON.stringify(trimmed));
  } catch {
    // Quota or a disabled storage surface: legs still work in memory.
  }
}

function legKey(leg: { expiry: string; type: string; strike: number }): string {
  return `${leg.expiry}|${leg.type}|${leg.strike}`;
}

/* ------------------------------------------------------------------ */
/* Requests, abort, polling                                            */
/* ------------------------------------------------------------------ */

interface Flight {
  controller: AbortController;
  key: string;
}

let flight: Flight | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

function cancelFlight(): void {
  if (flight) {
    flight.controller.abort();
    flight = null;
  }
}

function clearPoll(): void {
  if (pollTimer != null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function derivativesSessionOpen(): boolean {
  if (typeof window !== "undefined" && (window as any).__E2E_MOCK_MARKET_OPEN__) return true;
  if (optionsDockState.underlying?.marketState === "closed") return false;
  return isDerivativesOpenIst(new Date());
}

function pollDelay(): number {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return BACKGROUND_POLL_MS;
  return FOCUSED_POLL_MS;
}

function schedulePoll(): void {
  clearPoll();
  if (!optionsDockState.symbol || !optionsDockState.expiry) return;
  if (!derivativesSessionOpen()) return;
  if (optionsDockState.paused) return;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void refresh();
  }, pollDelay());
}

const statusError = (error: unknown): { kind: string; message: string } => {
  if (error instanceof OptionDockError) return { kind: error.kind, message: error.message };
  if (error instanceof Error) return { kind: "unknown", message: error.message };
  return { kind: "unknown", message: "Could not load the option chain" };
};

/* ------------------------------------------------------------------ */
/* Chain reconciliation                                                */
/* ------------------------------------------------------------------ */

const LEG_NUMBER_FIELDS = [
  "ltp", "oi", "prevOi", "volume", "iv", "delta",
  "gamma", "theta", "vega", "pop", "bid", "ask",
] as const;

/**
 * Patch a frame field by field instead of replacing the objects, so a 10 s tick
 * only re-runs the cells whose number actually moved. Falls back to a fresh
 * frame whenever the shape changed (expiry roll, strike set edit).
 */
function applyChain(next: OptionDockChain): void {
  const prev = optionsDockState.chain;
  const sameShape =
    prev != null &&
    prev.expiry === next.expiry &&
    prev.rows.length === next.rows.length &&
    prev.rows.every((row, i) => row.strike === next.rows[i].strike);

  if (!sameShape) {
    setOptionsDockState("chain", next);
    setOptionsDockState("asOf", next.asOf);
    return;
  }

  for (let i = 0; i < next.rows.length; i += 1) {
    patchLeg(i, "ce", prev!.rows[i].ce, next.rows[i].ce);
    patchLeg(i, "pe", prev!.rows[i].pe, next.rows[i].pe);
  }
  if (prev!.spot !== next.spot) setOptionsDockState("chain", "spot", next.spot);
  if (prev!.pcr !== next.pcr) setOptionsDockState("chain", "pcr", next.pcr);
  if (prev!.atmIv !== next.atmIv) setOptionsDockState("chain", "atmIv", next.atmIv);
  if (prev!.spotChangePct !== next.spotChangePct) {
    setOptionsDockState("chain", "spotChangePct", next.spotChangePct);
  }
  if (prev!.asOf !== next.asOf) {
    setOptionsDockState("chain", "asOf", next.asOf);
    setOptionsDockState("asOf", next.asOf);
  }
}

type LegSide = ChainRow["ce"];
type Field = (typeof LEG_NUMBER_FIELDS)[number];

function patchLeg(
  index: number,
  side: "ce" | "pe",
  prev: LegSide,
  next: LegSide,
): void {
  for (const field of LEG_NUMBER_FIELDS as readonly Field[]) {
    if (prev[field] !== next[field]) {
      setOptionsDockState("chain", "rows", index, side, field, next[field]);
    }
  }
  if (prev.instrumentKey !== next.instrumentKey) {
    setOptionsDockState("chain", "rows", index, side, "instrumentKey", next.instrumentKey);
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function setLegs(legs: DockLeg[]): void {
  setOptionsDockState("legs", legs);
  persistLegs(optionsDockState.symbol, legs);
}

/**
 * Open the dock on `symbol`. `mode` only decides which surface the host shows;
 * the chain is fetched regardless because the Options tab is the reason the
 * user clicked the icon.
 */
export function open(symbol: string, mode: OptionsDockMode = "options"): void {
  const upper = String(symbol ?? "").trim().toUpperCase();
  if (!upper) return;

  const sameSymbol = optionsDockState.symbol === upper;
  cancelFlight();
  clearPoll();
  generation += 1;
  const token = generation;

  touchSymbol(upper);
  setOptionsDockState(
    produce((state) => {
      state.symbol = upper;
      state.mode = mode;
      state.error = null;
      state.paused = null;
      state.refreshing = false;
      if (!sameSymbol) {
        state.expiries = [];
        state.expiry = null;
        state.chain = null;
        state.asOf = null;
        state.underlying = null;
        state.legs = loadPersistedLegs(upper);
      }
      state.status = state.chain ? "ready" : "loading";
    }),
  );

  const controller = new AbortController();
  flight = { controller, key: `${upper}|listing` };

  void (async () => {
    let listing: UnderlyingInfo | null = null;
    try {
      listing = await fetchUnderlying(upper, controller.signal);
    } catch (error) {
      if (controller.signal.aborted || token !== generation) return;
      flight = null;
      const failure = statusError(error);
      setOptionsDockState({ status: "error", error: failure, refreshing: false });
      return;
    }
    if (controller.signal.aborted || token !== generation) return;
    flight = null;
    if (!listing) return;

    const expiries = listing.expiries;
    const defaultExpiry =
      (listing.defaultExpiry && expiries.some((e) => e.date === listing!.defaultExpiry)
        ? listing.defaultExpiry
        : null) ?? pickDefaultExpiry(expiries.map((e) => e.date), new Date());

    if (!listing.fno || expiries.length === 0 || !defaultExpiry) {
      setOptionsDockState(
        produce((state) => {
          state.underlying = listing;
          state.expiries = expiries;
          state.expiry = defaultExpiry;
          state.status = "empty";
          state.error = null;
        }),
      );
      return;
    }

    setOptionsDockState(
      produce((state) => {
        state.underlying = listing;
        state.expiries = expiries;
        state.expiry = defaultExpiry;
        state.status = state.chain ? "ready" : "loading";
      }),
    );

    await loadChain(upper, defaultExpiry, "open");
  })();
}

type LoadReason = "open" | "expiry" | "refresh";

async function loadChain(symbol: string, expiry: string, reason: LoadReason): Promise<void> {
  cancelFlight();
  clearPoll();
  generation += 1;
  const token = generation;

  const cached = frameCache.get(frameKey(symbol, expiry));
  if (cached) {
    applyChain(cached);
    setOptionsDockState(produce((state) => {
      state.status = "ready";
      state.error = null;
      state.paused = null;
    }));
  } else if (reason !== "refresh") {
    setOptionsDockState(produce((state) => {
      state.chain = null;
      state.asOf = null;
      state.status = "loading";
      state.error = null;
      state.paused = null;
    }));
  }

  const controller = new AbortController();
  flight = { controller, key: frameKey(symbol, expiry) };
  setOptionsDockState("refreshing", true);

  let chain: OptionDockChain | null = null;
  try {
    chain = await fetchChain(symbol, expiry, controller.signal);
  } catch (error) {
    if (controller.signal.aborted || token !== generation) return;
    flight = null;
    setOptionsDockState("refreshing", false);
    const failure = statusError(error);

    if (failure.kind === "rate_limited") {
      // Never blank the chain on a 429: the last frame is still the market.
      const retryAfterMs =
        (error instanceof OptionDockError ? error.retryAfterMs : null) ?? DEFAULT_RATE_LIMIT_RETRY_MS;
      setOptionsDockState(produce((state) => {
        state.paused = { retryAfterMs, reason: "rate_limited" };
        state.status = state.chain ? "ready" : "loading";
        state.error = state.chain ? null : failure;
      }));
      scheduleRetry(retryAfterMs);
      return;
    }

    setOptionsDockState(produce((state) => {
      state.status = state.chain ? "ready" : "error";
      state.error = state.chain ? null : failure;
    }));
    return;
  }

  if (controller.signal.aborted || token !== generation) return;
  flight = null;
  if (!chain) return;

  rememberFrame(symbol, expiry, chain);
  applyChain(chain);
  setOptionsDockState(produce((state) => {
    state.status = "ready";
    state.error = null;
    state.paused = null;
    state.refreshing = false;
  }));
  schedulePoll();
}

function scheduleRetry(retryAfterMs: number): void {
  clearPoll();
  if (!optionsDockState.symbol || !optionsDockState.expiry) return;
  const delay = Number.isFinite(retryAfterMs) ? Math.max(retryAfterMs, 1000) : DEFAULT_RATE_LIMIT_RETRY_MS;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    setOptionsDockState("paused", null);
    void refresh();
  }, delay);
}

/** Re-read the current frame (also the Retry action of the error state). */
export function refresh(): Promise<void> {
  const symbol = optionsDockState.symbol;
  const expiry = optionsDockState.expiry;
  if (!symbol) return Promise.resolve();
  if (!expiry) {
    open(symbol, optionsDockState.mode);
    return Promise.resolve();
  }
  setOptionsDockState("paused", null);
  return loadChain(symbol, expiry, "refresh");
}

/** Switch expiry: the cached frame paints immediately, one refresh follows. */
export function setExpiry(expiry: string): void {
  const symbol = optionsDockState.symbol;
  if (!symbol || !expiry || expiry === optionsDockState.expiry) return;
  setOptionsDockState("expiry", expiry);
  void loadChain(symbol, expiry, "expiry");
}

export function setMode(mode: OptionsDockMode): void {
  setOptionsDockState("mode", mode);
}

/** Close the dock: abort the in-flight request and stop every timer. */
export function close(): void {
  cancelFlight();
  clearPoll();
  generation += 1;
  setOptionsDockState(
    produce((state) => {
      state.symbol = null;
      state.status = "idle";
      state.error = null;
      state.paused = null;
      state.refreshing = false;
      state.chain = null;
      state.expiry = null;
      state.expiries = [];
      state.underlying = null;
      state.asOf = null;
      state.legs = [];
    }),
  );
}

function lotSizeFor(leg: NewDockLeg): number {
  if (leg.lotSize && leg.lotSize > 0) return leg.lotSize;
  const expiry = leg.expiry ?? optionsDockState.expiry;
  const info = optionsDockState.expiries.find((entry) => entry.date === expiry);
  return info?.lotSize && info.lotSize > 0 ? info.lotSize : 1;
}

/** Add a leg. No request: the payoff is pure arithmetic over the frame. */
export function addLeg(leg: NewDockLeg): boolean {
  const expiry = leg.expiry ?? optionsDockState.expiry;
  if (!expiry) return false;
  if (!Number.isFinite(leg.strike) || leg.strike <= 0) return false;
  const premium = Number.isFinite(leg.premium) ? leg.premium : 0;
  const lots = Math.max(1, Math.floor(leg.lots ?? 1));
  const next: DockLeg = {
    key: legKey({ expiry, type: leg.type, strike: leg.strike }),
    expiry,
    side: leg.side,
    type: leg.type,
    strike: leg.strike,
    premium,
    lots,
    lotSize: lotSizeFor({ ...leg, expiry }),
  };

  const existing = optionsDockState.legs.find((entry) => entry.key === next.key);
  if (existing) {
    setLegs(
      optionsDockState.legs.map((entry) =>
        entry.key === next.key ? { ...entry, side: next.side, premium: next.premium } : entry,
      ),
    );
    return true;
  }
  if (optionsDockState.legs.length >= MAX_LEGS) return false;
  setLegs([...optionsDockState.legs, next]);
  return true;
}

export function removeLeg(key: string): void {
  setLegs(optionsDockState.legs.filter((leg) => leg.key !== key));
}

export function clearLegs(): void {
  setLegs([]);
}

export function setLegLots(key: string, lots: number): void {
  const next = Math.max(1, Math.min(99, Math.floor(lots)));
  setLegs(optionsDockState.legs.map((leg) => (leg.key === key ? { ...leg, lots: next } : leg)));
}

export function toggleLegSide(key: string): void {
  setLegs(
    optionsDockState.legs.map((leg) =>
      leg.key === key ? { ...leg, side: leg.side === "buy" ? "sell" : "buy" } : leg,
    ),
  );
}

/** Legs whose expiry is not the one on screen — the LegBuilder flags them. */
export function staleLegs(): DockLeg[] {
  const expiry = optionsDockState.expiry;
  return optionsDockState.legs.filter((leg) => leg.expiry !== expiry);
}

/** Net premium in rupees: credit is positive, debit negative. */
export function netPremium(): number {
  let net = 0;
  for (const leg of optionsDockState.legs) {
    const sign = leg.side === "sell" ? 1 : -1;
    net += sign * leg.lots * leg.lotSize * leg.premium;
  }
  return net;
}

export function currentChain(): OptionDockChain | null {
  return unwrap(optionsDockState.chain);
}

/* ------------------------------------------------------------------ */
/* Visibility + teardown                                               */
/* ------------------------------------------------------------------ */

let visibilityBound = false;

function bindVisibility(): void {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (!optionsDockState.symbol) return;
    if (document.visibilityState === "hidden") {
      clearPoll();
      return;
    }
    void refresh().then(() => schedulePoll());
  });
}

bindVisibility();

/**
 * Drop every frame, timer and leg — the test suites' reset. Not part of the UI
 * contract; `close()` is what a user action calls.
 */
export function __resetOptionsDock(): void {
  cancelFlight();
  clearPoll();
  generation += 1;
  frameCache.clear();
  openSymbols.length = 0;
  setOptionsDockState(createInitialState());
}
