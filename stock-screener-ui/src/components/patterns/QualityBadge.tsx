import { Badge, Tooltip } from "@/ui";
import type { PatternQuality } from "@/types/chartPatterns";
import { QUALITY_INFO } from "@/config/patternCatalog";

const QUALITY_COLORS: Record<string, string> = {
  textbook: "success",
  strong: "primary",
  fair: "info",
  marginal: "warning",
};

export interface QualityBadgeProps {
  quality: PatternQuality | string | null | undefined;
  "data-testid"?: string;
}

/** Small semantic chip for shape quality, with a help tooltip explaining the tier. */
export function QualityBadge({ quality, "data-testid": testId }: QualityBadgeProps) {
  const key = String(quality ?? "").toLowerCase();
  const info = QUALITY_INFO[key as keyof typeof QUALITY_INFO];
  const label = info?.label ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Unknown");

  const badge = (
    <Badge
      color={QUALITY_COLORS[key] ?? "default"}
      variant="outline"
      size="sm"
      data-testid={testId ?? `patterns-quality-${key || "unknown"}`}
    >
      {label}
    </Badge>
  );

  if (!info) return badge;

  return (
    <Tooltip label={info.description} position="top" withArrow multiline>
      {badge}
    </Tooltip>
  );
}
