/**
 * Pure helpers for screener request URLs and screener payload reads.
 * Shared by the screener hooks so query-string shape and defaults live in
 * exactly one place. No React, no fetch — keep URLs byte-identical.
 */
import { API_BASE } from "@/api/config";
import type { ScreenerData, Stock } from "../types";

export const SCREENER_DEFAULT_PROVIDER = "upstox";
export const SCREENER_DEFAULT_MODE = "intraday";
export const SCREENER_API_URL = `${API_BASE}/api/screener`;

export function normalizeScreenerId(screener: string): string {
  return screener.replace(/^builtin:/, "");
}

export function isEmptyFilterValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export interface ScreenerBaseParams {
  provider?: string;
  mode?: string;
  screener: string;
  stripBuiltinPrefix?: boolean;
}

export function createBaseSearchParams({
  provider,
  mode,
  screener,
  stripBuiltinPrefix = false,
}: ScreenerBaseParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  searchParams.set("provider", provider || SCREENER_DEFAULT_PROVIDER);
  searchParams.set("mode", mode || SCREENER_DEFAULT_MODE);
  searchParams.set("screener", stripBuiltinPrefix ? normalizeScreenerId(screener) : screener);
  return searchParams;
}

export function appendFilterRecord(
  searchParams: URLSearchParams,
  filters?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!filters) return;
  Object.entries(filters).forEach(([key, value]) => {
    if (!isEmptyFilterValue(value)) {
      searchParams.set(key, String(value));
    }
  });
}

export interface ScreenerFilterDefault {
  key: string;
  default?: unknown;
}

export function appendFilterDefaults(
  searchParams: URLSearchParams,
  filters?: ScreenerFilterDefault[] | null,
): void {
  if (!Array.isArray(filters) || filters.length === 0) return;
  filters.forEach((filter) => {
    if (filter && filter.default !== undefined) {
      searchParams.set(filter.key, String(filter.default));
    }
  });
}

export interface ScreenerApiUrlParams {
  provider?: string;
  mode?: string;
  screener: string;
  filters?: Record<string, string | number | boolean | null | undefined>;
}

/** URL for the screener fetch used by useScreenerApi (keeps any builtin: prefix). */
export function buildScreenerApiUrl(params: ScreenerApiUrlParams): string {
  const searchParams = createBaseSearchParams(params);
  appendFilterRecord(searchParams, params.filters);
  return `${SCREENER_API_URL}?${searchParams.toString()}`;
}

export interface ScreenerPreviewUrlParams {
  screener: string;
  columns?: string[];
  filters?: ScreenerFilterDefault[] | null;
}

/** URL for the preview fetch used by useScreenerPreview (strips builtin:, adds columns). */
export function buildScreenerPreviewUrl({
  screener,
  columns,
  filters,
}: ScreenerPreviewUrlParams): string {
  const searchParams = createBaseSearchParams({
    provider: SCREENER_DEFAULT_PROVIDER,
    mode: SCREENER_DEFAULT_MODE,
    screener,
    stripBuiltinPrefix: true,
  });
  if (columns && columns.length > 0) {
    searchParams.set("columns", columns.join(","));
  }
  appendFilterDefaults(searchParams, filters);
  return `${SCREENER_API_URL}?${searchParams.toString()}`;
}

export function approachingStocksOf(data?: Pick<ScreenerData, "approaching"> | null): Stock[] {
  return data?.approaching || [];
}

export function touchedStocksOf(data?: Pick<ScreenerData, "touched"> | null): Stock[] {
  return data?.touched || [];
}
