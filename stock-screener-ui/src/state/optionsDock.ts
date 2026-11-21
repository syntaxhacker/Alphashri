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
  type OptionChainLevels,
  type OptionDockChain,
  type UnderlyingInfo,
} from "../api/optionsDock";
import { pickDefaultExpiry, type OptionLeg } from "../utils/optionsMath";
import {
  STRATEGY_PRESETS,
  buildPreset,
  type ChainRow as StrategyChainRow,
  type StrategyContext,
} from "../utils/optionsStrategies";
import { isDerivativesOpenIst } from "../utils/marketClock";

const FOCUSED_POLL_MS = 10_000;
const BACKGROUND_POLL_MS = 30_000;
/** Distinct `(symbol, expiry)` frames kept in memory. */
const MAX_FRAMES = 3;
/** Distinct symbols tracked as open; the oldest stops polling first. */
const MAX_OPEN_SYMBOLS = 5;
export const MAX_LEGS = 4;
export const DEFAULT_RATE_LIMIT_RETRY_MS = 8_000;
const MAX_PERSISTED_SYMBOLS = 20;

type OptionsDockMode = "chart" | "options";
type OptionsDockStatus = "idle" | "loading" | "ready" | "error" | "empty";

/** A leg the user owns: the pure-maths shape plus the contract it belongs to. */
export interface DockLeg extends OptionLeg {
  /** Stable identity for `remove`/`lots`/`side` — expiry + type + strike. */
  key: string;
  expiry: string;
  /** Built by an active preset (true) or hand-picked (false). Only preset legs
   * get their premium re-read from the chain on a same-shape tick. Optional for
   * legacy/consumer compatibility — a missing flag means hand-picked. */
  fromPreset?: boolean;
}

interface NewDockLeg {
  side: OptionLeg["side"];
  type: OptionLeg["type"];
  strike: number;
  premium: number;
  lots?: number;
  lotSize?: number;
  expiry?: string;
}

interface OptionsDockPause {
  retryAfterMs: number;
  /** Wall-clock deadline, so the countdown can tick instead of repeating the
   * first 429's `retryAfterMs` forever. */
  retryAt: number;
  reason: "rate_limited";
}

interface OptionsDockState {
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
  /** Strategy whose legs are auto-built from the chain, `null` for hand-picked. */
  activePreset: string | null;
  /** Set when an active preset could not be rebuilt against the current chain. */
  presetUnavailable: boolean;
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
    activePreset: null,
    presetUnavailable: false,
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

function loadPersistedLegs(symbol: string): DockLeg[] {
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
      // Persisted legs are always hand-picked; `activePreset` is not restored.
      .map((leg) => ({ ...leg, key: legKey(leg), fromPreset: false }));
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

/**
 * The listing (E1) and the chain (E2) are separate flights. A single shared
 * controller let an expiry switch abort the in-flight listing, leaving the dock
 * with no expiries but a chain for a date the backend never listed.
 */
let listingController: AbortController | null = null;
let chainController: AbortController | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Set while the chain is off screen (the pillars view). A tick that lands after
 * the suspend must not re-arm the timer, otherwise the "hidden" chain keeps
 * spending the options slice through `schedulePoll`'s tail.
 */
let pollSuspended = false;
/** Session token: bumped only by `open`/`close`, so an async continuation from a
 * closed or superseded session cannot write into the new one. */
let generation = 0;
/** Incremented on every chain load; distinguishes a superseded chain request
 * from the one that currently owns the panel (generation stays put for an
 * expiry switch). */
let chainRequestId = 0;

function abortListing(): void {
  if (listingController) {
    listingController.abort();
    listingController = null;
  }
}

function abortChain(): void {
  if (chainController) {
    chainController.abort();
    chainController = null;
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
  if (pollSuspended) return;
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
 * The levels block is a small value object: patch it as a whole only when its
 * contents actually changed, so a flat tick does not repaint every badge.
 */
function levelsEqual(a: OptionChainLevels | null | undefined, b: OptionChainLevels | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

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
    rebuildPresetForNewFrame();
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
  if (!levelsEqual(prev!.levels, next.levels)) {
    setOptionsDockState("chain", "levels", next.levels ?? null);
  }
  repricePresetLegs();
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
  // A new session owns both flights; an expiry switch (which stays in this
  // session) never aborts the listing.
  abortListing();
  abortChain();
  clearPoll();
  // A new session always polls; a suspend belongs to the last view, not the symbol.
  pollSuspended = false;
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
        // Persisted legs are hand-picked, not preset output.
        state.activePreset = null;
        state.presetUnavailable = false;
      }
      state.status = state.chain ? "ready" : "loading";
    }),
  );

