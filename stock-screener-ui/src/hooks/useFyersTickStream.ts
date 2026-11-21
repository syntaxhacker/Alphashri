/**
 * Live Fyers tick stream for the chart's last candle.
 *
 * Contract (api/reports_api/fyers_ws.py):
 *   GET /ws/fyers/ticks?symbol=NIFTY[&token=<app JWT>]
 *   {"type":"tick","symbol":"NIFTY50-INDEX","requested_symbol":"NIFTY","data":{"ltp":...},"ts":...}
 *   {"type":"status","state":...,"reason":...,"detail"?,"market_open":...}
 *
 * One socket per symbol (the backend opens one hub subscription per client);
 * a module-level manager ref-counts consumers so a second mount of the same
 * symbol never opens a second socket. The broker token is resolved server-side
 * from the DB and an absent `token` is explicitly allowed, so no token is put
 * in the URL — none reaches proxy/access logs.
 *
 * Poll precedence (for the chart lane): while `isLive()` is true the stream is
 * authoritative and the poll must be suppressed; on disconnected / reconnecting /
 * market_closed the poll is the fallback. This module never starts a poll.
 */
import { createEffect, createSignal, onCleanup } from "solid-js";
import { API_BASE } from "@/api/config";

const WS_PATH = "/ws/fyers/ticks";
const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 15_000;

export function fyersBackoffMs(attempt: number): number {
  return Math.min(MIN_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
}

/** Token-free on purpose — a JWT in a WS URL ends up in access logs. */
export function buildFyersTicksUrl(base: string, symbol: string): string {
  const wsBase = base.replace(/^http/, "ws").replace(/\/+$/, "");
  return `${wsBase}${WS_PATH}?symbol=${encodeURIComponent(symbol)}`;
}

export interface FyersTick {
  /** Requested symbol, e.g. NIFTY — the key callers look up. */
  symbol: string;
  /** Hub/app symbol the backend routes, e.g. NIFTY50-INDEX. */
  brokerSymbol: string;
  ltp: number;
  ts: string | number | null;
  raw: Record<string, unknown>;
}

export type FyersStreamState =
  | "connecting"
  | "connected"
  | "market_closed"
  | "market_open"
  | "reconnecting"
  | "disconnected"
  | "error";

const STATES: readonly string[] = [
  "connecting",
  "connected",
  "market_closed",
  "market_open",
  "reconnecting",
  "disconnected",
  "error",
];
function isStreamState(value: unknown): value is FyersStreamState {
  return typeof value === "string" && STATES.includes(value);
}

// Aggregate precedence: a single live feed beats a closed/market-open sibling.
const PRIORITY: readonly FyersStreamState[] = [
  "connected",
  "market_open",
  "connecting",
  "reconnecting",
  "market_closed",
  "error",
  "disconnected",
];

interface Session {
  symbol: string;
  socket: WebSocket | null;
  timer?: ReturnType<typeof setTimeout>;
  retryCount: number;
  clients: number;
  state: FyersStreamState;
  detail?: string;
  closing: boolean;
}

interface Snapshot {
  ticks: Record<string, FyersTick>;
  state: FyersStreamState;
  detail?: string;
}

const sessions = new Map<string, Session>();
let ticks: Record<string, FyersTick> = {};
let streamState: FyersStreamState = "disconnected";
let streamDetail: string | undefined;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const listener of subscribers) listener();
}

function snapshot(): Snapshot {
  return { ticks, state: streamState, detail: streamDetail };
}

function setAggregate(state: FyersStreamState, detail?: string): void {
  if (streamState === state && streamDetail === detail) return;
  streamState = state;
  streamDetail = detail;
  notify();
}

function recomputeAggregate(): void {
  const all = [...sessions.values()];
  if (all.length === 0) {
    setAggregate("disconnected");
    return;
  }
  for (const state of PRIORITY) {
    const match = all.find((session) => session.state === state);
    if (match) {
      setAggregate(state, match.detail);
      return;
    }
  }
  setAggregate("disconnected");
}

function applyState(
  session: Session,
  state: FyersStreamState,
  detail?: string,
): void {
  if (session.state === state && session.detail === detail) return;
  session.state = state;
  session.detail = detail;
  recomputeAggregate();
}

function detach(ws: WebSocket): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onclose = null;
  ws.onerror = null;
}

function handleFrame(data: unknown, session: Session): void {
  let frame: Record<string, unknown>;
  try {
    frame = (typeof data === "string" ? JSON.parse(data) : data) as Record<
      string,
      unknown
    >;
  } catch {
    return;
  }
  if (!frame || typeof frame !== "object") return;

  if (frame.type === "tick") {
    const payload = frame.data as Record<string, unknown> | null | undefined;
    const ltp =
      typeof payload?.ltp === "number"
        ? payload.ltp
        : Number(payload?.ltp ?? NaN);
    if (!Number.isFinite(ltp)) return;
    const brokerSymbol =
      typeof frame.symbol === "string" ? frame.symbol : session.symbol;
    const ts =
      typeof frame.ts === "string" || typeof frame.ts === "number"
        ? frame.ts
        : null;
    ticks = {
      ...ticks,
      [session.symbol]: {
        symbol: session.symbol,
        brokerSymbol,
        ltp,
        ts,
        raw: frame,
      },
    };
    notify();
  } else if (frame.type === "status" && isStreamState(frame.state)) {
    const detail =
      (typeof frame.detail === "string" ? frame.detail : null) ??
      (typeof frame.reason === "string" ? frame.reason : undefined);
    applyState(session, frame.state, detail);
  }
}

