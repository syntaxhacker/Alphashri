import { useEffect, useRef } from "react";
import { getAccessToken } from "@/state/auth";
import { API_BASE } from "@/api/config";
import { normalizeBurst } from "@/api/reportNifty";
import type { NiftyBurst } from "@/types/niftyReport";

/** Backoff schedule for a dropped socket: 1s, 2s, 4s … capped at 15s. */
const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 15_000;

function backoffMs(attempt: number): number {
  return Math.min(MIN_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
}

/**
 * Build the bursts WebSocket URL from an HTTP(S) API base.
 * `http` → `ws`, `https` → `wss` (single prefix replace).
 */
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

/**
 * Server-pushed Nifty alerts over WebSocket.
 *
 * Same exported name, arguments, and callback contract as the old SSE
 * version: each detected event is handed to `onEvent` as a normalized
 * `NiftyBurst`. A `snapshot` frame (a list) is delivered one event at a
 * time; a `burst` frame (a single event) is appended the same way. The
 * caller dedupes by id, so replaying a snapshot over already-seen events
 * is safe. `heartbeat` / `error` frames are ignored.
 *
 * `enabled` false (EOD) and any error just means the caller keeps its
 * polling path. When the `WebSocket` global is missing (e.g. jsdom tests)
 * the hook does nothing.
 */
export function useNiftyBurstStream(
  onEvent: (burst: NiftyBurst) => void,
  enabled: boolean,
): void {
  // Keep the latest callback without re-opening the stream on every render.
  const cbRef = useRef(onEvent);
  useEffect(() => {
    cbRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof WebSocket === "undefined") return;

    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let attempt = 0;

    const deliver = (raw: unknown) => {
      try {
        const parsed = normalizeBurst((raw ?? {}) as Record<string, unknown>);
        if (parsed && parsed.id) cbRef.current(parsed);
      } catch {
        /* ignore a malformed event rather than dropping the stream */
      }
    };

    const connect = () => {
      if (closed) return;
      timer = undefined;
      let socket: WebSocket;
      try {
        socket = new WebSocket(burstWsUrl(API_BASE, { token: getAccessToken() }));
      } catch {
        attempt += 1;
        timer = setTimeout(connect, backoffMs(attempt));
        return;
      }
      ws = socket;

      socket.onopen = () => {
        if (closed) return;
        attempt = 0;
      };

      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(String(event.data)) as {
            type?: string;
            data?: unknown;
          };
          if (frame.type === "burst" && frame.data) {
            deliver(frame.data);
          } else if (frame.type === "snapshot" && Array.isArray(frame.data)) {
            for (const item of frame.data) deliver(item);
          }
          // heartbeat / error frames carry no events — ignore them.
        } catch {
          /* ignore a malformed frame rather than dropping the stream */
        }
      };

      // Browsers fire `error` followed by `close` for a single failure —
      // schedule only one reconnect, otherwise every failure doubles the
      // live sockets (each re-delivering the snapshot) and the overwritten
      // timer handle can never be cleared on cleanup.
      const scheduleReconnect = () => {
        if (closed || timer !== undefined) return;
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
    };
  }, [enabled]);
}
