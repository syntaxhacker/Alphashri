/**
 * Solid port of src/hooks/useNiftyReportStream.ts + niftyStreamCore.ts
 * (both still React) — identical semantics, accessor-based API:
 * `report()`, `tape()`, `sensex()`, `connected()` and `useNiftySpotTick()`.
 *
 * The tick store is module-level, same as the React original, so parity
 * tests that drive `setLiveTick(...)` see the same frames.
 */
import { createEffect, createSignal, onCleanup } from "solid-js";
import { API_BASE } from "@/api/config";
import { normalizeReport, normalizeSensex, normalizeTapeRow, normalizeBurst } from "@/api/reportNifty";
import { getAccessToken } from "@/state/auth";
import type { NiftyReport, NiftySensex, NiftyTape } from "@/types/niftyReport";

/** Backoff schedule for a dropped socket: 1s, 2s, 4s … capped at 15s. */
const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 15_000;

function backoffMs(attempt: number): number {
  return Math.min(MIN_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
}

export interface NiftySpotTick {
  spot: number;
  ts: string | null;
  change_pct: number | null;
}

let liveTick: NiftySpotTick | null = null;
const tickListeners = new Set<() => void>();

function emitTick(): void {
  for (const listener of tickListeners) listener();
}

/** Replace the live tick. Identity changes each tick, so the snapshot is stable per render. */
export function setLiveTick(tick: NiftySpotTick | null): void {
  liveTick = tick;
  emitTick();
}

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  return () => {
    tickListeners.delete(listener);
  };
}

/** The ~1/second live spot tick, as a signal — only subscribers re-render. */
export function useNiftySpotTick() {
  const [tick, setTick] = createSignal<NiftySpotTick | null>(liveTick);
  createEffect(() => {
    const unsubscribe = subscribeTick(() => setTick(liveTick));
    onCleanup(unsubscribe);
  });
  return tick;
}

export interface NiftyStreamHandlers {
  onFrame: (frame: unknown) => void;
  onOpen?: () => void;
  onReconnect?: () => void;
  onDisconnect?: () => void;
}

/** Self-reconnecting WebSocket with the standard backoff and single-reconnect-per-failure semantics. */
function useNiftyStreamCore(args: {
  url: () => string;
  enabled: () => boolean;
  handlers: NiftyStreamHandlers;
}): void {
  const handlerRef = { current: args.handlers };
  handlerRef.current = args.handlers;

  createEffect(() => {
    const url = args.url();
    const enabled = args.enabled();
    const { onFrame, onOpen, onReconnect, onDisconnect } = handlerRef.current;

    if (!enabled || typeof WebSocket === "undefined") {
      onDisconnect?.();
      return;
    }

    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      timer = undefined;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        attempt += 1;
        timer = setTimeout(connect, backoffMs(attempt));
        return;
      }
      ws = socket;

      socket.onopen = () => {
        if (closed) return;
        attempt = 0;
        onOpen?.();
      };

      socket.onmessage = (event) => {
        try {
          onFrame(JSON.parse(String(event.data)));
        } catch {
          /* ignore a malformed frame rather than dropping the stream */
        }
      };

      const scheduleReconnect = () => {
        if (closed || timer !== undefined) return;
        attempt += 1;
        timer = setTimeout(connect, backoffMs(attempt));
        onReconnect?.();
      };
      socket.onclose = scheduleReconnect;
      socket.onerror = scheduleReconnect;
    };

    connect();

    onCleanup(() => {
      closed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      const socket = ws;
      ws = null;
      if (socket) {
        // Detach first so close() itself cannot schedule a reconnect.
        socket.onclose = null;
        socket.onerror = null;
        try {
          socket.close();
        } catch {
          /* already closed */
        }
      }
      onDisconnect?.();
    });
  });
}

export function reportWsUrl(
  base: string,
  opts: { expiry?: string; token?: string | null } = {},
): string {
  const wsBase = base.replace(/^http/, "ws");
  const params = new URLSearchParams();
  if (opts.expiry) params.set("expiry", opts.expiry);
  if (opts.token) params.set("token", opts.token);
  const qs = params.toString();
  return `${wsBase}/ws/nifty/report${qs ? `?${qs}` : ""}`;
}

