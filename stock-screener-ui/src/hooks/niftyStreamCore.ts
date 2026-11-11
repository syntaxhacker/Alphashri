/**
 * Shared WebSocket stream core used by `useNiftyBurstStream` and
 * `useNiftyReportStream`.
 *
 * Encapsulates the reconnect / backoff / cleanup semantics so the two hooks
 * cannot drift apart:
 *  - one reconnect per failure (browsers fire `error` then `close` for a
 *    single failure, so both handlers share one `scheduleReconnect` and the
 *    `timer !== undefined` guard prevents a second socket from ever opening);
 *  - exponential backoff 1s → 2s → 4s … capped at 15s;
 *  - detach-before-close on teardown so `socket.close()` cannot itself
 *    schedule a reconnect through an overwritten timer handle.
 *
 * Frame delivery is handed to `onFrame` with the already-parsed JSON; the
 * caller parses / type-dispatches inside `onFrame`. Connection state is
 * reported via `onOpen` / `onReconnect` / `onDisconnect`.
 *
 * The effect re-runs only when `url` or `enabled` change — handlers are
 * captured in a ref so replacing them does not re-open the socket.
 */

import { useEffect, useRef } from "react";

/** Backoff schedule for a dropped socket: 1s, 2s, 4s … capped at 15s. */
const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 15_000;

function backoffMs(attempt: number): number {
  return Math.min(MIN_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
}

export interface NiftyStreamHandlers {
  /** A parsed JSON frame pushed by the server. */
  onFrame: (frame: unknown) => void;
  /** The socket opened (handshake complete). */
  onOpen?: () => void;
  /** A reconnect was scheduled (backoff timer armed). */
  onReconnect?: () => void;
  /** The stream is disabled or torn down (no socket will deliver frames). */
  onDisconnect?: () => void;
}

interface NiftyStreamOptions {
  url: string;
  enabled: boolean;
  handlers: NiftyStreamHandlers;
}

/**
 * Self-reconnecting WebSocket with the standard backoff and
 * single-reconnect-per-failure semantics.
 */
export function useNiftyStreamCore({
  url,
  enabled,
  handlers,
}: NiftyStreamOptions): void {
  const handlerRef = useRef(handlers);
  handlerRef.current = handlers;

  useEffect(() => {
    const { onFrame, onOpen, onReconnect, onDisconnect } = handlerRef.current;

    if (!enabled) {
      onDisconnect?.();
      return;
    }
    if (typeof WebSocket === "undefined") {
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

      // Browsers fire `error` followed by `close` for a single failure —
      // schedule only one reconnect, otherwise every failure doubles the
      // live sockets (each re-delivering the snapshot) and the overwritten
      // timer handle can never be cleared on cleanup.
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
      onDisconnect?.();
    };
  }, [url, enabled]);
}
