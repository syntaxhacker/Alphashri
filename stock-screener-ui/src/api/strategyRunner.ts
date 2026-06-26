import type { StrategyRunnerConfig } from "../types/strategyRunner";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

export function runStrategyRunner(
  config: StrategyRunnerConfig,
  onEvent: (event: any) => void,
  onError: (err: Error) => void,
  onComplete: () => void,
): () => void {
  const controller = new AbortController();
  let cancelled = false;

  (async () => {
    try {
      const response = await fetch(`${API_BASE}/api/strategy-runner/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Strategy runner failed: ${response.status}`);
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
            const event = JSON.parse(dataLine.slice(6));
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
