import { fetchWithAuth } from "../state/auth";
import type { ScreenerOption, SortDirection } from "../types";

import { API_BASE } from "@/api/config";
const SCREENERS_API = `${API_BASE}/api/screeners`;

// Shared !ok handler: parse the server's `detail` message, falling back to the HTTP status.
async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  const err = await response.json().catch(() => ({ detail: fallback }));
  throw new Error(err.detail || `HTTP ${response.status}`);
}

export interface CreateScreenerPayload {
  name: string;
  description?: string;
  indicators?: string[];
  columns?: string[];
  filters?: Record<string, any>;
  default_sort?: { column: string; direction: SortDirection };
}

export async function createScreener(payload: CreateScreenerPayload): Promise<ScreenerOption> {
  const response = await fetchWithAuth(SCREENERS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureOk(response, "Failed to create screener");
  return response.json();
}

export async function updateScreener(
  id: string,
  payload: Partial<CreateScreenerPayload>,
): Promise<ScreenerOption> {
  const response = await fetchWithAuth(`${SCREENERS_API}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureOk(response, "Failed to update screener");
  return response.json();
}

export async function deleteScreener(id: string): Promise<void> {
  const response = await fetchWithAuth(`${SCREENERS_API}/${id}`, {
    method: "DELETE",
  });
  await ensureOk(response, "Failed to delete screener");
}