function normalizeAuxTape(raw: unknown): NiftyTape {
  const r = (raw ?? {}) as Record<string, unknown>;
  const toNum = (v: unknown, fallback = 0): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const tape: NiftyTape = {
    date: String(r.date ?? ""),
    interval_sec: toNum(r.interval_sec ?? r.intervalSec, 60),
    rows: (Array.isArray(r.rows) ? r.rows : []).map((row) =>
      normalizeTapeRow((row ?? {}) as Record<string, unknown>),
    ),
  };
  const baseline = r.baseline_t ?? r.baselineT;
  if (typeof baseline === "string" && baseline) tape.baseline_t = baseline;
  return tape;
}

export function useNiftyReportStream(args: { expiry?: string; enabled: boolean }) {
  const [report, setReport] = createSignal<NiftyReport | null>(null);
  const [tape, setTape] = createSignal<NiftyTape | null>(null);
  const [sensex, setSensex] = createSignal<NiftySensex | null>(null);
  const [connected, setConnected] = createSignal(false);

  createEffect(() => {
    if (!args.enabled) {
      setLiveTick(null);
      setReport(null);
      setTape(null);
      setSensex(null);
    }
  });

  useNiftyStreamCore({
    url: () => reportWsUrl(API_BASE, { expiry: args.expiry, token: getAccessToken() }),
    enabled: () => args.enabled,
    handlers: {
      onOpen: () => setConnected(true),
      onReconnect: () => setConnected(false),
      onDisconnect: () => setConnected(false),
      onFrame: (frame) => {
        const f = frame as {
          type?: string;
          data?: unknown;
          tape?: unknown;
          sensex?: unknown;
          spot?: unknown;
          ts?: unknown;
          change_pct?: unknown;
        };
        if (f.type === "report" && f.data) {
          setReport(normalizeReport(f.data as Record<string, unknown>));
        } else if (f.type === "tick") {
          const spot = typeof f.spot === "number" ? f.spot : NaN;
          if (!Number.isFinite(spot)) return;
          const ts = typeof f.ts === "string" && f.ts ? f.ts : null;
          const changePct =
            typeof f.change_pct === "number" && Number.isFinite(f.change_pct)
              ? f.change_pct
              : null;
          setLiveTick({ spot, ts, change_pct: changePct });
        } else if (f.type === "aux") {
          if (f.tape !== null && f.tape !== undefined) {
            setTape(normalizeAuxTape(f.tape));
          }
          if (f.sensex !== null && f.sensex !== undefined) {
            setSensex(normalizeSensex(f.sensex as Record<string, unknown>));
          }
        }
      },
    },
  });

  return { report, tape, sensex, connected };
}

export function burstWsUrl(
  base: string,
  opts: { token?: string | null } = {},
): string {
  const wsBase = base.replace(/^http/, "ws");
  const params = new URLSearchParams();
  if (opts.token) params.set("token", opts.token);
  const qs = params.toString();
  return `${wsBase}/ws/nifty/bursts${qs ? `?${qs}` : ""}`;
}

export function useNiftyBurstStream(
  onEvent: (burst: import("@/types/niftyReport").NiftyBurst) => void,
  enabled: () => boolean,
): void {
  const cbRef = { current: onEvent };
  cbRef.current = onEvent;

  useNiftyStreamCore({
    url: () => burstWsUrl(API_BASE, { token: getAccessToken() }),
    enabled,
    handlers: {
      onFrame: (frame) => {
        const f = frame as { type?: string; data?: unknown } | null;
        if (!f) return;
        if (f.type === "burst" && f.data) {
          deliver(f.data);
        } else if (f.type === "snapshot" && Array.isArray(f.data)) {
          for (const item of f.data) deliver(item);
        }
      },
    },
  });

  function deliver(raw: unknown) {
    try {
      const parsed = normalizeBurst((raw ?? {}) as Record<string, unknown>);
      if (parsed && parsed.id) cbRef.current(parsed);
    } catch {
      /* ignore a malformed event rather than dropping the stream */
    }
  }
}
