/** Event Watch API client
 * (GET /api/reports/events/upcoming, GET /api/reports/events/recent).
 * Returns null when the endpoint is absent (HTTP 404) so callers can
 * render the sections that do load. */

import { fetchWithAuth } from "../state/auth";
import type { EventWatchResponse, RegimeResponse } from "../types/eventWatch";
import { API_BASE } from "./config";

const EVENTS_API_BASE = `${API_BASE}/api/reports/events`;

async function parseOrThrow(response: Response, label: string): Promise<EventWatchResponse> {
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      if (error?.detail) detail = String(error.detail);
    } catch {
      // keep status fallback
    }
    throw new Error(detail || `Failed to fetch ${label}`);
  }
  return response.json();
}

export async function fetchUpcomingEvents(
  days: number = 7,
  universe: string = "nifty500",
  signal?: AbortSignal,
): Promise<EventWatchResponse | null> {
  const params = new URLSearchParams({ days: String(days), universe });
  const response = await fetchWithAuth(`${EVENTS_API_BASE}/upcoming?${params.toString()}`, {
    signal,
  });
  if (response.status === 404) return null;
  return parseOrThrow(response, "upcoming events");
}

export async function fetchRecentEvents(
  universe: string = "nifty500",
  signal?: AbortSignal,
): Promise<EventWatchResponse | null> {
  const params = new URLSearchParams({ universe });
  const response = await fetchWithAuth(`${EVENTS_API_BASE}/recent?${params.toString()}`, {
    signal,
  });
  if (response.status === 404) return null;
  return parseOrThrow(response, "recent events");
}

/** Nifty 50 vs 20DMA regime snapshot. Returns null when the endpoint is
 * absent (HTTP 404) so callers omit the chip on older backends. */
export async function fetchRegime(signal?: AbortSignal): Promise<RegimeResponse | null> {
  const response = await fetchWithAuth(`${EVENTS_API_BASE}/regime`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      if (error?.detail) detail = String(error.detail);
    } catch {
      // keep status fallback
    }
    throw new Error(detail || "Failed to fetch regime");
  }
  return response.json();
}
