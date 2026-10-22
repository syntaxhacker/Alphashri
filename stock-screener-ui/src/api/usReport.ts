/** US futures + options report API client. */

import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "./config";
import type { UsEod, UsLive, UsStatus, UsTape } from "../types/usReport";

const US_API = `${API_BASE}/api/reports/us`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetchWithAuth(`${US_API}${path}`);
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body);
    } catch {
      /* keep status text */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const fetchUsLive = (root: string) => getJson<UsLive>(`/live?root=${root}`);

export const fetchUsTape = (root: string, date: string) =>
  getJson<UsTape>(`/tape?root=${root}&date=${date}`);

export const fetchUsEod = (root: string, date: string) =>
  getJson<UsEod>(`/eod?root=${root}&date=${date}`);

export const fetchUsDates = (root: string) =>
  getJson<{ root: string; dates: string[] }>(`/replay/dates?root=${root}`);

export const fetchUsStatus = () => getJson<UsStatus>(`/tape/status`);
