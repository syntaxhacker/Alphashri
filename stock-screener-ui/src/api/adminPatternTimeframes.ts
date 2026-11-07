import type { AdminPatternTimeframe } from "../types/admin";

import { API_BASE } from "@/api/config";
const ADMIN_PATTERN_TIMEFRAMES_BASE = `${API_BASE}/api/admin/pattern-timeframes`;

export type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>;

async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = (await response.json().catch(() => ({}))) as { detail?: unknown };
  const detail = body?.detail;
  const message =
    typeof detail === "string" && detail
      ? detail
      : detail != null
        ? JSON.stringify(detail)
        : `HTTP ${response.status}`;
  throw new Error(message);
}

export async function fetchAdminPatternTimeframes(
  fetchWithAuth: FetchWithAuth,
): Promise<AdminPatternTimeframe[]> {
  const response = await ensureOk(await fetchWithAuth(ADMIN_PATTERN_TIMEFRAMES_BASE));
  const body = (await response.json()) as { timeframes?: AdminPatternTimeframe[] };
  return body.timeframes ?? [];
}

export async function setAdminPatternTimeframeEnabled(
  fetchWithAuth: FetchWithAuth,
  id: string,
  enabled: boolean,
): Promise<AdminPatternTimeframe> {
  const response = await ensureOk(
    await fetchWithAuth(`${ADMIN_PATTERN_TIMEFRAMES_BASE}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  );
  const body = (await response.json()) as { timeframe: AdminPatternTimeframe };
  return body.timeframe;
}

export interface AddAdminPatternTimeframePayload {
  id: string;
  label: string;
  minutes: number;
  source_tf?: string | null;
  max_lookback_days?: number;
  min_bars?: number;
}

export async function addAdminPatternTimeframe(
  fetchWithAuth: FetchWithAuth,
  payload: AddAdminPatternTimeframePayload,
): Promise<AdminPatternTimeframe> {
  const response = await ensureOk(
    await fetchWithAuth(ADMIN_PATTERN_TIMEFRAMES_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  const body = (await response.json()) as { timeframe: AdminPatternTimeframe };
  return body.timeframe;
}

export async function deleteAdminPatternTimeframe(
  fetchWithAuth: FetchWithAuth,
  id: string,
): Promise<string> {
  const response = await ensureOk(
    await fetchWithAuth(`${ADMIN_PATTERN_TIMEFRAMES_BASE}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  );
  const body = (await response.json()) as { deleted?: string };
  return body.deleted ?? id;
}

export async function reorderAdminPatternTimeframes(
  fetchWithAuth: FetchWithAuth,
  ids: string[],
): Promise<AdminPatternTimeframe[]> {
  const response = await ensureOk(
    await fetchWithAuth(`${ADMIN_PATTERN_TIMEFRAMES_BASE}/order`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
  const body = (await response.json()) as { timeframes?: AdminPatternTimeframe[] };
  return body.timeframes ?? [];
}
