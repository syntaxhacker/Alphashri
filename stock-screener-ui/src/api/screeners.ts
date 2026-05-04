import { fetchWithAuth } from "../state/auth";
import type { ScreenerOption, SortDirection } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";
const SCREENERS_API = `${API_BASE}/api/screeners`;

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
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Failed to create screener" }));
    throw new Error(err.detail || `HTTP ${response.status}`);
  }
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
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Failed to update screener" }));
    throw new Error(err.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function deleteScreener(id: string): Promise<void> {
  const response = await fetchWithAuth(`${SCREENERS_API}/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Failed to delete screener" }));
    throw new Error(err.detail || `HTTP ${response.status}`);
  }
}
