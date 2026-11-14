import { createMemo, For, Show } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { LocalCompactPanel } from "./reportBits";
import type { NiftyStructureShift } from "@/types/niftyReport";

/** Short uppercase labels for the known structural-shift kinds. */
const STRUCTURE_KIND_LABELS: Record<string, string> = {
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

interface NiftyStructureShiftsProps {
  structure?: NiftyStructureShift[];
}

/**
 * Compact "why" behind the numbers: timestamped structural shifts in the
 * option tape. Absent `structure` renders nothing; an empty array renders a
 * friendly empty state. Newest arrives last on the payload and is shown first.
 */
export function NiftyStructureShifts(props: NiftyStructureShiftsProps) {
  // Newest is last in the payload — reverse so the latest shift leads.
  const ordered = createMemo(() => (props.structure ? [...props.structure].reverse() : []));
  const summary = createMemo(() => structureSummary(props.structure ?? []));

  return (
    <Show when={props.structure}>
      {/* Wrapper is a flex item inside the report's "signals row" (structure +
          OI bursts). It intentionally has no `overflow: hidden`: that would drop
          the implicit `min-height: auto` and could collapse it. `flex`/`min-width`
          size it horizontally; `min-width: 0` contains horizontal overflow while
          the internal list (below) owns the vertical scroll. */}
      <div data-testid="nifty-structure" class="flex-[1_1_420px] min-w-0">
        <LocalCompactPanel title="Structure shifts">
          <div data-testid="nifty-structure-summary" class="mb-[2px]">
            <Text size="xs" fw={600} c="dimmed" span>
              {summary()}
            </Text>
          </div>

          <Show
            when={ordered().length > 0}
            fallback={
              <Text data-testid="nifty-structure-empty" size="sm" c="dimmed">
                No structural shifts yet today
              </Text>
            }
          >
            {/* Dense single-line list (~15px/row: no vertical padding,
                line-height 1.2) capped to a fixed height so the panel never
                grows unbounded — overflow scrolls inside the panel. This is an
                INNER scroller, never a direct page-column child. */}
            <div
              data-testid="nifty-structure-list"
              class="flex flex-col gap-[2px] min-w-0"
              style={{ "max-height": "120px", "overflow-y": "auto" }}
            >
              <For each={ordered()}>{(shift) => {
                const accent = structureSeverityAccent(shift.severity);
                const full = shift.detail || STRUCTURE_DASH;
                return (
                  <div
                    data-testid="nifty-structure-row"
                    class="flex items-center gap-[8px] min-w-0 pl-1 pr-1 py-0 leading-[1.2]"
                    style={{
                      "border-left": `3px solid ${accent}`,
                      "background-color": palette.SURFACE_ALT,
                      "border-radius": "4px",
                    }}
                  >
                    <span class="shrink-0 whitespace-nowrap">
                      <Text size="xs" fw={700} c={accent} span>
                        {structureKindLabel(shift.kind)}
                      </Text>
                    </span>
                    <span class="shrink-0 whitespace-nowrap">
                      <Text size="xs" c="dimmed" span>
                        {structureTimeLabel(shift.t)}
                      </Text>
                    </span>
                    <span
                      data-testid="nifty-structure-detail"
                      title={full}
                      class="flex-1 min-w-0 overflow-hidden truncate whitespace-nowrap"
                    >
                      <Text size="xs" c="dimmed" span>
                        {full}
                      </Text>
                    </span>
                  </div>
                );
              }}</For>
            </div>
          </Show>
        </LocalCompactPanel>
      </div>
    </Show>
  );
}
