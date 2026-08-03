import { apiFetch } from "../state/auth";
import type { PriceSurgeEvent } from "../types/notifications";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

export async function fetchSurges(
  limit: number = 10,
  offset: number = 0,
): Promise<{ total: number; events: PriceSurgeEvent[] }> {
  return apiFetch(`${API_BASE}/api/notifications/surge?limit=${limit}&offset=${offset}`);
}

export async function recordSurge(data: {
  symbol: string;
  move_pct: number;
  direction: string;
  price?: number;
  screener_id: string;
  screen_label: string;
}): Promise<void> {
  await apiFetch(`${API_BASE}/api/notifications/surge`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
