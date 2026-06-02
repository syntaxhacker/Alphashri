import type { ReplayConfig, ReplayEvent, ReplaySavedConfig } from "../types/replay";
import { fetchWithAuth } from "../state/auth";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

export async function fetchReplaySymbols(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/replay/symbols`);
  if (!response.ok) {
    throw new Error(`Failed to fetch symbols: ${response.status}`);
  }
  const data = await response.json();
  return data.symbols || [];
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

export async function fetchSavedConfigs(): Promise<ReplaySavedConfig[]> {
  const response = await fetchWithAuth(`${API_BASE}/api/replay/configs`);
  if (!response.ok) throw new Error(`Failed to fetch saved configs: ${response.status}`);
  const data = await response.json();
  return data.configs || [];
}

export async function saveReplayConfig(name: string, config: ReplayConfig, description?: string): Promise<ReplaySavedConfig> {
  const response = await fetchWithAuth(`${API_BASE}/api/replay/configs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description: description || null, config }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to save config: ${response.status}`);
  }
  return response.json();
}

export async function deleteReplayConfig(id: number): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE}/api/replay/configs/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`Failed to delete config: ${response.status}`);
}
