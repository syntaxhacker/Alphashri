/**
 * Component-token tier (dark-only).
 *
 * `tailwind.css` declares every `--ui-*` custom property in terms of the
 * existing semantic `--color-fin-*` tokens. This module mirrors those names for
 * TS consumers and owns the finite colour → tone maps the three migrated
 * components share, so Button / Badge / Alert no longer re-derive palette
 * anchors in their own files. Static constants and pure functions only: no DOM
 * reads, no listeners, no runtime theme engine, no new dependency.
 */
import * as palette from "./palette";

/** Canonical tones; one per semantic colour anchor. */
export const UI_TONES = ["primary", "positive", "negative", "warning", "info", "muted"] as const;
export type UiTone = (typeof UI_TONES)[number];

/** Per-tone roles each component paints with. */
export const BUTTON_TONE_SUFFIXES = ["bg", "text", "wash", "wash-hover"] as const;
export const BADGE_TONE_SUFFIXES = ["main", "wash"] as const;
export const ALERT_TONE_SUFFIXES = ["main", "wash", "wash-border"] as const;

/** Roles shared by every tone (one declaration, not one per tone). */
export const BUTTON_SHARED_SUFFIXES = [
  "solid-ink",
  "neutral-border",
  "neutral-text",
  "neutral-muted",
  "neutral-surface",
  "neutral-surface-alt",
] as const;
export const BADGE_SHARED_SUFFIXES = ["filled-ink"] as const;

type ButtonToneSuffix = (typeof BUTTON_TONE_SUFFIXES)[number];
type BadgeToneSuffix = (typeof BADGE_TONE_SUFFIXES)[number];
type AlertToneSuffix = (typeof ALERT_TONE_SUFFIXES)[number];

export type ButtonTokenName =
  | `ui-button-${UiTone}-${ButtonToneSuffix}`
  | `ui-button-${(typeof BUTTON_SHARED_SUFFIXES)[number]}`;
export type BadgeTokenName =
  | `ui-badge-${UiTone}-${BadgeToneSuffix}`
  | `ui-badge-${(typeof BADGE_SHARED_SUFFIXES)[number]}`;
export type AlertTokenName = `ui-alert-${UiTone}-${AlertToneSuffix}`;
export type ComponentTokenName = ButtonTokenName | BadgeTokenName | AlertTokenName;

/** Every declared component token, enumerated for parity tests with the CSS. */
export const BUTTON_TOKEN_NAMES: readonly ButtonTokenName[] = [
  ...UI_TONES.flatMap(
    (tone) => BUTTON_TONE_SUFFIXES.map((suffix) => `ui-button-${tone}-${suffix}` as ButtonTokenName),
  ),
  ...BUTTON_SHARED_SUFFIXES.map((suffix) => `ui-button-${suffix}` as ButtonTokenName),
];

export const BADGE_TOKEN_NAMES: readonly BadgeTokenName[] = [
  ...UI_TONES.flatMap(
    (tone) => BADGE_TONE_SUFFIXES.map((suffix) => `ui-badge-${tone}-${suffix}` as BadgeTokenName),
  ),
  ...BADGE_SHARED_SUFFIXES.map((suffix) => `ui-badge-${suffix}` as BadgeTokenName),
];

export const ALERT_TOKEN_NAMES: readonly AlertTokenName[] = UI_TONES.flatMap((tone) =>
  ALERT_TONE_SUFFIXES.map((suffix) => `ui-alert-${tone}-${suffix}` as AlertTokenName),
);

export const COMPONENT_TOKEN_NAMES: readonly ComponentTokenName[] = [
  ...BUTTON_TOKEN_NAMES,
  ...BADGE_TOKEN_NAMES,
  ...ALERT_TOKEN_NAMES,
];

/** The custom property backing a component token. */
export function componentTokenProperty(name: ComponentTokenName): `--${string}` {
  return `--${name}`;
}

/** `var(--ui-…)` for inline styles; class literals spell the var out for Tailwind. */
export function componentTokenVar(name: ComponentTokenName): string {
  return `var(${componentTokenProperty(name)})`;
}

/** A caller-supplied CSS colour, as opposed to a named semantic colour. */
export function isCustomColor(color: string | undefined): color is string {
  return !!color && (color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl"));
}

/** Raw dark-theme anchors, used only by the contrast helper (never for paint). */
export const TONE_ANCHORS: Record<UiTone, string> = {
  primary: palette.PRIMARY,
  positive: palette.POSITIVE_COLOR,
  negative: palette.NEGATIVE_COLOR,
  warning: palette.WARNING,
  info: palette.INFO,
  muted: palette.TEXT_MUTED_COLOR,
};

/** Button's historical colour aliases (success / error / secondary / …). */
export function buttonTone(color?: string): UiTone {
  switch (String(color)) {
    case "success":
      return "positive";
    case "error":
    case "danger":
      return "negative";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "secondary":
      return "muted";
    default:
      return "primary";
  }
}

/** Badge's status aliases; secondary/default/neutral/dimmed share the muted tone. */
export function badgeTone(color?: string): UiTone {
  switch (String(color)) {
    case "success":
      return "positive";
    case "error":
    case "danger":
      return "negative";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "secondary":
    case "default":
    case "neutral":
    case "dimmed":
      return "muted";
    default:
      return "primary";
  }
}

/** Alert's severity aliases; `primary` and an unset colour both meant INFO. */
export function alertTone(color?: string): UiTone {
  switch (String(color)) {
    case "success":
      return "positive";
    case "error":
    case "danger":
      return "negative";
    case "warning":
      return "warning";
    case "secondary":
      return "muted";
    default:
      return "info";
  }
}
