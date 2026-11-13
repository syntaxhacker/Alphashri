import {
  POSITIVE,
  NEGATIVE,
  WARNING,
  INDICATOR_BLUE_A,
  ROTATION_COOLING,
  ROTATION_HEATING,
  TEXT_MUTED,
} from "@/ui/palette";
import type { RotationStatus } from "@/types/rotation";

export { RotationStatus };

export const ROTATION_STATUS_LABELS: Record<RotationStatus, { short: string; long: string }> = {
  booming: { short: "BOOM", long: "BOOMING" },
  heating: { short: "HEAT", long: "HEATING" },
  cooling: { short: "COOL", long: "COOLING" },
  dumping: { short: "DUMP", long: "DUMPING" },
  neutral: { short: "FLAT", long: "FLAT" },
};

export const ROTATION_STATUS_TONE: Record<RotationStatus, "positive" | "warning" | "info" | "negative" | "muted"> = {
  booming: "positive",
  heating: "warning",
  cooling: "info",
  dumping: "negative",
  neutral: "muted",
};

export const ROTATION_STATUS_COLORS_BOARD: Record<RotationStatus, string> = {
  booming: "var(--color-fin-positive)",
  heating: ROTATION_HEATING,
  cooling: ROTATION_COOLING,
  dumping: "var(--color-fin-negative)",
  neutral: TEXT_MUTED,
};

export const ROTATION_STATUS_COLORS_PANEL: Record<RotationStatus, string> = {
  booming: POSITIVE,
  heating: WARNING,
  cooling: INDICATOR_BLUE_A,
  dumping: NEGATIVE,
  neutral: TEXT_MUTED,
};