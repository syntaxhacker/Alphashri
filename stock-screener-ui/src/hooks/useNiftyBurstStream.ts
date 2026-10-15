import { useCallback, useEffect, useRef } from "react";
import { fetchWithAuth } from "@/state/auth";
import { API_BASE } from "@/api/config";
import { normalizeBurst } from "@/api/reportNifty";
import type { NiftyBurst } from "@/types/niftyReport";

const STREAM_URL = `${API_BASE}/api/reports/nifty/bursts/stream`;
/** Reconnect backoff after a drop (ms). The caller falls back to polling. */
const RECONNECT_MS = 5_000;

/**
 * Server-pushed Nifty alerts.
 *
 * The report page polls `/bursts` every 30s, so an alert detected at a minute
 * boundary could reach the UI up to ~30s late. This subscribes to the SSE feed
 * and hands each event straight to `onEvent`, so a burst lands within a couple
 * of seconds of the tape row.
 *
 * Uses `fetchWithAuth` + `ReadableStream` rather than `EventSource` because the
 * endpoint is auth-gated and `EventSource` cannot send an Authorization header
 * (same reason `useLivePrices` does it this way).
 *
 * Delivery only — it does not make detection faster. `enabled` false (EOD) and
 * any error just means the caller keeps its polling path.
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

  const stopRef = useRef<AbortController | null>(null);

  const connect = useCallback(async (signal: AbortSignal) => {
    const res = await fetchWithAuth(STREAM_URL, {
      headers: { Accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; ignore comments (: ...).
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue; // heartbeat / comment
        try {
          const raw = JSON.parse(line.slice(6)) as Record<string, unknown>;
          // SSE carries the backend's raw detection dict — normalize it the
          // same way the polled endpoint is normalized.
          const parsed = normalizeBurst(raw);
          if (parsed && parsed.id) cbRef.current(parsed);
        } catch {
          /* ignore a malformed frame rather than dropping the stream */
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    stopRef.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const loop = async () => {
      while (!closed && !controller.signal.aborted) {
        try {
          await connect(controller.signal);
        } catch {
          /* fall through to backoff */
        }
        if (closed || controller.signal.aborted) return;
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, RECONNECT_MS);
        });
      }
    };
    void loop();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      controller.abort();
      stopRef.current = null;
    };
  }, [enabled, connect]);
}
