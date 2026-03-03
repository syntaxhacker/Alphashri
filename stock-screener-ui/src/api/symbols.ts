/**
 * Symbol Search API
 *
 * Generic API for searching stock symbols.
 * Used by autocomplete components throughout the UI.
 */

import { fetchWithAuth } from "../state/auth";

const API_BASE = "http://localhost:8765/api/symbols";

export interface SymbolResult {
  symbol: string; // Trading symbol (e.g., "TATASTEEL")
  name: string; // Company name (e.g., "Tata Steel Limited")
  isin?: string; // ISIN code
}

export interface SearchResponse {
  results: SymbolResult[];
  query: string;
  total: number;
}

/**
 * Search for stock symbols by query string.
 * Searches both symbol and company name.
 *
 * @param query - Search query (min 1 character)
 * @param limit - Maximum results to return (default 10)
 * @returns Array of matching symbols
 */
export async function searchSymbols(query: string, limit: number = 10): Promise<SymbolResult[]> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  try {
    const url = `${API_BASE}/search?q=${encodeURIComponent(query.trim())}&limit=${limit}`;
    const response = await fetchWithAuth(url);

    if (!response.ok) {
      console.error("Symbol search failed:", response.status);
      return [];
    }

    const data: SearchResponse = await response.json();
    return data.results || [];
  } catch (error) {
    console.error("Symbol search error:", error);
    return [];
  }
}
