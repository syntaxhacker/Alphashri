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

export async function fetchDailyReport(
  date?: string,
  universe: string = "nifty500",
  signal?: AbortSignal,
): Promise<DailyReportResponse> {
  const params = new URLSearchParams({
    date: date || todayIST(),
    universe,
  });
  const response = await fetchWithAuth(`${REPORTS_API_BASE}/daily?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      if (error?.detail) detail = String(error.detail);
    } catch {
      // keep status fallback
    }
    throw new Error(detail || "Failed to fetch daily report");
  }
  return response.json();
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
  const response = await fetchWithAuth(`${REPORTS_API_BASE}/breakouts?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      if (error?.detail) detail = String(error.detail);
    } catch {
      // keep status fallback
    }
    throw new Error(detail || "Failed to fetch report breakouts");
  }
  return response.json();
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
  const response = await fetchWithAuth(`${REPORTS_API_BASE}/follow-through?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      if (error?.detail) detail = String(error.detail);
    } catch {
      // keep status fallback
    }
    throw new Error(detail || "Failed to fetch report follow-through");
  }
  return response.json();
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
  const response = await fetchWithAuth(`${REPORTS_API_BASE}/delivery?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      if (error?.detail) detail = String(error.detail);
    } catch {
      // keep status fallback
    }
    throw new Error(detail || "Failed to fetch delivery report");
  }
  return response.json();
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
  const response = await fetchWithAuth(`${REPORTS_API_BASE}/events?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      if (error?.detail) detail = String(error.detail);
    } catch {
      // keep status fallback
    }
    throw new Error(detail || "Failed to fetch report events");
  }
  return response.json();
}
