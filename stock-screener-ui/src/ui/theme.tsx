// Local UI provider stub. Styling is provided by Tailwind tokens + sxTheme.
import type { JSX } from "solid-js";

export const uiTheme = {} as any;

export function UIProvider({ children }: { children: JSX.Element; defaultColorScheme?: "light" | "dark"; forceColorScheme?: "light" | "dark" }) {
  return <>{children}</>;
}
