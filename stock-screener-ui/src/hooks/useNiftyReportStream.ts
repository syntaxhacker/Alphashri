import { useEffect, useState, useSyncExternalStore } from "react";
import { API_BASE } from "@/api/config";
import { normalizeReport, normalizeSensex, normalizeTapeRow } from "@/api/reportNifty";
import { useNiftyStreamCore } from "./niftyStreamCore";
import { getAccessToken } from "@/state/auth";
import type { NiftyReport, NiftySensex, NiftyTape } from "@/types/niftyReport";

/**
 * Build the report WebSocket URL from an HTTP(S) API base.
 *
 * Pure helper — unit-tested directly. `http` → `ws`, `https` → `wss`
 * (a single prefix replace, so `https` correctly becomes `wss`).
 */
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

/**
 * Normalize an `aux`-frame tape payload into `NiftyTape` shape (same contract
 * as `GET /api/reports/nifty/tape`: `{date, interval_sec, baseline_t, rows}`).
 *
 * Rows go through the shared `normalizeTapeRow` (snake_case-tolerant);
 * top-level scalars are read defensively. There is no top-level
 * `normalizeTape` in `@/api/reportNifty`, so this small wrapper is the
 * equivalent for WS payloads.
 */
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

/**
 * Live spot tick pushed ~once per second (only when the spot changed).
 *
 * Kept separate from `report` on purpose: the ~30s `report` frame owns the
 * full option-chain snapshot, while `tick` only moves the Spot stat.
 */
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

function getTickSnapshot(): NiftySpotTick | null {
  return liveTick;
}

/** The ~1/second live spot tick, as a subscription — only subscribers re-render. */
export function useNiftySpotTick(): NiftySpotTick | null {
  return useSyncExternalStore(subscribeTick, getTickSnapshot, getTickSnapshot);
}

/**
 * Live Nifty report over WebSocket.
 *
 * The server pushes `{"type":"report","data": <NiftyReport>}` on connect and
 * whenever the report changes, plus `{"type":"heartbeat"}` keepalives and
 * `{"type":"error"}` frames (both ignored apart from keeping the socket up).
 *
 * It also pushes `{"type":"aux","tape": <NiftyTape|null>, "sensex":
 * <NiftySensex|null>}` on connect and whenever either changes. A null side is
 * ignored so the last good value stays on screen.
 *
 * A `{"type":"tick","spot": <number>, "ts": <iso|null>,
 * "change_pct": <number|null>}` frame arrives ~once per second (only when the
 * spot changed) and is pushed into the module-level tick store (read it with
 * `useNiftySpotTick`) instead of this hook's return value, so the ~1 Hz tick
 * never re-renders the caller.
 *
 * Reconnects with backoff (1s, 2s, 4s … cap 15s) while `enabled`; closes
 * cleanly on unmount, when `enabled` goes false, or when `expiry` changes.
 * When the `WebSocket` global is missing (e.g. jsdom tests) the hook simply
 * stays disconnected so the caller falls back to polling.
 *
 * The reconnect / backoff / cleanup logic is shared with
 * `useNiftyBurstStream` via `useNiftyStreamCore`.
 */
export function useNiftyReportStream({
  expiry,
  enabled,
}: {
  expiry?: string;
  enabled: boolean;
}): { report: NiftyReport | null; tape: NiftyTape | null; sensex: NiftySensex | null; connected: boolean } {
  const [report, setReport] = useState<NiftyReport | null>(null);
  const [tape, setTape] = useState<NiftyTape | null>(null);
  const [sensex, setSensex] = useState<NiftySensex | null>(null);
  const [connected, setConnected] = useState(false);

  // When disabled, release the pushed frames and the live tick so EOD can't
  // pin stale live data from the previous live session. `connected` is reset
  // by the stream core's own disconnect handler (also on unmount).
  useEffect(() => {
    if (!enabled) {
      setLiveTick(null);
      setReport(null);
      setTape(null);
      setSensex(null);
    }
  }, [enabled]);

  useNiftyStreamCore({
    url: reportWsUrl(API_BASE, { expiry, token: getAccessToken() }),
    enabled,
    handlers: {
      onOpen: () => setConnected(true),
      // Browsers fire `error` then `close` for one failure; both handlers
      // schedule one reconnect, so mark the stream disconnected on the first.
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
          // Live spot only — never touches the report snapshot. A
          // non-finite spot is ignored so the last good value stays.
          const spot = typeof f.spot === "number" ? f.spot : NaN;
          if (!Number.isFinite(spot)) return;
          const ts = typeof f.ts === "string" && f.ts ? f.ts : null;
          const changePct =
            typeof f.change_pct === "number" && Number.isFinite(f.change_pct)
              ? f.change_pct
              : null;
          setLiveTick({ spot, ts, change_pct: changePct });
        } else if (f.type === "aux") {
          // Null sides mean "unchanged" — keep the last good value.
          if (f.tape !== null && f.tape !== undefined) {
            setTape(normalizeAuxTape(f.tape));
          }
          if (f.sensex !== null && f.sensex !== undefined) {
            setSensex(normalizeSensex(f.sensex as Record<string, unknown>));
          }
        }
        // heartbeat / error frames carry no report — ignore them.
      },
    },
  });

  return { report, tape, sensex, connected };
}