  const controller = new AbortController();
  listingController = controller;

  void (async () => {
    let listing: UnderlyingInfo | null = null;
    try {
      listing = await fetchUnderlying(upper, controller.signal);
    } catch (error) {
      if (token !== generation || controller.signal.aborted) return;
      listingController = null;
      const failure = statusError(error);
      setOptionsDockState({ status: "error", error: failure, refreshing: false });
      return;
    }
    if (token !== generation || controller.signal.aborted) return;
    listingController = null;
    if (!listing) {
      setOptionsDockState({
        status: "error",
        error: { kind: "upstream", message: "Could not load the option listing" },
        refreshing: false,
      });
      return;
    }

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

    await loadChain(upper, defaultExpiry, "open", token);
  })();
}

type LoadReason = "open" | "expiry" | "refresh";

/**
 * E2. `token` is the session generation captured by the caller: `loadChain`
 * never mints one, so switching expiry or refreshing cannot invalidate the
 * listing that launched this session. Requests within a session are superseded
 * by `chainRequestId` instead.
 */
async function loadChain(
  symbol: string,
  expiry: string,
  reason: LoadReason,
  token: number,
): Promise<void> {
  if (token !== generation) return;
  // Only ever abort the chain — the listing belongs to `open()`.
  abortChain();
  clearPoll();
  const reqId = ++chainRequestId;
  const current = () => token === generation && reqId === chainRequestId;

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
  chainController = controller;
  setOptionsDockState("refreshing", true);

  let chain: OptionDockChain | null = null;
  try {
    chain = await fetchChain(symbol, expiry, controller.signal);
  } catch (error) {
    // A superseded load must not write: the newer request owns the panel and
    // will land its own terminal status.
    if (!current() || controller.signal.aborted) return;
    chainController = null;
    setOptionsDockState("refreshing", false);
    const failure = statusError(error);

    if (failure.kind === "rate_limited") {
      // Never blank the chain on a 429: the last frame is still the market.
      const retryAfterMs =
        (error instanceof OptionDockError ? error.retryAfterMs : null) ?? DEFAULT_RATE_LIMIT_RETRY_MS;
      setOptionsDockState(produce((state) => {
        state.paused = { retryAfterMs, retryAt: Date.now() + retryAfterMs, reason: "rate_limited" };
        state.status = state.chain ? "ready" : "error";
        state.error = state.chain ? null : failure;
      }));
      scheduleRetry(retryAfterMs);
      return;
    }

    // Keep the last frame painted, but surface the typed failure (an `auth`
    // error carries "Reconnect Upstox in Settings", a timeout earns the Retry
    // banner) and keep polling so a transient blip self-heals. Same cadence as
    // a healthy tick — never a tight loop.
    setOptionsDockState(produce((state) => {
      state.status = state.chain ? "ready" : "error";
      state.error = failure;
    }));
    schedulePoll();
    return;
  }

  if (!current() || controller.signal.aborted) return;
  chainController = null;
  setOptionsDockState("refreshing", false);

  if (!chain) {
    // Only an abort normally yields null (filtered above), but an unexpected
    // null must still end in a terminal status — never a stranded loading.
    setOptionsDockState(produce((state) => {
      state.status = state.chain ? "ready" : "error";
      state.error = state.error ?? { kind: "upstream", message: "Could not load the option chain" };
    }));
    schedulePoll();
    return;
  }

  // The backend accepts any well-formed expiry and answers 200 with `chain: []`.
  // For a date the listing never offered that is the silent-corruption case:
  // show the empty state instead of a zero-row "ready" table.
  const knownExpiry = optionsDockState.expiries.some((entry) => entry.date === expiry);
  if (chain.rows.length === 0 && !knownExpiry) {
    setOptionsDockState(produce((state) => {
      state.chain = null;
      state.asOf = null;
      state.status = "empty";
      state.error = null;
      state.paused = null;
    }));
    return;
  }

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
  if (pollSuspended) return;
  if (!optionsDockState.symbol || !optionsDockState.expiry) return;
  // A closed market's last print is final; the next open re-polls on its own.
  if (!derivativesSessionOpen()) return;
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
    // A listing is already running for this symbol; restarting it would abort
    // a perfectly healthy E1 and land on an unknown-expiry chain.
    if (!listingController) open(symbol, optionsDockState.mode);
    return Promise.resolve();
  }
  setOptionsDockState("paused", null);
  return loadChain(symbol, expiry, "refresh", generation);
}

