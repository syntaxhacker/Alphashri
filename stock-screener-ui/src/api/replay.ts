import type { ReplayConfig, ReplayEvent } from "../types/replay";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

export async function fetchReplaySymbols(): Promise<string[]> {
  const data = await (await fetch(`${API_BASE}/api/replay/symbols`)).json();
  return data.symbols;
}

export function runReplay(
  config: ReplayConfig,
  onEvent: (event: ReplayEvent) => void,
  onError: (error: Error) => void,
  onComplete: () => void,
): () => void {
  const controller = new AbortController();
  let cancelled = false;

  (async () => {
    try {
      const response = await fetch(`${API_BASE}/api/replay/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Replay failed: ${response.status}`);
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
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;

          try {
            const event: ReplayEvent = JSON.parse(dataLine.slice(6));
            onEvent(event);
          } catch {
            // skip malformed events
          }
        }
      }

      if (!cancelled) onComplete();
    } catch (err) {
      if (!cancelled) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return () => {
    cancelled = true;
    controller.abort();
  };
}