function scheduleReconnect(session: Session): void {
  if (session.closing || session.timer !== undefined) return;
  session.retryCount += 1;
  applyState(session, "reconnecting");
  session.timer = setTimeout(() => {
    session.timer = undefined;
    if (session.closing) return;
    const dead = session.socket;
    session.socket = null;
    if (dead) {
      detach(dead);
      try {
        dead.close();
      } catch {
        /* already gone */
      }
    }
    connect(session);
  }, fyersBackoffMs(session.retryCount - 1));
}

function connect(session: Session): void {
  if (session.closing) return;
  // CONNECTING (0) or OPEN (1) means this symbol already has a socket.
  if (session.socket && (session.socket.readyState === 0 || session.socket.readyState === 1)) {
    return;
  }

  let ws: WebSocket;
  try {
    ws = new WebSocket(buildFyersTicksUrl(API_BASE, session.symbol));
  } catch {
    scheduleReconnect(session);
    return;
  }
  session.socket = ws;

  ws.onopen = () => {
    if (session.closing || session.socket !== ws) return;
    session.retryCount = 0;
    applyState(session, "connected");
  };

  ws.onmessage = (event: MessageEvent) => {
    if (session.socket === ws) handleFrame(event.data, session);
  };

  ws.onclose = () => {
    if (session.closing || session.socket !== ws) return;
    session.socket = null;
    scheduleReconnect(session);
  };

  // onclose drives the retry; this covers environments that emit an error
  // without ever closing. The timer guard keeps one reconnect per failure.
  ws.onerror = () => {
    if (session.closing || session.socket !== ws) return;
    scheduleReconnect(session);
  };
}

function teardownSession(session: Session): void {
  session.closing = true;
  if (session.timer !== undefined) {
    clearTimeout(session.timer);
    session.timer = undefined;
  }
  const dead = session.socket;
  session.socket = null;
  if (dead) {
    detach(dead);
    try {
      if (dead.readyState !== 3) dead.close();
    } catch {
      /* already gone */
    }
  }
  sessions.delete(session.symbol);
  const { [session.symbol]: _removed, ...rest } = ticks;
  ticks = rest;
  recomputeAggregate();
}

function register(symbol: string): Session {
  let session = sessions.get(symbol);
  if (!session) {
    session = {
      symbol,
      socket: null,
      retryCount: 0,
      clients: 0,
      state: "disconnected",
      closing: false,
    };
    sessions.set(symbol, session);
    connect(session);
  }
  session.clients += 1;
  return session;
}

function release(session: Session): void {
  session.clients -= 1;
  if (session.clients <= 0) teardownSession(session);
}

/** Test-only: drop all consumers and connection state between isolated cases. */
export function __resetFyersTickStream(): void {
  for (const session of sessions.values()) teardownSession(session);
  sessions.clear();
  ticks = {};
  setAggregate("disconnected");
  notify();
}

export interface UseFyersTickStreamArgs {
  symbols: () => readonly string[];
  enabled?: () => boolean;
}

export interface FyersTickStreamApi {
  ticks: () => Readonly<Record<string, FyersTick>>;
  lastTick: (symbol: string) => FyersTick | null;
  state: () => FyersStreamState;
  detail: () => string | undefined;
  connected: () => boolean;
  /** Gate for the chart poll: true only when the stream is authoritative. */
  isLive: () => boolean;
  isDisconnected: () => boolean;
  isReconnecting: () => boolean;
  isMarketClosed: () => boolean;
}

export function useFyersTickStream(
  args: UseFyersTickStreamArgs,
): FyersTickStreamApi {
  const normalized = (): string[] =>
    args
      .symbols()
      .map((symbol) => String(symbol).toUpperCase())
      .filter(Boolean);
  const enabled = (): boolean => args.enabled?.() ?? true;

  const [view, setView] = createSignal<Snapshot>(snapshot());
  createEffect(() => {
    const unsubscribe = subscribe(() => setView(snapshot()));
    onCleanup(unsubscribe);
  });

  const held = new Map<string, Session>();
  createEffect(() => {
    const wanted = new Set(enabled() ? normalized() : []);
    for (const [symbol, session] of held) {
      if (!wanted.has(symbol)) {
        release(session);
        held.delete(symbol);
      }
    }
    for (const symbol of wanted) {
      if (!held.has(symbol)) held.set(symbol, register(symbol));
    }
  });
  onCleanup(() => {
    for (const session of held.values()) release(session);
    held.clear();
  });

  const s = view;
  return {
    ticks: () => s().ticks,
    lastTick: (symbol: string) => s().ticks[String(symbol).toUpperCase()] ?? null,
    state: () => s().state,
    detail: () => s().detail,
    connected: () => s().state === "connected",
    isLive: () => s().state === "connected",
    isDisconnected: () => s().state === "disconnected" || s().state === "error",
    isReconnecting: () =>
      s().state === "reconnecting" || s().state === "connecting",
    isMarketClosed: () => s().state === "market_closed",
  };
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}
