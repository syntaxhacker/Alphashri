import { useEffect, useRef, useCallback } from "react";
import { getAccessToken } from "../state/auth";
import { isMarketClosedToday } from "../state/holidays";
import { readSseStream } from "../api/sse";

import { API_BASE } from "@/api/config";

export interface LivePriceEvent {
  instrument_key: string;
  symbol: string;
  ltp: number;
  ltq?: string | number;
  ts?: string;
}

export type LivePricesSubscriber = (symbol: string, price: LivePriceEvent) => void;

export function useLivePrices() {
  const pricesRef = useRef<Record<string, LivePriceEvent>>({});
  const controllerRef = useRef<AbortController | null>(null);
  const listenersRef = useRef<Set<LivePricesSubscriber>>(new Set());

  const subscribe = useCallback((listener: LivePricesSubscriber) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getPrices = useCallback(() => pricesRef.current, []);

  useEffect(() => {
    if (isMarketClosedToday()) return;
    const controller = new AbortController();
    controllerRef.current = controller;

    (async () => {
      const token = getAccessToken();
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      try {
        const response = await fetch(`${API_BASE}/api/paper/live/stream`, {
          headers,
          signal: controller.signal,
        });

        if (!response.ok) {
          console.warn("[LivePrices] SSE connection failed:", response.status);
          return;
        }

        await readSseStream(
          response,
          (frame) => {
            if (frame.event === "price" && frame.data) {
              try {
                const data = JSON.parse(frame.data) as LivePriceEvent & { type: string };
                if (data.symbol && data.ltp != null) {
                  const prev = pricesRef.current[data.symbol];
                  if (!prev || prev.ltp !== data.ltp) {
                    pricesRef.current[data.symbol] = {
                      instrument_key: data.instrument_key,
                      symbol: data.symbol,
                      ltp: data.ltp,
                      ltq: data.ltq,
                      ts: data.ts,
                    };
                    listenersRef.current.forEach((fn) =>
                      fn(data.symbol, pricesRef.current[data.symbol]),
                    );
                  }
                }
              } catch {
                // skip malformed
              }
            } else if (frame.event === "error" && frame.data) {
              try {
                const parsed = JSON.parse(frame.data);
                console.error("[LivePrices] Stream error:", parsed.message);
              } catch {
                // ignore
              }
            } else if (frame.event === "nosymbols") {
              console.log("[LivePrices] No symbols to stream");
            }
          },
          { signal: controller.signal },
        );
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.warn("[LivePrices] Connection error:", err);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  return { subscribe, getPrices };
}
