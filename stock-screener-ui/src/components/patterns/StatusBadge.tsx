import { splitProps } from "solid-js";
import { Badge } from "@/ui";
import type { PatternStatus } from "@/types/chartPatterns";
import type { DisplayStatus, DisplayTone } from "./patternDisplayStatus";
import { statusBadgeTone, statusLabel, type BadgeTone } from "./patternTone";

export interface StatusBadgeProps {
  status: PatternStatus | string | null | undefined;
  display?: DisplayStatus | null;
  "data-testid"?: string;
}

function titleCase(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

function toneToBadgeTone(tone: DisplayTone): BadgeTone {
  return tone === "neutral" ? "default" : tone;
}

export function StatusBadge(props: StatusBadgeProps) {
  const [local] = splitProps(props, ["status", "display"]);
  const key = () => String(local.status ?? "").toLowerCase();
  const label = () => (local.display ? titleCase(local.display.label) : statusLabel(local.status));
  const color = () =>
    local.display ? toneToBadgeTone(local.display.tone) : statusBadgeTone(local.status);
  return (
    <Badge
      color={color()}
      variant="light"
      size="sm"
      data-testid={props["data-testid"] ?? `patterns-status-${key() || "unknown"}`}
    >
      {label()}
    </Badge>
  );
}
