import { useEffect, useState } from "react";
import { API_BASE } from "@/api/config";
import { normalizeReport, normalizeSensex, normalizeTapeRow } from "@/api/reportNifty";
import { getAccessToken } from "@/state/auth";
import type { NiftyReport, NiftySensex, NiftyTape } from "@/types/niftyReport";

/** Backoff schedule for a dropped socket: 1s, 2s, 4s … capped at 15s. */
const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 15_000;

function backoffMs(attempt: number): number {
  return Math.min(MIN_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
}

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
 * spot changed) and is exposed as `tick` without touching `report`.
 *
 * Reconnects with backoff (1s, 2s, 4s … cap 15s) while `enabled`; closes
 * cleanly on unmount, when `enabled` goes false, or when `expiry` changes.
 * When the `WebSocket` global is missing (e.g. jsdom tests) the hook simply
 * stays disconnected so the caller falls back to polling.
 */
export function useNiftyReportStream({
  expiry,
  enabled,
}: {
  expiry?: string;
  enabled: boolean;
}): { report: NiftyReport | null; tape: NiftyTape | null; sensex: NiftySensex | null; tick: NiftySpotTick | null; connected: boolean } {
  const [report, setReport] = useState<NiftyReport | null>(null);
  const [tape, setTape] = useState<NiftyTape | null>(null);
  const [sensex, setSensex] = useState<NiftySensex | null>(null);
  const [tick, setTick] = useState<NiftySpotTick | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      // Drop the last live tick so switching to EOD cannot show a stale
      // spot from the previous live session.
      setTick(null);
      return;
    }
    if (typeof WebSocket === "undefined") return;

    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      timer = undefined;
      let socket: WebSocket;
      try {
        socket = new WebSocket(
          reportWsUrl(API_BASE, { expiry, token: getAccessToken() }),
        );
      } catch {
        attempt += 1;
        timer = setTimeout(connect, backoffMs(attempt));
        return;
      }
      ws = socket;

      socket.onopen = () => {
        if (closed) return;
        attempt = 0;
        setConnected(true);
      };

      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(String(event.data)) as {
            type?: string;
            data?: unknown;
            tape?: unknown;
            sensex?: unknown;
            spot?: unknown;
            ts?: unknown;
            change_pct?: unknown;
          };
          if (frame.type === "report" && frame.data) {
            setReport(normalizeReport(frame.data as Record<string, unknown>));
          } else if (frame.type === "tick") {
            // Live spot only — never touches the report snapshot. A
            // non-finite spot is ignored so the last good value stays.
            const spot = typeof frame.spot === "number" ? frame.spot : NaN;
            if (!Number.isFinite(spot)) return;
            const ts = typeof frame.ts === "string" && frame.ts ? frame.ts : null;
            const changePct =
              typeof frame.change_pct === "number" && Number.isFinite(frame.change_pct)
                ? frame.change_pct
                : null;
            setTick({ spot, ts, change_pct: changePct });
          } else if (frame.type === "aux") {
            // Null sides mean "unchanged" — keep the last good value.
            if (frame.tape !== null && frame.tape !== undefined) {
              setTape(normalizeAuxTape(frame.tape));
            }
            if (frame.sensex !== null && frame.sensex !== undefined) {
              setSensex(normalizeSensex(frame.sensex as Record<string, unknown>));
            }
          }
          // heartbeat / error frames carry no report — ignore them.
        } catch {
          /* ignore a malformed frame rather than dropping the stream */
        }
      };

      // Browsers fire `error` followed by `close` for a single failure —
      // schedule only one reconnect, otherwise every failure doubles the
      // live sockets (each streaming full reports) and the overwritten
      // timer handle can never be cleared on cleanup.
      const scheduleReconnect = () => {
        if (closed || timer !== undefined) return;
        setConnected(false);
        attempt += 1;
        timer = setTimeout(connect, backoffMs(attempt));
      };
      socket.onclose = scheduleReconnect;
      socket.onerror = scheduleReconnect;
    };

    connect();

    return () => {
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
      setConnected(false);
    };
  }, [enabled, expiry]);

  return { report, tape, sensex, tick, connected };
}
