import { Badge } from "@/ui";
import type { PatternStatus } from "@/types/chartPatterns";

const STATUS_COLORS: Record<string, string> = {
  confirmed: "success",
  forming: "info",
  failed: "error",
  marginal: "warning",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  forming: "Forming",
  failed: "Failed",
  marginal: "Marginal",
};

export interface StatusBadgeProps {
  status: PatternStatus | string | null | undefined;
  "data-testid"?: string;
}

/** Small semantic chip for a pattern detection status. */
export function StatusBadge({ status, "data-testid": testId }: StatusBadgeProps) {
  const key = String(status ?? "").toLowerCase();
  const label = STATUS_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Unknown");
  return (
    <Badge
      color={STATUS_COLORS[key] ?? "default"}
      variant="light"
      size="sm"
      data-testid={testId ?? `patterns-status-${key || "unknown"}`}
    >
      {label}
    </Badge>
  );
}
