/**
 * Profile meta utilities
 */

import type { ProfileMeta } from "../types";
import * as state from "../state";

export function getActiveProfileMeta(): ProfileMeta {
  if (!state.data) {
    return state.profileMetaById[state.activeScreener] || {};
  }
  return state.data.profile_meta || state.profileMetaById[state.activeScreener] || {};
}

export function getSectionLabels(): { primary: string; secondary: string } {
  const meta = getActiveProfileMeta();
  return (
    meta.section_labels || {
      primary: "🎯 APPROACHING 52W HIGH",
      secondary: "✅ ALREADY TOUCHED 52W HIGH",
    }
  );
}

export function initProfileFilters(screener: string) {
  const meta = state.profileMetaById[screener] || {};
  const defs = meta.filters || [];
  const values: Record<string, string | number> = {};
  defs.forEach((f) => {
    values[f.key] = f.default ?? (f.type === "number" ? 0 : "");
  });
  state.setProfileFilterValues(values);
}

export function applyProfileFilters(stocks: any[]): any[] {
  // Profile filters are handled server-side through query params.
  return stocks;
}
