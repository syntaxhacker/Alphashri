/**
 * Nifty report API client.
 */

import { fetchWithAuth } from "../state/auth";
import type { NiftyReport } from "../types/niftyReport";

import { API_BASE } from "./config";

const NIFTY_API_BASE = `${API_BASE}/api/reports/nifty`;

async function parseNiftyResponse(response: Response): Promise<NiftyReport> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      (error as { detail?: string }).detail || "Failed to fetch Nifty report",
    );
  }
  return response.json();
}

export async function fetchLiveNifty(
  expiry?: string,
  signal?: AbortSignal,
): Promise<NiftyReport> {
  const url = expiry
    ? `${NIFTY_API_BASE}/live?expiry=${encodeURIComponent(expiry)}`
    : `${NIFTY_API_BASE}/live`;
  const response = await fetchWithAuth(url, { signal });
  return parseNiftyResponse(response);
}

export async function fetchNiftyByDate(
  date: string,
  signal?: AbortSignal,
): Promise<NiftyReport> {
  const response = await fetchWithAuth(
    `${NIFTY_API_BASE}?date=${encodeURIComponent(date)}`,
    { signal },
  );
  return parseNiftyResponse(response);
}

export async function snapshotNifty(
  date?: string,
  expiry?: string,
): Promise<NiftyReport> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (expiry) params.set("expiry", expiry);
  const query = params.toString();
  const response = await fetchWithAuth(
    query ? `${NIFTY_API_BASE}/snapshot?${query}` : `${NIFTY_API_BASE}/snapshot`,
    { method: "POST" },
  );
  return parseNiftyResponse(response);
}
