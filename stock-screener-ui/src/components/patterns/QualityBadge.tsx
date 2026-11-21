import { Badge, Tooltip } from "@/ui";
import type { PatternQuality } from "@/types/chartPatterns";
import { QUALITY_INFO } from "@/config/patternCatalog";
import { qualityBadgeTone, qualityLabel } from "./patternTone";

export interface QualityBadgeProps {
  quality: PatternQuality | string | null | undefined;
  "data-testid"?: string;
}

/** Small semantic chip for shape quality, with a help tooltip explaining the tier. */
export function QualityBadge(props: QualityBadgeProps) {
  const key = () => String(props.quality ?? "").toLowerCase();
  const info = () => QUALITY_INFO[key() as keyof typeof QUALITY_INFO];
  const label = () => qualityLabel(props.quality);
  const testId = () => props["data-testid"];

  const badge = (
    <Badge
      color={qualityBadgeTone(props.quality)}
      variant="outline"
      size="sm"
      data-testid={testId() ?? `patterns-quality-${key() || "unknown"}`}
    >
      {label()}
    </Badge>
  );

  if (!info()) return badge;

  return (
    <Tooltip label={info()!.description} position="top" withArrow multiline>
      {badge}
    </Tooltip>
  );
}
