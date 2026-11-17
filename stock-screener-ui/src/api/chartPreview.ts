/**
 * Chart Preview API
 *
 * Fetches lightweight chart data for hover preview and expanded charts.
 */

import { fetchWithAuth } from "../state/auth";
import type { ORBZone } from "../types/backtest";
import { API_ENDPOINTS } from "./config";

const API_BASE = API_ENDPOINTS.CHART_PREVIEW;

export interface PreviewCandle {
  time: string; // "2025-10-24T09:15"
  date: string; // "2025-10-24"
  time_str: string; // "09:15"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PivotLevel {
  date: string;
  date_raw: string;
  pp: number; // Pivot Point
  r1: number; // Resistance 1
  s1: number; // Support 1
  r2?: number; // Resistance 2
  s2?: number; // Support 2
}

export interface ChartPreviewData {
  symbol: string;
  candles: PreviewCandle[];
  orb_zones: ORBZone[];
  pivot_levels: PivotLevel[];
  high_52w?: number | null;
  timeframe: number;
  or_minutes?: number;
  total_candles: number;
  error?: string;
}

// Cache for preview data (symbol+tf+days -> data)
const previewCache = new Map<string, { data: ChartPreviewData; timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 1 minute cache

const MAX_PREVIEW_DAYS = 30;

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The endpoint always walks back from the last trading day, so a trade date has
 * to be expressed as a session count for its candles to fall inside the window.
 */
export function previewDaysForDate(date: string, today: Date = new Date()): number {
  const target = parseIsoDate(date);
  if (!target) return 1;

  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (target.getTime() >= end.getTime()) return 1;

  let sessions = 1;
  const cursor = new Date(target);
  while (cursor < end && sessions < MAX_PREVIEW_DAYS) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) sessions += 1;
  }
  return sessions;
}

/**
 * Fetch chart preview data for a symbol.
 *
 * @param symbol - Stock symbol (e.g., "TATAMOTORS")
 * @param tf - Timeframe in minutes (default 15)
 * @param days - Days of history (default 1 for hover preview)
 * @param orMinutes - Opening range period in minutes (default 45)
 * @returns Chart preview data with candles, ORB zones, and pivot levels
 */
export async function fetchChartPreview(
  symbol: string,
  tf: number = 15,
  days: number = 1,
  orMinutes: number = 45,
): Promise<ChartPreviewData | null> {
  if (!symbol) {
    return null;
  }

  const cacheKey = `${symbol}:${tf}:${days}:${orMinutes}`;

  // Check cache
  const cached = previewCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = `${API_BASE}/${encodeURIComponent(symbol)}?tf=${tf}&days=${days}&or_minutes=${orMinutes}`;
    const response = await fetchWithAuth(url);

    if (!response.ok) {
      console.error("Chart preview fetch failed:", response.status);
      return null;
    }

    const data: ChartPreviewData = await response.json();

    if (data.error) {
      return data;
    }

    // Cache the result
    previewCache.set(cacheKey, { data, timestamp: Date.now() });

    return data;
  } catch (error) {
    console.error("Chart preview error:", error);
    return null;
  }
}

/**
 * Clear the preview cache for a specific symbol or all.
 */
export function clearPreviewCache(symbol?: string): void {
  if (symbol) {
    // Clear all entries for this symbol
    for (const key of previewCache.keys()) {
      if (key.startsWith(symbol + ":")) {
        previewCache.delete(key);
      }
    }
  } else {
    previewCache.clear();
  }
}
