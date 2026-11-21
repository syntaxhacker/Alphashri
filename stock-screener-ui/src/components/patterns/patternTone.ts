import { QUALITY_INFO } from "@/config/patternCatalog";
import {
  INFO,
  NEUTRAL,
  NEGATIVE,
  PATTERN_CONFIRMED,
  PATTERN_FAILED,
  PATTERN_FORMING,
  PATTERN_MARGINAL,
  POSITIVE,
  TEXT_MUTED,
  WARNING,
} from "@/ui/palette";
import type { DisplayTone } from "./patternDisplayStatus";

/** Semantic badge colours (FIN palette tokens). */
export type BadgeTone = "success" | "info" | "error" | "warning" | "primary" | "default";
/** Text/`c` tones understood by `@/ui` Text. */
export type TextTone = "success" | "error" | "dimmed";

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  forming: "Forming",
  failed: "Failed",
  marginal: "Marginal",
};

const STATUS_BADGE_TONE: Record<string, BadgeTone> = {
  confirmed: "success",
  forming: "info",
  failed: "error",
  marginal: "warning",
};

/** Raw chart colours (canvas/SVG), deliberately not theme tokens. */
const STATUS_CHART_COLOR: Record<string, string> = {
  confirmed: PATTERN_CONFIRMED,
  forming: PATTERN_FORMING,
  failed: PATTERN_FAILED,
  marginal: PATTERN_MARGINAL,
};

const QUALITY_BADGE_TONE: Record<string, BadgeTone> = {
  textbook: "success",
  strong: "primary",
  fair: "info",
  marginal: "warning",
};

export function statusLabel(status: string | null | undefined): string {
  const key = String(status ?? "").toLowerCase();
  return STATUS_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Unknown");
}

export function statusBadgeTone(status: string | null | undefined): BadgeTone {
  return STATUS_BADGE_TONE[String(status ?? "").toLowerCase()] ?? "default";
}

export function statusChartColor(status: string | null | undefined): string {
  return STATUS_CHART_COLOR[String(status ?? "").toLowerCase()] ?? TEXT_MUTED;
}

export function qualityBadgeTone(quality: string | null | undefined): BadgeTone {
  return QUALITY_BADGE_TONE[String(quality ?? "").toLowerCase()] ?? "default";
}

/** Full quality label; `fallback` covers empty/unknown tiers (surfaces differ). */
export function qualityLabel(
  quality: string | null | undefined,
  fallback = "Unknown",
): string {
  const key = String(quality ?? "").toLowerCase();
  const info = QUALITY_INFO[key as keyof typeof QUALITY_INFO];
  if (info) return info.label;
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : fallback;
}

/** Positive/negative change as raw chart colour. */
export function changeChartColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return TEXT_MUTED;
  return value >= 0 ? PATTERN_CONFIRMED : PATTERN_FAILED;
}

/** Positive/negative change as a `Text c` tone. */
export function changeTextTone(value: number | null | undefined): TextTone {
  if (value == null || !Number.isFinite(value)) return "dimmed";
  return value >= 0 ? "success" : "error";
}

/** `TextTone` → raw chart/hex colour. Unknown tones mute to `TEXT_MUTED`. */
export function textToneChartColor(tone: string | null | undefined): string {
  switch (String(tone ?? "").toLowerCase()) {
    case "success":
      return POSITIVE;
    case "error":
      return NEGATIVE;
    default:
      return TEXT_MUTED;
  }
}

const DISPLAY_TONE_COLOR: Record<DisplayTone, string> = {
  success: POSITIVE,
  warning: WARNING,
  error: NEGATIVE,
  info: INFO,
  neutral: NEUTRAL,
};

/** Derived display-status tone → palette colour (status pill dot + text). */
export function displayToneColor(tone: DisplayTone): string {
  return DISPLAY_TONE_COLOR[tone] ?? NEUTRAL;
}
