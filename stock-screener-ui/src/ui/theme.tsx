// Local UI provider. Styling still comes from Tailwind tokens + sxTheme; the
// provider's one job is to bridge the colour-scheme props onto the shared
// `useColorScheme` signal so CSS vars, charts and JS token readers agree.
import { createEffect, on, type JSX } from "solid-js";
import { applyColorScheme, hasStoredColorScheme } from "./hooks";

export const uiTheme = {} as any;

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
