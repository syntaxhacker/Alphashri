import { Badge } from "@/ui";
import type { PatternQuality } from "@/types/chartPatterns";

const QUALITY_COLORS: Record<string, string> = {
  textbook: "success",
  strong: "primary",
  fair: "info",
  marginal: "warning",
};

const QUALITY_LABELS: Record<string, string> = {
  textbook: "Textbook",
  strong: "Strong",
  fair: "Fair",
  marginal: "Marginal",
};

export interface QualityBadgeProps {
  quality: PatternQuality | string | null | undefined;
  "data-testid"?: string;
}

/** Small semantic chip for shape quality. */
export function QualityBadge({ quality, "data-testid": testId }: QualityBadgeProps) {
  const key = String(quality ?? "").toLowerCase();
  const label = QUALITY_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Unknown");
  return (
    <Badge
      color={QUALITY_COLORS[key] ?? "default"}
      variant="outline"
      size="sm"
      data-testid={testId ?? `patterns-quality-${key || "unknown"}`}
    >
      {label}
    </Badge>
  );
}
