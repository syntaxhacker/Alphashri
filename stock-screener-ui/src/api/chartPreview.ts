/**
 * Chart Preview API
 *
 * Fetches lightweight chart data for hover preview and expanded charts.
 */

import { fetchWithAuth } from "../state/auth";

const API_BASE = "http://localhost:8765/api/chart/preview";

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

export interface ORBZone {
  date: string;
  date_raw: string;
  or_high: number;
  or_low: number;
  or_end_time: string;
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
  timeframe: number;
  or_minutes?: number;
  total_candles: number;
  error?: string;
}

// Cache for preview data (symbol+tf+days -> data)
const previewCache = new Map<string, { data: ChartPreviewData; timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 1 minute cache

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
    const url = `${API_BASE}/${symbol}?tf=${tf}&days=${days}&or_minutes=${orMinutes}`;
    const response = await fetchWithAuth(url);

    if (!response.ok) {
      console.error("Chart preview fetch failed:", response.status);
      return null;
    }

    const data: ChartPreviewData = await response.json();

    if (data.error) {
      console.error("Chart preview error:", data.error);
      return null;
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
