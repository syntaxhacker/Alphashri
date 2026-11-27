/** Shared JSON helpers for report API clients (event watch, profitability). */

import { fetchWithAuth } from "../state/auth";

async function reportRequestError(response: Response, fallback: string): Promise<never> {
  let detail = `HTTP ${response.status}`;
  try {
    const error = await response.json();
    if (error?.detail) detail = String(error.detail);
  } catch {
    // keep status fallback
  }
  throw new Error(detail || fallback);
}

export async function parseReportJson<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  if (!response.ok) await reportRequestError(response, fallback);
  return response.json();
}

/** Fetch a JSON report endpoint, parsing `{ detail }` error bodies into the thrown Error. */
export async function fetchReportJson<T>(
  url: string,
  signal: AbortSignal | undefined,
  fallback: string,
): Promise<T> {
  const response = await fetchWithAuth(url, { signal });
  return parseReportJson(response, fallback);
}