/**
 * Stop the chain timer while the chain is off screen (the pillars view). The
 * last frame stays painted; nothing polls until `resumePolling()`, and a tick
 * that was already in flight cannot re-arm the timer while suspended.
 */
export function suspendPolling(): void {
  pollSuspended = true;
  clearPoll();
}

/**
 * Hand the chain back to the poller. The frame painted before the suspend is
 * still the truth the moment the chain reappears, so this only re-arms the
 * timer: the next tick is a normal cadence away. Fetching here would spend a
 * chain request on the click that merely stops hiding the table.
 */
export function resumePolling(): void {
  pollSuspended = false;
  schedulePoll();
}

/** Switch expiry: the cached frame paints immediately, one refresh follows. */
export function setExpiry(expiry: string): void {
  const symbol = optionsDockState.symbol;
  if (!symbol || !expiry || expiry === optionsDockState.expiry) return;
  // The backend accepts any well-formed date, so an unlisted expiry would paint
  // a 0-row "ready" chain. Ignore it until the listing has offered the date.
  if (!optionsDockState.expiries.some((entry) => entry.date === expiry)) return;
  setOptionsDockState("expiry", expiry);
  void loadChain(symbol, expiry, "expiry", generation);
}

export function setMode(mode: OptionsDockMode): void {
  setOptionsDockState("mode", mode);
}

