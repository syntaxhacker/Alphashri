import { memo, useMemo } from "react";
import Box from "@mui/material/Box";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel } from "@/components/common/compact";
import type { NiftyStructureShift } from "@/types/niftyReport";

/** Short uppercase labels for the known structural-shift kinds. */
export const STRUCTURE_KIND_LABELS: Record<string, string> = {
  wall_flip: "WALL FLIP",
  wall_move: "WALL MOVE",
  max_pain_drift: "MAX PAIN",
  pcr_shift: "PCR SHIFT",
  volume_spike: "VOL SPIKE",
  level_break: "LEVEL BREAK",
};

/** Rendered for any absent field so a row never shows a blank cell. */
export const STRUCTURE_DASH = "—";

/**
 * Critical gets the strongest (negative/red) accent, alert the warning
 * (orange), and watch — like any unknown severity — the weakest muted tone.
 */
export function structureSeverityAccent(severity: string | null | undefined): string {
  const s = String(severity ?? "").trim().toLowerCase();
  if (s === "critical") return palette.NEGATIVE;
  if (s === "alert") return palette.WARNING;
  return palette.TEXT_MUTED;
}

/**
 * Uppercase label for a shift kind. Unknown kinds fall back to a readable
 * form of the raw string (never dropped, never blank).
 */
export function structureKindLabel(kind: string | null | undefined): string {
  const k = String(kind ?? "").trim().toLowerCase();
  if (STRUCTURE_KIND_LABELS[k]) return STRUCTURE_KIND_LABELS[k];
  const fallback = k.toUpperCase().replace(/[_-]+/g, " ").trim();
  return fallback || "SHIFT";
}

/** IST `HH:MM` for a shift timestamp; falls back to the raw clock or a dash. */
export function structureTimeLabel(t: string | null | undefined): string {
  const raw = String(t ?? "").trim();
  if (!raw) return STRUCTURE_DASH;
  const clock = /^(\d{2}:\d{2})/.exec(raw);
  if (clock) return clock[1];
  const iso = /T(\d{2}:\d{2})/.exec(raw);
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleTimeString("en-IN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });
  }
  return iso ? iso[1] : STRUCTURE_DASH;
}

/** Header line, e.g. `7 shifts · 1 critical`. */
export function structureSummary(shifts: NiftyStructureShift[]): string {
  const total = shifts.length;
  const critical = shifts.filter(
    (s) => String(s?.severity ?? "").trim().toLowerCase() === "critical",
  ).length;
  return `${total} ${total === 1 ? "shift" : "shifts"} · ${critical} critical`;
}

export interface NiftyStructureShiftsProps {
  structure?: NiftyStructureShift[];
}

/**
 * Compact "why" behind the numbers: timestamped structural shifts in the
 * option tape. Absent `structure` renders nothing; an empty array renders a
 * friendly empty state. Newest arrives last on the payload and is shown first.
 */
function NiftyStructureShiftsInner({ structure }: NiftyStructureShiftsProps) {
  // Hooks stay unconditional: the absent-payload case returns null AFTER
  // them, so toggling between null/defined never changes the hook order.
  // Newest is last in the payload — reverse so the latest shift leads.
  const ordered = useMemo(
    () => (structure ? [...structure].reverse() : []),
    [structure],
  );
  const summary = useMemo(() => structureSummary(structure ?? []), [structure]);

  if (!structure) return null;

  return (
    // Wrapper is a flex item inside the report's "signals row" (structure +
    // OI bursts). It intentionally has no `overflow: hidden`: that would drop
    // the implicit `min-height: auto` and could collapse it. `flex`/`minWidth`
    // size it horizontally; `minWidth: 0` contains horizontal overflow while
    // the internal list (below) owns the vertical scroll.
    <Box data-testid="nifty-structure" sx={{ flex: "1 1 420px", minWidth: 0 }}>
      <CompactPanel title="Structure shifts">
        <Box data-testid="nifty-structure-summary" sx={{ mb: 0.25 }}>
          <Text size="xs" fw={600} c="dimmed" span>
            {summary}
          </Text>
        </Box>

        {ordered.length === 0 ? (
          <Text data-testid="nifty-structure-empty" size="sm" c="dimmed">
            No structural shifts yet today
          </Text>
        ) : (
          // Dense single-line list (~15px/row: no vertical padding,
          // lineHeight 1.2) capped to a fixed height so the panel never
          // grows unbounded — overflow scrolls inside the panel. This is an
          // INNER scroller, never a direct page-column child.
          <Box
            data-testid="nifty-structure-list"
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0.25,
              minWidth: 0,
              maxHeight: 120,
              overflowY: "auto",
            }}
          >
            {ordered.map((shift, i) => {
              const accent = structureSeverityAccent(shift.severity);
              const full = shift.detail || STRUCTURE_DASH;
              return (
                <Box
                  key={`${shift.t}-${shift.kind}-${i}`}
                  data-testid="nifty-structure-row"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    minWidth: 0,
                    pl: 1,
                    pr: 1,
                    py: 0,
                    borderLeft: `3px solid ${accent}`,
                    bgcolor: palette.SURFACE_ALT,
                    borderRadius: 0.5,
                    lineHeight: 1.2,
                  }}
                >
                  <Box component="span" sx={{ flexShrink: 0, whiteSpace: "nowrap" }}>
                    <Text size="xs" fw={700} c={accent} span>
                      {structureKindLabel(shift.kind)}
                    </Text>
                  </Box>
                  <Box component="span" sx={{ flexShrink: 0, whiteSpace: "nowrap" }}>
                    <Text size="xs" c="dimmed" span>
                      {structureTimeLabel(shift.t)}
                    </Text>
                  </Box>
                  <Box
                    component="span"
                    data-testid="nifty-structure-detail"
                    title={full}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Text size="xs" c="dimmed" span>
                      {full}
                    </Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </CompactPanel>
    </Box>
  );
}

/** Memoised leaf panel — `structure` keeps identity between unrelated parent renders. */
export const NiftyStructureShifts = memo(NiftyStructureShiftsInner);
NiftyStructureShifts.displayName = "NiftyStructureShifts";
