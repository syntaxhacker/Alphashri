// Local UI provider. Styling still comes from Tailwind tokens + sxTheme; the
// provider's one job is to bridge the colour-scheme props onto the shared
// `useColorScheme` signal so CSS vars, charts and JS token readers agree.
import { createEffect, on, type JSX } from "solid-js";
import { applyColorScheme, hasStoredColorScheme } from "./hooks";
import * as palette from "./palette";
import { TYPE_SCALE } from "./typography";

/**
 * JS-side tokens for chart option builders and token readers. The colour
 * aliases point straight at palette.ts so there is no second palette to drift;
 * the font values mirror the fallbacks the chart code already carries, so
 * reading them from the theme changes nothing visually.
 */
export const uiTheme = {
  fontFamily: '"IBM Plex Sans", "Roboto", system-ui, sans-serif',
  fontSizes: {
    // Semantic roles first; the legacy chart names are aliases so no chart
    // invents a fifth scale.
    micro: `${TYPE_SCALE.micro.size}px`,
    body: `${TYPE_SCALE.body.size}px`,
    label: `${TYPE_SCALE.label.size}px`,
    title: `${TYPE_SCALE.title.size}px`,
    heading: `${TYPE_SCALE.heading.size}px`,
    display: `${TYPE_SCALE.display.size}px`,
    sm: `${TYPE_SCALE.micro.size}px`,
    md: `${TYPE_SCALE.label.size}px`,
    lg: `${TYPE_SCALE.title.size}px`,
    xl: `${TYPE_SCALE.heading.size}px`,
  },
  fontWeights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  colors: {
    primary: palette.PRIMARY,
    success: palette.POSITIVE,
    error: palette.NEGATIVE,
    warning: palette.WARNING,
    info: palette.INFO,
    text: palette.TEXT,
    textMuted: palette.TEXT_MUTED,
    background: palette.BG,
    surface: palette.SURFACE,
    surfaceAlt: palette.SURFACE_ALT,
    border: palette.BORDER,
  },
} as const;

export type UiTheme = typeof uiTheme;

type ColorScheme = "light" | "dark";

export interface UIProviderProps {
  children: JSX.Element;
  /** Seed only when the user has no stored choice. */
  defaultColorScheme?: ColorScheme;
  /** Authoritative override; wins over storage, the bootstrap and the default. */
  forceColorScheme?: ColorScheme;
}

export function UIProvider(props: UIProviderProps) {
  // Apply on mount straight away: index.html paints the root attribute before
  // the bundle, so a prop-driven scheme must correct it without waiting for an
  // effect (and without a visible flash of the wrong scheme).
  const force = props.forceColorScheme;
  const fallback = props.defaultColorScheme;
  if (force) {
    applyColorScheme(force);
  } else if (fallback && !hasStoredColorScheme()) {
    applyColorScheme(fallback);
  }

  // Props are getters in Solid — follow later changes too. `defer` skips the
  // initial values applied above. Both writes go through the shared signal and
  // the data-color-scheme attribute, never through localStorage.
  createEffect(
    on(
      () => props.forceColorScheme,
      (next) => {
        if (next) applyColorScheme(next);
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      () => props.defaultColorScheme,
      (next) => {
        if (next && !props.forceColorScheme && !hasStoredColorScheme()) applyColorScheme(next);
      },
      { defer: true },
    ),
  );

  // With neither prop set this is still a pass-through: no attribute, signal or
  // storage write, so the pre-paint bootstrap stays authoritative.
  return <>{props.children}</>;
}
