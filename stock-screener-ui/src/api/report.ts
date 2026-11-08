/** Daily report + breakouts + follow-through API client
 * (GET /api/reports/daily, /api/reports/breakouts, /api/reports/follow-through). */

import { fetchWithAuth } from "../state/auth";
import type {
  DailyReportResponse,
  DeliveryResponse,
  FollowThroughResponse,
  ReportBreakoutsResponse,
  ReportEventsResponse,
} from "../types/report";
import { API_BASE } from "./config";

const REPORTS_API_BASE = `${API_BASE}/api/reports`;

function todayIST(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}

export { todayIST };

async function fetchReportJson<T>(
  url: string,
  signal: AbortSignal | undefined,
  fallback: string,
): Promise<T> {
  const response = await fetchWithAuth(url, { signal });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      if (error?.detail) detail = String(error.detail);
    } catch {
      // keep status fallback
    }
    throw new Error(detail || fallback);
  }
  return response.json();
}

export async function fetchDailyReport(
  date?: string,
  universe: string = "nifty500",
  signal?: AbortSignal,
): Promise<DailyReportResponse> {
  const params = new URLSearchParams({
    date: date || todayIST(),
    universe,
  });
  return fetchReportJson<DailyReportResponse>(
    `${REPORTS_API_BASE}/daily?${params.toString()}`,
    signal,
    "Failed to fetch daily report",
  );
}

export async function fetchReportBreakouts(
  date?: string,
  universe: string = "nifty500",
  signal?: AbortSignal,
): Promise<ReportBreakoutsResponse> {
  const params = new URLSearchParams({
    date: date || todayIST(),
    universe,
  });
  return fetchReportJson<ReportBreakoutsResponse>(
    `${REPORTS_API_BASE}/breakouts?${params.toString()}`,
    signal,
    "Failed to fetch report breakouts",
  );
}

export async function fetchReportFollowThrough(
  date?: string,
  universe: string = "nifty500",
  signal?: AbortSignal,
): Promise<FollowThroughResponse> {
  const params = new URLSearchParams({
    date: date || todayIST(),
    universe,
  });
  return fetchReportJson<FollowThroughResponse>(
    `${REPORTS_API_BASE}/follow-through?${params.toString()}`,
    signal,
    "Failed to fetch report follow-through",
  );
}

export async function fetchReportDelivery(
  date?: string,
  universe: string = "nifty500",
  limit: number = 15,
  signal?: AbortSignal,
): Promise<DeliveryResponse> {
  const params = new URLSearchParams({
    date: date || todayIST(),
    universe,
    limit: String(limit),
  });
  return fetchReportJson<DeliveryResponse>(
    `${REPORTS_API_BASE}/delivery?${params.toString()}`,
    signal,
    "Failed to fetch delivery report",
  );
}

export async function fetchReportEvents(
  symbols: string[],
  from?: string,
  to?: string,
  signal?: AbortSignal,
): Promise<ReportEventsResponse> {
  const params = new URLSearchParams({
    symbols: symbols.join(","),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  return fetchReportJson<ReportEventsResponse>(
    `${REPORTS_API_BASE}/events?${params.toString()}`,
    signal,
    "Failed to fetch report events",
  );
}
