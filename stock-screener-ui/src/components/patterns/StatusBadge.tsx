import { Badge } from "@/ui";
import type { PatternStatus } from "@/types/chartPatterns";
import { statusBadgeTone, statusLabel } from "./patternTone";

export interface StatusBadgeProps {
  status: PatternStatus | string | null | undefined;
  "data-testid"?: string;
}

/** Small semantic chip for a pattern detection status. */
export function StatusBadge({ status, "data-testid": testId }: StatusBadgeProps) {
  const key = String(status ?? "").toLowerCase();
  const label = statusLabel(status);
  return (
    <Badge
      color={statusBadgeTone(status)}
      variant="light"
      size="sm"
      data-testid={testId ?? `patterns-status-${key || "unknown"}`}
    >
      {label}
    </Badge>
  );
}
