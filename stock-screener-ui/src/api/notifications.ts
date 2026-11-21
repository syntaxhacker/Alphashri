import { apiFetch } from "../state/auth";
import type { PriceSurgeEvent } from "../types/notifications";

import { API_BASE } from "@/api/config";

export interface SurgeListResponse {
  /** All-time row count — pagination only, never surfaced on the bell. */
  total: number;
  /** Bounded count of alerts raised today (IST) — what the bell should mean. */
  today_count?: number;
  offset?: number;
  limit?: number;
  events: PriceSurgeEvent[];
}

export async function fetchSurges(
  limit: number = 10,
  offset: number = 0,
): Promise<SurgeListResponse> {
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
