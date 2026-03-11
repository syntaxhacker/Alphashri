/**
 * Filter and sort components
 */

import type { Stock } from "../types";
import * as state from "../state";

export function applyFilters(stocks: Stock[]): Stock[] {
  return stocks.filter(
    (s) =>
      s.score >= state.filters.minScore &&
      s.tv_price <= state.filters.maxPrice &&
      s.recent_return_5d >= state.filters.minReturn &&
      (state.filters.sector === "" || s.sector === state.filters.sector),
  );
}

export function sortStocks(stocks: Stock[]): Stock[] {
  if (!state.sortColumn) return stocks;

  return [...stocks].sort((a, b) => {
    let aVal: any, bVal: any;

    switch (state.sortColumn) {
      case "symbol":
        aVal = a.symbol;
        bVal = b.symbol;
        break;
      case "score":
        aVal = a.score;
        bVal = b.score;
        break;
      case "tv_price":
        aVal = a.tv_price;
        bVal = b.tv_price;
        break;
      case "upstox_price":
        aVal = a.upstox_price;
        bVal = b.upstox_price;
        break;
      case "broker_diff":
        aVal = a.broker_diff;
        bVal = b.broker_diff;
        break;
      case "high_52w":
        aVal = a.high_52w;
        bVal = b.high_52w;
        break;
      case "to_52w_high":
        aVal = a.to_52w_high;
        bVal = b.to_52w_high;
        break;
      case "time_to_52w":
        aVal = a.time_to_52w?.days ?? 999;
        bVal = b.time_to_52w?.days ?? 999;
        break;
      case "recent_return_5d":
        aVal = a.recent_return_5d;
        bVal = b.recent_return_5d;
        break;
      case "perf_w":
        aVal = a.perf_w;
        bVal = b.perf_w;
        break;
      case "day_change":
        aVal = a.day_change ?? 0;
        bVal = b.day_change ?? 0;
        break;
      case "rsi":
        aVal = a.rsi ?? 0;
        bVal = b.rsi ?? 0;
        break;
      case "stoch_k":
        aVal = a.stoch_k ?? 0;
        bVal = b.stoch_k ?? 0;
        break;
      case "wick_close_pct":
        aVal = a.wick_close_pct ?? 0;
        bVal = b.wick_close_pct ?? 0;
        break;
      case "volume_surge":
        aVal = a.volume_surge ?? 0;
        bVal = b.volume_surge ?? 0;
        break;
      case "atr_pct":
        aVal = a.atr_pct ?? 0;
        bVal = b.atr_pct ?? 0;
        break;
      case "adx":
        aVal = a.adx ?? 0;
        bVal = b.adx ?? 0;
        break;
      case "interest_score":
        aVal = a.interest_score ?? 0;
        bVal = b.interest_score ?? 0;
        break;
      case "gap_pct":
        aVal = a.gap_pct ?? 0;
        bVal = b.gap_pct ?? 0;
        break;
      case "premarket_change":
        aVal = a.premarket_change ?? 0;
        bVal = b.premarket_change ?? 0;
        break;
      case "impact_score":
        aVal = a.impact_score ?? 0;
        bVal = b.impact_score ?? 0;
        break;
      case "market_cap_b":
        aVal = a.market_cap_b ?? 0;
        bVal = b.market_cap_b ?? 0;
        break;
      case "volume_m":
        aVal = a.volume_m ?? 0;
        bVal = b.volume_m ?? 0;
        break;
      case "sector":
        aVal = a.sector;
        bVal = b.sector;
        break;
      default:
        return 0;
    }

    if (typeof aVal === "string") {
      return state.sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    return state.sortDirection === "asc" ? aVal - bVal : bVal - aVal;
  });
}

export function handleSort(column: string) {
  if (state.sortColumn === column) {
    state.setSortDirection(state.sortDirection === "asc" ? "desc" : "asc");
  } else {
    state.setSortColumn(column);
    state.setSortDirection("desc");
  }
}

export function renderSortIndicator(column: string): string {
  if (state.sortColumn !== column) return '<span class="sort-indicator"></span>';
  return `<span class="sort-indicator ${state.sortDirection}">${state.sortDirection === "asc" ? "↑" : "↓"}</span>`;
}

export function renderSortableHeader(
  label: string,
  column: string,
  className = "",
  tooltip = "",
): string {
  const tooltipAttr = tooltip ? ` title="${tooltip}"` : "";
  return `<th class="${className} sortable" data-column="${column}"${tooltipAttr} onclick="window.handleSort('${column}')">${label} ${renderSortIndicator(column)}</th>`;
}

export function getUniqueSectors(stocks: Stock[]): string[] {
  return Array.from(new Set(stocks.map((s) => s.sector))).sort();
}
