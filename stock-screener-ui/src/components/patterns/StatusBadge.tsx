import { Badge } from "@/ui";
import type { PatternStatus } from "@/types/chartPatterns";
import type { DisplayStatus, DisplayTone } from "./patternDisplayStatus";
import { statusBadgeTone, statusLabel, type BadgeTone } from "./patternTone";

export interface StatusBadgeProps {
  status: PatternStatus | string | null | undefined;
  /** Derived display status (ARMED / BREAKOUT / …). Falls back to `status`. */
  display?: DisplayStatus | null;
  "data-testid"?: string;
}

/** `BREAKOUT` → `Breakout` — badges are sentence-case, the card pill is upper. */
function titleCase(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

function toneToBadgeTone(tone: DisplayTone): BadgeTone {
  return tone === "neutral" ? "default" : tone;
}

/** Small semantic chip for a pattern detection status. */
export function StatusBadge({ status, display, "data-testid": testId }: StatusBadgeProps) {
  const key = String(status ?? "").toLowerCase();
  const label = display ? titleCase(display.label) : statusLabel(status);
  const color = display ? toneToBadgeTone(display.tone) : statusBadgeTone(status);
  return (
    <Badge
      color={color}
      variant="light"
      size="sm"
      data-testid={testId ?? `patterns-status-${key || "unknown"}`}
    >
      {label}
    </Badge>
  );
}
