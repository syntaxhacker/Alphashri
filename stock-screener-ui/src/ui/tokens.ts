/**
 * JS seam for the CSS-var theme. The Tailwind `@theme` block in `tailwind.css`
 * owns the dark values and `:root[data-color-scheme="light"]` owns the overrides;
 * this module only reads them, so charts stop carrying static dark hexes while
 * the CSS remains the single source of truth (`theme-single-source.test.ts`).
 *
 * No listeners, no timers: the accessor re-reads computed style on every call,
 * so a caller only has to call it where it paints. Cheap, and SSR safe.
 */
import * as palette from "./palette";
import { useColorScheme } from "./hooks";

/** Every `--color-fin-*` custom property mirrored in `tailwind.css`. */
export const TOKEN_NAMES = [
  "bg",
  "surface",
  "surface-alt",
  "border",
  "text",
  "text-muted",
  "primary",
  "positive",
  "negative",
  "warning",
  "info",
  "border-subtle",
  "border-default",
  "border-strong",
  "border-focus",
  "border-positive",
  "border-negative",
  "border-warning",
  "border-info",
  "border-disabled",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

const FALLBACKS: Record<TokenName, string> = {
  bg: palette.BG_COLOR,
  surface: palette.SURFACE_COLOR,
  "surface-alt": palette.SURFACE_ALT_COLOR,
  border: palette.BORDER_COLOR,
  text: palette.TEXT_COLOR,
  "text-muted": palette.TEXT_MUTED_COLOR,
  primary: palette.PRIMARY,
  positive: palette.POSITIVE_COLOR,
  negative: palette.NEGATIVE_COLOR,
  warning: palette.WARNING,
  info: palette.INFO,
  "border-subtle": palette.BORDER_SUBTLE,
  "border-default": palette.BORDER_DEFAULT,
  "border-strong": palette.BORDER_STRONG,
  "border-focus": palette.BORDER_FOCUS,
  "border-positive": palette.BORDER_POSITIVE,
  "border-negative": palette.BORDER_NEGATIVE,
  "border-warning": palette.BORDER_WARNING,
  "border-info": palette.BORDER_INFO,
  "border-disabled": palette.BORDER_DISABLED,
};

/** The CSS custom property backing a semantic token. */
export function tokenVar(name: TokenName): string {
  return `--color-fin-${name}`;
}

/**
 * Read a themed colour from the root element. Returns the palette anchor when
 * there is no DOM (SSR) or the stylesheet has not declared the variable yet.
 */
export function tokenColor(name: TokenName): string {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return FALLBACKS[name];
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(tokenVar(name)).trim();
  return value || FALLBACKS[name];
}

/**
 * Accessor for chart/JS consumers. It re-reads computed style on each call and
 * tracks the shared scheme signal, so reading it inside an effect repaints when
 * light/dark flips. No resize/media listeners are installed.
 */
export function useTokenColor(name: TokenName): () => string {
  const { colorScheme } = useColorScheme();
  return () => {
    colorScheme();
    return tokenColor(name);
  };
}
