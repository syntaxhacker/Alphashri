import type { ReplayConfig, ReplayEvent, ReplaySavedConfig } from "../types/replay";
import { fetchWithAuth } from "../state/auth";
import { readSseStream } from "./sse";

import { API_BASE } from "@/api/config";

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

      await readSseStream(
        response,
        (frame) => {
          if (cancelled) {
            return;
          }
          try {
            const event: ReplayEvent = JSON.parse(frame.data);
            onEvent(event);
          } catch {
            // skip malformed events
          }
        },
        { signal: controller.signal },
      );

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
