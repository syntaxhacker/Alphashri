import { useEffect, useRef, useCallback } from "react";
import { getAccessToken } from "../state/auth";
import { isMarketClosedToday } from "../state/holidays";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

export interface LivePriceEvent {
  instrument_key: string;
  symbol: string;
  ltp: number;
  ltq?: string | number;
  ts?: string;
}

export type LivePricesSubscriber = (prices: Record<string, LivePriceEvent>) => void;

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
    let cancelled = false;

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

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n");
            let eventType = "";
            let dataStr = "";

            for (const line of lines) {
              if (line.startsWith("event: ")) eventType = line.slice(7);
              else if (line.startsWith("data: ")) dataStr = line.slice(6);
            }

            if (eventType === "price" && dataStr) {
              try {
                const data = JSON.parse(dataStr) as LivePriceEvent & { type: string };
                if (data.symbol && data.ltp != null) {
                  pricesRef.current = {
                    ...pricesRef.current,
                    [data.symbol]: {
                      instrument_key: data.instrument_key,
                      symbol: data.symbol,
                      ltp: data.ltp,
                      ltq: data.ltq,
                      ts: data.ts,
                    },
                  };
                  listenersRef.current.forEach((fn) => fn(pricesRef.current));
                }
              } catch {
                // skip malformed
              }
            } else if (eventType === "error" && dataStr) {
              try {
                const parsed = JSON.parse(dataStr);
                console.error("[LivePrices] Stream error:", parsed.message);
              } catch {
                // ignore
              }
            } else if (eventType === "nosymbols") {
              console.log("[LivePrices] No symbols to stream");
            }
          }
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.warn("[LivePrices] Connection error:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return { subscribe, getPrices };
}