/** Close the dock: abort both flights and stop every timer. */
export function close(): void {
  abortListing();
  abortChain();
  clearPoll();
  pollSuspended = false;
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
      state.activePreset = null;
      state.presetUnavailable = false;
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
    fromPreset: false,
  };

  const existing = optionsDockState.legs.find((entry) => entry.key === next.key);
  if (existing) {
    // Overwriting a preset leg by hand takes ownership of its premium.
    setLegs(
      optionsDockState.legs.map((entry) =>
        entry.key === next.key
          ? { ...entry, side: next.side, premium: next.premium, fromPreset: false }
          : entry,
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

export function setLegLots(key: string, lots: number): void {
  const next = Math.max(1, Math.min(99, Math.floor(lots)));
  setLegs(optionsDockState.legs.map((leg) => (leg.key === key ? { ...leg, lots: next } : leg)));
}

/* ------------------------------------------------------------------ */
/* Strategy presets                                                    */
/* ------------------------------------------------------------------ */

/**
 * The live frame in the shape `optionsStrategies` expects. `ltp: null` becomes 0
 * so the preset treats the strike as untradeable — inventing a premium would
 * price a contract the market is not quoting.
 */
function toStrategyRows(rows: readonly ChainRow[]): StrategyChainRow[] {
  return rows.map((row) => ({
    strike: row.strike,
    ce: { ltp: row.ce.ltp ?? 0, oi: row.ce.oi, iv: row.ce.iv },
    pe: { ltp: row.pe.ltp ?? 0, oi: row.pe.oi, iv: row.pe.iv },
  }));
}

/** Preset input from the frame currently on screen; `null` before a chain lands. */
export function presetContext(): StrategyContext | null {
  const chain = optionsDockState.chain;
  if (!chain || !(chain.spot > 0) || chain.rows.length === 0) return null;
  const expiry = optionsDockState.expiries.find((entry) => entry.date === optionsDockState.expiry);
  return {
    spot: chain.spot,
    rows: toStrategyRows(chain.rows),
    lotSize: expiry?.lotSize && expiry.lotSize > 0 ? expiry.lotSize : 0,
  };
}

function legsFromPreset(presetId: string): DockLeg[] | null {
  const ctx = presetContext();
  if (!ctx) return null;
  const expiry = optionsDockState.expiry;
  if (!expiry) return null;
  const built = buildPreset(presetId, ctx);
  if (!built) return null;
  return built.map((leg) => ({
    ...leg,
    expiry,
    key: legKey({ expiry, type: leg.type, strike: leg.strike }),
    fromPreset: true,
  }));
}

/**
 * Apply the selected preset against the current chain. `null` selects
 * "No strategy" and empties the leg strip.
 *
 * An unbuildable preset keeps its id on purpose: the chain may be too narrow
 * today and the dock should say so instead of silently forgetting the choice.
 */
export function setStrategy(id: string | null): void {
  if (id == null) {
    setOptionsDockState(produce((state) => {
      state.activePreset = null;
      state.presetUnavailable = false;
    }));
    setLegs([]);
    return;
  }
  if (!STRATEGY_PRESETS.some((preset) => preset.id === id)) return;

  const hasChain = presetContext() != null;
  const legs = hasChain ? legsFromPreset(id) : null;
  setOptionsDockState(produce((state) => {
    state.activePreset = id;
    state.presetUnavailable = hasChain && legs == null;
  }));
  setLegs(legs ?? []);
}

/**
 * Rebuild an active preset against a frame whose shape changed (expiry roll or a
 * strike-set edit). Same-expiry polls never reach here, so a user's lot edits
 * survive a 10 s tick; a genuinely new frame earns a fresh build.
 *
 * A preset the new chain cannot hold clears the legs but keeps the id, so the
 * dock can explain the gap instead of forgetting the choice.
 */
function rebuildPresetForNewFrame(): void {
  const presetId = optionsDockState.activePreset;
  if (!presetId) return;
  const rebuilt = legsFromPreset(presetId);
  if (rebuilt == null) {
    setOptionsDockState("presetUnavailable", true);
    setLegs([]);
    return;
  }
  setOptionsDockState("presetUnavailable", false);
  setLegs(rebuilt);
}

/**
 * A preset's premium is the chain's LTP at build time; a same-shape tick must
 * move it or the payoff prices a contract at yesterday's premium. Lots and side
 * tweaks are preserved — only the premium is re-read. Hand-picked legs (and any
 * leg the user took ownership of) keep the premium they deliberately placed.
 */
function repricePresetLegs(): void {
  const presetId = optionsDockState.activePreset;
  const chain = optionsDockState.chain;
  if (!presetId || !chain) return;
  const legs = optionsDockState.legs;
  if (legs.length === 0) return;

  let changed = false;
  const next = legs.map((leg) => {
    if (!leg.fromPreset) return leg;
    if (leg.expiry !== chain.expiry) return leg;
    const row = chain.rows.find((entry) => entry.strike === leg.strike);
    const ltp = row ? (leg.type === "CE" ? row.ce.ltp : row.pe.ltp) : null;
    if (ltp == null || !(ltp > 0) || ltp === leg.premium) return leg;
    changed = true;
    return { ...leg, premium: ltp };
  });
  if (changed) setLegs(next);
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
    if (!optionsDockState.symbol || pollSuspended) return;
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
  abortListing();
  abortChain();
  clearPoll();
  pollSuspended = false;
  generation += 1;
  frameCache.clear();
  openSymbols.length = 0;
  setOptionsDockState(createInitialState());
}
