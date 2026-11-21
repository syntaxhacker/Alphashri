import type { DockLayout, DockPanelSpec } from "./types";
import { isRecord } from "@/utils/isRecord";

export const MIN_PANE_SIZE = 0.1;
export const MAX_PANE_SIZE = 4;
export const LAYOUT_WIRE_VERSION = 1;

/** Clamp a saved weight into the band a splitter can still meaningfully move. */
export function clampSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return MIN_PANE_SIZE;
  return Math.min(MAX_PANE_SIZE, Math.max(MIN_PANE_SIZE, n));
}

/** Only a positive finite number is a usable width ceiling. */
function usableMaxWidth(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Bound a desired pane width between its floor and ceiling. A missing or
 * invalid ceiling leaves the width unbounded above; a ceiling below the floor
 * collapses to the floor so the two constraints can never invert.
 */
export function clampPaneWidth(width: number, minWidth: number, maxWidth?: number): number {
  const floor = Math.max(0, minWidth);
  const ceiling = usableMaxWidth(maxWidth);
  const bounded = Math.max(floor, width);
  return ceiling == null ? bounded : Math.min(Math.max(floor, ceiling), bounded);
}

/**
 * Saved layouts are untrusted input (the `view:"map"` lesson): an id that no
 * longer exists is dropped, a missing required singleton is re-appended, and a
 * nonsense size degrades to a clamp instead of throwing on render.
 */
export function normalizeLayout<D extends object = Record<string, unknown>>(
  raw: unknown,
  specs: DockPanelSpec<D>[],
): DockLayout {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const seen = new Set<string>();
  const panes: DockLayout["panes"] = [];

  const rawPanes = isRecord(raw) && Array.isArray(raw.panes) ? raw.panes : [];
  for (const entry of rawPanes) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const spec = byId.get(entry.id);
    if (!spec || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const savedMaxWidth = usableMaxWidth(entry.maxWidth);
    panes.push({
      id: entry.id,
      size: clampSize(typeof entry.size === "number" ? entry.size : spec.size),
      ...(savedMaxWidth == null ? {} : { maxWidth: savedMaxWidth }),
    });
  }

  const rawHidden = isRecord(raw) && Array.isArray(raw.hidden) ? raw.hidden : [];
  const hidden: string[] = [];
  for (const id of rawHidden) {
    if (typeof id !== "string" || !byId.has(id) || seen.has(id) || hidden.includes(id)) continue;
    hidden.push(id);
  }

  for (const spec of specs) {
    if (!spec.singleton || seen.has(spec.id) || hidden.includes(spec.id)) continue;
    panes.push({
      id: spec.id,
      size: clampSize(spec.size),
      ...(usableMaxWidth(spec.maxWidth) == null ? {} : { maxWidth: spec.maxWidth }),
    });
  }

  return { panes, hidden };
}

export function serializeLayout(layout: DockLayout): string {
  return JSON.stringify({ v: LAYOUT_WIRE_VERSION, panes: layout.panes, hidden: layout.hidden });
}

export function parseLayout(raw: string | null | undefined): DockLayout | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.panes) || !Array.isArray(parsed.hidden)) return null;
    const panes = parsed.panes
      .filter((p): p is Record<string, unknown> => isRecord(p) && typeof p.id === "string")
      .map((p) => {
        const ceiling = usableMaxWidth(p.maxWidth);
        return {
          id: p.id as string,
          size: clampSize(p.size),
          ...(ceiling == null ? {} : { maxWidth: ceiling }),
        };
      });
    const hidden = parsed.hidden.filter((id): id is string => typeof id === "string");
    return { panes, hidden };
  } catch {
    return null;
  }
}
