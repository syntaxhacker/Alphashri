import { useEffect, useRef } from "react";
import { getAccessToken } from "@/state/auth";
import { API_BASE } from "@/api/config";
import { useNiftyStreamCore } from "./niftyStreamCore";
import { normalizeBurst } from "@/api/reportNifty";
import type { NiftyBurst } from "@/types/niftyReport";

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

  // Reconnect / backoff / cleanup is shared with useNiftyReportStream.
  useNiftyStreamCore({
    url: burstWsUrl(API_BASE, { token: getAccessToken() }),
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
        // heartbeat / error frames carry no events — ignore them.
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
